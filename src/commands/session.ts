// data-fire 会话指令
// 设计思想：一次"游玩"=一个会话。开始时生成 sessionId、记开始时间、落 session_start 记录；
// 结束时记结束时间、算时长、落 session_end 记录。同时维护本地访问计数用于回头率。
//
// 回头率的本地实现：浏览器 localStorage 里存 visitCounts 表 { [userUuid]: {count,lastSeen} }，
// 每次 sessionStart 自增 count。后端会以 userUuid 权威去重，本地这份数据是兜底，
// 让扩展能在离线时也判断是否回头客。注意 visitCounts 会随匿名玩家增长无限膨胀，
// 所以每次写入前会 prune 掉最老的访问记录（见下）。
//
// 暴露主体：Session 对象。
// 调用示例：
//   await Session.start()        // 积木"开始记录本次会话"
//   await Session.end('natural') // 积木/自动模式"结束记录本次会话"（reason 见 end 注释）
//   Session.elapsedSeconds()     // 积木"本次会话已游玩 N 秒"

import { state } from '../store'
import { pushRecord } from '../queue'
import { sender } from '../sender'
import { kv } from '../kv'
import { Player } from './player'

// visitCounts 的本地保留条数上限。匿名玩家每来一个就多一条，存 localStorage 不封顶会越撑越大。
// 超过就按 lastSeen 最老逐个剔除——保留最近活跃的玩家即可算本机回头率。
const VISIT_CAP = 200

// 访问计数表里每条还需带个 lastSeen 时间戳，才能判断"最老"。这是带时间戳的版本结构。
type VisitTable = Record<string, { count: number; lastSeen: number }>

// 结束会话的理由，决定后端 isComplete 怎么算。之前 hardcode true，导致"中途关页面"也算完整。
// natural: 玩家点了停止或脚本自然跑完（PROJECT_RUN_STOP）——算完整。
// unload : 玩家直接关页面/切后台——不算完整。
type EndReason = 'natural' | 'unload'

export const Session = {
  // 开始一次会话。生成 sessionId、取玩家身份、自增本地访问计数、落 session_start 记录。
  // 异步因为要拿玩家身份。积木是 command 但可以返回 Promise，Scratch 会等待。
  async start(): Promise<void> {
    if (state.sessionId) return // 已有会话不重复开始，防止玩家在作品里反复触发
    const uuid = await Player.getUuid() // 确保玩家身份已就绪，会话记录要带它
    state.userUuid = uuid
    state.sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    state.sessionStartTime = Date.now()
    state.auto.sessionStartTime = state.sessionStartTime // 自动模式也复用这个开始时间
    // 本地访问计数自增，算回头率。visitCounts 是带 lastSeen 的表存 localStorage。
    const visits = kv.getItem('visitCounts', {}) as Record<string, unknown>
    migrateVisits(visits) // 兼容旧格式：更早版本存的是 { [uuid]: number }（纯计数），改成 { count, lastSeen } 结构后旧数据仍是数字，这里就地迁移，防止 entry.count += 1 在数字上建属性抛错
    const table = visits as VisitTable
    const entry = table[uuid] || { count: 0, lastSeen: 0 }
    entry.count += 1
    entry.lastSeen = Date.now()
    table[uuid] = entry
    pruneVisits(table) // 超 VISIT_CAP 剔除最老的，防 localStorage 无限膨胀
    kv.setItem('visitCounts', table)
    // session_start 记录：value 放开始时间戳，properties 放访问次数与是否回头客
    pushRecord(
      'session_start',
      'session',
      state.sessionStartTime,
      JSON.stringify({ visitCount: entry.count, isReturning: entry.count > 1 })
    )
  },

  // 结束当前会话。reason 决定 isComplete 后端怎么算（见 EndReason）。
  // 算时长、落 session_end 记录，reason=natural 时立即 flush 把这批送出去。
  async end(reason: EndReason = 'natural'): Promise<void> {
    if (!state.sessionId) return // 没有会话就不结束
    const endTs = Date.now()
    const durationMs = endTs - state.sessionStartTime
    // isComplete 现在按 reason：自然停止才算完整，关页面/切后台不算。之前 hardcode true 是错的。
    const isComplete = reason === 'natural'
    pushRecord(
      'session_end',
      'session',
      endTs,
      JSON.stringify({ durationMs, isComplete, startTs: state.sessionStartTime })
    )
    state.sessionId = ''
    state.sessionStartTime = 0
    state.auto.sessionStartTime = 0
    if (reason === 'natural') {
      // 自然结束是重要节点，立即 flush（in-flight 守卫会防重复批次）。
      // unload 不走这条——关页面要靠 sendBeacon（sender.flushNow(true)），由 collect 统一调。
      sender.flushNow()
    }
  },

  // 返回当前会话已过秒数。积木"本次会话已游玩 N 秒"调用，reporter 类型必须同步返回。
  // 没有会话时返回 0,避免除零或 NaN 干扰 Scratcher 的游戏逻辑。
  // 注意：会话 start 是异步的，start 的 Promise 尚未 resolve 时本 reporter 可能拿到 0；
  // reporter 在 Scratch 里通常每帧重算，故会在 start 落定后自愈——开始的数百毫秒内返回 0 是已知取舍。
  elapsedSeconds(): number {
    if (!state.sessionStartTime) return 0
    return Math.floor((Date.now() - state.sessionStartTime) / 1000)
  }
}

// 剔除 visitCounts 表里超 VISIT_CAP 的最老条目。直接修改入参表然后返回。
// 单独成函数让 start 主流程更清晰；纯本地裁剪逻辑独立看也易懂。
function pruneVisits(visits: VisitTable): void {
  const keys = Object.keys(visits)
  if (keys.length <= VISIT_CAP) return
  // 按 lastSeen 升序排，最老的（时间戳最小）排前面，逐个删直到回到 VISIT_CAP。
  keys
    .sort((a, b) => visits[a].lastSeen - visits[b].lastSeen)
    .slice(0, keys.length - VISIT_CAP)
    .forEach((k) => delete visits[k])
}

// 就地把旧格式 visitCounts 迁移到新结构。旧版每条是数字（纯计数），新版是 { count, lastSeen }。
// 直接改入参对象，让后续 setItem 把迁移后的结构落回 localStorage——跑一次后 storage 里就是新格式，下次无需再迁。
// 之所以就地写而不是返回新对象：减少一次拷贝，且 start 主流程读到的就是迁移后的对象。
function migrateVisits(raw: Record<string, unknown>): void {
  let dirty = false
  for (const uuid of Object.keys(raw)) {
    const v = raw[uuid]
    if (typeof v === 'number') {
      raw[uuid] = { count: v, lastSeen: 0 } // 旧数据没有 lastSeen，用 0 兜底（会被 prune 优先剔除，无妨）
      dirty = true
    }
  }
  if (dirty) {
    // 迁移完立刻落库一次，避免万一 start 后续步骤出错导致迁移结果丢失、下次还报同样的错。
    kv.setItem('visitCounts', raw)
  }
}