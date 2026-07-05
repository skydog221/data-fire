// data-fire 拓展端全局状态存储
// 设计思想：所有在运行期间需要被多个指令共享读写的数据都集中放在这里，
// 让人一眼看到整个业务会用到的数据有哪些、长什么样、初始值是什么。
// 这遵循 HOP 的"触发→指令→数据→反馈"链路：指令只负责改这里的数据，
// 数据变化驱动 sender 把队列上报出去、驱动 dashboard 展示。
//
// 重要边界：本文件只存数据 + 提供数据定义，不做上报逻辑。往 queue 里塞记录的
// 统一入口在 ./queue.ts（pushRecord），批量取走的逻辑在 ./sender.ts。store 不 import
// 两者，避免"数据层反向依赖反馈层"形成循环 import——数据层被动，反馈层主动取。
//
// store 暴露的是一个单例对象 state，commands 各文件直接 import state 来读写。
// 改动这里的字段等于改了整个拓展的运行时记忆，所以字段都带尾随注释说明用途。
//
// 调用示例：
//   import { state, EventRecord } from './store'
//   state.queue.length                    // 读队列长度（sender 判断批量阈值用）
//   const uid = state.userUuid              // 读当前玩家身份
//   state.sessionId = newId                 // 写当前会话 id

// 一条上报记录的统一结构，和 DESIGN.md 里 EventRecord 完全对齐。
// 所有自定义积木最终都生成这种结构 push 进 queue，sender 批量发到后端。
// 举例：{ projectId:'p_abc', sessionId:'s_1', userUuid:'u_1', name:'like', category:'event', value:1, properties:null, ts:1700000000000 }
export interface EventRecord {
  projectId: string // 作品 id，决定数据归属哪个 dashboard
  sessionId: string // 会话 id，一次游玩一个
  userUuid: string // 玩家身份，来自 ccwAPI 或本地匿名
  name: string // 事件/指标/计数器名
  category: 'session' | 'event' | 'metric' | 'counter' | 'score' | 'funnel'
  value: number | null // 数值载荷，无则 null
  properties: string | null // JSON 字符串，自定义扩展字段，无则 null
  ts: number // 毫秒时间戳
}

// 自动模式的开关位与运行状态也放这里，collect.ts 读写、其他指令只读。
interface AutoState {
  enabled: boolean // 自动模式是否已开启
  flushTimerId: number | null // 批量上报定时器句柄（setInterval 返回 number），关闭时 clearInterval 要它。原叫 flushTimer，改名 flushTimerId 更准确
  runtimeBound: boolean // runtime 事件是否已绑定，防止重复绑定
  unloadBound: boolean // 页面卸载/隐藏兜底是否已绑，防止重复绑
  sessionStartTime: number // 当前会话开始时间戳，0 表示未开始
  runtimeStartListener: (() => void) | null // PROJECT_RUN_START 的回调引用，stop 时必须拿同一个函数 off 掉，否则旧闭包会留在 runtime 里
  runtimeStopListener: (() => void) | null // PROJECT_RUN_STOP 的回调引用，和 runtimeStartListener 成对清理
  unloadListener: (() => void) | null // beforeunload 的回调引用，避免拓展热重载后旧页面监听器继续持有 state/sender
  visibilityListener: (() => void) | null // visibilitychange 的回调引用，removeEventListener 必须用注册时同一个函数
}

// 漏斗本地状态：每个漏斗名 → { 步骤名: 该步骤在本会话内首次进入的序号 }。
// 序号从 1 递增，按"本会话内首次进入某步骤"的先后分配，给后端提供稳定步骤顺序，
// 避免只靠时间戳近似排序漏斗转化。序号仅本会话内有效，跨会话重新计数——
// 后端按 (funnel, stepIndex) 聚合到达率，跨会话同一步骤会被并到同一桶。
type FunnelState = Record<string, Record<string, number>>

// 全局共享状态单例。字段都给初始值，方便看结构。
// 注意 state.projectId 由当前页面 URL 解析（见 ./project），不是后端分配、也不再持久化；
// 本表的运行时内存字段（userUuid/sessionId/queue/counters/funnels/auto.*）每次会话重置，不落盘。
const state = {
  runtime: null as unknown as VM.Runtime, // 拓展加载时由入口写入，各指令要用 runtime 绑事件、取舞台
  projectId: '', // 作品 id，空字符串表示尚未从当前 URL 解析到（collect.start 会写入）
  userUuid: '', // 玩家身份，空字符串表示尚未取（持久化在 localStorage 的 anonymousId，player 指令读回）
  sessionId: '', // 当前会话 id，空字符串表示无会话
  sessionStartTime: 0, // 当前会话开始时间戳（毫秒），0 表示无会话
  queue: [] as EventRecord[], // 待上报记录队列，sender 定时批量取走
  counters: {} as Record<string, number>, // 本地计数器当前值缓存，方便 counterAdd 就地累加再上报（内存态，不上报的镜像值，重启清零无妨）
  funnels: {} as FunnelState, // 本地漏斗步骤序号缓存，funnelStep 用它分配稳定 stepIndex（仅本会话内有效）
  auto: {
    // 自动模式运行状态
    enabled: false,
    flushTimerId: null,
    runtimeBound: false,
    unloadBound: false,
    sessionStartTime: 0,
    runtimeStartListener: null,
    runtimeStopListener: null,
    unloadListener: null,
    visibilityListener: null
  } as AutoState
}

export { state }