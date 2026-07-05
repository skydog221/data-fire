# data-fire 后端路由层测试
# 设计思想：main.py 的路由函数体只做"取参数→调对应 actions 指令→返回结果"，业务逻辑全在 actions。
# 故路由层测试只验证：路径/查询参数解析（days 边界 422）、/health、POST /collect 透传 payload、
# CORS 头。用 httpx.AsyncClient 直连 ASGI app，patch 各 action 函数返预设值，不碰真 DB/Redis。
#
# 关键：用 httpx ASGITransport 直连 main.app，不触发 FastAPI lifespan（lifespan_connect 会真连
# Postgres+Redis），故无需 lifespan 旁路——ASGITransport 默认不跑生命周期事件。

import json

import pytest
from httpx import ASGITransport, AsyncClient

import main
from actions import collect, session, event, player, metric


@pytest.fixture
def client(monkeypatch):
    """httpx AsyncClient 直连 main.app（ASGI transport，不跑 lifespan）。
    各 action 函数被 patch 成返预设值，路由层只测参数解析与透传。"""
    transport = ASGITransport(app=main.app)
    return AsyncClient(transport=transport, base_url='http://test')


async def test_health_returns_ok(client):
    # /health 探活，固定返回 {status: ok}
    async with client as c:
        resp = await c.get('/health')
    assert resp.status_code == 200
    assert resp.json() == {'status': 'ok'}


async def test_collect_passes_payload_to_action(monkeypatch, client):
    # POST /collect 透传 payload 给 collect.records，返回其结果（含 ok 契约字段）
    captured = {}
    async def fake_records(payload):
        captured['payload'] = payload
        return {'ok': True, 'projectId': 'p_stable', 'accepted': 2}
    monkeypatch.setattr(collect, 'records', fake_records)
    async with client as c:
        resp = await c.post('/collect', json={'records': [{'name': 'x'}]})
    assert resp.json() == {'ok': True, 'projectId': 'p_stable', 'accepted': 2}
    assert captured['payload'] == {'records': [{'name': 'x'}]}  # payload 原样透传


async def test_sessions_route_calls_list_(monkeypatch, client):
    # GET /sessions/{pid} 调 session.list_，返回其结果
    async def fake_list(pid, days):
        return [{'sessionId': 's1', 'startTs': 1}]
    monkeypatch.setattr(session, 'list_', fake_list)
    async with client as c:
        resp = await c.get('/sessions/p_abc?days=7')
    assert resp.status_code == 200
    assert resp.json() == [{'sessionId': 's1', 'startTs': 1}]


async def test_days_query_lower_bound_rejects_zero(client):
    # days < 1 应被 Query(ge=1) 拦截返 422
    async with client as c:
        resp = await c.get('/sessions/p_abc?days=0')
    assert resp.status_code == 422


async def test_days_query_upper_bound_rejects_366(client):
    # days > 365 应被 Query(le=365) 拦截返 422
    async with client as c:
        resp = await c.get('/sessions/p_abc?days=366')
    assert resp.status_code == 422


async def test_days_query_boundaries_accepted(monkeypatch, client):
    # days=1 和 days=365 都在边界内，应通过
    # session.list_ 是 async，patch 成 async 函数返回空列表（路由会 await 它）
    async def fake_list(pid, days):
        return []
    monkeypatch.setattr(session, 'list_', fake_list)
    async with client as c:
        r1 = await c.get('/sessions/p_abc?days=1')
        r365 = await c.get('/sessions/p_abc?days=365')
    assert r1.status_code == 200
    assert r365.status_code == 200


async def test_metrics_series_requires_name_query(client):
    # GET /metrics/{pid}/series 的 name 是必填 str，不传应 422
    async with client as c:
        resp = await c.get('/metrics/p_abc/series')
    assert resp.status_code == 422


async def test_funnel_route_passes_funnel_param(monkeypatch, client):
    # GET /metrics/{pid}/funnel?funnel=onboard 透传 funnel 参数
    captured = {}
    async def fake_funnel(pid, funnel, days):
        captured['funnel'] = funnel
        return [{'step': 'start', 'count': 1, 'rate': None}]
    monkeypatch.setattr(metric, 'funnel', fake_funnel)
    async with client as c:
        resp = await c.get('/metrics/p_abc/funnel?funnel=onboard')
    assert resp.status_code == 200
    assert captured['funnel'] == 'onboard'


async def test_cors_header_present(client):
    # 简单 GET 跨域响应在 CORS_ORIGIN='*' 时返回 *；真实浏览器预检另见 test_cors.py。
    async with client as c:
        resp = await c.get('/health', headers={'Origin': 'http://example.com'})
    assert resp.headers.get('access-control-allow-origin') == '*'
