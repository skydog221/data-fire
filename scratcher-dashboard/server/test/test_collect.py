# data-fire 后端"接收上报"指令单元测试
# 设计思想：collect.records 是拓展端→后端的唯一落库入口，逻辑分支多（空批/正常/抢锁/降级）。
# 这里用 fake_db/fake_redis（见 conftest）零基础设施地覆盖所有分支，并断言响应体带 ok=True。
# 当前设计：projectId 由拓展端从当前 URL 解析，后端只负责按该 projectId 原样落库，不再做指纹分配。

from actions import collect


async def test_records_empty_batch_returns_empty_without_writing(patch_store, fake_db):
    # 空批：不落库，返回 accepted=0，projectId 为空字符串
    result = await collect.records({'records': []})
    assert result == {'ok': True, 'projectId': '', 'accepted': 0}
    assert fake_db.inserted == []  # 没写库


async def test_records_stores_with_incoming_projectId_and_ok_contract(patch_store, fake_db, fake_redis):
    # 正常批：写入条数=accepted，记录字段对齐模型，projectId 使用拓展端传来的作品 id，响应带 ok=True
    records = [
        {'projectId': '6743db44e6d6684b55c0e58f', 'sessionId': 's1', 'userUuid': 'u1',
         'name': 'session_start', 'category': 'session', 'value': 1700, 'properties': None, 'ts': 1700},
        {'projectId': '6743db44e6d6684b55c0e58f', 'sessionId': 's1', 'userUuid': 'u1',
         'name': 'like', 'category': 'event', 'value': None, 'properties': None, 'ts': 1800},
    ]
    result = await collect.records({'records': records})
    assert result == {'ok': True, 'projectId': '6743db44e6d6684b55c0e58f', 'accepted': 2}
    assert all(r['projectId'] == '6743db44e6d6684b55c0e58f' for r in fake_db.inserted)
    assert len(fake_db.inserted) == 2


async def test_records_missing_projectId_falls_back_to_unknown(patch_store, fake_db):
    # 没带 projectId 时归到 p_unknown，避免空字符串散进 DB 难查
    records = [{'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'category': 'event', 'ts': 1}]
    result = await collect.records({'records': records})
    assert result == {'ok': True, 'projectId': 'p_unknown', 'accepted': 1}
    assert fake_db.inserted[0]['projectId'] == 'p_unknown'


async def test_records_missing_category_defaults_to_event(patch_store, fake_db):
    # 缺省 category 字段后端补 'event'，防丢字段
    records = [{'projectId': 'p_x', 'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'value': None, 'ts': 1}]
    await collect.records({'records': records})
    assert fake_db.inserted[0]['category'] == 'event'


async def test_records_missing_ts_coerced_to_zero(patch_store, fake_db):
    # 缺 ts 字段时 int(r.get('ts', 0)) 兜底为 0
    records = [{'projectId': 'p_x', 'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'value': None, 'category': 'event'}]
    await collect.records({'records': records})
    assert fake_db.inserted[0]['ts'] == 0


async def test_records_redis_lock_acquired_then_released(patch_store, fake_db, fake_redis):
    # 抢到锁：set NX 返回 True，写库后 delete 释锁；锁 key 直接用 projectId
    fake_redis.acquire = True
    records = [{'projectId': 'p_x', 'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'category': 'event', 'ts': 1}]
    await collect.records({'records': records})
    assert len(fake_redis.set_calls) == 1
    assert fake_redis.set_calls[0]['key'] == 'projectfp:p_x'
    assert fake_redis.set_calls[0]['nx'] is True
    assert fake_redis.delete_calls == ['projectfp:p_x']


async def test_records_redis_lock_not_acquired_skips_delete_but_still_writes(patch_store, fake_db, fake_redis):
    # 没抢到锁：继续写入即可。锁只用于并发削峰，不影响 projectId 归属
    fake_redis.acquire = False
    records = [{'projectId': 'p_x', 'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'category': 'event', 'ts': 1}]
    result = await collect.records({'records': records})
    assert fake_redis.delete_calls == []  # 没抢到不释锁
    assert result == {'ok': True, 'projectId': 'p_x', 'accepted': 1}
    assert len(fake_db.inserted) == 1


async def test_records_redis_unavailable_falls_back_to_mem_lock(monkeypatch, fake_db):
    # Redis=None 降级：走进程内 asyncio.Lock 兜底，照样落库返回正确响应
    # 注意：collect.py 用 `from store import get_db, get_redis` 把名字绑定到自身命名空间，
    # 故要 patch collect 模块持有的引用（get_db 和 get_redis 都要），而非只 patch store
    import store
    import actions.collect as collect_mod
    async def _none():
        return None
    monkeypatch.setattr(store, 'get_db', _async(fake_db))
    monkeypatch.setattr(store, 'get_redis', _none)
    monkeypatch.setattr(collect_mod, 'get_db', _async(fake_db), raising=False)
    monkeypatch.setattr(collect_mod, 'get_redis', _none, raising=False)
    records = [{'projectId': 'p_x', 'sessionId': 's1', 'userUuid': 'u1', 'name': 'x', 'category': 'event', 'ts': 1}]
    result = await collect.records({'records': records})
    assert result == {'ok': True, 'projectId': 'p_x', 'accepted': 1}
    assert len(fake_db.inserted) == 1


def _async(value):
    # 把普通值包成 async 函数，用于 patch async 的 get_db
    async def _return():
        return value
    return _return
