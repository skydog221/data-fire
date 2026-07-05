// data-fire 上报反馈模块
// 设计思想：把 state.queue 里积攒的记录批量发到后端 collect 接口，发不出去就降级缓存进
// 浏览器 localStorage，下次启动重发。这是 HOP 链路的"效果反馈"环节——指令只往 queue 塞数据，
// 真正把数据送出去由本模块负责。本模块主动取 state.queue，store/queue 反向 import 本模块，
// 但本模块绝不 import commands，故无循环（commands→queue→sender→store，单向）。
//
// 关键策略（魔法数字都注释说明原因）：
//   - 批量上报：每 5 秒兜底一次 + 队列满 FLUSH_BATCH_SIZE 提前触发（提前触发在 queue.ts 的 onQueuePush）。
//   - 失败重试：单批最多重试 3 次，每次间隔翻倍退避，避免把后端打爆。
//   - 离线降级：仍失败就把这批记录存进 localStorage 的 pendingQueue 键，下次启动 flushPending 先发。
//   - 页面关闭兜底：用 sendBeacon 而非普通 fetch——beforeunload 不等 async，普通 fetch 会被浏览器中途掐断，
//     sendBeacon 是浏览器承诺"页面卸载后也会替你发出去"的专门接口，这才是关页面兜底的正确姿势。
//   - 响应体校验：仅 2xx 不算成功，还要看后端响应体里 ok=true，避免后端校验失败却返回 200 造成静默丢数据。
//
// 调用示例：
//   import { sender } from '../sender'
//   sender.start('https://api.example.com')   // 开启定时批量上报
//   sender.flushNow()                           // 立即发一批（会话结束、达阈值时调）
//   sender.flushNow(true)                       // 走 sendBeacon 立即发全部（页面关闭兜底专用）
//   await sender.flushPending()                 // 启动时重发 localStorage 历史缓存

import { state, EventRecord } from './store'
import { FLUSH_BATCH_SIZE } from './queue'

const FLUSH_INTERVAL_MS = 5000 // 每 5 秒兜底检查一次队列
const MAX_RETRY = 3 // 单批最多重试次数
const RETRY_BASE_MS = 1000 // 退避基数，第 n 次重试间隔 = 1000 * 2^(n-1)
const PENDING_KEY = 'pendingQueue' // 离线缓存在 localStorage 里的键名
const PENDING_CAP = 5000 // localStorage 离线缓存上限。超过则丢最老的——惯着沙箱配额，且不让单作品把浏览器塞爆

// 后端 collect API 地址。dashboard 前端跑在 5173，但 /collect 是 FastAPI 后端接口，开发时必须打到 8000。
// 如果这里错写成 dashboard 前端地址，浏览器会 POST http://localhost:5173/collect，Vite 前端不会返回 CORS 头，
// CCW 页面就会报 No 'Access-Control-Allow-Origin' header。生产部署时把这里改成真实后端 API 域名。
const DEFAULT_ENDPOINT = 'http://localhost:8000'

class Sender {
  endpoint = '' // 后端 collect 地址，start() 后写入为 DEFAULT_ENDPOINT
  running = false // 定时上报是否在跑，防止重复 start
  // in-flight 守卫：标记当前是否正在 flush。防止定时器、达阈值回调、会话结束三处
  // 同一时刻都调 flushNow 时，各自 splice 走一批并发 send，造成后端收到重复/乱序批次。
  // 第二次 flushNow 见 inflight=true 就直接 return，等当前这批发完下轮自然再发。
  private inflight = false

  // 开启批量上报循环。后端地址固定 DEFAULT_ENDPOINT（自定义地址功能已删，不再接收参数）。
  // 注意：离线缓存走 localStorage（./kv），沙箱 iframe 里可能受限，sender 内部已 try-catch 兜底。
  start(): void {
    this.endpoint = DEFAULT_ENDPOINT
    if (this.running) return
    this.running = true
    // 定时兜底 flush：到点就把当前队列发出去（queue.ts 的 onQueuePush 会在达阈值时提前调 flushNow，
    // 这里只是"防止久未达阈值也能周期性发"的兜底）。
    const timerId = setInterval(() => this.flushNow(), FLUSH_INTERVAL_MS)
    state.auto.flushTimerId = timerId // 存句柄，destroy 时 clearInterval
  }

  // 停止定时上报。测试或拓展卸载时用，常规运行不必调。
  stop(): void {
    if (state.auto.flushTimerId !== null) {
      clearInterval(state.auto.flushTimerId)
      state.auto.flushTimerId = null
    }
    this.running = false
  }

  // 立即把当前队列发出去。发成功就清队列；失败重试到放弃则降级缓存。
  // beacon=true 时走 sendBeacon：用于 beforeunload 等不等 async 的场景，能发出去但不重试、
  // 也不读响应体回写 projectId（页面都要没了，回写也用不上）。
  flushNow(beacon = false): void {
    if (this.inflight && !beacon) return // 有常规 flush 在跑且本次也是常规 flush：让路，避免重复批次
    const batch = state.queue.splice(0, FLUSH_BATCH_SIZE) // 先把这批从队列摘出来，腾出空间继续收新记录
    if (batch.length === 0) return
    if (beacon) {
      this.sendBeacon(batch)
      return
    }
    this.inflight = true
    this.sendWithRetry(batch)
      .then(ok => {
        if (!ok) this.cachePending(batch) // 重试到放弃仍失败，降级写 localStorage 等下次重发
      })
      .finally(() => {
        this.inflight = false
      })
  }

  // 带指数退避重试的发送。成功返回 true、彻底失败返回 false（不 reject，避免调用方还得 catch）。
  private async sendWithRetry(batch: EventRecord[]): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      const ok = await this.post(batch)
      if (ok) return true
      if (attempt < MAX_RETRY) {
        // 退避：第 1 次等 1s、第 2 次 2s、第 3 次 4s。用 await 而非 setTimeout 链，可读性更好。
        await this.sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1))
      }
    }
    return false
  }

  // 真正发 HTTP POST 到后端 collect 接口，并做响应体 ok 校验。
  // 用 Scratch.fetch 而不是原生 fetch：TurboWarp/CCW 环境下会走权限沙箱，更稳。
  private async post(batch: EventRecord[]): Promise<boolean> {
    try {
      const res = await Scratch.fetch(`${this.endpoint}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch })
      })
      if (!res.ok) return false // 非 2xx 直接判失败
      // 后端约定返回 { ok: true, accepted: number }。projectId 已由拓展从当前 URL 解析，后端不再分配/回写。
      const body = await res.json().catch(() => null)
      if (!body || body.ok !== true) return false
      return true
    } catch {
      return false
    }
  }

  // 页面关闭兜底专用：用 navigator.sendBeacon 发全部剩余队列。
  // beforeunload 不等 async，普通 fetch 会被掐断；sendBeacon 是浏览器承诺"页面卸载后替你发出去"的接口。
  // 不重试、不读响应、保守清队列（发不出去就留下次）：关页面时只能尽力而为，真正的"不丢"靠离线缓存兜底。
  private sendBeacon(batch: EventRecord[]): void {
    if (!navigator.sendBeacon) return // 没有该 API 的环境只能放弃这批
    const blob = new Blob([JSON.stringify({ records: batch })], {
      type: 'application/json'
    })
    const ok = navigator.sendBeacon(`${this.endpoint}/collect`, blob)
    if (!ok) this.cachePending(batch) // sendBeacon 返回 false 表示排队失败，降级缓存留下次
  }

  // 用 localStorage 存离线缓存。读取+追加+去上限+写回，整外层 try-catch 防沙箱抛错。
  // 注意 localStorage 在沙箱 iframe 里可能受限抛错，存不了就静默放弃这批——
  // 牺牲极端场景的少量数据，换取常规场景的干净存储与不中断游戏。这是有意识的取舍。
  private cachePending(batch: EventRecord[]): void {
    try {
      const prev = this.readPending()
      const next = prev.concat(batch)
      // 超过 PENDING_CAP 丢最老的，避免单作品把浏览器配额撑爆。
      const trimmed =
        next.length > PENDING_CAP ? next.slice(next.length - PENDING_CAP) : next
      this.writePending(trimmed)
    } catch (e) {
      console.warn('[data-fire] cache pending to localStorage failed', e)
    }
  }

  // 启动时调用：把 localStorage 里缓存的历史批次循环发出去，成功一批删一批，直到清空或失败。
  // 之前只发一批就停，积压到几百条要好几次重启才重发完；现在一次启动尽量清空。
  async flushPending(): Promise<void> {
    if (!this.endpoint) return
    let pending: EventRecord[]
    try {
      pending = this.readPending()
    } catch (e) {
      console.warn('[data-fire] read pending from localStorage failed', e)
      return
    }
    while (pending.length > 0) {
      const batch = pending.splice(0, FLUSH_BATCH_SIZE)
      const ok = await this.post(batch)
      if (ok) {
        this.safeWrite(pending) // 这批成功，把剩余写回（可能已空）
        continue
      }
      // 这批发不动：把这批塞回 pending 头部，写回整个，留待下次启动/重试，本轮停止。
      this.safeWrite(batch.concat(pending))
      break
    }
  }

  // 读 localStorage 里的待发缓存。解析失败当作空，避免坏数据卡死后续上报。
  private readPending(): EventRecord[] {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as EventRecord[]) : []
    } catch {
      return []
    }
  }

  // 写 localStorage 的待发缓存，外层兜 try-catch 防沙箱里 setItem 抛错。
  private writePending(records: EventRecord[]): void {
    localStorage.setItem(PENDING_KEY, JSON.stringify(records))
  }

  private safeWrite(records: EventRecord[]): void {
    try {
      this.writePending(records)
    } catch (e) {
      console.warn('[data-fire] write pending to localStorage failed', e)
    }
  }

  // 可等待的 sleep 工具。退避专用，别处不要用——指令里要延时请用 runtime 的 yield。
  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}

export const sender = new Sender()
