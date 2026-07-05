# data-fire 后端时间工具单元测试
# 设计思想：tools/time.py 是纯时间换算，零依赖零副作用，最适合作为第一个跑通的测试，
# 顺便验证 conftest 基建可用。三个函数逐一用已知时间戳断言输出。

from datetime import datetime, timezone, timedelta

from tools.time import ts_to_datetime, days_ago_ts, ts_to_day_bucket


# 已知时间戳：2023-11-14 22:13:20 UTC = 1700000000 秒 = 1700000000000 毫秒
KNOWN_TS_MS = 1700000000000


def test_ts_to_datetime_returns_iso_utc():
    # /1000 后转 UTC ISO，不带时区后缀以外的内容（isoformat 会带 +00:00）
    result = ts_to_datetime(KNOWN_TS_MS)
    assert result.startswith('2023-11-14T22:13:20')


def test_days_ago_ts_is_ms_and_about_n_days_back():
    # 7 天前的毫秒时间戳应约等于 now-7天，误差在 1 秒内（测试执行瞬间）
    expected = int((datetime.now(tz=timezone.utc) - timedelta(days=7)).timestamp() * 1000)
    got = days_ago_ts(7)
    assert abs(got - expected) < 1000  # 毫秒级，给 1 秒容差


def test_ts_to_day_bucket_floors_to_midnight_utc():
    # KNOWN_TS_MS = 2023-11-14 22:13:20 UTC，取整到当天 00:00:00 UTC
    midnight = datetime(2023, 11, 14, tzinfo=timezone.utc)
    expected = int(midnight.timestamp() * 1000)
    assert ts_to_day_bucket(KNOWN_TS_MS) == expected


def test_ts_to_day_bucket_different_times_same_day_collapse():
    # 同一天不同时刻取整后应落到同一个 bucket（00:00 UTC 的毫秒）
    midnight_ts = int(datetime(2023, 11, 14, tzinfo=timezone.utc).timestamp() * 1000)
    noon_ts = int(datetime(2023, 11, 14, 12, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
    assert ts_to_day_bucket(midnight_ts) == ts_to_day_bucket(noon_ts) == midnight_ts
