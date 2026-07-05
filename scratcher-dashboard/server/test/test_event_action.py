# data-fire 后端"查询事件"指令单元测试
# 设计思想：event.timeline 按天分桶计数，event.top 按 name 计数取前 N。
# 喂入跨天多事件，断言分桶、name 过滤、排序与 limit 默认值。

from actions import event
from conftest import row

# 两个已知天的毫秒时间戳与其按天取整（00:00 UTC）后的 bucket，用于断言分桶结果。
# DAY1=2023-11-14 22:13 UTC，取整到 2023-11-14 00:00 UTC；
# DAY2=2023-11-16 ~22:13 UTC，取整到 2023-11-16 00:00 UTC（与 DAY1 不同天，验证分桶）。
DAY1 = 1700000000000
DAY1_BUCKET = 1699920000000  # 2023-11-14 00:00 UTC
DAY2 = 1700172800000
DAY2_BUCKET = 1700092800000  # 2023-11-16 00:00 UTC


async def test_timeline_day_buckets_ascending(patch_store, fake_db):
    # 3 个 like 事件散落两天：2 个在 day1、1 个在 day2，应按天分桶且升序返回
    fake_db.rows = [
        row(name='like', category='event', ts=DAY1),
        row(name='like', category='event', ts=DAY1 + 1000),  # 同天不同时刻，归同桶
        row(name='like', category='event', ts=DAY2),
    ]
    result = await event.timeline('p_abc', name='like', days=365)
    assert result == [{'bucket': DAY1_BUCKET, 'count': 2}, {'bucket': DAY2_BUCKET, 'count': 1}]


async def test_timeline_without_name_includes_all_events(patch_store, fake_db):
    # name 留空统计所有 event 记录
    fake_db.rows = [
        row(name='like', category='event', ts=DAY1),
        row(name='favorite', category='event', ts=DAY1),
    ]
    result = await event.timeline('p_abc', name=None, days=365)
    assert result == [{'bucket': DAY1_BUCKET, 'count': 2}]  # 同桶合计


async def test_timeline_with_name_filters_subset(patch_store, fake_db):
    # name 过滤：只统计匹配 name 的事件
    fake_db.rows = [
        row(name='like', category='event', ts=DAY1),
        row(name='favorite', category='event', ts=DAY1),
    ]
    result = await event.timeline('p_abc', name='like', days=365)
    assert result == [{'bucket': DAY1_BUCKET, 'count': 1}]


async def test_top_counts_desc_and_limit_default(patch_store, fake_db):
    # like=3, favorite=2, follow=1，默认 limit=10 全保留，按计数降序
    fake_db.rows = [
        row(name='like', category='event', ts=DAY1),
        row(name='like', category='event', ts=DAY1),
        row(name='like', category='event', ts=DAY1),
        row(name='favorite', category='event', ts=DAY1),
        row(name='favorite', category='event', ts=DAY1),
        row(name='follow', category='event', ts=DAY1),
    ]
    result = await event.top('p_abc', days=365)
    assert [(r['name'], r['count']) for r in result] == [('like', 3), ('favorite', 2), ('follow', 1)]


async def test_top_respects_limit_param(patch_store, fake_db):
    # limit=2 只取前 2 名
    fake_db.rows = [row(name=f'evt{i}', category='event', ts=DAY1) for i in range(5)]
    result = await event.top('p_abc', days=365, limit=2)
    assert len(result) == 2
    # 注：路由层 GET /events/{pid}/top 未暴露 limit 参数（main.py 只传 project_id, days），
    # 故实际线上永远用默认 10。这里测 action 层本身的 limit 仍可用——死参数留作后续清理。
