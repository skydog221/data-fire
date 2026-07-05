# data-fire 后端测试公共夹具
# 设计思想：后端所有 actions 都 await get_db() 拿 Prisma 单例后做 find_many/create_many，
# 真跑要 PostgreSQL+Redis。这里用 monkeypatch 把 store.get_db/get_redis 换成假实现，
# 让纯聚合算法在零基础设施下被测——假 db 按"预设 rows"返、假 redis 可控抢锁结果。
# 这是 HOP"指令只组合数据、数据由 store 提供"的测试投影：换个 store 就能离线跑指令。
#
# 用法（在任意 test_*.py 里）：
#   async def test_xxx(fake_db, fake_redis, patch_store):
#       fake_db.rows = [...]              # 预设 find_many 返回的行
#       await session.list_('p_abc', 30)  # 跑被测指令，读 fake_db.rows 聚合
#   fake_redis.acquire = False            # 模拟"没抢到锁"
#   await collect.records({'records': [...]})  # 走 Redis=None 降级分支：fake_redis_none
#
# 注意：patch_store fixture 在每个用例前后还原 get_db/get_redis，避免单例污染跨用例。

import sys
import os
import asyncio
from types import SimpleNamespace

import pytest

# 让 conftest 能 import 到 server 根目录下的 store/actions。pytest 从 server/ 运行时本就在 sys.path，
# 但显式插一次更稳，防止从仓库根目录调用 pytest 时找不到模块。
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)


# 假 Prisma 客户端。只实现 actions 用到的两个方法：find_many / create_many。
# find_many 按 where/order 过滤？这里简化为"按 category/name 过滤预设 rows"，覆盖各 action 的查询模式。
# 真实 Prisma 的 where 是嵌套 dict（如 {'ts': {'gte': since}}），假实现只解一层关键字 + gte/None 兜底，
# 够测聚合逻辑即可——本测试重点是内存聚合算法，不是 Prisma 查询翻译。
class FakeDb:
    def __init__(self):
        # 预设的行表。每个元素是一个 SimpleNamespace，模拟 Prisma 返回的 model 实例（属性访问 r.name/r.ts）。
        # 测试用例直接赋 fake_db.rows = [...] 来"喂"数据给被测 action。
        self.rows: list = []
        # 记录 create_many 被喂进去的写入数据，便于断言"落库了什么"。
        self.inserted: list[dict] = []

    def _make_proxy(self):
        # 造一个带 find_many/create_many 的代理。actions 写法是 db.eventrecord.find_many(...)，
        # db.eventrecord 是属性（见模块末 property 注入），返回这个 proxy，链式调 find_many/create_many。
        db_self = self
        class _Proxy:
            async def find_many(self_inner, where=None, order=None):
                return db_self._filter_rows(where, order)
            async def create_many(self_inner, data=None):
                db_self.inserted.extend(data or [])
        return _Proxy()

    def _filter_rows(self, where: dict | None, order: dict | None) -> list:
        # 按 where 关键字过滤预设 rows。支持顶层字段相等 + {'ts': {'gte': x}} 这类嵌套。
        # 注意：故意不应用 ts 的 gte 过滤——days_ago_ts(days) 算的是"真实当前 30 天前"，
        # 而测试用的 ts 是固定小整数（如 1000~7000），若按 gte 过滤全会被剔除。
        # 本假实现的职责是"喂给 action 它要聚合的行"，action 本身不会再按 ts 二次过滤
        # （ts 过滤是 Prisma 的活，action 只做内存聚合），故这里对 ts 的 gte 条件直接放行，
        # 只对 category/name/projectId 等相等条件过滤。这是测试投影的合理简化。
        out = list(self.rows)
        if where:
            for key, cond in where.items():
                if key == 'ts':
                    continue  # 跳过时间窗过滤，见上注释
                filtered = []
                for r in out:
                    val = getattr(r, key, None)
                    if isinstance(cond, dict):
                        # 其他嵌套条件暂不支持，放行
                        filtered.append(r)
                    else:
                        if val != cond:
                            continue
                        filtered.append(r)
                out = filtered
        # order 支持 {'ts': 'asc'|'desc'}
        if order:
            for key, direction in order.items():
                out.sort(key=lambda r: getattr(r, key), reverse=(direction == 'desc'))
        return out


# 让 FakeDb 支持 db.eventrecord 属性访问返回 proxy（模拟 Prisma 的 db.eventrecord.find_many 链式）。
# 给 FakeDb 注入 eventrecord property。做成 property 而非实例属性，每次访问返回新 proxy 但共享 rows/inserted。
# actions 写法是 db.eventrecord.find_many(...)（属性取值再调方法），故必须用 property 而非普通方法。
FakeDb.eventrecord = property(lambda self: self._make_proxy())  # type: ignore[assignment]


# 假 Redis。只实现 collect 用到的 set(nx, ex) / delete。
# acquire 控制 set NX 的返回值：True=抢到锁、False=没抢到、模拟真实 Redis 的 SET NX 语义。
class FakeRedis:
    def __init__(self, acquire: bool = True):
        self.acquire = acquire  # set NX 是否返回 True（抢到锁）
        self.set_calls: list[dict] = []  # 记录 set 调用参数，便于断言锁 key 与 ttl
        self.delete_calls: list[str] = []  # 记录 delete 调用

    async def set(self, key, value, ex=None, nx=False):
        self.set_calls.append({'key': key, 'value': value, 'ex': ex, 'nx': nx})
        return self.acquire  # True=抢到、False=没抢到

    async def delete(self, key):
        self.delete_calls.append(key)
        return 1


# ---- fixtures ----

@pytest.fixture
def fake_db():
    """一个干净的假 Prisma 客户端。用例给 fake_db.rows 赋值来喂查询数据。"""
    return FakeDb()


@pytest.fixture
def fake_redis():
    """一个默认能抢到锁的假 Redis。用例改 .acquire=False 模拟没抢到。"""
    return FakeRedis(acquire=True)


@pytest.fixture
def fake_redis_none(monkeypatch):
    """让 get_redis 直接返回 None，触发 collect 的进程内 asyncio.Lock 降级分支。"""
    import store
    monkeypatch.setattr(store, 'get_redis', _async_none)
    return None


async def _async_none():
    # get_redis 是 async，patch 成返回 None 的 async 函数
    return None


@pytest.fixture
def patch_store(monkeypatch, fake_db, fake_redis):
    """
    把 get_db / get_redis 换成返回假实现。
    在所有 action 测试里用：拿到假 db/redis，被测 action 读它们聚合，零真基础设施。
    用例可通过给 fake_db.rows 赋值、改 fake_redis.acquire 来控制被测分支。

    关键：collect.py 用 `from store import get_db, get_redis` 把名字绑定到自己模块命名空间，
    故只 patch store.get_db 不够——collect 仍持有旧引用。这里同时 patch 各 actions 模块的绑定，
    确保被测 action 真的调到假实现。
    """
    import store
    import actions.collect as collect
    import actions.session as session
    import actions.event as event
    import actions.player as player
    import actions.metric as metric
    fake_get_db = _make_async(fake_db)
    fake_get_redis = _make_async(fake_redis)
    # patch store 本体（main.py 路由层会用到）+ 各 actions 模块持有的绑定
    for mod in (store, collect, session, event, player, metric):
        monkeypatch.setattr(mod, 'get_db', fake_get_db, raising=False)
        monkeypatch.setattr(mod, 'get_redis', fake_get_redis, raising=False)
    return fake_db


def _make_async(value):
    """把一个普通值包成 async 函数，用于 patch async 的 get_db/get_redis。"""
    async def _return():
        return value
    return _return


# 工具：快速造一行 EventRecord 的 SimpleNamespace（模拟 Prisma model 实例的属性访问）。
# actions 里都是 r.name / r.ts / r.value / r.properties / r.sessionId / r.userUuid 属性访问，
# 故用 SimpleNamespace 而非 dict。
def row(**kwargs):
    """造一行记录。缺省字段补 None/''，避免 getattr 落空。
    projectId 默认 'p_abc'——所有 action 测试都用 p_abc 查询，这样测试行天然通过 where 过滤，
    用例无需每行都写 projectId='p_abc'。需要别的 projectId 时覆盖即可。"""
    defaults = dict(projectId='p_abc', sessionId='', userUuid='', name='', category='event',
                    value=None, properties=None, ts=0)
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)
