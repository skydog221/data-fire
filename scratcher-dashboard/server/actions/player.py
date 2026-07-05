# data-fire 后端"查询玩家"指令
# 设计思想：以 userUuid 为维度统计玩家。包括唯一玩家数、访问次数分布、回头客识别、新老构成。
# 回头率在 session.summary 里也算了一份，这里按玩家维度算得更细（每人几次、新老占比）。
# 入口 main.py 收到 GET /players/{projectId} 后调用 player.list_() 或 player.retention()。
#
# 调用示例：
#   from actions import player
#   await player.list_('p_abc', days=30)    # 返回 [{userUuid, visits, firstTs, lastTs}]
#   await player.retention('p_abc')          # 返回新老玩家占比与回头率

from store import get_db
from tools.time import days_ago_ts


# 取某作品最近 n 天的玩家列表，每人带访问次数、首次/末次出现时间。
# 只用 session_start 记录来统计（一次 start = 一次访问），保证不重复计数。
async def list_(project_id: str, days: int = 30) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'session', 'name': 'session_start', 'ts': {'gte': since}},
        order={'ts': 'asc'},
    )
    # 内存按 userUuid 聚合：visits 计数、first/last 取首尾
    players: dict[str, dict] = {}
    for r in rows:
        uid = r.userUuid
        slot = players.setdefault(uid, {'userUuid': uid, 'visits': 0, 'firstTs': r.ts, 'lastTs': r.ts})
        slot['visits'] += 1
        slot['firstTs'] = min(slot['firstTs'], r.ts)
        slot['lastTs'] = max(slot['lastTs'], r.ts)
    # 按访问次数降序，最活跃的玩家排前面
    return sorted(players.values(), key=lambda x: x['visits'], reverse=True)


# 取回头率与新老玩家占比。一个指令算完"玩家构成总览"。
async def retention(project_id: str, days: int = 30) -> dict:
    players = await list_(project_id, days)
    total = len(players)
    # visits>1 的玩家算回头客
    returning_players = sum(1 for p in players if p['visits'] > 1)
    new_players = total - returning_players
    # 总访问次数 = 每人 visits 之和；回头访问次数 = 总访问 - 唯一玩家数
    total_visits = sum(p['visits'] for p in players)
    return {
        'uniquePlayers': total,
        'newPlayers': new_players,
        'returningPlayers': returning_players,
        'returningPlayerRate': round(returning_players / total, 3) if total else 0,
        'totalVisits': total_visits,
        'avgVisitsPerPlayer': round(total_visits / total, 2) if total else 0,
    }
