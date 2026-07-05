# data-fire 联调测试：拓展端报文 ↔ 后端真实 app 往返
# 设计思想：这是本计划最高价值部分。不用浏览器，纯代码同时驱动"拓展端按真实 Track/Session 逻辑
# 生成的 EventRecord"经过真实 FastAPI app 的 /collect 落进内存 DB，再调真实读接口，断言聚合结果
# 与输入一致。验证两边契约是否真的对得上——尤其 test_collect_response_contract 固化
# "后端必须带 ok:true，否则拓展端 sender 会判失败"的契约（已修复后端 collect.records 加 ok=True）。
#
# 关键设计：用一个"可持久化的假 DB"——create_many 真存进内存列表，find_many 从这个列表查。
# 这样 /collect 写进去的记录，读接口能立刻查到，模拟真 DB 的往返但不依赖 PostgreSQL。
# Redis 用 FakeRedis（抢到锁即正常），不依赖真 Redis。

import sys
import os
from types import SimpleNamespace
from httpx import ASGITransport, AsyncClient

import pytest

# 让本文件能 import test/ 下的 make_records。pytest 把 server/ 加进 sys.path，但 test/ 子目录未必。
TEST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
if TEST_DIR not in sys.path:
    sys.path.insert(0, TEST_DIR)

import main  # noqa: E402  必须在 patch store 之后/import 路径就绪后导入
import store  # noqa: E402
from actions import collect  # noqa: E402
from test.make_records import (  # noqa: E402
    session_start, session_end, track_event, track_metric,
    track_counter, track_score, funnel_step,
)


# 可持久化的假 DB：create_many 存进内存列表，find_many 从该列表按 where 过滤。
# 这样联调的"写→读"往返在内存里成立，模拟真 DB 但零基础设施。
class RoundTripDb:
    def __init__(self):
        self._rows: list[SimpleNamespace] = []  # 真正的"库表"
        self._next_id = 1

    def _proxy(self):
        # 造一个带 find_many/create_many 的代理。actions 写法是 db.eventrecord.find_many(...)，
        # db.eventrecord 是属性（见模块末 property 注入），返回这个 proxy。
        db = self
        class _Proxy:
            async def find_many(self, where=None, order=None):
                return db._filter(where, order)
            async def create_many(self, data=None):
                for d in (data or []):
                    row = SimpleNamespace(
                        id=db._next_id,
                        projectId=d['projectId'], sessionId=d.get('sessionId', ''),
                        userUuid=d.get('userUuid', ''), name=d.get('name', ''),
                        category=d.get('category', 'event'), value=d.get('value'),
                        properties=d.get('properties'), ts=d.get('ts', 0),
                    )
                    db._rows.append(row)
                    db._next_id += 1
        return _Proxy()

    def _filter(self, where, order):
        out = list(self._rows)
        if where:
            for key, cond in where.items():
                if key == 'ts':
                    continue  # 跳过时间窗过滤（测试用固定小 ts，见 conftest._filter_rows 同款注释）
                filtered = []
                for r in out:
                    val = getattr(r, key, None)
                    if isinstance(cond, dict):
                        filtered.append(r)  # 其他嵌套条件放行
                    elif val != cond:
                        continue
                    else:
                        filtered.append(r)
                out = filtered
        if order:
            for key, direction in order.items():
                out.sort(key=lambda r: getattr(r, key), reverse=(direction == 'desc'))
        return out


# 给 RoundTripDb 注入 eventrecord property：actions 写法 db.eventrecord.find_many(...)，
# 属性取值返回 _proxy()，共享同一个 RoundTripDb 的 _rows/_next_id。做成 property 而非方法，
# 因为 db.eventrecord 是属性访问不是调用。同 conftest FakeDb 的做法。
RoundTripDb.eventrecord = property(lambda self: self._proxy())  # type: ignore[assignment]


class _FakeRedis:
    # 联调里 Redis 锁总是能抢到，不测降级（降级分支已在 test_collect.py 单测覆盖）
    async def set(self, key, value, ex=None, nx=False):
        return True
    async def delete(self, key):
        return 1


@pytest.fixture
def roundtrip(monkeypatch):
    """装一个 RoundTripDb + FakeRedis，patch 到 store 与各 actions 模块的 get_db/get_redis 绑定。
    返回 (db, client) 供用例写记录、调读接口。"""
    db = RoundTripDb()
    redis = _FakeRedis()
    async def _get_db():
        return db
    async def _get_redis():
        return redis
    # patch store 本体 + 各 actions 模块持有的绑定（collect.py 用 from store import 绑定）
    import actions.session as session_mod, actions.event as event_mod
    import actions.player as player_mod, actions.metric as metric_mod
    for mod in (store, collect, session_mod, event_mod, player_mod, metric_mod):
        monkeypatch.setattr(mod, 'get_db', _get_db, raising=False)
        monkeypatch.setattr(mod, 'get_redis', _get_redis, raising=False)
    transport = ASGITransport(app=main.app)
    client = AsyncClient(transport=transport, base_url='http://test')
    return db, client


async def test_collect_response_contract(roundtrip):
    # 固化修复后契约：/collect 响应体必须带 ok=True + projectId + accepted
    # 拓展端 sender.post 严格判 body.ok === true，缺了它会把成功上报当失败走离线缓存、projectId 不回写
    db, client = roundtrip
    batch = [session_start('s1', 'u1', 1000)]
    async with client as c:
        resp = await c.post('/collect', json={'records': batch})
    body = resp.json()
    assert body['ok'] is True  # ★ 契约字段，拓展端 sender 成功判定的依据
    assert body['projectId'] == 'p_pending_demo'  # 当前设计：后端原样确认拓展端从 URL 解析出的 projectId
    assert body['accepted'] == 1


async def test_session_round_trip(roundtrip):
    # session_start + session_end 往返：读 /sessions 能配对还原，summary 回算正确
    # 查询 projectId 直接使用拓展端从 URL 解析并上报的 'p_pending_demo'；后端不再做指纹分配
    db, client = roundtrip
    batch = [
        session_start('s1', 'u1', 1000, visitCount=1, isReturning=False),
        session_end('s1', 'u1', 1000, 2000, isComplete=True),
    ]
    project_id = 'p_pending_demo'
    async with client as c:
        await c.post('/collect', json={'records': batch})
        sessions = (await c.get(f'/sessions/{project_id}')).json()
        summary = (await c.get(f'/sessions/{project_id}/summary')).json()
    assert len(sessions) == 1
    assert sessions[0]['startTs'] == 1000
    assert sessions[0]['durationMs'] == 1000
    assert sessions[0]['isComplete'] is True
    assert summary['totalSessions'] == 1
    assert summary['avgDurationMs'] == 1000
    assert summary['completionRate'] == 1.0


async def test_retention_round_trip(roundtrip):
    # 多玩家多访问往返：/players visits 降序、/retention 新老占比
    db, client = roundtrip
    batch = [
        session_start('s1', 'u1', 1000),
        session_start('s2', 'u1', 2000),  # u1 第二次（回头）
        session_start('s3', 'u2', 3000),  # u2 新玩家
    ]
    project_id = 'p_pending_demo'
    async with client as c:
        await c.post('/collect', json={'records': batch})
        players = (await c.get(f'/players/{project_id}')).json()
        retention = (await c.get(f'/players/{project_id}/retention')).json()
    # u1 visits=2 排前，u2 visits=1
    assert players[0]['userUuid'] == 'u1'
    assert players[0]['visits'] == 2
    assert players[1]['userUuid'] == 'u2'
    assert players[1]['visits'] == 1
    # retention: 2 玩家，u1 回头(u1 visits>1)，u2 新
    assert retention['uniquePlayers'] == 2
    assert retention['returningPlayers'] == 1
    assert retention['newPlayers'] == 1
    assert retention['totalVisits'] == 3


async def test_event_timeline_top_round_trip(roundtrip):
    # 事件往返：/events/timeline 按天分桶、/events/top 排序
    db, client = roundtrip
    from test.test_event_action import DAY1, DAY1_BUCKET, DAY2, DAY2_BUCKET
    batch = [
        track_event('like', ts=DAY1),
        track_event('like', ts=DAY1 + 100),
        track_event('like', ts=DAY2),
        track_event('favorite', ts=DAY1),
    ]
    project_id = 'p_pending_demo'
    async with client as c:
        await c.post('/collect', json={'records': batch})
        timeline = (await c.get(f'/events/{project_id}/timeline?name=like&days=365')).json()
        top = (await c.get(f'/events/{project_id}/top?days=365')).json()
    # like 在 day1 有 2 条、day2 有 1 条
    assert {'bucket': DAY1_BUCKET, 'count': 2} in timeline
    assert {'bucket': DAY2_BUCKET, 'count': 1} in timeline
    # top: like=3, favorite=1
    top_map = {r['name']: r['count'] for r in top}
    assert top_map['like'] == 3
    assert top_map['favorite'] == 1


async def test_metric_counter_score_funnel_round_trip(roundtrip):
    # metric 序列、counter 最新值、score 分布、funnel 转化率全链路回算
    db, client = roundtrip
    batch = [
        track_metric('hp', 80, ts=1000),
        track_metric('hp', 60, ts=2000),
        track_counter('kills', 1, op='add', delta=1, ts=1000),
        track_counter('kills', 2, op='add', delta=1, ts=2000),  # 最新值=2
        track_counter('deaths', 0, op='overwrite', ts=1000),
        track_score(100, ts=1000),
        track_score(500, ts=2000),
        track_score(300, ts=3000),
        funnel_step('onboard', 'start', 1, ts=1000),
        funnel_step('onboard', 'step2', 2, ts=2000),
    ]
    project_id = 'p_pending_demo'
    async with client as c:
        await c.post('/collect', json={'records': batch})
        series = (await c.get(f'/metrics/{project_id}/series?name=hp&days=365')).json()
        counters = (await c.get(f'/metrics/{project_id}/counters')).json()
        scores = (await c.get(f'/metrics/{project_id}/scores?days=365')).json()
        funnel = (await c.get(f'/metrics/{project_id}/funnel?funnel=onboard&days=365')).json()
    # metric series
    assert series == [{'ts': 1000, 'value': 80}, {'ts': 2000, 'value': 60}]
    # counters 最新值
    c_map = {r['name']: r['value'] for r in counters}
    assert c_map['kills'] == 2  # 最新一条
    assert c_map['deaths'] == 0
    # score 分布
    assert scores['count'] == 3
    assert scores['max'] == 500
    assert scores['min'] == 100
    assert scores['topScores'] == [500, 300, 100]
    # funnel 转化率
    assert funnel[0] == {'step': 'start', 'count': 1, 'rate': None}
    assert funnel[1] == {'step': 'step2', 'count': 1, 'rate': 1.0}


async def test_empty_batch_returns_zero_accepted(roundtrip):
    # 空批：不落库，返回 ok=True + accepted=0
    db, client = roundtrip
    async with client as c:
        resp = await c.post('/collect', json={'records': []})
    assert resp.json() == {'ok': True, 'projectId': '', 'accepted': 0}
    assert len(db._rows) == 0  # 没写库


async def test_days_query_boundaries(roundtrip):
    # days=0 → 422、days=366 → 422、days=1/365 → 200
    db, client = roundtrip
    stable = 'p_abc'
    async with client as c:
        assert (await c.get(f'/sessions/{stable}?days=0')).status_code == 422
        assert (await c.get(f'/sessions/{stable}?days=366')).status_code == 422
        assert (await c.get(f'/sessions/{stable}?days=1')).status_code == 200
        assert (await c.get(f'/sessions/{stable}?days=365')).status_code == 200
