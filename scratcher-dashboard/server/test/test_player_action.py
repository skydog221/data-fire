# data-fire 后端"查询玩家"指令单元测试
# 设计思想：player.list_ 以 userUuid 聚合 session_start，retention 算新老构成与回头率。
# 喂入乱序多玩家多访问记录，断言聚合、排序、回头率公式与除零兜底。

from actions import player
from conftest import row


async def test_list_aggregates_visits_and_first_last(patch_store, fake_db):
    # u1 来 2 次、u2 来 1 次；firstTs=min、lastTs=max、visits 计数
    # player.list_ 用 where={'category':'session','name':'session_start'} 过滤，故每行都要带这两字段
    fake_db.rows = [
        row(userUuid='u1', name='session_start', category='session', ts=1000),
        row(userUuid='u2', name='session_start', category='session', ts=1500),
        row(userUuid='u1', name='session_start', category='session', ts=3000),  # u1 第二次，乱序插中间
        row(userUuid='u1', name='session_start', category='session', ts=2000),  # u1 第三次，验证 min/max
    ]
    result = await player.list_('p_abc', 30)
    assert result[0]['userUuid'] == 'u1'  # visits 多的排前
    assert result[0]['visits'] == 3
    assert result[0]['firstTs'] == 1000
    assert result[0]['lastTs'] == 3000
    assert result[1]['userUuid'] == 'u2'
    assert result[1]['visits'] == 1


async def test_list_sorted_by_visits_desc(patch_store, fake_db):
    # 多玩家按 visits 降序
    fake_db.rows = [
        row(userUuid='a', name='session_start', category='session', ts=1),
        row(userUuid='b', name='session_start', category='session', ts=1),
        row(userUuid='b', name='session_start', category='session', ts=2),
        row(userUuid='c', name='session_start', category='session', ts=1),
        row(userUuid='c', name='session_start', category='session', ts=2),
        row(userUuid='c', name='session_start', category='session', ts=3),
    ]
    result = await player.list_('p_abc', 30)
    visits = [p['visits'] for p in result]
    assert visits == [3, 2, 1]  # c=3, b=2, a=1 降序


async def test_retention_new_vs_returning(patch_store, fake_db):
    # 3 玩家：c 来 3 次（回头）、b 来 2 次（回头）、a 来 1 次（新）
    fake_db.rows = [
        row(userUuid='a', name='session_start', category='session', ts=1),
        row(userUuid='b', name='session_start', category='session', ts=1),
        row(userUuid='b', name='session_start', category='session', ts=2),
        row(userUuid='c', name='session_start', category='session', ts=1),
        row(userUuid='c', name='session_start', category='session', ts=2),
        row(userUuid='c', name='session_start', category='session', ts=3),
    ]
    r = await player.retention('p_abc', 30)
    assert r['uniquePlayers'] == 3
    assert r['newPlayers'] == 1  # a 只来 1 次
    assert r['returningPlayers'] == 2  # b,c 来 >1 次
    assert r['returningPlayerRate'] == round(2 / 3, 3)
    assert r['totalVisits'] == 6  # 1+2+3
    assert r['avgVisitsPerPlayer'] == round(6 / 3, 2)  # 2.0


async def test_retention_empty_returns_zeros(patch_store, fake_db):
    # 空结果除零兜底
    fake_db.rows = []
    r = await player.retention('p_abc', 30)
    assert r == {
        'uniquePlayers': 0, 'newPlayers': 0, 'returningPlayers': 0,
        'returningPlayerRate': 0, 'totalVisits': 0, 'avgVisitsPerPlayer': 0,
    }


async def test_retention_all_new_no_returning(patch_store, fake_db):
    # 每人都只来 1 次：全是新玩家，回头率 0
    fake_db.rows = [
        row(userUuid='a', name='session_start', category='session', ts=1),
        row(userUuid='b', name='session_start', category='session', ts=2),
    ]
    r = await player.retention('p_abc', 30)
    assert r['returningPlayers'] == 0
    assert r['newPlayers'] == 2
    assert r['returningPlayerRate'] == 0
