// data-fire 上报队列统一写入口
// 设计思想：这是 HOP 链路的"数据修改"出口——所有指令（session / event / collect）
// 算完业务值后，都调 pushRecord 把结果变成一条 EventRecord 推进 state.queue。
// 集中这一处是为了保证：①记录结构永远一致（projectId/sessionId/userUuid/ts 全由这里填）；
// ②队列长度达批量阈值时，能立刻触发 sender 提前 flush（见尾部 onQueuePush）。
//
// 之前 session.ts 和 event.ts 各自复制了一份 enqueue，没人去触发"满 20 条提前发"。
// 现在统一在这里写一次，并把"达阈值提前 flush"也挂在这里——任何指令 push 满
// FLUSH_BATCH_SIZE 条，下一批就不会等到定时器，而是当场发出去。
//
// 调用示例：
//   import { pushRecord } from '../queue'
//   pushRecord('like', 'event', 1, null)              // 记一个带值的事件
//   pushRecord('session_start', 'session', startTs, '{"visitCount":2}')  // 会话开始

import { state, EventRecord } from './store'
import { sender } from './sender'

// 批量上报阈值：队列累计到这里就提前 flush，不必等定时器到点。
// 改这里和 sender.ts 里的同名常量一起改（sender 取的是它自己那份，这里取的是这份，
// 两份必须相等——故这里只导出一个，sender 直接 import 复用，避免双源不同步）。
export const FLUSH_BATCH_SIZE = 20

// 内存队列上限：后端离线、玩家身份接口卡住、宿主不触发定时器时，自定义事件仍可能持续入队。
// 上限取 1000 条，按“每 4 秒一条”约能保留 66 分钟，足够调试和短会话；超过时丢最老记录，优先保护游戏不卡死。
export const QUEUE_MEMORY_CAP = 1000

// 往上报队列里推一条记录。这是所有指令的统一写入出口。
// name/category/value/properties 是业务字段；projectId/sessionId/userUuid/ts 由本函数补齐，
// 保证推出去的记录结构永远完整一致。无会话时 sessionId 占位 's_none'，让记录不至于丢归属线索。
export function pushRecord(
  name: string,
  category: EventRecord['category'],
  value: number | null,
  properties: string | null
): void {
  const record: EventRecord = {
    projectId: state.projectId,
    sessionId: state.sessionId || 's_none', // 无会话兜底占位，autoStart/sessionStart 失败也不至于丢这条
    userUuid: state.userUuid,
    name,
    category,
    value,
    properties,
    ts: Date.now()
  }
  state.queue.push(record)
  pruneQueueToMemoryCap()
  onQueuePush()
}

// 把内存待发队列裁到固定上限。这里丢最老记录而不是拒绝新记录，因为最新行为更贴近玩家当前状态和调试现场。
function pruneQueueToMemoryCap(): void {
  if (state.queue.length <= QUEUE_MEMORY_CAP) return
  state.queue.splice(0, state.queue.length - QUEUE_MEMORY_CAP)
}

// 每次入队后检查：达批量阈值就提前 flush。这是"满 20 条触发一次"的真正实现点——
// 定时器负责兜底周期 flush，这里负责高峰时主动泄洪，两者互补。
function onQueuePush(): void {
  if (state.queue.length >= FLUSH_BATCH_SIZE) sender.flushNow()
}