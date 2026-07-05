# data-fire 后端通用时间工具
# 设计思想：HOP 要求 tools 文件只放"真正通用、和具体业务主体无关"的小函数。
# 本文件只做时间戳与日期范围的换算，多个 actions 都要用（按时间段聚合），且拿到别的项目也能用。
# 业务逻辑不放这里。
#
# 调用示例：
#   from tools.time import ts_to_datetime, days_ago_ts
#   dt_str = ts_to_datetime(1700000000000)   # '2023-11-14T22:13:20'
#   start_ts = days_ago_ts(7)                 # 7 天前的毫秒时间戳

from datetime import datetime, timezone, timedelta

# 毫秒时间戳转 ISO 字符串（不带时区后缀，方便前端直接 new Date 也行）。
# 扩展端上报的 ts 都是毫秒，落库存的是 BigInt，查询展示时要转可读时间。
def ts_to_datetime(ts: int) -> str:
    # /1000 因为 Python 用秒，扩展端用毫秒
    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()


# 返回 n 天前的毫秒时间戳。用于"最近 n 天"这类查询的起点。
def days_ago_ts(days: int) -> int:
    # 用 timedelta 算天数差，再转毫秒
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    return int(cutoff.timestamp() * 1000)


# 把一个毫秒时间戳按"天"取整到当天 00:00 UTC 的毫秒时间戳。
# 用于按天分桶聚合（如每日活跃、每日会话数）。
def ts_to_day_bucket(ts: int) -> int:
    day = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int(day.timestamp() * 1000)
