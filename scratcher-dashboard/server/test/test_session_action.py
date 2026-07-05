# data-fire 后端"查询会话"指令单元测试
# 设计思想：session.list_ 把 start/end 记录配对还原会话，summary 在其上算总览。
# 用 fake_db.rows 喂入预设行，断言配对逻辑、JSON 解析容错、汇总统计与除零兜底。

import json

from actions import session
from conftest import row


async def test_list_pairs_start_and_end_by_sessionId(patch_store, fake_db):
    # 同 sessionId 的 start/end 配对成一条会话：startTs 取自 start.value，durationMs/isComplete 取自 end.properties
    fake_db.rows = [
        row(sessionId='s1', name='session_start', category='session', value=1000, userUuid='u1', ts=1000),
        row(sessionId='s1', name='session_end', category='session', value=2000, userUuid='u1', ts=2000,
            properties=json.dumps({'durationMs': 1000, 'isComplete': True})),
    ]
    result = await session.list_('p_abc', 30)
    assert len(result) == 1
    s = result[0]
    assert s['startTs'] == 1000
    assert s['durationMs'] == 1000
    assert s['isComplete'] is True
    assert s['userUuid'] == 'u1'


async def test_list_missing_end_keeps_duration_null(patch_store, fake_db):
    # 只有 start 没 end：durationMs=None、isComplete=False（slot 默认）
    fake_db.rows = [row(sessionId='s1', name='session_start', category='session', value=1000, userUuid='u1', ts=1000)]
    result = await session.list_('p_abc', 30)
    assert result[0]['durationMs'] is None
    assert result[0]['isComplete'] is False


async def test_list_bad_end_properties_json_falls_back_to_empty(patch_store, fake_db):
    # end.properties 是坏 JSON：meta={}，durationMs=None、isComplete=False，不抛错
    fake_db.rows = [
        row(sessionId='s1', name='session_start', category='session', value=1000, userUuid='u1', ts=1000),
        row(sessionId='s1', name='session_end', category='session', value=2000, userUuid='u1', ts=2000,
            properties='{not json'),
    ]
    result = await session.list_('p_abc', 30)
    assert result[0]['durationMs'] is None
    assert result[0]['isComplete'] is False


async def test_summary_counts_and_rates(patch_store, fake_db):
    # 3 会话：2 完整、1 带时长。回头率按 userUuid 去重——u1 来 2 次，unique=2 total=3 returning=1
    fake_db.rows = [
        row(sessionId='s1', name='session_start', category='session', value=1000, userUuid='u1', ts=1000),
        row(sessionId='s1', name='session_end', category='session', value=2000, ts=2000, properties=json.dumps({'durationMs': 1000, 'isComplete': True})),
        row(sessionId='s2', name='session_start', category='session', value=3000, userUuid='u2', ts=3000),
        row(sessionId='s2', name='session_end', category='session', value=4000, ts=4000, properties=json.dumps({'durationMs': 1000, 'isComplete': True})),
        row(sessionId='s3', name='session_start', category='session', value=5000, userUuid='u1', ts=5000),
        row(sessionId='s3', name='session_end', category='session', value=7000, ts=7000, properties=json.dumps({'durationMs': 2000, 'isComplete': False})),
    ]
    s = await session.summary('p_abc', 30)
    assert s['totalSessions'] == 3
    assert s['avgDurationMs'] == round((1000 + 1000 + 2000) / 3)  # 1333
    assert s['completionRate'] == round(2 / 3, 3)  # 2 完整 / 3
    assert s['uniquePlayers'] == 2  # u1, u2
    assert s['returningVisits'] == 1  # total - unique
    assert s['returningRate'] == round(1 / 3, 3)


async def test_summary_empty_returns_zeros(patch_store, fake_db):
    # 空结果：除零兜底全 0，不抛
    fake_db.rows = []
    s = await session.summary('p_abc', 30)
    assert s == {
        'totalSessions': 0, 'avgDurationMs': 0, 'completionRate': 0,
        'uniquePlayers': 0, 'returningVisits': 0, 'returningRate': 0,
    }


async def test_summary_avg_ignores_none_durations(patch_store, fake_db):
    # 只对有 durationMs 的会话取均值：1 条有(1000)、1 条无(None)，均值=1000
    fake_db.rows = [
        row(sessionId='s1', name='session_start', category='session', value=1000, userUuid='u1', ts=1000),
        row(sessionId='s1', name='session_end', category='session', value=2000, ts=2000, properties=json.dumps({'durationMs': 1000, 'isComplete': True})),
        row(sessionId='s2', name='session_start', category='session', value=3000, userUuid='u2', ts=3000),
        # s2 无 end，durationMs=None
    ]
    s = await session.summary('p_abc', 30)
    assert s['avgDurationMs'] == 1000  # 只算有 duration 的那一条
    assert s['totalSessions'] == 2  # total 仍含无 duration 的会话
