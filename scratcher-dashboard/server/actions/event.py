# data-fire 后端"查询事件"指令
# 设计思想：把某事件按时间分布统计出来，让 dashboard 画出"点赞/收藏/关注等事件的时机分布"。
# 比如看某事件在会话进行到第几秒最常发生，或按天看事件趋势。
# 入口 main.py 收到 GET /events/{projectId} 后调用 event.timeline() 或 event.top()。
#
# 调用示例：
#   from actions import event
#   await event.timeline('p_abc', name='like', days=7)   # 返回 [{bucket, count}] 按天分桶
#   await event.top('p_abc', days=7)                      # 返回最热门的事件名及次数

from store import get_db
from tools.time import days_ago_ts, ts_to_day_bucket


# 取某事件在最近 n 天按天分桶的次数。用于画趋势折线。
# name 留空则统计所有 event 类记录。
async def timeline(project_id: str, name: str | None = None, days: int = 30) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    where = {'projectId': project_id, 'category': 'event', 'ts': {'gte': since}}
    if name:
        where['name'] = name
    rows = await db.eventrecord.find_many(where=where)
    # 内存里按天分桶计数。数据量按"最近 n 天某事件"算不会太大，内存分桶足够，避免写复杂 SQL。
    buckets: dict[int, int] = {}
    for r in rows:
        buckets[ts_to_day_bucket(r.ts)] = buckets.get(ts_to_day_bucket(r.ts), 0) + 1
    return sorted([{'bucket': k, 'count': v} for k, v in buckets.items()], key=lambda x: x['bucket'])


# 取最近 n 天最热门的事件名 Top N。用于看玩家最常触发哪些事件。
async def top(project_id: str, days: int = 30, limit: int = 10) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'event', 'ts': {'gte': since}}
    )
    # 内存按 name 计数再排序取前 N
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.name] = counts.get(r.name, 0) + 1
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:limit]
    return [{'name': n, 'count': c} for n, c in ranked]
