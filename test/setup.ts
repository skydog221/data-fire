// data-fire 拓展端测试全局 setup
// 设计思想：被测模块依赖若干浏览器/Scratch 宿主全局（Scratch.fetch、navigator.sendBeacon、
// localStorage、crypto.randomUUID、window/document 事件）。happy-dom 提供 localStorage/window/document，
// 但 Scratch 全局需自己造桩。每个用例前重置 state 单例，避免跨用例污染。
//
// 这里只造"所有测试都要的公共桩"，用例特有的桩在自己文件里局部 mock。

import { vi, beforeEach, afterEach } from 'vitest'
import { state } from '../src/store'

// ---- Scratch 全局桩 ----
// 拓展端用 Scratch.fetch（沙箱感知的 fetch）发 POST，用例可 vi.stubGlobal 覆盖。
// 默认桩返回一个 ok=true 的响应，避免没 mock 时直接崩；用例按需替换。
const defaultFetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ ok: true, projectId: 'p_test' }),
})) as any

const ScratchStub = {
  fetch: defaultFetch,
  Cast: { toNumber: (v: any) => Number(v) || 0 },
  BlockType: { COMMAND: 'command', REPORTER: 'reporter', HAT: 'hat' },
  ArgumentType: { STRING: 'string', NUMBER: 'number' },
  Separator: '---',
  extensions: { register: () => {}, unsandboxed: true },
  vm: { runtime: { gandi: undefined } },
  runtime: {} as any,
}
;(globalThis as any).Scratch = ScratchStub

// ---- crypto.randomUUID 桩 ----
// player.ts 用 crypto.randomUUID 生成匿名 id。happy-dom 自带真实 randomUUID 且 globalThis.crypto 是
// 只读 getter 无法整体覆盖，故用 vi.spyOn 固定其返回值，让 player 测试的匿名 id 分支可确定性断言。
// 注意：spy 在 setup 顶层装一次，afterEach 的 vi.restoreAllMocks 会还原它——故改用 vi.fn 直接覆写属性。
const _origRandomUUID = (globalThis as any).crypto?.randomUUID?.bind((globalThis as any).crypto)
;(globalThis as any).crypto.randomUUID = () => 'fake-uuid-0001'

// ---- navigator.sendBeacon 桩 ----
// sender 关页面兜底用 sendBeacon。happy-dom 可能没提供，桩成返回 true
if (!(navigator as any).sendBeacon) {
  ;(navigator as any).sendBeacon = () => true
}

// ---- state 单例重置 ----
// state 是可变单例，跨用例共享会串数据。每个用例前把字段还原到初始值。
// 不用 vi.resetModules（会触发模块图重算、成本高且易碎），直接手动重置字段更直观。
const initialState = {
  projectId: '',
  userUuid: '',
  sessionId: '',
  sessionStartTime: 0,
  queue: [] as any[],
  counters: {} as Record<string, number>,
  funnels: {} as Record<string, Record<string, number>>,
  auto: {
    enabled: false,
    flushTimerId: null as number | null,
    runtimeBound: false,
    unloadBound: false,
    sessionStartTime: 0,
    runtimeStartListener: null as (() => void) | null,
    runtimeStopListener: null as (() => void) | null,
    unloadListener: null as (() => void) | null,
    visibilityListener: null as (() => void) | null,
  },
}

beforeEach(() => {
  // 重置 state 各字段到初始值（保留 runtime 引用，避免各指令访问 runtime 时 null）
  state.projectId = initialState.projectId
  state.userUuid = initialState.userUuid
  state.sessionId = initialState.sessionId
  state.sessionStartTime = initialState.sessionStartTime
  state.queue = [] as any[]
  state.counters = {}
  state.funnels = {}
  state.auto.enabled = false
  state.auto.flushTimerId = null
  state.auto.runtimeBound = false
  state.auto.unloadBound = false
  state.auto.sessionStartTime = 0
  state.auto.runtimeStartListener = null
  state.auto.runtimeStopListener = null
  state.auto.unloadListener = null
  state.auto.visibilityListener = null
  // localStorage 清空，避免上个用例写入的 projectId/visitCounts/anonymousId/pendingQueue 残留
  localStorage.clear()
  // 桩函数调用记录清零
  defaultFetch.mockClear()
})

afterEach(() => {
  // 兜底再清一次 localStorage，防某些用例中途写入没在 beforeEach 前清干净
  localStorage.clear()
})
