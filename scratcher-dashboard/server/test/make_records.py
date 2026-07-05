# data-fire 联调测试报文构造器
# 设计思想：联调要验证"拓展端按真实 Track/Session 逻辑生成的 EventRecord 经后端 /collect 落库后，
# 各读接口能正确回算"。为避免手写 14 字段错配，本文件按拓展端 src/commands/*.ts 的真实字段约定
# 产记录。**两侧字段契约改动要同步本文件**——这是联调的"对齐基准"。
#
# 字段契约对照（拓展端产生 → 后端期望）：
#   name      → name
#   category  → category（缺省后端补 'event'）
#   value     → value（session_start=开始ts / session_end=结束ts / metric/score/counter 累加后值）
#   properties(JSON 字符串)
#     session_end    → { durationMs, isComplete, startTs }   见 src/commands/session.ts end()
#     counter        → { op, delta }  op='add'|'overwrite'   见 src/commands/event.ts counterAdd/Set
#     funnel         → { funnel, stepIndex }                 见 src/commands/event.ts funnelStep()
#     session_start  → { visitCount, isReturning }           见 src/commands/session.ts start()
#   ts        → int(ms)  拓展端 pushRecord 用 Date.now()
#   projectId 占位 'p_pending_*' → 后端经指纹变 'p_<sha16>'
#   响应体    → { ok: true, projectId, accepted }  ★ ok=True 是拓展端 sender.post 成功判定的契约字段
#
# 调用示例：
#   from test.make_records import session_start, session_end, track_event, funnel_step
#   batch = [session_start('s1','u1',1000), track_event('like', value=None, ts=1200), session_end('s1','u1',1000,2000)]

import json


def session_start(sessionId, userUuid, startTs, projectId='p_pending_demo', visitCount=1, isReturning=False):
    """造一条 session_start 记录。value 放开始时间戳，properties 放访问次数与是否回头客。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': 'session_start', 'category': 'session', 'value': startTs,
        'properties': json.dumps({'visitCount': visitCount, 'isReturning': isReturning}),
        'ts': startTs,
    }


def session_end(sessionId, userUuid, startTs, endTs, isComplete=True, projectId='p_pending_demo'):
    """造一条 session_end 记录。value 放结束时间戳，properties 放时长/完整标记/开始时间戳。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': 'session_end', 'category': 'session', 'value': endTs,
        'properties': json.dumps({'durationMs': endTs - startTs, 'isComplete': isComplete, 'startTs': startTs}),
        'ts': endTs,
    }


def track_event(name, value=None, detail=None, projectId='p_pending_demo', sessionId='s1', userUuid='u1', ts=0):
    """造一条 event 记录。拓展端 Track.event/eventValue/eventDetail 对应此 category='event'。"""
    properties = json.dumps({'detail': str(detail)}) if detail is not None else None
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': name, 'category': 'event', 'value': value,
        'properties': properties, 'ts': ts,
    }


def track_metric(name, value, projectId='p_pending_demo', sessionId='s1', userUuid='u1', ts=0):
    """造一条 metric 记录。对应拓展端 Track.metric。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': name, 'category': 'metric', 'value': value,
        'properties': None, 'ts': ts,
    }


def track_counter(name, value, op='add', delta=None, projectId='p_pending_demo', sessionId='s1', userUuid='u1', ts=0):
    """造一条 counter 记录。op='add' 对应 counterAdd（带 delta），op='overwrite' 对应 counterSet。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': name, 'category': 'counter', 'value': value,
        'properties': json.dumps({'op': op, 'delta': delta if delta is not None else value}),
        'ts': ts,
    }


def track_score(value, projectId='p_pending_demo', sessionId='s1', userUuid='u1', ts=0):
    """造一条 score 记录。对应拓展端 Track.score。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': 'score', 'category': 'score', 'value': value,
        'properties': None, 'ts': ts,
    }


def funnel_step(funnel, step, stepIndex, userUuid='u1', projectId='p_pending_demo', sessionId='s1', ts=0):
    """造一条 funnel 记录。name 放步骤名，properties 放漏斗名与步骤序号。"""
    return {
        'projectId': projectId, 'sessionId': sessionId, 'userUuid': userUuid,
        'name': step, 'category': 'funnel', 'value': None,
        'properties': json.dumps({'funnel': funnel, 'stepIndex': stepIndex}),
        'ts': ts,
    }
