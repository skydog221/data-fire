# data-fire 后端 CORS 测试
# 设计思想：dashboard 生产环境常会有多个访问来源（自定义域名、www 域名、本地调试域名）。
# 旧实现只把 CORS_ORIGIN 当单字符串，配置成逗号分隔时 FastAPI 会把整串当成一个 origin，
# 浏览器预检 OPTIONS 就不会拿到正确 access-control-allow-origin。这里直接测试解析函数和真实预检响应。

from httpx import ASGITransport, AsyncClient

import main
from store import parse_cors_origins


def test_parse_cors_origins_defaults_to_star():
    # 未配置或只写 * 时全放开，方便本地开发
    assert parse_cors_origins(None) == ['*']
    assert parse_cors_origins('') == ['*']
    assert parse_cors_origins('*') == ['*']


def test_parse_cors_origins_supports_comma_separated_list():
    # 生产常写多个域名，用逗号分隔；尾斜杠会去掉，避免和浏览器 Origin 不匹配
    raw = 'https://dash.example.com, https://www.example.com/ , http://localhost:5173'
    assert parse_cors_origins(raw) == [
        'https://dash.example.com',
        'https://www.example.com',
        'http://localhost:5173',
    ]


async def test_cors_preflight_allows_dashboard_origin():
    # 真实预检：浏览器跨域 POST/GET 前会发 OPTIONS，后端应反射允许的 origin 并放行方法/header。
    # 当前默认 CORS_ORIGIN='*'，FastAPI 会把请求 Origin 反射回 access-control-allow-origin。
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.options(
            '/collect',
            headers={
                'Origin': 'http://localhost:5173',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        )
    assert resp.status_code == 200
    assert resp.headers.get('access-control-allow-origin') == 'http://localhost:5173'
    assert 'POST' in resp.headers.get('access-control-allow-methods', '')
    assert 'content-type' in resp.headers.get('access-control-allow-headers', '').lower()
