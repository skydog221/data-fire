# data-fire 功能链路说明

这份文档按 Scratch 积木逐一说明数据从拓展端到 dashboard 的完整路径：玩家触发积木，拓展端把动作转成 `EventRecord`，`sender` 批量请求 dashboard 后端，后端写入 `EventRecord` 宽表，前端再按作品 ID 调查询接口展示。

核心链路固定是：

```text
Scratch 积木触发 -> src/index.ts 转发 opcode -> src/commands/* 执行业务指令 -> src/queue.ts 生成 EventRecord -> src/sender.ts POST /collect -> dashboard 后端 actions 落库/聚合 -> dashboard 前端 api/client.ts 获取 -> Dashboard.tsx 展示
```

## 统一数据与请求格式

所有会上报到后端的积木，最终都会变成同一种记录结构。这个结构定义在 [src/store.ts](src/store.ts)，统一写入入口是 [src/queue.ts](src/queue.ts)。

```ts
interface EventRecord {
  projectId: string
  sessionId: string
  userUuid: string
  name: string
  category: 'session' | 'event' | 'metric' | 'counter' | 'score' | 'funnel'
  value: number | null
  properties: string | null
  ts: number
}
```

字段含义：

| 字段 | 来源 | 作用 |
| --- | --- | --- |
| `projectId` | [src/project.ts](src/project.ts) 从当前 URL 的 `/extension/{id}`、`/detail/{id}`、`/project/{id}` 解析 | 决定数据属于哪个作品看板 |
| `sessionId` | [src/commands/session.ts](src/commands/session.ts) 开始会话时生成；没有会话时用 `s_none` | 把一次游玩内的记录串起来 |
| `userUuid` | [src/commands/player.ts](src/commands/player.ts) 从 `runtime.ccwAPI.getUserInfo().uuid` 获取，失败时用本地匿名 ID | 计算唯一玩家、回头率、漏斗去重 |
| `name` | 积木参数或系统固定名 | 事件名、指标名、计数器名、步骤名 |
| `category` | 指令写死 | 后端按它区分会话、事件、指标、计数器、分数、漏斗 |
| `value` | 积木参数或系统计算值 | 数值载荷，没有则 `null` |
| `properties` | JSON 字符串 | 额外信息，如访问次数、计数器操作、漏斗名 |
| `ts` | [src/queue.ts](src/queue.ts) 调用 `Date.now()` | 事件发生时间，毫秒时间戳 |

拓展端不是每触发一次积木就立刻发一次 HTTP。记录会先进入 `state.queue`，满足下面任一条件后由 [src/sender.ts](src/sender.ts) 批量请求：

| 触发发送的时机 | 行为 |
| --- | --- |
| 队列累计到 20 条 | `pushRecord()` 触发 `sender.flushNow()` |
| 每 5 秒定时兜底 | `sender.start()` 里的定时器触发 `flushNow()` |
| 自然结束会话 | `Session.end('natural')` 立即触发 `flushNow()` |
| 页面关闭或隐藏 | 自动模式调用 `sender.flushNow(true)`，用 `navigator.sendBeacon` 兜底 |
| 网络失败 | 最多重试 3 次，仍失败写入 `localStorage.pendingQueue`，下次启动重发 |

统一 HTTP 请求如下：

```http
POST https://ccw-dash.iskydog.top/collect
Content-Type: application/json

{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "user-uuid-or-anon-id",
      "name": "like",
      "category": "event",
      "value": null,
      "properties": null,
      "ts": 1793779200000
    }
  ]
}
```

后端入口是 [scratcher-dashboard/server/main.py](scratcher-dashboard/server/main.py) 的 `POST /collect`。它调用 [scratcher-dashboard/server/actions/collect.py](scratcher-dashboard/server/actions/collect.py) 的 `collect.records(payload)`，从第一条记录取 `projectId` 作为本批归属，然后把每条记录批量写入 [scratcher-dashboard/server/data/schema.prisma](scratcher-dashboard/server/data/schema.prisma) 里的 `EventRecord` 表。

成功响应如下，拓展端会严格检查 `ok === true` 才认为上报成功：

```json
{
  "ok": true,
  "projectId": "6743db44e6d6684b55c0e58f",
  "accepted": 1
}
```

dashboard 前端进入 `/p/:projectId` 后，由 [scratcher-dashboard/web/src/pages/Dashboard.tsx](scratcher-dashboard/web/src/pages/Dashboard.tsx) 读取路由中的 `projectId`，再用 [scratcher-dashboard/web/src/pages/useDashboardData.ts](scratcher-dashboard/web/src/pages/useDashboardData.ts) 并发调用 [scratcher-dashboard/web/src/api/client.ts](scratcher-dashboard/web/src/api/client.ts) 中的查询方法，把结果存进 React state 渲染各卡片。

## 积木链路总览

| 积木显示文字 | opcode | 是否上报 `/collect` | 写入记录 | dashboard 主要读取方式 |
| --- | --- | --- | --- | --- |
| 开启自动数据收集 | `autoStart` | 间接上报 | 自动触发 `session_start`、`session_end` | 会话、玩家、回头率相关接口 |
| 看板地址 | `getDashboardUrl` | 不上报 | 无 | 无；返回本地拼出的 `/p/{projectId}/` |
| 当前玩家 uuid | `getPlayerUuid` | 不上报 | 无 | 无；只返回身份字符串 |
| 开始记录本次会话 | `sessionStart` | 上报 | `session_start` | `getSessionSummary()`、`getSessions()`、`getPlayerRetention()`、`getPlayers()` |
| 结束记录本次会话 | `sessionEnd` | 上报 | `session_end` | `getSessionSummary()`、`getSessions()` |
| 本次会话已游玩秒数 | `sessionElapsed` | 不上报 | 无 | 无；只读本地时间 |
| 记录事件 [name] | `trackEvent` | 上报 | `category=event` | `getEventTimeline()`、`getEventTop()` |
| 记录事件 [name] 值为 [value] | `trackEventValue` | 上报 | `category=event`，带 `value` | `getEventTimeline()`、`getEventTop()` |
| 记录事件 [name] 详情 [detail] | `trackEventDetail` | 上报 | `category=event`，`properties.detail` | `getEventTimeline()`、`getEventTop()`；详情当前只落库未展示 |
| 记录指标 [name] 当前值 [value] | `trackMetric` | 上报 | `category=metric` | `getMetricSeries()` |
| 计数器 [name] 增加 [delta] | `counterAdd` | 上报 | `category=counter`，`properties.op=add` | `getCounters()` |
| 计数器 [name] 设为 [value] | `counterSet` | 上报 | `category=counter`，`properties.op=overwrite` | `getCounters()` |
| 提交分数 [value] | `submitScore` | 上报 | `category=score` | `getScores()` |
| 漏斗 [funnel] 进入步骤 [step] | `funnelStep` | 上报 | `category=funnel`，`properties.funnel/stepIndex` | `getFunnel()` |

## 开启自动数据收集

积木信息：`开启自动数据收集`，opcode 是 `autoStart`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Collect.start()`。

拓展端处理：

1. [src/commands/collect.ts](src/commands/collect.ts) 先用 `getCurrentProjectID()` 从当前页面 URL 解析 `state.projectId`，解析失败时用 `p_unknown`。
2. 立即启动 `sender.start()` 定时发送队列，先给后续每 4 秒一类自定义打点准备泄洪口，避免玩家身份接口慢时记录只堆在内存里。
3. 调用 `Player.getUuid()` 准备 `state.userUuid`。
4. 绑定 Scratch runtime 事件：`PROJECT_RUN_START` 时调用 `Session.start()`，`PROJECT_RUN_STOP` 时调用 `Session.end('natural')`；绑定时保存回调引用，`Collect.stop()` / 拓展卸载时会移除，避免热重载或重复加载留下旧闭包。
5. 绑定 `beforeunload` 和 `visibilitychange:hidden`，页面关闭或隐藏时调用 `Session.end('unload')`，再走 `sendBeacon` 上报；页面监听器同样保存引用并可释放。
6. 调用 `sender.flushPending()` 重发本地离线缓存。

这个积木本身不会立即写一条名为 `autoStart` 的记录。它打开的是自动链路，后续由运行开始和运行结束产生会话记录。

运行开始时的请求记录：

```json
{
  "projectId": "6743db44e6d6684b55c0e58f",
  "sessionId": "s_lz9g4nabc1",
  "userUuid": "player-uuid",
  "name": "session_start",
  "category": "session",
  "value": 1793779200000,
  "properties": "{\"visitCount\":2,\"isReturning\":true}",
  "ts": 1793779200000
}
```

运行结束时的请求记录：

```json
{
  "projectId": "6743db44e6d6684b55c0e58f",
  "sessionId": "s_lz9g4nabc1",
  "userUuid": "player-uuid",
  "name": "session_end",
  "category": "session",
  "value": 1793779260000,
  "properties": "{\"durationMs\":60000,\"isComplete\":true,\"startTs\":1793779200000}",
  "ts": 1793779260000
}
```

后端处理：`POST /collect` 批量写入 `EventRecord` 表。查询时，[scratcher-dashboard/server/actions/session.py](scratcher-dashboard/server/actions/session.py) 把同一 `sessionId` 下的 `session_start` 和 `session_end` 配对，还原成一次会话；[scratcher-dashboard/server/actions/player.py](scratcher-dashboard/server/actions/player.py) 只统计 `session_start` 来计算玩家访问次数和回头率。

前端获取：

| 展示区域 | 前端方法 | 后端接口 | 后端 action |
| --- | --- | --- | --- |
| KPI 总览 | `getSessionSummary(projectId, days)` | `GET /sessions/{projectId}/summary` | `session.summary()` |
| 会话时长分布 | `getSessions(projectId, days)` | `GET /sessions/{projectId}` | `session.list_()` |
| 玩家回头率 | `getPlayerRetention(projectId, days)` | `GET /players/{projectId}/retention` | `player.retention()` |
| 玩家列表能力 | `getPlayers(projectId, days)` | `GET /players/{projectId}` | `player.list_()` |

## 看板地址

积木信息：`看板地址`，opcode 是 `getDashboardUrl`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Collect.dashboardUrl()`。

拓展端处理：这个积木只读取 `state.projectId` 并拼成 `https://ccw-dash.iskydog.top/p/{projectId}/`。`state.projectId` 通常由 `开启自动数据收集` 先解析写入，所以建议 Scratcher 先运行自动收集，再读取看板地址。

请求格式：不上报后端，没有 `/collect` 请求。

后端处理：无。

前端获取：玩家打开这个积木返回的 URL 后，React Router 匹配 `/p/:projectId`，Dashboard 用 URL 中的 `projectId` 拉取对应作品数据。

## 当前玩家 uuid

积木信息：`当前玩家 uuid`，opcode 是 `getPlayerUuid`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Player.getUuid()`。

拓展端处理：

1. 如果 `state.userUuid` 已有值，直接返回。
2. 优先调用 `state.runtime.ccwAPI.getUserInfo()`，取返回对象的 `uuid`。
3. 如果当前环境没有 `ccwAPI` 或调用失败，从 `localStorage.anonymousId` 读取本机匿名 ID。
4. 本机也没有匿名 ID 时生成 `anon_...` 并写入 localStorage。

请求格式：不上报 dashboard 后端，没有 `/collect` 请求。它可能调用 CCW runtime 提供的 `ccwAPI.getUserInfo()`，这是宿主环境 API，不是本项目 dashboard API。

后端处理：无。后续其它积木上报时，会把这个 uuid 填到 `EventRecord.userUuid`，查询玩家和回头率时再使用。

前端获取：无单独展示接口。它作为其它记录的 `userUuid` 字段，被 `getSessionSummary()`、`getPlayerRetention()`、`getPlayers()`、`getFunnel()` 间接使用。

## 开始记录本次会话

积木信息：`开始记录本次会话`，opcode 是 `sessionStart`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Session.start()`。

拓展端处理：

1. 如果 `state.sessionId` 已存在，直接返回，防止重复开始同一次会话。
2. 调用 `Player.getUuid()` 确保玩家身份可用。
3. 生成 `sessionId`，记录 `state.sessionStartTime`。
4. 更新本地 `visitCounts`，得到 `visitCount` 和 `isReturning`。
5. 调用 `pushRecord('session_start', 'session', state.sessionStartTime, JSON.stringify({ visitCount, isReturning }))` 入队。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "session_start",
      "category": "session",
      "value": 1793779200000,
      "properties": "{\"visitCount\":2,\"isReturning\":true}",
      "ts": 1793779200000
    }
  ]
}
```

后端处理：`collect.records()` 写入 `EventRecord` 表。查询时：

| 后端 action | 处理方式 |
| --- | --- |
| `session.list_()` | 查 `category=session`，把 `session_start.value` 作为 `startTs`，把 `userUuid` 带到会话结果 |
| `session.summary()` | 基于会话列表计算总会话数、平均时长、完整率、唯一玩家、回头访问率 |
| `player.list_()` | 只查 `name=session_start`，按 `userUuid` 聚合访问次数、首次访问、末次访问 |
| `player.retention()` | 基于玩家访问次数计算新玩家、回头玩家、人均访问次数 |

前端获取：`useDashboardData()` 首次加载时并发调用 `getSessionSummary()`、`getSessions()`、`getPlayerRetention()`，分别渲染 KPI、会话时长分布、玩家回头率。

## 结束记录本次会话

积木信息：`结束记录本次会话`，opcode 是 `sessionEnd`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Session.end()`。

拓展端处理：

1. 如果没有 `state.sessionId`，直接返回，防止无会话结束。
2. 计算 `durationMs = endTs - state.sessionStartTime`。
3. 根据结束原因写 `isComplete`：手动积木和自然停止是 `true`，页面关闭兜底是 `false`。
4. 调用 `pushRecord('session_end', 'session', endTs, JSON.stringify({ durationMs, isComplete, startTs }))` 入队。
5. 清空当前会话状态。
6. 自然结束时立即 `sender.flushNow()`，尽快把会话闭环送到后端。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "session_end",
      "category": "session",
      "value": 1793779260000,
      "properties": "{\"durationMs\":60000,\"isComplete\":true,\"startTs\":1793779200000}",
      "ts": 1793779260000
    }
  ]
}
```

后端处理：`session.list_()` 读取 `session_end.properties`，解析出 `durationMs` 和 `isComplete`，并把 `value` 作为 `endTs`。`session.summary()` 用它计算平均时长和完整结束率。

前端获取：`getSessions()` 提供会话时长分布，`getSessionSummary()` 提供平均时长和完整率 KPI。

## 本次会话已游玩秒数

积木信息：`本次会话已游玩秒数`，opcode 是 `sessionElapsed`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Session.elapsedSeconds()`。

拓展端处理：读取 `state.sessionStartTime`，返回 `Math.floor((Date.now() - state.sessionStartTime) / 1000)`。没有会话时返回 `0`。

请求格式：不上报后端，没有 `/collect` 请求。

后端处理：无。真正被 dashboard 使用的会话时长来自 `sessionEnd` 上报的 `durationMs`。

前端获取：无。

## 记录事件 [name]

积木信息：`记录事件 [name]`，opcode 是 `trackEvent`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.event(args.name)`。

拓展端处理：调用 `pushRecord(name, 'event', null, null)`。适合记录点赞、收藏、关注、点击按钮、进入房间等离散行为。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "like",
      "category": "event",
      "value": null,
      "properties": null,
      "ts": 1793779230000
    }
  ]
}
```

后端处理：

| 后端 action | 处理方式 |
| --- | --- |
| `event.timeline(projectId, name, days)` | 查 `category=event`，可选按 `name` 过滤，再按天分桶计数 |
| `event.top(projectId, days)` | 查 `category=event`，按 `name` 计数并取 Top 10 |

前端获取：`useDashboardData()` 首次加载时调用 `getEventTimeline(projectId, { days })` 和 `getEventTop(projectId, days)`。Dashboard 的“事件趋势”默认显示所有事件合计；切到“单事件”并输入事件名后调用 `loadTimeline(eventName)`，最终请求 `GET /events/{projectId}/timeline?name=like&days=30`。

## 记录事件 [name] 值为 [value]

积木信息：`记录事件 [name] 值为 [value]`，opcode 是 `trackEventValue`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.eventValue(args.name, Scratch.Cast.toNumber(args.value))`。

拓展端处理：调用 `pushRecord(name, 'event', value, null)`。适合记录“到达第几关”“一次获得多少金币”这类事件发生时带一个数值的场景。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "level_reached",
      "category": "event",
      "value": 3,
      "properties": null,
      "ts": 1793779240000
    }
  ]
}
```

后端处理：当前事件查询只按 `category/name/ts` 统计次数，`value` 会落库但不会参与现有 `event.timeline()` 和 `event.top()` 的聚合。

前端获取：和普通事件相同，使用 `getEventTimeline()` 和 `getEventTop()` 展示事件发生次数。当前 dashboard 不展示事件 `value` 明细。

## 记录事件 [name] 详情 [detail]

积木信息：`记录事件 [name] 详情 [detail]`，opcode 是 `trackEventDetail`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.eventDetail(args.name, args.detail)`。

拓展端处理：`detail` 会被包装成 JSON 字符串，调用 `pushRecord(name, 'event', null, JSON.stringify({ detail }))`。这样 Scratcher 传普通文本也能安全进入统一 `properties` 字段。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "item_got",
      "category": "event",
      "value": null,
      "properties": "{\"detail\":\"拿到了宝剑\"}",
      "ts": 1793779250000
    }
  ]
}
```

后端处理：和普通事件一样落库并参与次数统计。当前 `event.timeline()` 和 `event.top()` 不解析 `properties.detail`。

前端获取：和普通事件相同，使用 `getEventTimeline()` 和 `getEventTop()` 展示事件次数。详情字段当前只保存在数据库里，dashboard 暂无详情列表视图。

## 记录指标 [name] 当前值 [value]

积木信息：`记录指标 [name] 当前值 [value]`，opcode 是 `trackMetric`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.metric(args.name, Scratch.Cast.toNumber(args.value))`。

拓展端处理：调用 `pushRecord(name, 'metric', value, null)`。适合记录血量、速度、金币数、在线人数等随时间变化的瞬时值。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "hp",
      "category": "metric",
      "value": 80,
      "properties": null,
      "ts": 1793779260000
    }
  ]
}
```

后端处理：`metric.series(projectId, name, days)` 查询 `category=metric` 且 `name` 匹配的记录，按 `ts` 升序返回 `{ ts, value }` 序列。

前端获取：Dashboard 的“指标趋势”输入框填指标名后调用 `loadMetricSeries(metricName)`，最终请求 `getMetricSeries(projectId, name, days)`，对应 `GET /metrics/{projectId}/series?name=hp&days=30`，用折线图展示。

## 计数器 [name] 增加 [delta]

积木信息：`计数器 [name] 增加 [delta]`，opcode 是 `counterAdd`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.counterAdd(args.name, Scratch.Cast.toNumber(args.delta))`。

拓展端处理：

1. 在 `state.counters[name]` 中维护本地当前值。
2. 把本地当前值加上 `delta`。
3. 调用 `pushRecord(name, 'counter', state.counters[name], JSON.stringify({ op: 'add', delta }))`。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "kills",
      "category": "counter",
      "value": 5,
      "properties": "{\"op\":\"add\",\"delta\":1}",
      "ts": 1793779270000
    }
  ]
}
```

后端处理：`metric.counters(projectId)` 查询该作品所有 `category=counter` 记录，按 `ts` 倒序排列后，每个 `name` 只取第一条作为最新值。当前后端不重放 `op/delta`，`properties` 主要用于保留语义，方便以后做更严格的重算或审计。

前端获取：`useDashboardData()` 首次加载时调用 `getCounters(projectId)`，对应 `GET /metrics/{projectId}/counters`。Dashboard 的“计数器当前值”表格展示 `name/value/ts`。

## 计数器 [name] 设为 [value]

积木信息：`计数器 [name] 设为 [value]`，opcode 是 `counterSet`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.counterSet(args.name, Scratch.Cast.toNumber(args.value))`。

拓展端处理：把 `state.counters[name]` 覆盖成 `value`，再调用 `pushRecord(name, 'counter', value, JSON.stringify({ op: 'overwrite' }))`。适合清零、重置、同步某个权威数值。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "kills",
      "category": "counter",
      "value": 0,
      "properties": "{\"op\":\"overwrite\"}",
      "ts": 1793779280000
    }
  ]
}
```

后端处理：和 `counterAdd` 相同，`metric.counters()` 按时间取每个计数器的最新记录，所以覆盖值会自然成为当前值。

前端获取：和 `counterAdd` 相同，`getCounters(projectId)` 返回最新值并在“计数器当前值”表格展示。

## 提交分数 [value]

积木信息：`提交分数 [value]`，opcode 是 `submitScore`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.score(Scratch.Cast.toNumber(args.value))`。

拓展端处理：调用 `pushRecord('score', 'score', value, null)`。分数用固定 `name=score`，并通过 `category=score` 和普通计数器区分。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "score",
      "category": "score",
      "value": 9800,
      "properties": null,
      "ts": 1793779290000
    }
  ]
}
```

后端处理：`metric.score_dist(projectId, days)` 查询最近 n 天 `category=score` 的记录，取所有非空 `value`，计算提交次数、最高分、最低分、平均分、前 10 名分数。

前端获取：`useDashboardData()` 首次加载时调用 `getScores(projectId, days)`，对应 `GET /metrics/{projectId}/scores?days=30`。Dashboard 的“分数分布”展示总提交次数、最高、最低、平均和 Top 排行。

## 漏斗 [funnel] 进入步骤 [step]

积木信息：`漏斗 [funnel] 进入步骤 [step]`，opcode 是 `funnelStep`，定义在 [src/index.ts](src/index.ts)，执行时调用 `Track.funnelStep(args.funnel, args.step)`。

拓展端处理：

1. `state.funnels[funnelName]` 保存本会话内这个漏斗的步骤顺序。
2. 某个 `stepName` 第一次出现时分配 `stepIndex = 已有步骤数 + 1`。
3. 同一会话重复进入同一步，复用原 `stepIndex`。
4. 调用 `pushRecord(stepName, 'funnel', null, JSON.stringify({ funnel: funnelName, stepIndex }))`。

请求格式：

```json
{
  "records": [
    {
      "projectId": "6743db44e6d6684b55c0e58f",
      "sessionId": "s_lz9g4nabc1",
      "userUuid": "player-uuid",
      "name": "choose_role",
      "category": "funnel",
      "value": null,
      "properties": "{\"funnel\":\"tutorial\",\"stepIndex\":2}",
      "ts": 1793779300000
    }
  ]
}
```

后端处理：`metric.funnel(projectId, funnel, days)` 查询最近 n 天 `category=funnel` 的记录，解析 `properties.funnel`，只保留指定漏斗。然后按步骤名收集到达该步骤的 `userUuid` 集合，计算每步去重人数和相对上一步的转化率。

前端获取：Dashboard 的“漏斗转化”输入框填漏斗名后调用 `loadFunnel(funnelName)`，最终请求 `getFunnel(projectId, funnel, days)`，对应 `GET /metrics/{projectId}/funnel?funnel=tutorial&days=30`，用漏斗图展示每步人数和转化率。

## dashboard 查询接口索引

| 数据域 | 前端函数 | HTTP 请求 | 后端函数 | 主要来源积木 |
| --- | --- | --- | --- | --- |
| 会话总览 | `getSessionSummary(projectId, days)` | `GET /sessions/{projectId}/summary?days=30` | `session.summary()` | `autoStart`、`sessionStart`、`sessionEnd` |
| 会话列表 | `getSessions(projectId, days)` | `GET /sessions/{projectId}?days=30` | `session.list_()` | `autoStart`、`sessionStart`、`sessionEnd` |
| 玩家回头率 | `getPlayerRetention(projectId, days)` | `GET /players/{projectId}/retention?days=30` | `player.retention()` | `autoStart`、`sessionStart`、`getPlayerUuid` 间接提供身份 |
| 玩家列表 | `getPlayers(projectId, days)` | `GET /players/{projectId}?days=30` | `player.list_()` | `sessionStart` |
| 事件趋势 | `getEventTimeline(projectId, { name, days })` | `GET /events/{projectId}/timeline?name=like&days=30` | `event.timeline()` | `trackEvent`、`trackEventValue`、`trackEventDetail` |
| 热门事件 | `getEventTop(projectId, days)` | `GET /events/{projectId}/top?days=30` | `event.top()` | `trackEvent`、`trackEventValue`、`trackEventDetail` |
| 指标折线 | `getMetricSeries(projectId, name, days)` | `GET /metrics/{projectId}/series?name=hp&days=30` | `metric.series()` | `trackMetric` |
| 计数器当前值 | `getCounters(projectId)` | `GET /metrics/{projectId}/counters` | `metric.counters()` | `counterAdd`、`counterSet` |
| 分数分布 | `getScores(projectId, days)` | `GET /metrics/{projectId}/scores?days=30` | `metric.score_dist()` | `submitScore` |
| 漏斗转化 | `getFunnel(projectId, funnel, days)` | `GET /metrics/{projectId}/funnel?funnel=tutorial&days=30` | `metric.funnel()` | `funnelStep` |

## 以后新增积木时怎么接入这条链路

新增一个会上报数据的积木时，按这条顺序改最稳：

1. 在 [src/l10n/index.ts](src/l10n/index.ts) 增加积木显示文案。
2. 在 [src/index.ts](src/index.ts) 的 `getInfo().blocks` 增加 block 定义，并在方法区把 opcode 转发到 `commands`。
3. 如果是新业务主体，在 [src/commands/](src/commands/) 下新增或扩展对应指令对象；指令只做业务计算，然后调用 `pushRecord()`。
4. 如现有 `category` 不够表达，再同步扩展 [src/store.ts](src/store.ts) 的 `EventRecord.category` 类型、后端聚合 action、前端 API 类型。
5. 后端接收侧通常不用改，因为 `POST /collect` 已经按统一宽表落库；只有 dashboard 需要新的聚合视图时才新增 `actions` 查询和 `main.py` 路由。
6. 前端在 [scratcher-dashboard/web/src/api/client.ts](scratcher-dashboard/web/src/api/client.ts) 增加请求函数，在 [scratcher-dashboard/web/src/pages/useDashboardData.ts](scratcher-dashboard/web/src/pages/useDashboardData.ts) 管理状态，在 [scratcher-dashboard/web/src/pages/Dashboard.tsx](scratcher-dashboard/web/src/pages/Dashboard.tsx) 增加展示区域。
