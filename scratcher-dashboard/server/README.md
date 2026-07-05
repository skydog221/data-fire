# data-fire 开发者端后端

为 Scratcher 提供数据分析看板的后端服务。接收拓展端上报的玩家行为数据，聚合存储，供前端 dashboard 查询展示。

## 技术栈

- Python + FastAPI（HTTP 入口）
- Prisma ORM（`prisma-client-py`，数据结构在 `data/schema.prisma`）
- PostgreSQL（主库）+ 可选 Redis（项目指纹锁与缓存；不可用时降级为进程内锁）

## 目录结构

```
server/
  main.py            入口：FastAPI 应用，路由触发→调用 actions 指令
  store.py           共享状态：Prisma 客户端单例 + 可选 Redis 连接 + 配置
  data/schema.prisma PostgreSQL 数据结构定义（EventRecord 宽表）
  actions/           按主体分文件的指令
    collect.py       接收上报、落库、返回 ok/projectId/accepted
    session.py       查询会话与总览
    event.py         查询事件时机分布
    player.py        查询玩家与回头率
    metric.py        聚合指标/计数器/分数/漏斗
  tools/time.py      通用时间换算工具（无业务身份）
  requirements.txt
  .env.example
```

## 快速开始

```bash
cd server
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # 填 PostgreSQL DATABASE_URL；REDIS_URL 可选
python -m prisma generate --schema=data/schema.prisma
python -m prisma db push --schema=data/schema.prisma   # 首次建表

uvicorn main:app --reload --port 8000
```

启动后访问 `http://localhost:8000/docs` 看 API 文档。Redis 连不上时后端会打印 warning 并继续运行，只失去跨进程锁与缓存。

## CORS 配置

前端 dashboard 和后端分域部署时，浏览器会先发 CORS 预检。后端读取 `.env` 里的 `CORS_ORIGIN` 控制允许来源：

```env
# 本地开发可以全放开
CORS_ORIGIN=*

# 生产推荐写具体域名；多个域名用英文逗号分隔，后端会逐个允许
CORS_ORIGIN=https://dashboard.example.com,https://www.example.com,http://localhost:5173
```

域名尾部不要依赖 `/`，后端会自动去掉尾斜杠，确保和浏览器 `Origin` 头匹配。

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/collect` | 拓展端上报一批记录，响应 `{ ok: true, projectId, accepted }` |
| GET | `/sessions/{projectId}` | 会话列表 |
| GET | `/sessions/{projectId}/summary` | 会话总览（时长/完整率/回头率） |
| GET | `/players/{projectId}` | 玩家列表 |
| GET | `/players/{projectId}/retention` | 回头率与新老构成 |
| GET | `/events/{projectId}/timeline` | 事件趋势（按天） |
| GET | `/events/{projectId}/top` | 热门事件 Top |
| GET | `/metrics/{projectId}/series` | 指标折线 |
| GET | `/metrics/{projectId}/counters` | 计数器当前值 |
| GET | `/metrics/{projectId}/scores` | 分数分布与排行 |
| GET | `/metrics/{projectId}/funnel` | 漏斗转化率 |
| GET | `/health` | 健康检查 |

查询参数 `days` 控制时间范围（默认 30 天）。
