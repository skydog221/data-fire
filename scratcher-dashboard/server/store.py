# data-fire 开发者端后端共享状态
# 设计思想：HOP 要求 store 集中存放"程序运行时所有需要共享调用的数据"。
# 后端要共享的是：Prisma 客户端单例（连 MySQL）、Redis 连接、服务配置。
# 所有 actions 文件 import 本模块的 db / redis / config 来读写数据，不各自建连接。
#
# 调用示例：
#   from store import db, redis_client, config
#   await db.eventrecord.create(data={...})      # 写一条记录
#   await redis_client.set('key', 'value')        # 写缓存
#   port = config['port']                         # 读配置

import os
from prisma import Prisma

def parse_cors_origins(raw: str | None) -> list[str]:
    """把 CORS_ORIGIN 解析成 FastAPI CORSMiddleware 要的 origin 列表。支持 '*' 或逗号分隔多个域名。"""
    # 卫语句：没配置时默认全放开，方便本地开发；生产环境应在 .env 里写具体 dashboard 域名
    if not raw:
        return ['*']
    # 卫语句：星号单独出现时按全放开处理，避免被下面 split 当成普通 origin
    if raw.strip() == '*':
        return ['*']

    origins = [origin.strip().rstrip('/') for origin in raw.split(',') if origin.strip()]  # 去空格/尾斜杠，逗号分隔多域名
    return origins or ['*']  # 全写空时兜底全放开，避免服务因空列表导致所有跨域都失败


# 服务配置。从环境变量读，带默认值，方便本地开发。
# 改这里=改后端运行参数，集中可见。
config = {
    'port': int(os.getenv('PORT', '8000')),            # FastAPI 监听端口
    # 允许的前端来源。支持 '*' 或逗号分隔多个域名，如：
    # CORS_ORIGIN=https://dash.example.com,https://www.example.com,http://localhost:5173
    'cors_origins': parse_cors_origins(os.getenv('CORS_ORIGIN', '*')),
    'redis_url': os.getenv('REDIS_URL', 'redis://localhost:6379/0'),  # Redis 连接串
    # 项目指纹锁的过期时间（秒）。首次上报时按作品指纹分配 projectId，用 Redis 锁防并发重复分配。
    'project_lock_ttl': int(os.getenv('PROJECT_LOCK_TTL', '60')),
}

# Prisma 客户端单例。用模块级变量实现单例，整个进程共用一个连接池。
# 延迟到 connect() 时才真正连，避免 import 时就要求 MySQL 在线。
_db: Prisma | None = None


async def get_db() -> Prisma:
    """取已连接的 Prisma 客户端单例。首次调用会建连。"""
    # 卫语句：已建连直接返回，避免重复连接
    global _db
    if _db is not None:
        return _db
    _db = Prisma()
    await _db.connect()
    return _db


# Redis 连接单例。用 redis-py 异步客户端。
# Redis 用途：1) 项目指纹锁防并发重复分配 projectId；2) 热点查询结果缓存。
# 降级策略：Redis 为可选依赖，连不上则 _redis_client 置 None 且 _redis_unavailable 置 True，
# 后续不再重试（避免每个请求都超时拖慢响应），后端在纯 PostgreSQL 下照常运行。
_redis_client = None
_redis_unavailable = False   # 降级标志：True 表示已判定 Redis 不可用，持续返回 None，不再重试


async def get_redis():
    """取已连接的 Redis 异步客户端单例。首次调用会建连；连不上则降级返回 None。"""
    global _redis_client, _redis_unavailable
    # 卫语句：已建连直接返回单例
    if _redis_client is not None:
        return _redis_client
    # 卫语句：已判定不可用，直接返回 None 避免每个请求都重试超时
    if _redis_unavailable:
        return None
    # 延迟 import，避免没装 redis 时 import 本模块就崩
    import redis.asyncio as aioredis
    try:
        client = aioredis.from_url(config['redis_url'], decode_responses=True)
        # 真正探活一次：from_url 不会立即建连，ping 才会触发，连不上抛异常
        await client.ping()
        _redis_client = client   # 探活成功才缓存单例
        return _redis_client
    except Exception as e:
        # 降级：不抛错、不阻塞，记一条 warning，置标志后续持续返回 None
        print(f'[store] Redis 不可用，降级运行：{e}')
        _redis_unavailable = True
        return None


# FastAPI 生命周期事件：启动时建连、关闭时断连。main.py 会把它挂到 app 的 lifespan。
async def lifespan_connect():
    """应用启动时预建 Prisma 与 Redis 连接。Redis 连不上只 warning，不阻塞启动。"""
    await get_db()
    # Redis 降级：连不上时 get_redis 已记 warning 并返回 None，这里不 raise，应用照常启动
    await get_redis()


async def lifespan_disconnect():
    """应用关闭时断开连接，释放资源。"""
    global _db, _redis_client
    if _db is not None:
        await _db.disconnect()
        _db = None
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
