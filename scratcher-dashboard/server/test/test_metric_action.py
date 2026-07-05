# data-fire 后端"聚合指标"指令单元测试
# 设计思想：metric 把 metric/counter/score/funnel 四类数值记录各自聚合。
# 重点测 funnel 的 properties 过滤+去重+转化率、score_dist 的分布与空集、counters 的最新值去重、series 过滤 None。

import json

from actions import metric
from conftest import row


async def test_series_filters_none_values(patch_store, fake_db):
    # metric 序列：过滤掉 value=None 的行，只发 {ts, value}，按 ts 升序（find_many 已 order asc）
    fake_db.rows = [
        row(name='hp', category='metric', value=80, ts=1000),
        row(name='hp', category='metric', value=None, ts=2000),  # 应被过滤
        row(name='hp', category='metric', value=60, ts=3000),
    ]
    result = await metric.series('p_abc', name='hp', days=365)
    assert result == [{'ts': 1000, 'value': 80}, {'ts': 3000, 'value': 60}]


async def test_counters_latest_per_name(patch_store, fake_db):
    # counter 取每个 name 的最新值。find_many order desc，第一个出现的即最新
    fake_db.rows = [
        row(name='kills', category='counter', value=5, ts=3000),  # 最新
        row(name='kills', category='counter', value=3, ts=2000),
        row(name='deaths', category='counter', value=1, ts=4000),  # 最新
    ]
    result = await metric.counters('p_abc')
    by_name = {r['name']: r for r in result}
    assert by_name['kills']['value'] == 5
    assert by_name['kills']['ts'] == 3000
    assert by_name['deaths']['value'] == 1


async def test_score_dist_basic(patch_store, fake_db):
    # 分数分布：count/max/min/avg(1dp)/topScores[:10]
    fake_db.rows = [
        row(category='score', value=100, ts=1),
        row(category='score', value=500, ts=2),
        row(category='score', value=300, ts=3),
    ]
    s = await metric.score_dist('p_abc', days=365)
    assert s['count'] == 3
    assert s['max'] == 500
    assert s['min'] == 100
    assert s['avg'] == round(900 / 3, 1)  # 300.0
    assert s['topScores'] == [500, 300, 100]


async def test_score_dist_empty_returns_zeros(patch_store, fake_db):
    # 空集：全 0 初始形状
    fake_db.rows = []
    s = await metric.score_dist('p_abc', days=365)
    assert s == {'count': 0, 'max': 0, 'min': 0, 'avg': 0, 'topScores': []}


async def test_score_dist_top_scores_capped_at_10(patch_store, fake_db):
    # 超过 10 个分数只取前 10 排行
    fake_db.rows = [row(category='score', value=i, ts=i) for i in range(15)]
    s = await metric.score_dist('p_abc', days=365)
    assert len(s['topScores']) == 10
    assert s['topScores'][0] == 14  # 降序最大在前


async def test_funnel_conversion_rates(patch_store, fake_db):
    # 漏斗 onboard 三步：start=3人、step2=2人、step3=1人。rate=本步/上一步，首步 None
    fake_db.rows = [
        row(name='start', category='funnel', userUuid='u1', ts=1, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 1})),
        row(name='start', category='funnel', userUuid='u2', ts=1, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 1})),
        row(name='start', category='funnel', userUuid='u3', ts=1, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 1})),
        row(name='step2', category='funnel', userUuid='u1', ts=2, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 2})),
        row(name='step2', category='funnel', userUuid='u2', ts=2, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 2})),
        row(name='step3', category='funnel', userUuid='u1', ts=3, properties=json.dumps({'funnel': 'onboard', 'stepIndex': 3})),
    ]
    result = await metric.funnel('p_abc', funnel='onboard', days=365)
    assert result[0] == {'step': 'start', 'count': 3, 'rate': None}  # 首步无前驱
    assert result[1] == {'step': 'step2', 'count': 2, 'rate': round(2 / 3, 3)}
    assert result[2] == {'step': 'step3', 'count': 1, 'rate': round(1 / 2, 3)}


async def test_funnel_dedup_users_per_step(patch_store, fake_db):
    # 同一玩家多次进入同一步骤只算 1 人（set 去重）
    fake_db.rows = [
        row(name='start', category='funnel', userUuid='u1', ts=1, properties=json.dumps({'funnel': 'onb'})),
        row(name='start', category='funnel', userUuid='u1', ts=2, properties=json.dumps({'funnel': 'onb'})),  # 同人重复
        row(name='start', category='funnel', userUuid='u2', ts=3, properties=json.dumps({'funnel': 'onb'})),
    ]
    result = await metric.funnel('p_abc', funnel='onb', days=365)
    assert result[0]['count'] == 2  # u1, u2 去重后 2 人


async def test_funnel_filters_other_funnels(patch_store, fake_db):
    # 不同漏斗的记录应被过滤掉，只算指定 funnel
    fake_db.rows = [
        row(name='start', category='funnel', userUuid='u1', ts=1, properties=json.dumps({'funnel': 'onboard'})),
        row(name='start', category='funnel', userUuid='u2', ts=2, properties=json.dumps({'funnel': 'purchase'})),  # 别的漏斗
    ]
    result = await metric.funnel('p_abc', funnel='onboard', days=365)
    assert len(result) == 1  # 只剩 onboard 的 start
    assert result[0]['count'] == 1


async def test_funnel_bad_json_row_skipped(patch_store, fake_db):
    # properties 坏 JSON 的行应跳过，不抛错
    fake_db.rows = [
        row(name='start', category='funnel', userUuid='u1', ts=1, properties='{bad json'),
        row(name='step2', category='funnel', userUuid='u1', ts=2, properties=json.dumps({'funnel': 'onb'})),
    ]
    result = await metric.funnel('p_abc', funnel='onb', days=365)
    assert len(result) == 1  # 只 step2 有效


async def test_funnel_preserves_first_seen_order(patch_store, fake_db):
    # 步骤按首次出现顺序，不按名字字母序
    fake_db.rows = [
        row(name='zebra', category='funnel', userUuid='u1', ts=1, properties=json.dumps({'funnel': 'f'})),
        row(name='apple', category='funnel', userUuid='u1', ts=2, properties=json.dumps({'funnel': 'f'})),
    ]
    result = await metric.funnel('p_abc', funnel='f', days=365)
    assert [r['step'] for r in result] == ['zebra', 'apple']  # 首次出现顺序，非字母序
