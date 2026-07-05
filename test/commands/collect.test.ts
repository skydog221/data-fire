// data-fire 拓展端自动模式指令测试
// 设计思想：Collect.start 串起整条 HOP 链路（读 projectId、取身份、绑 runtime 事件、绑卸载兜底、
// 开 sender、重发离线缓存）。dashboardUrl 是纯字符串模板。这里测 dashboardUrl 纯函数 +
// start 的各绑定分支（桩 runtime/sender/Player/kv/Session）。
//
// collect.ts 用 `import { sender } from '../sender'` 等单例对象，spy 其方法是有效的（对象方法非 ESM 绑定）。
// 但 collect.ts 也 `import { Session }` 并在 bindRuntimeEvents 里 Session.start()——
// spy Session.start 有效（Session 是对象）。runtime.on 是 fake runtime 的方法 spy。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { state } from '../../src/store'
import { Collect } from '../../src/commands/collect'
import { sender } from '../../src/sender'
import * as sessionMod from '../../src/commands/session'
import * as playerMod from '../../src/commands/player'

describe('Collect.dashboardUrl 纯模板', () => {
  it('拼接 DASHBOARD_HOST + /p/ + projectId + /', () => {
    state.projectId = 'p_abc123'
    expect(Collect.dashboardUrl()).toBe('http://localhost:5173/p/p_abc123/')
  })

  it('占位 projectId 也能拼出 URL', () => {
    state.projectId = 'p_pending_x'
    expect(Collect.dashboardUrl()).toContain('/p/p_pending_x/')
  })
})

describe('Collect.start 流程', () => {
  let runtimeOn: ReturnType<typeof vi.fn>
  let senderStart: ReturnType<typeof vi.spyOn>
  let flushPending: ReturnType<typeof vi.spyOn>
  let sessionStart: ReturnType<typeof vi.spyOn>
  let playerGetUuid: ReturnType<typeof vi.spyOn>
  let addEventListener: ReturnType<typeof vi.spyOn>
  let docAddEventListener: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 还原 auto 各绑定标志，让 start 能重新绑
    state.auto.enabled = false
    state.auto.runtimeBound = false
    state.auto.unloadBound = false
    state.auto.flushTimerId = null
    state.auto.sessionStartTime = 0
    state.projectId = ''
    state.userUuid = ''

    // 当前作品 ID 从 URL 解析，默认给一个 detail 页面，避免测试跑在 about:blank 时得到 p_unknown。
    window.history.pushState(
      {},
      '',
      '/detail/6743db44e6d6684b55c0e58f?module=1'
    )

    // fake runtime 带 .on/.off spy，off 用来验证 stop 能释放自动模式监听器
    runtimeOn = vi.fn()
    ;(state as any).runtime = { on: runtimeOn, off: vi.fn() }

    // stub sender/session/player，避免真启定时器/真取身份
    senderStart = vi.spyOn(sender, 'start').mockImplementation(() => {})
    flushPending = vi.spyOn(sender, 'flushPending').mockResolvedValue(undefined)
    sessionStart = vi
      .spyOn(sessionMod.Session, 'start')
      .mockResolvedValue(undefined)
    playerGetUuid = vi
      .spyOn(playerMod.Player, 'getUuid')
      .mockResolvedValue('u1')

    // stub window/document 事件注册与释放
    addEventListener = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(() => {})
    docAddEventListener = vi
      .spyOn(document, 'addEventListener')
      .mockImplementation(() => {})
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})
    vi.spyOn(document, 'removeEventListener').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('从 detail URL 解析 projectId（不含 query 参数）', async () => {
    window.history.pushState(
      {},
      '',
      '/detail/6743db44e6d6684b55c0e58f?SubjectAreaGroupId=775&component=0'
    )
    await Collect.start()
    expect(state.projectId).toBe('6743db44e6d6684b55c0e58f')
  })

  it('从 project / extension URL 解析 projectId', async () => {
    window.history.pushState({}, '', '/project/p_abc?module=1')
    await Collect.start()
    expect(state.projectId).toBe('p_abc')

    state.auto.enabled = false
    window.history.pushState({}, '', '/extension/ext_456?foo=bar')
    await Collect.start()
    expect(state.projectId).toBe('ext_456')
  })

  it('绑定 PROJECT_RUN_START 与 PROJECT_RUN_STOP runtime 事件', async () => {
    await Collect.start()
    const registered = runtimeOn.mock.calls.map((c: any[]) => c[0])
    expect(registered).toContain('PROJECT_RUN_START')
    expect(registered).toContain('PROJECT_RUN_STOP')
  })

  it('PROJECT_RUN_START 回调调 Session.start', async () => {
    await Collect.start()
    const startCb = runtimeOn.mock.calls.find(
      (c: any[]) => c[0] === 'PROJECT_RUN_START'
    )![1]
    await startCb()
    expect(sessionStart).toHaveBeenCalledTimes(1)
  })

  it('PROJECT_RUN_STOP 回调调 Session.end(natural)', async () => {
    const endSpy = vi
      .spyOn(sessionMod.Session, 'end')
      .mockResolvedValue(undefined)
    await Collect.start()
    const stopCb = runtimeOn.mock.calls.find(
      (c: any[]) => c[0] === 'PROJECT_RUN_STOP'
    )![1]
    await stopCb()
    expect(endSpy).toHaveBeenCalledWith('natural')
    endSpy.mockRestore()
  })

  it('绑 beforeunload 与 visibilitychange 卸载兜底', async () => {
    await Collect.start()
    const winEvents = addEventListener.mock.calls.map((c: any[]) => c[0])
    const docEvents = docAddEventListener.mock.calls.map((c: any[]) => c[0])
    expect(winEvents).toContain('beforeunload')
    expect(docEvents).toContain('visibilitychange')
  })

  it('开 sender.start 与 flushPending', async () => {
    await Collect.start()
    expect(senderStart).toHaveBeenCalledTimes(1)
    expect(flushPending).toHaveBeenCalledTimes(1)
  })

  it('先开 sender 再等玩家身份，避免身份接口慢时事件只堆内存', async () => {
    const order: string[] = []
    senderStart.mockImplementation(() => {
      order.push('sender.start')
    })
    playerGetUuid.mockImplementation(async () => {
      order.push('player.getUuid')
      return 'u1'
    })
    await Collect.start()
    expect(order).toEqual(['sender.start', 'player.getUuid'])
  })

  it('stop 释放 runtime/window/document 监听器并停止 sender', async () => {
    const senderStop = vi.spyOn(sender, 'stop').mockImplementation(() => {})
    await Collect.start()
    const runtimeStartListener = state.auto.runtimeStartListener
    const runtimeStopListener = state.auto.runtimeStopListener
    Collect.stop()
    expect((state.runtime as any).off).toHaveBeenCalledWith('PROJECT_RUN_START', runtimeStartListener)
    expect((state.runtime as any).off).toHaveBeenCalledWith('PROJECT_RUN_STOP', runtimeStopListener)
    expect(window.removeEventListener).toHaveBeenCalledTimes(1)
    expect(document.removeEventListener).toHaveBeenCalledTimes(1)
    expect(senderStop).toHaveBeenCalledTimes(1)
    expect(state.auto.enabled).toBe(false)
    expect(state.auto.runtimeBound).toBe(false)
    expect(state.auto.unloadBound).toBe(false)
    senderStop.mockRestore()
  })

  it('幂等：已 enabled 直接 return 不重绑', async () => {
    state.auto.enabled = true
    await Collect.start()
    expect(runtimeOn).not.toHaveBeenCalled() // 已开启，跳过全部绑定
  })

  it('runtime 事件与卸载兜底各只绑一次（runtimeBound/unloadBound 标志）', async () => {
    await Collect.start()
    // 绑一次后置 bound 标志，第二次 start 即使 enabled 被绕过也由标志防重——
    // 这里直接验证第一次绑后标志生效：再调一次 start（清掉 enabled 但不清 bound）应跳过绑定
    state.auto.enabled = false
    const callsBefore = runtimeOn.mock.calls.length
    await Collect.start()
    expect(runtimeOn.mock.calls.length).toBe(callsBefore) // 已 bound，不重绑
  })
})
