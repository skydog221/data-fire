# data-fire 设计文档

> 本文件是整个 data-fire 项目的数据收集设计说明书与架构总纲。
> 任何接手项目的人，先读本文件，就能知道：收集什么数据、数据长什么样、积木怎么放、数据怎么流、各端怎么配合。

---

## 一、设计目标

为 Scratcher 提供一个"插上即用"的玩家数据分析基座：

- **自动模式**：Scratcher 只需拖入一个"开启自动数据收集"积木，扩展自动采集会话、时长、回头率等通用数据，无需填写服务器地址。
- **高度自定义**：同时提供一组细粒度积木，让 Scratcher 按自己游戏的业务，手动上报自定义事件、指标、计数器、分数、漏斗步骤。
- **闭环反馈**：扩展端把数据上报到固定后端，后端按拓展从当前 URL 解析出的 `projectId` 聚合存储，Scratcher 用"看板地址"积木进入 dashboard 看到自己的数据分析。

整条链路严格遵循 HOP 架构思想：

```
触发事件(玩家在 Scratch 里点了绿旗 / 自定义事件被调用)
  → 指令执行(commands 里的方法读数据、算逻辑、改 store)
  → 数据修改(store 里的队列/计数器/会话状态被更新)
  → 效果反馈(sender 批量上报到后端 / 后端落库 / dashboard 展示)
```

---

## 二、收集什么数据（数据域划分）

把所有可收集数据分成 6 个**数据域**。自动模式覆盖会话、时长、回头率等无需业务语义的数据，自定义积木覆盖事件、指标、计数器、分数、漏斗等需要 Scratcher 明确埋点的数据。

### 域1：会话与时长（session）

玩家从进入作品到离开的一次"游玩"叫做一个会话。

| 字段         | 含义                                                           | 自动模式来源                                              |
| ------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| sessionId    | 一次会话的唯一 id，开始会话时生成                              | 是                                                        |
| userUuid     | 玩家身份（来自 ccwAPI.getUserInfo，无身份时退化为匿名随机 id） | 是                                                        |
| projectStart | 会话开始时间戳                                                 | runtime 事件 PROJECT_RUN_START                            |
| projectEnd   | 会话结束时间戳                                                 | PROJECT_RUN_STOP / beforeunload / visibilitychange:hidden |
| durationMs   | 会话时长 = end - start                                         | 计算                                                      |
| isComplete   | 是否完整结束：自然停止 true，关页面/切后台 false               | 计算                                                      |

### 域2：回头率（returning / retention）

判断同一玩家是否多次来玩。

| 字段        | 含义                                   |
| ----------- | -------------------------------------- |
| visitCount  | 该 userUuid 在本浏览器的累计访问次数   |
| firstSeen   | 该玩家第一次出现的时间（后端权威统计） |
| lastSeen    | 该玩家上一次出现的时间                 |
| isReturning | 本次是否为"回头客"（visitCount > 1）   |

实现：扩展端在浏览器 `localStorage`（见 `src/kv.ts`）存每个 userUuid 的访问计数，上报时一并带上；后端再以 userUuid 做权威去重统计。双端各算一次，互为兜底。本地存浏览器而非舞台注释，是为了不污染工程文件。访问计数最多保留 200 个玩家，超出按最老 `lastSeen` 裁剪。

### 域3：行为事件（event）

玩家在游戏里做的"离散动作"，记录**时机**。例如：点赞、收藏、关注、跳关、拾取道具。

统一抽象成一条 EventRecord：

```
event(id, name, category, value, ts, sessionId, userUuid, projectId, properties?)
```

- `name`：事件名，如 `like`、`favorite`、`follow`、`pickup`
- `category`：`event`
- `value`：数值型载荷，如点赞数、关卡号
- `properties`：自定义 JSON 扩展字段（自定义积木传入）

自动模式不采集点赞/收藏/关注这类带业务语义的时机，因为扩展无法直接监听 Scratch 网站按钮，也不知道游戏里哪段逻辑代表"点赞"或"通关"。这类事件由 Scratcher 用自定义积木在合适位置触发。自动模式只负责会话、时长、回头率等无需业务语义的数据。

### 域4：计数器与分数（metric / counter / score）

- **指标**（metric）：带时间戳的瞬时数值，如"当前血量""当前速度"。积木：`记录指标 [名] 当前值 [N]`。适合画折线。
- **计数器**（counter）：可累加或覆盖的数值，如"本局击杀数""总拾取数"。积木：`计数器 [名] 增加 [N]`、`计数器 [名] 设为 [N]`。
- **分数**（score）：特殊指标，专门给"最终得分"。积木：`提交分数 [N]`。

计数器记录会在 `properties` 里带操作语义：`{ op:'add', delta }` 或 `{ op:'overwrite' }`，避免后端重放/补偿时分不清累加与覆盖。

### 域5：漏斗（funnel）

把一个完整流程拆成若干步骤，统计每步到达率。例如"进入→选角色→开始第一关→通关"。

- 积木：`漏斗 [漏斗名] 进入步骤 [步骤名]`
- properties：`{ funnel, stepIndex }`
- 后端按 `funnel` 分组、按 `stepIndex` 排序统计到达人数，算每步转化率。

`stepIndex` 在扩展端按本会话内首次进入顺序分配；重复进入同一步复用原序号，确保同一步不会被拆成多个桶。

### 域6：自定义任意事件（custom）

兜底能力：Scratcher 想记录任何东西，都可以用最通用的积木：

- `记录事件 [名]`
- `记录事件 [名] 值为 [N]`
- `记录事件 [名] 详情 [文本]`

域3 到域5 的积木本质上都是统一 EventRecord 的语义化包装，后端用同一张表存。

---

## 三、统一数据模型（EventRecord）

所有上报落到后端都是同一种结构，方便聚合与扩展：

```typescript
interface EventRecord {
  projectId: string // 作品 id，对应 dashboard 入口
  sessionId: string // 会话 id，无会话时为 's_none'
  userUuid: string // 玩家身份
  name: string // 事件/指标/计数器名
  category: 'session' | 'event' | 'metric' | 'counter' | 'score' | 'funnel'
  value: number | null // 数值载荷，无则 null
  properties: string | null // JSON 字符串，自定义扩展字段
  ts: number // 毫秒时间戳
}
```

会话本身也用事件表示：

- `category=session, name=session_start`：`value=开始时间`，`properties={visitCount,isReturning}`
- `category=session, name=session_end`：`value=结束时间`，`properties={durationMs,isComplete,startTs}`

这样后端只有一张宽表，所有分析都从这张表出。计数器、指标、分数、漏斗也都按"一次记录"存，聚合时按 category/name/properties 解释。

---

## 四、积木清单（blocks）

分为三组，对应三个 palette 区域，用分隔符 `---` 隔开。积木文案里的参数必须使用 scratch-vm 的命名占位符 `[name]`，不能用 Blockly 的 `%1/%2`，否则会触发 `Message index out of range`。

### A 组：自动模式与看板（2 块）

| 积木             | 类型     | opcode          | 说明                                                               |
| ---------------- | -------- | --------------- | ------------------------------------------------------------------ |
| 开启自动数据收集 | command  | autoStart       | 一键开启：初始化 projectId、玩家身份、会话监听、批量上报、离线重发 |
| 看板地址         | reporter | getDashboardUrl | 返回当前作品公开看板地址 `http://localhost:5173/p/{projectId}/`    |

### B 组：会话与身份（4 块）

| 积木               | 类型     | opcode         | 说明                                              |
| ------------------ | -------- | -------------- | ------------------------------------------------- |
| 当前玩家 uuid      | reporter | getPlayerUuid  | 返回当前玩家身份字符串                            |
| 开始记录本次会话   | command  | sessionStart   | 生成 sessionId，记开始时间，落 session_start 事件 |
| 结束记录本次会话   | command  | sessionEnd     | 记结束时间，算时长，落 session_end 事件           |
| 本次会话已游玩秒数 | reporter | sessionElapsed | 返回当前会话已过秒数                              |

### C 组：自定义数据收集（8 块）

| 积木                           | 类型    | opcode           | 说明                                     |
| ------------------------------ | ------- | ---------------- | ---------------------------------------- |
| 记录事件 [name]                | command | trackEvent       | 落一条 category=event 记录               |
| 记录事件 [name] 值为 [value]   | command | trackEventValue  | 带数值的事件                             |
| 记录事件 [name] 详情 [detail]  | command | trackEventDetail | 带自定义 detail 的事件                   |
| 记录指标 [name] 当前值 [value] | command | trackMetric      | 瞬时数值，画折线                         |
| 计数器 [name] 增加 [delta]     | command | counterAdd       | 累加，properties 带 op/delta             |
| 计数器 [name] 设为 [value]     | command | counterSet       | 覆盖，properties 带 op=overwrite         |
| 提交分数 [value]               | command | submitScore      | 专供最终得分                             |
| 漏斗 [funnel] 进入步骤 [step]  | command | funnelStep       | 漏斗打点，properties 带 funnel/stepIndex |

---

## 五、架构链路（触发→指令→数据→反馈）

### 扩展端（根目录 src/）

```
src/
  index.ts          入口：注册扩展，把 opcode 映射到 commands 方法
  store.ts          全局共享数据：projectId/userUuid/sessionId/队列/计数器/漏斗/自动模式状态
  kv.ts             浏览器 localStorage KV：匿名 id、访问计数、离线缓存辅助
  queue.ts          统一入队出口 pushRecord + 队列达阈值提前触发 flush + 内存队列上限保护
  sender.ts         反馈：批量上报、失败重试、离线缓存、sendBeacon
  l10n/index.ts     中英文文案
  commands/
    collect.ts      自动模式指令：autoStart / dashboardUrl / runtime 事件 / 卸载兜底
    player.ts       身份指令：getPlayerUuid
    session.ts      会话指令：sessionStart/sessionEnd/sessionElapsed
    event.ts        自定义数据指令：trackEvent/trackMetric/counterAdd/counterSet/submitScore/funnelStep
```

数据流：

```
玩家点绿旗
  → runtime 触发 PROJECT_RUN_START 事件
  → collect.ts 里的事件监听器被调用
  → 调用 Session.start()（指令执行）
  → store 里 sessionId/sessionStart 被写入（数据修改）
  → queue.pushRecord 把 session_start 记录推入 store.queue（数据修改）
  → sender 定时或达阈值把 queue 批量 POST 到后端 /collect（效果反馈）
  → 后端 collect.py 按 projectId 落库并返回 { ok:true, accepted }（效果反馈）
  → Collect.dashboardUrl() 用当前 URL 解析出的 projectId 返回看板地址（反馈给 Scratcher）
  → dashboard 根据 projectId 拉数据展示（效果反馈）
```

页面关闭/切后台时走另一条兜底链路：

自动模式保存 runtime、beforeunload、visibilitychange 的回调引用，拓展卸载或热重载时通过 `Collect.stop()` 统一移除监听器并停止 sender 定时器。这样“绿旗后每 4 秒记录事件”这类长时间循环不会因为旧拓展实例残留而叠加多个监听器或多个 flush 定时器。内存里的待发队列最多保留 1000 条，超过时丢最老记录，避免后端离线或宿主异常时撑爆 Scratch 页面；真正持久化的离线缓存仍由 sender 控制在 localStorage 5000 条以内。

```
beforeunload / visibilitychange:hidden
  → Session.end('unload') 写 session_end，isComplete=false
  → sender.flushNow(true)
  → navigator.sendBeacon('/collect') 尽力把剩余队列送到后端
```

### 开发者端后端（scratcher-dashboard/server/）

```
server/
  main.py           入口：FastAPI 接收 HTTP 触发，按路径分发给 actions
  store.py          共享数据：Prisma 客户端单例 + 可选 Redis 连接 + 配置
  data/
    schema.prisma   PostgreSQL 数据结构定义（EventRecord 模型）
  actions/
    collect.py      接收扩展端上报的批量记录（按 projectId 接收并落库）
    session.py      查会话列表与时长统计
    event.py        查事件时机分布
    player.py       查玩家与回头率
    metric.py       聚合指标/计数器/分数/漏斗
  tools/
    time.py         时间戳与日期范围换算等无业务身份小工具
  requirements.txt
  .env.example
```

`/collect` 接口契约：

- 请求体：`{ "records": EventRecord[] }`
- 响应体：`{ "ok": true, "projectId": "6743db44e6d6684b55c0e58f", "accepted": 12 }`
- `ok` 必须反映是否真正落库；扩展端只把 `ok===true` 当成功，否则会降级缓存。
- `projectId` 原样返回拓展端传来的作品 ID，方便调用方确认本批次归属；拓展端不会依赖它回写。
- Redis 可用时用 Redis 锁防跨进程并发；Redis 不可用时降级为进程内 `asyncio.Lock`，后端仍可运行。

### 开发者端前端（scratcher-dashboard/web/）

React Router + React + Shadcn/ui + Vite。路由 `/p/:projectId` 进入某作品的数据看板。前端 API 封装在 `src/api/client.ts`，Dashboard 页面在 `src/pages/Dashboard.tsx`，图表基于 Recharts。

---

## 六、projectId 的分配

扩展在上报时需要一个 `projectId`，决定数据归属哪个 dashboard。

当前实现是**从当前 URL 直接解析**：

1. `Collect.start()` 调用 `getCurrentProjectID()`。
2. 解析当前 `window.location.href` 的路径段。
3. 若路径中出现 `extension`、`detail` 或 `project`，就取它后面一段作为作品 ID。
4. `?` 后的 query 参数天然不参与解析。
5. 上报时直接把这个作品 ID 写进每条 EventRecord。
6. 「看板地址」积木返回 `http://localhost:5173/p/{projectId}/`。

例子：

```
https://www.ccw.site/detail/6743db44e6d6684b55c0e58f?SubjectAreaGroupId=775
→ projectId = 6743db44e6d6684b55c0e58f
```

这个设计避免后端再做哈希分配，也避免把同一个 CCW 作品在不同玩家/不同会话下拆成多个 projectId。

---

## 七、降级与隐私

- **离线降级**：sender 上报失败时把记录缓存进浏览器 `localStorage`，下次启动 `flushPending` 循环重发到清空或再次失败为止，保证不丢数据。缓存上限 5000 条，超过丢最老的。离线缓存是运行时临时数据，存浏览器本地更合适，不污染工程文件。
- **批量上报**：默认每 5 秒兜底一次 + 队列满 20 条提前触发（达阈值在 `queue.ts` 的 `pushRecord` 后立即触发 `sender.flushNow`），单批最多重试 3 次、指数退避，减少请求量。
- **页面关闭兜底**：`beforeunload` 与 `visibilitychange:hidden` 触发 `Session.end('unload')`（`isComplete=false`）后，立即 `sender.flushNow(true)` 走 `navigator.sendBeacon`——普通 fetch 在卸载时会被浏览器掐断，`sendBeacon` 才是关页面兜底的正确接口。
- **in-flight 守卫**：`sender` 同一时刻只允许一次常规 flush，定时器/达阈值/会话结束并发调用时其余让路，避免后端收到重复或乱序批次。
- **身份**：无 ccwAPI 环境时退化为本地随机匿名 id，回头率仍能在本机成立；访问计数最多保留 200 个玩家，避免 localStorage 无限膨胀。
- **Redis 降级**：Redis 可用时做跨进程指纹锁；不可用时用进程内锁兜底，后端仍可继续接收数据。
- **隐私**：只采集游玩行为与 Scratcher 主动上报的业务数据，不采集页面级隐私信息。
