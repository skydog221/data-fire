<div align="center">

# 🔥 data-fire

> 为 Scratcher 而生的玩家数据分析基座 —— 插上即用，用数据帮你改进游戏。

**自动模式** 一个积木开启会话 / 时长 / 回头率等通用采集 · **高度自定义** 提供事件 / 指标 / 计数器 / 分数 / 漏斗等细粒度积木 · **闭环看板** 配套 Dashboard 把数据变成图表

[架构](#-架构) · [快速开始](#-快速开始) · [积木清单](#-积木清单) · [数据模型](#-数据模型) · [API](#-后端-api) · [设计文档](./DESIGN.md)

</div>

---

## 📖 这是什么

data-fire 是一个面向 **Scratcher**（用 Scratch 编程的开发者）的玩家数据分析脚手架。

Scratch 作品缺乏运营级数据：你不知道玩家玩了多久、有没有回头、在哪一步流失、谁拿了高分。data-fire 把这套能力做成三件套：

1. **拓展端**：拖进 Scratch 作品里，一个积木开启自动采集，或用细粒度积木自定义上报任何业务数据。
2. **后端**：接收上报、聚合存储、提供查询 API。
3. **Dashboard**：Scratcher 用「看板地址」积木拿到公开看板链接，进入看板查看自己作品的数据分析。

整条链路遵循 **触发事件 → 指令执行 → 数据修改 → 效果反馈** 的架构思想，代码即文档，新人只看局部代码就能接手。

---

## 🏗 架构

```
data-fire/
├── src/                        # 拓展端（TS + tsup，跑在 Scratch 里）
│   ├── index.ts                # 入口：注册拓展，opcode → 指令映射
│   ├── store.ts                # 全局状态：projectId / 会话 / 队列 / 计数器 / 漏斗
│   ├── kv.ts                   # 浏览器 localStorage KV：匿名 id / 访问计数 / 离线缓存辅助
│   ├── queue.ts                # 统一入队出口 pushRecord + 达阈值提前 flush
│   ├── sender.ts               # 反馈层：批量上报 + 重试 + 离线缓存 + sendBeacon
│   ├── l10n/index.ts           # 中英文案，积木参数用 [name] 这种命名占位符
│   └── commands/               # 按主体分文件的指令
│       ├── collect.ts          #   自动模式总开关 + 看板地址 + runtime 事件 + 卸载兜底
│       ├── player.ts           #   玩家身份：ccwAPI 优先，本地匿名 id 降级
│       ├── session.ts          #   会话开始/结束/计时，isComplete 区分自然/关页面
│       └── event.ts            #   事件/指标/计数器/分数/漏斗
│
└── scratcher-dashboard/        # 开发者端
    ├── server/                 # 后端（Python FastAPI + Prisma + PostgreSQL + 可选 Redis）
    │   ├── main.py             # 入口：HTTP 路由 → actions 指令
    │   ├── store.py            # Prisma / Redis 单例 + 配置，Redis 连不上可降级
    │   ├── data/schema.prisma  # EventRecord 宽表（PostgreSQL）
    │   ├── actions/            # collect / session / event / player / metric
    │   └── tools/time.py       # 通用时间工具
    │
    └── web/                    # 前端（React Router + React + Shadcn/ui + Vite）
        └── src/
            ├── api/client.ts   # 11 个后端接口封装
            ├── pages/Dashboard.tsx        # 9 张分析卡片
            └── components/{ui,charts}/    # shadcn 组件 + Recharts 图表
```

**数据流**：玩家在 Scratch 触发积木 → `commands` 调 `queue.pushRecord` 改 `store` 队列 → `sender` 批量 POST 到后端 `/collect` → 后端按 URL 解析出的作品 ID 落库 → Scratcher 用「看板地址」进入 Dashboard → Dashboard 拉数据画图。

---

## 🚀 快速开始

### 拓展端

```bash
npm install
npm run build            # 产出 dist/withL10n.global.js
```

把 `dist/withL10n.global.js` 加载进 TurboWarp / Gandi，拖入「**开启自动数据收集**」即可。开发环境里 Dashboard 看板地址是 `http://localhost:5173`，拓展端上报后端 API 地址是 `http://localhost:8000`，不再让 Scratcher 手动填写服务器地址。开发调试用 `npm run dev`（监听 + 本地 8080 服务）。

### 后端

```bash
cd scratcher-dashboard/server
python -m venv .venv
.venv\Scripts\activate                      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                        # 填 PostgreSQL DATABASE_URL；Redis 可选
python -m prisma generate --schema=data/schema.prisma
python -m prisma db push --schema=data/schema.prisma   # 首次建表
uvicorn main:app --reload --port 8000
```

启动后访问 `http://localhost:8000/docs` 查看 API 文档。Redis 连不上时后端会降级运行，只失去跨进程锁与缓存，不阻塞收数。

### Dashboard

```bash
cd scratcher-dashboard/web
npm install
npm run dev                                 # http://localhost:5173
```

访问 `http://localhost:5173/p/你的projectId` 查看看板。生产部署设 `VITE_API_BASE=https://你的后端域名` 后 `npm run build`，把 `dist/` 托管到静态服务器。

---

## 🧩 积木清单

三组积木，用分隔线在 palette 里隔开，共 **14 块**。

### A 组 · 自动模式与看板（2 块）

| 积木                 | 类型     | 说明                                                                    |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| **开启自动数据收集** | command  | 一键开启：初始化 projectId、玩家身份、会话监听、批量上报、离线重发      |
| **看板地址**         | reporter | 返回当前作品公开 Dashboard 地址：`http://localhost:5173/p/{projectId}/` |

自动采集会话开始/结束、游玩时长、回头率、页面关闭兜底。业务语义数据（点赞/收藏/关注时机）由 Scratcher 用 C 组积木在交互逻辑里触发——拓展无法监听 Scratch 网站按钮，这是明确设计边界。

### B 组 · 会话与身份（4 块）

| 积木               | 类型     | 说明                                         |
| ------------------ | -------- | -------------------------------------------- |
| 当前玩家 uuid      | reporter | 返回玩家身份（ccwAPI 优先，无则本地匿名 id） |
| 开始记录本次会话   | command  | 生成 sessionId，记开始时间，落 session_start |
| 结束记录本次会话   | command  | 算时长，落 session_end，立即上报             |
| 本次会话已游玩秒数 | reporter | 当前会话已过秒数                             |

### C 组 · 自定义数据收集（8 块）

| 积木                            | 说明                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| 记录事件 [名]                   | 离散动作，如点赞、拾取                                            |
| 记录事件 [名] 值为 [N]          | 带数值，如到达第 N 关                                             |
| 记录事件 [名] 详情 [文本]       | 带自定义详情                                                      |
| 记录指标 [名] 当前值 [N]        | 瞬时数值，画折线（血量/速度）                                     |
| 计数器 [名] 增加 [N]            | 累加；properties 带 `op:add` 和 `delta`，方便后端理解重放语义     |
| 计数器 [名] 设为 [N]            | 覆盖；properties 带 `op:overwrite`                                |
| 提交分数 [N]                    | 专供最终得分                                                      |
| 漏斗 [漏斗名] 进入步骤 [步骤名] | 漏斗打点；properties 带 `funnel` 和 `stepIndex`，保证步骤顺序稳定 |

---

## 📊 数据模型

所有自定义上报落到后端都是同一种结构 —— 一张 `EventRecord` 宽表，按 `category` 区分：

| 字段         | 含义                                                            |
| ------------ | --------------------------------------------------------------- |
| `projectId`  | 作品 id，决定数据归属哪个 dashboard                             |
| `sessionId`  | 会话 id，一次游玩一个；无会话时兜底为 `s_none`                  |
| `userUuid`   | 玩家身份                                                        |
| `name`       | 事件/指标/计数器名                                              |
| `category`   | `session` / `event` / `metric` / `counter` / `score` / `funnel` |
| `value`      | 数值载荷，无则 null                                             |
| `properties` | JSON 字符串，自定义扩展字段，如计数器 op、漏斗 stepIndex        |
| `ts`         | 毫秒时间戳                                                      |

会话本身也用事件表示：`session_start` / `session_end`。后端只有一张宽表，所有分析都从这张表出。详见 [DESIGN.md](./DESIGN.md)。

---

## 🔌 后端 API

后端 API base url 本地开发为 `http://localhost:8000`；生产部署时使用真实后端 API 域名。Dashboard 前端地址 `http://localhost:5173` 只用于打开看板页面，不是 `/collect` 上报地址。时间戳均为毫秒，`days` 控制时间范围（默认 30）。

| 方法 | 路径                       | 用途                                                         |
| ---- | -------------------------- | ------------------------------------------------------------ |
| POST | `/collect`                 | 拓展端上报一批记录，响应 `{ ok: true, projectId, accepted }` |
| GET  | `/sessions/{pid}`          | 会话列表                                                     |
| GET  | `/sessions/{pid}/summary`  | 会话总览（时长/完整率/回头率）                               |
| GET  | `/players/{pid}`           | 玩家列表                                                     |
| GET  | `/players/{pid}/retention` | 回头率与新老构成                                             |
| GET  | `/events/{pid}/timeline`   | 事件趋势（按天）                                             |
| GET  | `/events/{pid}/top`        | 热门事件 Top                                                 |
| GET  | `/metrics/{pid}/series`    | 指标折线                                                     |
| GET  | `/metrics/{pid}/counters`  | 计数器当前值                                                 |
| GET  | `/metrics/{pid}/scores`    | 分数分布与排行                                               |
| GET  | `/metrics/{pid}/funnel`    | 漏斗转化率                                                   |
| GET  | `/health`                  | 健康检查                                                     |

---

## 📈 Dashboard 视图

Dashboard 已实现 9 张分析卡片，一一呼应拓展端的数据域：

- **KPI 总览行** · 会话数 / 唯一玩家 / 平均时长 / 完整率 / 回头率
- **回头率卡片** · 新玩家 vs 回头玩家占比
- **会话时长分布** · 分桶柱状图
- **事件趋势折线** · 默认全部事件，可切单事件
- **热门事件 Top** · 横向条形排行
- **指标折线** · 输入指标名画折线
- **计数器当前值** · 表格
- **分数分布** · 最高/最低/平均 + Top 排行
- **漏斗图** · 输入漏斗名，画每步人数与转化率

---

## 🛡 可靠性与隐私

- **离线降级**：上报失败时记录缓存进浏览器 `localStorage`，下次启动循环重发到清空，持久化缓存上限 5000 条；内存待发队列另有 1000 条上限，后端离线或宿主异常时会丢最老记录保护游戏页面不被撑爆。
- **批量上报**：每 5 秒兜底一次或满 20 条提前触发，3 次指数退避重试，减少请求量。
- **页面关闭兜底**：`beforeunload` / 切后台时走 `navigator.sendBeacon` 把剩余队列发出去——普通 fetch 在卸载时会被掐断。
- **身份降级**：无 ccwAPI 环境退化为本地随机匿名 id，本机回头率仍成立，访问计数最多保留 200 个玩家，防 localStorage 膨胀。
- **projectId 来源**：拓展直接从当前 URL 的 `extension/`、`detail/`、`project/` 后一段解析作品 ID，不含 query 参数；看板地址天然与 CCW 作品绑定。
- **Redis 可选**：Redis 可用时做跨进程指纹锁；不可用时用进程内锁降级，后端仍可正常收数。
- **隐私**：只采集游玩行为与 Scratcher 主动上报的业务数据，不采集页面级隐私信息。

---

## 📜 许可证

[ MPL-2.0 ](./LICENSE)
