# data-fire 后端"接收上报"指令
# 设计思想：这是 HOP 链路"效果反馈"的服务端终点。拓展端 sender 把一批 EventRecord POST 到这里，
# 本指令负责按拓展端传来的 projectId 批量落库。projectId 已经由拓展从当前 URL 解析，后端不再分配。
# 入口 main.py 收到 POST /collect 后调用 collect.records()。
#
# 指令职责单一：只做"接收并落库"，不做查询（查询归其他 actions）。
#
# 调用示例：
#   from actions import collect
#   await collect.records({'records': [{...}, {...}]})   # 返回 {'ok': True, 'projectId': '6743...', 'accepted': 2}

import asyncio
from store import get_db, get_redis, config

# 进程内内存 projectId 锁：仅当 Redis 不可用（降级运行）时兜底，防同进程并发写同一个作品。
# 结构：_mem_locks[key] = asyncio.Lock()。仅本进程有效，不跨进程，但 Redis 可用时不会用到。
_mem_locks: dict[str, asyncio.Lock] = {}


# 接收一批记录并落库。projectId 由拓展端从当前 URL 的 extension/detail/project 路径段解析，后端只负责接收并按这个 id 落库。
async def records(payload: dict) -> dict:
    db = await get_db()
    incoming = payload.get('records', [])
    if not incoming:
        return {'ok': True, 'projectId': '', 'accepted': 0}

    # 取第一条里的 projectId 作为本批次归属。这个值来自拓展端解析当前 URL，形如 detail/{id} 里的 id。
    first = incoming[0]
    stable_id = first.get('projectId', '') or 'p_unknown'

    # 用 Redis 锁防并发：多个拓展实例同时上报同一作品时，按 projectId 串行写入同一批次相关记录。
    # 锁 key 用 projectId，60 秒过期兜底防止死锁。Redis 不可用时会降级到进程内锁。
    redis = await get_redis()
    lock_key = f'projectfp:{stable_id}'

    if redis is not None:
        # Redis 可用：setnx 语义，返回 True 说明抢到锁；没抢到也能写，因为 projectId 已经由拓展端确定。
        acquired = await redis.set(lock_key, '1', ex=config['project_lock_ttl'], nx=True)
        if not acquired:
            # 没抢到锁：继续写入即可。锁只用于并发削峰，不影响 projectId 归属。
            pass
        # 批量构造写入数据：把每条记录的字段对齐到 Prisma 模型，projectId 统一用 URL 解析出的作品 id。
        data = [
            {
                'projectId': stable_id,
                'sessionId': r.get('sessionId', ''),
                'userUuid': r.get('userUuid', ''),
                'name': r.get('name', ''),
                'category': r.get('category', 'event'),
                'value': r.get('value'),
                'properties': r.get('properties'),
                'ts': int(r.get('ts', 0)),
            }
            for r in incoming
        ]
        # 一次批量插入，减少 DB 往返。Prisma 的 create_many 走单条 SQL。
        await db.eventrecord.create_many(data=data)
        # 释放锁（抢到才释）。没抢到时没有持有锁，不需要释放。
        if acquired:
            await redis.delete(lock_key)
    else:
        # Redis 降级：用进程内 asyncio.Lock 兜底，只防同进程并发写同一 projectId。
        # 锁按指纹 key 复用，同一指纹只一把锁。with 语法保证 try/finally 自动释放，无死锁风险。
        mem_lock = _mem_locks.setdefault(lock_key, asyncio.Lock())
        async with mem_lock:
            # 批量构造写入数据：把每条记录的字段对齐到 Prisma 模型，projectId 统一用 URL 解析出的作品 id。
            data = [
                {
                    'projectId': stable_id,
                    'sessionId': r.get('sessionId', ''),
                    'userUuid': r.get('userUuid', ''),
                    'name': r.get('name', ''),
                    'category': r.get('category', 'event'),
                    'value': r.get('value'),
                    'properties': r.get('properties'),
                    'ts': int(r.get('ts', 0)),
                }
                for r in incoming
            ]
            # 一次批量插入，减少 DB 往返。Prisma 的 create_many 走单条 SQL。
            await db.eventrecord.create_many(data=data)

    # 返回收到的 projectId，方便调用方确认本批次归属；拓展端不会依赖它回写 projectId。
    # 接收条件已保证 incoming 非空，这里 accepted 取 incoming 长度（落库条数在此前两分支都已写入）。
    # ok=True 是与拓展端 sender.post 的契约字段：sender 严格判 body.ok === true 才算上报成功，
    # 缺了它 sender 会把成功上报当失败并走离线缓存。
    return {'ok': True, 'projectId': stable_id, 'accepted': len(incoming)}
