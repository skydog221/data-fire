// data-fire 拓展端会话指令测试
// 设计思想：Session 管理会话生命周期与本地访问计数（回头率）。
// 重点测：migrateVisits 旧格式迁移、start/end 落进 state.queue 的记录形状、幂等守卫、elapsedSeconds。
// 用 fake timers 控时 + 直接读 state.queue 断言记录，不 spy pushRecord——
// 因为 session.ts 用 `import { pushRecord }` 捕获了绑定，对 queueMod.pushRecord 的 spy 不会被
// 已导入的引用看到（ESM 命名导入是只读绑定，spy 不传播）。改读 state.queue 更稳。
// sender 是单例对象，flushNow 是其方法，spy sender.flushNow 有效。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { state } from '../../src/store'
import { Session } from '../../src/commands/session'
import { sender } from '../../src/sender'
import { kv } from '../../src/kv'

describe('migrateVisits 旧格式迁移（经 Session.start 间接验证）', () => {
  beforeEach(() => {
    state.sessionId = ''
    state.userUuid = 'u1'
    ;(state as any).runtime = {}
  })

  it('数字格式就地迁移成 {count,lastSeen:0} 再 +1', async () => {
    // 旧版 visitCounts 存 { uuid: number }，migrate 应 { uuid: { count, lastSeen: 0 } }。
    // start 里 entry.count += 1 若没迁移会在数字上建属性抛错——能跑过即迁移生效
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    kv.setItem('visitCounts', { u1: 5 }) // 旧格式数字
    await Session.start()
    const after = kv.getItem('visitCounts', {}) as any
    expect(after.u1).toEqual({ count: 6, lastSeen: 1000 }) // 旧 5 +1 = 6
    nowSpy.mockRestore()
  })

  it('已是新格式的不重复迁移，正常 +1', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(2000)
    kv.setItem('visitCounts', { u1: { count: 2, lastSeen: 500 } })
    await Session.start()
    const after = kv.getItem('visitCounts', {}) as any
    expect(after.u1).toEqual({ count: 3, lastSeen: 2000 })
    nowSpy.mockRestore()
  })
})

describe('pruneVisits 裁剪（间接）', () => {
  it('超 200 条时剔除最老，保留 200 条', async () => {
    // VISIT_CAP=200 是模块常量。造 201 条，lastSeen 递增（u0 最老）。start 后应只留 200 条
    state.sessionId = ''
    state.userUuid = 'u_existing'
    ;(state as any).runtime = {}
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(9999)
    const table: Record<string, { count: number; lastSeen: number }> = {}
    for (let i = 0; i < 201; i++) table['u' + i] = { count: 1, lastSeen: i }
    kv.setItem('visitCounts', table)
    await Session.start()
    const after = kv.getItem('visitCounts', {}) as any
    expect(Object.keys(after).length).toBe(200)
    expect(after.u0).toBeUndefined() // lastSeen 最小的被剔除
    nowSpy.mockRestore()
  })
})

describe('Session.start 生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.sessionId = ''
    state.userUuid = 'u1'
    ;(state as any).runtime = {}
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('生成 sessionId 并设置 sessionStartTime', async () => {
    // sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5000)
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const expectedRand = (0.5).toString(36).slice(2, 6)
    kv.setItem('visitCounts', {})
    await Session.start()
    expect(state.sessionId).toBe('s_' + (5000).toString(36) + expectedRand)
    expect(state.sessionStartTime).toBe(5000)
    expect(state.auto.sessionStartTime).toBe(5000)
    nowSpy.mockRestore()
    randSpy.mockRestore()
  })

  it('幂等：已有 sessionId 不重复开始', async () => {
    state.sessionId = 's_existing'
    await Session.start()
    // 已有 sessionId 直接 return，队列不该新增 session_start 记录
    expect(state.queue.find((r) => r.name === 'session_start')).toBeUndefined()
    expect(state.sessionId).toBe('s_existing') // 没被改写
  })

  it('pushRecord shape：value=开始ts、properties 含 visitCount/isReturning', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(7000)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    kv.setItem('visitCounts', { u1: { count: 1, lastSeen: 100 } })
    await Session.start()
    const after = kv.getItem('visitCounts', {}) as any
    expect(after.u1.count).toBe(2) // 第二次访问
    const rec = state.queue.find((r) => r.name === 'session_start')!
    expect(rec.value).toBe(7000)
    expect(JSON.parse(rec.properties as string)).toEqual({ visitCount: 2, isReturning: true })
    nowSpy.mockRestore()
  })
})

describe('Session.end 与 elapsedSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.sessionId = ''
    state.userUuid = 'u1'
    ;(state as any).runtime = {}
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('end 落 session_end 记录并重置，natural 时立即 flush', async () => {
    state.sessionId = 's1'
    state.sessionStartTime = 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(3000)
    const flushSpy = vi.spyOn(sender, 'flushNow').mockImplementation(() => {})
    await Session.end('natural')
    const rec = state.queue.find((r) => r.name === 'session_end')!
    expect(rec.value).toBe(3000)
    expect(JSON.parse(rec.properties as string)).toEqual({ durationMs: 2000, isComplete: true, startTs: 1000 })
    expect(state.sessionId).toBe('')
    expect(state.sessionStartTime).toBe(0)
    expect(flushSpy).toHaveBeenCalledTimes(1)
    flushSpy.mockRestore()
    nowSpy.mockRestore()
  })

  it('unload 不 flush（交由 sendBeacon）', async () => {
    state.sessionId = 's1'
    state.sessionStartTime = 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(2000)
    const flushSpy = vi.spyOn(sender, 'flushNow').mockImplementation(() => {})
    await Session.end('unload')
    expect(state.queue.find((r) => r.name === 'session_end')).toBeDefined()
    expect(flushSpy).not.toHaveBeenCalled()
    flushSpy.mockRestore()
    nowSpy.mockRestore()
  })

  it('无会话时 end 直接返回', async () => {
    state.sessionId = ''
    const flushSpy = vi.spyOn(sender, 'flushNow').mockImplementation(() => {})
    await Session.end('natural')
    expect(state.queue.find((r) => r.name === 'session_end')).toBeUndefined()
    expect(flushSpy).not.toHaveBeenCalled()
    flushSpy.mockRestore()
  })

  it('无会话时 elapsedSeconds 返回 0', () => {
    state.sessionStartTime = 0
    expect(Session.elapsedSeconds()).toBe(0)
  })

  it('elapsedSeconds 取整秒', () => {
    state.sessionStartTime = 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(3500)
    expect(Session.elapsedSeconds()).toBe(2) // (3500-1000)/1000=2.5 floor→2
    nowSpy.mockRestore()
  })
})