# data-fire 开发者端后端入口
# 设计思想：HOP 要求入口只负责"接收外部触发并调用哪个指令"。本文件是 FastAPI 应用，
# 每个 HTTP 路由对应一次外部触发，路由函数体只做"取参数→调对应 actions 指令→返回结果"，
# 业务逻辑全在 actions/ 各文件里。看到一条路由就能顺着找到调了哪个指令。
#
# 路由清单（触发 → 指令）：
#   POST   /collect               → collect.records        拓展端上报一批记录
#   GET    /sessions/{pid}        → session.list_           某作品会话列表
#   GET    /sessions/{pid}/summary→ session.summary         会话总览
#   GET    /players/{pid}         → player.list_            玩家列表
#   GET    /players/{pid}/retention→ player.retention       回头率
#   GET    /events/{pid}/timeline → event.timeline          事件趋势
#   GET    /events/{pid}/top      → event.top               热门事件
#   GET    /metrics/{pid}/series  → metric.series           指标折线
#   GET    /metrics/{pid}/counters→ metric.counters         计数器当前值
#   GET    /metrics/{pid}/scores  → metric.score_dist       分数分布
#   GET    /metrics/{pid}/funnel  → metric.funnel           漏斗转化
#
# 运行：uvicorn main:app --reload --port 8000

from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from store import config, lifespan_connect, lifespan_disconnect
from actions import collect, session, event, player, metric


# 应用生命周期：启动建连、关闭断连。lifespan 是 FastAPI 推荐的写法，替代已弃用的 on_event。
@asynccontextmanager
async def lifespan(app: FastAPI):
    await lifespan_connect()
    yield
    await lifespan_disconnect()


app = FastAPI(title='data-fire backend', lifespan=lifespan)
# 允许前端跨域访问。config['cors_origins'] 支持 '*' 或逗号分隔多个域名，见 store.parse_cors_origins。
app.add_middleware(
    CORSMiddleware,
    allow_origins=config['cors_origins'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ===== 接收上报（拓展端 POST 进来）=====
@app.post('/collect')
async def post_collect(payload: dict):
    return await collect.records(payload)


# ===== 会话查询 =====
@app.get('/sessions/{project_id}')
async def get_sessions(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await session.list_(project_id, days)


@app.get('/sessions/{project_id}/summary')
async def get_session_summary(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await session.summary(project_id, days)


# ===== 玩家与回头率 =====
@app.get('/players/{project_id}')
async def get_players(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await player.list_(project_id, days)


@app.get('/players/{project_id}/retention')
async def get_retention(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await player.retention(project_id, days)


# ===== 事件时机 =====
@app.get('/events/{project_id}/timeline')
async def get_event_timeline(project_id: str, days: int = Query(30, ge=1, le=365), name: str | None = None):
    return await event.timeline(project_id, name, days)


@app.get('/events/{project_id}/top')
async def get_event_top(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await event.top(project_id, days)


# ===== 指标/计数器/分数/漏斗 =====
@app.get('/metrics/{project_id}/series')
async def get_metric_series(project_id: str, name: str, days: int = Query(30, ge=1, le=365)):
    return await metric.series(project_id, name, days)


@app.get('/metrics/{project_id}/counters')
async def get_counters(project_id: str):
    return await metric.counters(project_id)


@app.get('/metrics/{project_id}/scores')
async def get_scores(project_id: str, days: int = Query(30, ge=1, le=365)):
    return await metric.score_dist(project_id, days)


@app.get('/metrics/{project_id}/funnel')
async def get_funnel(project_id: str, funnel: str, days: int = Query(30, ge=1, le=365)):
    return await metric.funnel(project_id, funnel, days)


# 健康检查，方便前端探活
@app.get('/health')
async def health():
    return {'status': 'ok'}
