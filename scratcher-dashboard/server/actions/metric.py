# data-fire 后端"聚合指标"指令
# 设计思想：把 metric/counter/score/funnel 四类数值型记录各自聚合成 dashboard 要的形状。
# metric 画折线（按时间序列）、counter 取最新值、score 做分布与排行、funnel 算每步转化率。
# 入口 main.py 收到 GET /metrics/* 等路由后调用本文件对应方法。
#
# 调用示例：
#   from actions import metric
#   await metric.series('p_abc', name='hp', days=7)   # 返回 [{ts, value}] 血量折线
#   await metric.score_dist('p_abc')                   # 返回分数分布与最高分
#   await metric.funnel('p_abc', funnel='onboard')     # 返回 [{step, count, rate}]

import json
from store import get_db
from tools.time import days_ago_ts


# 取某指标最近 n 天的时间序列。用于折线图，如血量/速度/金币随时间变化。
async def series(project_id: str, name: str, days: int = 30) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'metric', 'name': name, 'ts': {'gte': since}},
        order={'ts': 'asc'},
    )
    # 直接映射成 {ts, value} 序列，前端按 ts 排点连线
    return [{'ts': r.ts, 'value': r.value} for r in rows if r.value is not None]


# 取所有计数器的最新值。counter 每次变更都上报，取每个 name 的最后一条即当前值。
async def counters(project_id: str) -> list:
    db = await get_db()
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'counter'}, order={'ts': 'desc'}
    )
    # 按 name 取第一条（desc 排序后最新在前），即每个计数器当前值
    latest: dict[str, dict] = {}
    for r in rows:
        if r.name not in latest:
            latest[r.name] = {'name': r.name, 'value': r.value, 'ts': r.ts}
    return list(latest.values())


# 取分数分布与排行。score 是特殊的 counter，单独做统计。
async def score_dist(project_id: str, days: int = 30) -> dict:
    db = await get_db()
    since = days_ago_ts(days)
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'score', 'ts': {'gte': since}}
    )
    values = [r.value for r in rows if r.value is not None]
    if not values:
        return {'count': 0, 'max': 0, 'min': 0, 'avg': 0, 'topScores': []}
    # 按分数降序取前 10 做排行榜
    top = sorted(values, reverse=True)[:10]
    return {
        'count': len(values),
        'max': max(values),
        'min': min(values),
        'avg': round(sum(values) / len(values), 1),
        'topScores': top,
    }


# 取某漏斗各步骤到达人数与转化率。funnel 记录的 name 是步骤名、properties 里存漏斗名。
async def funnel(project_id: str, funnel: str, days: int = 30) -> list:
    db = await get_db()
    since = days_ago_ts(days)
    rows = await db.eventrecord.find_many(
        where={'projectId': project_id, 'category': 'funnel', 'ts': {'gte': since}},
        order={'ts': 'asc'},
    )
    # 过滤出属于本漏斗的记录（properties.funnel == funnel）
    steps: dict[str, set] = {}  # step -> 到达该步骤的 userUuid 集合（去重）
    step_order: list = []       # 保留首次出现顺序，漏斗步骤要按顺序展示
    for r in rows:
        try:
            meta = json.loads(r.properties or '{}')
        except Exception:
            continue
        if meta.get('funnel') != funnel:
            continue
        step = r.name
        if step not in steps:
            steps[step] = set()
            step_order.append(step)
        steps[step].add(r.userUuid)

    # 算每步到达人数与前一步的转化率
    result = []
    prev_count = None
    for step in step_order:
        count = len(steps[step])
        # 转化率 = 本步人数 / 上一步人数。第一步无前驱，rate=null。
        rate = round(count / prev_count, 3) if prev_count else None
        result.append({'step': step, 'count': count, 'rate': rate})
        prev_count = count
    return result
