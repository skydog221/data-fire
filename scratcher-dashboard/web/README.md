# data-fire 开发者端前端 dashboard

面向 Scratcher 的数据分析看板。Scratcher 在拓展里拿到作品数据 id 后，访问 `/p/:projectId` 进入本看板，查看自己作品的玩家数据分析。

## 技术栈

- Vite + React + TypeScript
- React Router（路由 `/p/:projectId` 进入某作品看板）
- Shadcn/ui（组件库，基于 Radix + Tailwind）
- Recharts（图表，配合 dataviz 规范）

## 目录结构

```
web/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  tailwind.config.js
  postcss.config.js
  components.json          shadcn/ui 配置
  src/
    main.tsx               入口：挂载 React + Router
    App.tsx                路由表
    api/client.ts          后端 API 调用封装（fetch 各 endpoints）
    components/ui/         shadcn/ui 组件
    components/charts/     图表组件（折线/漏斗/分布）
    pages/Dashboard.tsx   看板主页，组装各分析卡片
    pages/NotFound.tsx
    lib/utils.ts           shadcn cn 工具
```

## 快速开始

```bash
cd web
npm install
npm run dev    # http://localhost:5173
```

访问 `http://localhost:5173/p/p_abc` 查看某作品看板（后端需已启动在 8000 端口）。

## 后端 API 契约

后端默认 `http://localhost:8000`。所有查询参数 `days` 控制时间范围（默认 30）。

| 方法 | 路径 | 返回结构 |
|------|------|----------|
| GET | `/sessions/{pid}/summary` | `{totalSessions, avgDurationMs, completionRate, uniquePlayers, returningVisits, returningRate}` |
| GET | `/sessions/{pid}?days=N` | `[{sessionId, startTs, durationMs, isComplete, userUuid, endTs?}]` |
| GET | `/players/{pid}/retention` | `{uniquePlayers, newPlayers, returningPlayers, returningPlayerRate, totalVisits, avgVisitsPerPlayer}` |
| GET | `/players/{pid}?days=N` | `[{userUuid, visits, firstTs, lastTs}]` |
| GET | `/events/{pid}/timeline?name=&days=N` | `[{bucket, count}]`（bucket 是当天 00:00 UTC 毫秒时间戳） |
| GET | `/events/{pid}/top?days=N` | `[{name, count}]` |
| GET | `/metrics/{pid}/series?name=&days=N` | `[{ts, value}]` |
| GET | `/metrics/{pid}/counters` | `[{name, value, ts}]` |
| GET | `/metrics/{pid}/scores?days=N` | `{count, max, min, avg, topScores[]}` |
| GET | `/metrics/{pid}/funnel?funnel=&days=N` | `[{step, count, rate}]`（rate 可为 null） |
| GET | `/health` | `{status:'ok'}` |

时间戳均为毫秒。
