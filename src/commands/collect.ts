// data-fire 自动模式指令
// 设计思想：一个积木"开启自动数据收集"启动一整套非自定义数据的自动采集。
// 自动采集的内容：会话开始/结束（绑 runtime 的 PROJECT_RUN_START/STOP 事件）、
// 会话时长（会话记录里带）、回头率（session 指令里已算）、页面关闭时兜底结束会话。
// 业务语义数据（点赞/收藏/关注时机）不在这自动采集，因为扩展无法监听 Scratch 网站按钮，
// 必须由 Scratcher 用自定义积木在自己作品的交互逻辑里触发——这是明确设计边界，详见 DESIGN.md 域3。
//
// 暴露主体：Collect 对象：
//   start()         对应总开关积木"开启自动数据收集"
//   dashboardUrl()  对应积木"看板地址"，返回当前作品的 dashboard 公开访问 URL
// 调用示例：
//   await Collect.start()              // 积木"开启自动数据收集"——初始化自动采集，具体上报 API 地址在 sender.ts
//   const url = Collect.dashboardUrl() // 积木"看板地址"——拿到 http://localhost:5173/p/{projectId}/

import { state } from '../store'
import { sender } from '../sender'
import { getCurrentProjectID } from '../project'
import { Session } from './session'
import { Player } from './player'

// dashboard 公开访问地址。注意：这不是后端 collect API 地址；上报地址在 sender.ts 的 DEFAULT_ENDPOINT。
// 开发时 dashboard 前端跑 5173，后端 API 跑 8000。看板地址必须给 Scratcher 打开前端页面，
// 所以这里保留 5173；sender 上报必须打到 8000，否则 /collect 会落到 Vite 前端导致 CORS 报错。
const DASHBOARD_HOST = 'http://localhost:5173'

// 自动模式总开关。绑定 runtime 事件、初始化身份与会话、开启批量上报、重发历史缓存。
// 这个方法把整条 HOP 链路串起来：触发(本积木被调用)→指令(绑事件、调 session)→数据(state 被改)→反馈(sender 上报)。
export const Collect = {
  async start(): Promise<void> {
    if (state.auto.enabled) return // 防重复开启，避免同一作品脚本重复调用时叠加定时器和监听器
    state.auto.enabled = true
    // projectId：直接从当前页面 URL 解析，支持 /extension/{id}、/detail/{id}、/project/{id} 三种路径。
    // 只取路径段，不含 ? 后的传参。解析不到时用 p_unknown 占位，避免空 projectId 让后端记录失去归属。
    state.projectId = getCurrentProjectID() || 'p_unknown'
    // 先开上报循环：玩家身份接口可能慢，Scratcher 又可能立刻进入“每 4 秒记录事件”，先让队列有泄洪口，避免内存只增不减。
    sender.start()
    // 等玩家身份就绪，自动模式要靠它算回头率；失败会在 Player 内部降级匿名身份，不让自动模式停在半启动状态。
    await Player.getUuid()
    // 绑定 runtime 事件，把自动采集挂上去。只绑一次，runtimeBound 标记防重复。
    if (!state.auto.runtimeBound) bindRuntimeEvents()
    // 绑页面卸载兜底（sendBeacon）。只绑一次，unloadBound 标记防重复。
    if (!state.auto.unloadBound) bindUnloadFallback()
    // 重发离线缓存放在监听器之后：即使历史缓存较多，也不耽误本次运行开始/停止事件被接住。
    await sender.flushPending()
  },

  // 停止自动采集并释放所有宿主资源。拓展热重载、卸载、测试清理时调用，防旧监听器/定时器继续持有闭包造成内存泄漏。
  stop(): void {
    unbindRuntimeEvents()
    unbindUnloadFallback()
    sender.stop()
    state.auto.enabled = false
    state.auto.sessionStartTime = 0
  },

  // 返回当前作品的 dashboard 公开访问地址。对应积木"看板地址"。
  // 拼规则：DASHBOARD_HOST + '/p/' + projectId + '/'。projectId 来自当前 URL 的 extension/detail/project 后一段，
  // 所以看板地址和 CCW 作品天然绑定，不依赖后端分配或 localStorage 回写。
  // 玩家可在自动收集开启后的任意时刻用这个积木取地址，去 dashboard 看自己的数据。
  dashboardUrl(): string {
    return `${DASHBOARD_HOST}/p/${state.projectId}/`
  }
}

// 把自动采集逻辑绑到 runtime 事件上。单独成函数让 collect.ts 的主流程更清晰。
function bindRuntimeEvents(): void {
  const runtime = state.runtime as any
  const onStart = () => {
    // 不 await：事件回调不能阻塞 runtime，会话开始是异步的但 runtime 不需要等它。
    Session.start().catch(() => {})
  }
  const onStop = () => {
    Session.end('natural').catch(() => {})
  }

  state.auto.runtimeStartListener = onStart
  state.auto.runtimeStopListener = onStop
  state.auto.runtimeBound = true
  // PROJECT_RUN_START：玩家点了绿旗或点了运行。此时开始一次会话。
  runtime.on('PROJECT_RUN_START', onStart)
  // PROJECT_RUN_STOP：玩家点了停止或脚本全部跑完。此时自然结束会话（isComplete=true）。
  runtime.on('PROJECT_RUN_STOP', onStop)
}

// 从 runtime 上拆掉自动采集监听器。Scratch runtime 近似 Node EventEmitter，不同宿主可能叫 off 或 removeListener，两个都兼容。
function unbindRuntimeEvents(): void {
  const runtime = state.runtime as any
  if (!state.auto.runtimeBound) return // 没绑定过就不处理，避免测试或半启动状态下访问空回调

  removeRuntimeListener(runtime, 'PROJECT_RUN_START', state.auto.runtimeStartListener)
  removeRuntimeListener(runtime, 'PROJECT_RUN_STOP', state.auto.runtimeStopListener)
  state.auto.runtimeStartListener = null
  state.auto.runtimeStopListener = null
  state.auto.runtimeBound = false
}

// 兼容不同 runtime 的解绑 API。必须传入注册时同一个 listener 引用，匿名函数无法被移除，这正是之前热重载泄漏的根源。
function removeRuntimeListener(runtime: any, eventName: string, listener: (() => void) | null): void {
  if (!listener) return // 半启动或旧状态可能没有保存到回调，直接跳过比抛错更适合游戏运行时
  if (typeof runtime.off === 'function') runtime.off(eventName, listener)
  else if (typeof runtime.removeListener === 'function') runtime.removeListener(eventName, listener)
}

// 页面关闭/隐藏兜底。之前用 beforeunload 调 Session.end，但普通 fetch 在 beforeunload 会被浏览器掐断，
// 真正送不到后端。现在分两步：①先走 Session.end('unload') 把 session_end 记录推进队列并标 isComplete=false；
// ②立即 sender.flushNow(true) 走 sendBeacon——这是浏览器承诺"卸载后也会替你发出去"的接口。
// 两者配合才把"中途关页面导致会话丢失"这条 DESIGN.md 域1 的承诺真正落地。
function bindUnloadFallback(): void {
  const onUnload = () => {
    Session.end('unload').then(() => sender.flushNow(true))
    // 注意 onUnload 是 sync 触发但内部 async：end 落记录后立刻 flushNow(true) 排 sendBeacon，
    // sendBeacon 本身是同步排队，浏览器会保证页面卸载后替我们把这批发出去。
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onUnload()
  }

  state.auto.unloadListener = onUnload
  state.auto.visibilityListener = onVisibilityChange
  state.auto.unloadBound = true
  // beforeunload：关页面/刷新。visibilitychange:hidden：切后台/最小化/切标签。
  // 两事件可能近同时触发——Session.end 内部 `if (!state.sessionId) return` 守卫保证只会落一条 session_end，
  // 第二次是 no-op，故不会产生重复批次。
  window.addEventListener('beforeunload', onUnload)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

// 拆掉页面级兜底监听器。removeEventListener 必须拿到注册时同一个函数，因此引用存在 state.auto 里。
function unbindUnloadFallback(): void {
  if (!state.auto.unloadBound) return // 没绑定过就不移除，保持 stop 可重复调用
  if (state.auto.unloadListener) window.removeEventListener('beforeunload', state.auto.unloadListener)
  if (state.auto.visibilityListener) document.removeEventListener('visibilitychange', state.auto.visibilityListener)
  state.auto.unloadListener = null
  state.auto.visibilityListener = null
  state.auto.unloadBound = false
}
