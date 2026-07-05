/*
  data-fire dashboard 后端 API 调用封装
  设计思想：HOP 里这是前端的"指令层"。用户操作/路由进入是触发事件，本文件的方法是指令执行，
  指令负责调后端接口拿到数据返回，组件拿到数据存进 state 驱动 UI 更新（数据修改→效果反馈）。
  每个后端 endpoint 对应一个方法，方法名用业务动词（getSessionSummary 而不是 getSummary），
  让人看到方法名就知道拉的是哪个业务数据。
  base url 优先取环境变量 VITE_API_BASE（生产部署用），dev 模式 vite.config.ts 的 proxy 把 /api 转发到 8000，
  所以默认值用 '/api' 即可走代理不跨域。

  调用示例（在组件里）：
    const summary = await getSessionSummary('p_abc')            // 会话总览
    const timeline = await getEventTimeline('p_abc', { days: 7 }) // 近7天事件趋势
    const scores = await getScores('p_abc', { days: 30 })       // 近30天分数分布

  所有时间戳均为毫秒。所有方法返回 Promise<数据>，出错抛 Error，组件 try/catch 后展示错误态。
*/

// ===== 后端返回的数据结构（和后端 actions 返回的字段一一对应，前端只读不改）=====

// 会话总览：sessions/{pid}/summary
export interface SessionSummary {
  totalSessions: number
  avgDurationMs: number
  completionRate: number
  uniquePlayers: number
  returningVisits: number
  returningRate: number
}

// 单条会话：sessions/{pid}
export interface SessionRow {
  sessionId: string
  startTs: number
  durationMs: number
  isComplete: boolean
  userUuid: string
  endTs?: number
}

// 玩家回头率：players/{pid}/retention
export interface PlayerRetention {
  uniquePlayers: number
  newPlayers: number
  returningPlayers: number
  returningPlayerRate: number
  totalVisits: number
  avgVisitsPerPlayer: number
}

// 单个玩家：players/{pid}
export interface PlayerRow {
  userUuid: string
  visits: number
  firstTs: number
  lastTs: number
}

// 事件趋势的一个时间桶：events/{pid}/timeline，bucket 是当天 00:00 UTC 毫秒
export interface EventBucket {
  bucket: number
  count: number
}

// 热门事件一项：events/{pid}/top
export interface EventTop {
  name: string
  count: number
}

// 指标序列一个点：metrics/{pid}/series
export interface MetricPoint {
  ts: number
  value: number
}

// 计数器当前值一项：metrics/{pid}/counters
export interface CounterRow {
  name: string
  value: number
  ts: number
}

// 分数分布：metrics/{pid}/scores
export interface ScoreDist {
  count: number
  max: number
  min: number
  avg: number
  topScores: number[]
}

// 漏斗一步：metrics/{pid}/funnel，rate 第一步为 null
export interface FunnelStep {
  step: string
  count: number
  rate: number | null
}

// 健康检查：/health
export interface HealthStatus {
  status: string
}


// ===== 底层请求工具 =====

// base url 优先环境变量，dev 走 vite proxy 的 /api 前缀，避免浏览器跨域拦截
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// 通用 fetch 封装：拼 URL、带查询参数、解析 JSON、出错抛带状态的 Error
// query 参数对象里值为 undefined 的键会被跳过，这样可选参数不传也不会拼成 name=undefined
async function request<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    })
  }

  const res = await fetch(url)
  if (!res.ok) {
    // 后端报错时把状态码和路径带上传出去，组件 catch 后能展示给用户排查
    throw new Error(`请求失败 ${res.status}: ${path}`)
  }

  return res.json() as Promise<T>
}


// ===== 会话相关 =====

// 会话总览：总次数、平均时长、完整率、唯一玩家、回头率
export function getSessionSummary(projectId: string, days = 30): Promise<SessionSummary> {
  return request<SessionSummary>(`/sessions/${projectId}/summary`, { days })
}

// 会话列表：用于画时长分布、查单条会话
export function getSessions(projectId: string, days = 30): Promise<SessionRow[]> {
  return request<SessionRow[]>(`/sessions/${projectId}`, { days })
}


// ===== 玩家相关 =====

// 玩家回头率：新老玩家构成、人均访问次数
export function getPlayerRetention(projectId: string, days = 30): Promise<PlayerRetention> {
  return request<PlayerRetention>(`/players/${projectId}/retention`, { days })
}

// 玩家列表：每个玩家的访问次数和首末时间
export function getPlayers(projectId: string, days = 30): Promise<PlayerRow[]> {
  return request<PlayerRow[]>(`/players/${projectId}`, { days })
}


// ===== 事件相关 =====

// 事件趋势：按天分桶的事件计数，name 不传则返回所有事件合计趋势
export function getEventTimeline(
  projectId: string,
  opts: { name?: string; days?: number } = {},
): Promise<EventBucket[]> {
  return request<EventBucket[]>(`/events/${projectId}/timeline`, {
    name: opts.name,
    days: opts.days ?? 30,
  })
}

// 热门事件 Top：横向条形排行用
export function getEventTop(projectId: string, days = 30): Promise<EventTop[]> {
  return request<EventTop[]>(`/events/${projectId}/top`, { days })
}


// ===== 指标/计数器/分数/漏斗 =====

// 指标序列：按 name 拉一条折线，name 必填（自定义积木上报的指标名）
export function getMetricSeries(projectId: string, name: string, days = 30): Promise<MetricPoint[]> {
  return request<MetricPoint[]>(`/metrics/${projectId}/series`, { name, days })
}

// 计数器当前值：所有 counter 的最新值
export function getCounters(projectId: string): Promise<CounterRow[]> {
  return request<CounterRow[]>(`/metrics/${projectId}/counters`)
}

// 分数分布：最高/最低/平均 + Top 排行
export function getScores(projectId: string, days = 30): Promise<ScoreDist> {
  return request<ScoreDist>(`/metrics/${projectId}/scores`, { days })
}

// 漏斗转化：每步人数与转化率，funnel 名必填
export function getFunnel(projectId: string, funnel: string, days = 30): Promise<FunnelStep[]> {
  return request<FunnelStep[]>(`/metrics/${projectId}/funnel`, { funnel, days })
}

// 健康检查：探活后端是否在线
export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/health')
}
