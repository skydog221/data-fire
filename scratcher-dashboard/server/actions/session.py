# data-fire 后端"查询会话"指令
# 设计思想：会话信息存成 session_start / session_end 两条事件记录。本指令把它们配对还原成"一次会话"。
# 配对规则：同一 sessionId 下，start 带 value=开始时间戳、end 带 properties={durationMs,isComplete}。
# 入口 main.py 收到 GET /sessions/{projectId} 后调用 session.list_()。
#
# 调用示例：
#   from actions import session
#   await session.list_('p_abc', days=7)   # 返回最近7天会话列表
#   await session.summary('p_abc')          # 返回会话数、平均时长、完整率

from store import get_db
from tools.time import days_ago_ts


# 取某作品最近 n 天的会话列表。把 start/end 记录配对成 {sessionId,startTs,durationMs,isComplete}。
async def list_(project_id: str, days: int = 30) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    # 一次查出该作品时间段内所有 session 类记录，按 sessionId 在内存里配对。
    # 这样只查一次 DB，比按 sessionId 逐个查快得多；会话量不会大到撑爆内存（最近 n 天有限）。
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'session', 'ts': {'gte': since}},
        order={'ts': 'asc'},
    )

    # 以 sessionId 为 key 收集每条会话的 start/end 信息
    sessions: dict[str, dict] = {}
    for r in rows:
        sid = r.sessionId
        slot = sessions.setdefault(sid, {'sessionId': sid, 'startTs': None, 'durationMs': None, 'isComplete': False})
        if r.name == 'session_start':
            slot['startTs'] = r.value  # start 的 value 放开始时间戳
            slot['userUuid'] = r.userUuid
        elif r.name == 'session_end':
            # end 的 properties 是 JSON 字符串，解出时长和完整标记
            try:
                meta = __import__('json').loads(r.properties or '{}')
            except Exception:
                meta = {}
            slot['durationMs'] = meta.get('durationMs')
            slot['isComplete'] = bool(meta.get('isComplete'))
            slot['endTs'] = r.value
    return list(sessions.values())


# 取某作品会话总览：会话总数、平均时长、完整结束率、回头率。
# 一个指令算完一个清楚的业务动作"会话总览"，内部组合 list_ 而非嵌套复杂逻辑。
async def summary(project_id: str, days: int = 30) -> dict:
    sessions = await list_(project_id, days)
    total = len(sessions)
    # 只对有 durationMs 的会话算平均时长，避免 None 干扰均值
    durations = [s['durationMs'] for s in sessions if s.get('durationMs') is not None]
    complete = sum(1 for s in sessions if s.get('isComplete'))
    # 回头率：同一 userUuid 出现多次视为回头。按 userUuid 去重计数。
    uuids = [s.get('userUuid') for s in sessions if s.get('userUuid')]
    unique_players = len(set(uuids))
    returning = total - unique_players  # 出现次数超出唯一玩家数的部分即回头次数
    avg_ms = sum(durations) / len(durations) if durations else 0
    return {
        'totalSessions': total,
        'avgDurationMs': round(avg_ms),
        'completionRate': round(complete / total, 3) if total else 0,
        'uniquePlayers': unique_players,
        'returningVisits': max(0, returning),
        'returningRate': round(max(0, returning) / total, 3) if total else 0,
    }
