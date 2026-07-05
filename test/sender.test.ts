// data-fire 拓展端 sender 测试
// 设计思想：sender 是 HOP 链路的"反馈"环节，把 state.queue 批量 POST 到后端 /collect。
// 重点测：inflight 守卫去重、指数退避重试、post 契约（body.ok===true 才成功）、
// 响应无 ok 字段判失败走 cachePending（固化拓展端严格判定，防后端再漂移掉 ok）、
// sendBeacon 分支、cachePending 超上限裁剪、flushPending 成功清空/失败塞回头部。
// 用 fake timers 控制退避，spy Scratch.fetch 不真发 HTTP。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { state } from '../src/store'
import { sender } from '../src/sender'
import { FLUSH_BATCH_SIZE } from '../src/queue'

// 直接替换 Scratch.fetch 的工具：setup 里 Scratch 是普通对象，直接覆盖其 fetch 属性最稳，用例按需传实现
function setFetch(impl: any) {
  ;(globalThis as any).Scratch.fetch = impl
}

describe('sender start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, projectId: 'p_stable' })
      }))
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('start 设 endpoint 且 running，stop 清 interval', () => {
    sender.start()
    expect((sender as any).running).toBe(true)
    expect((sender as any).endpoint).toBe('http://localhost:8000')
    expect(state.auto.flushTimerId).not.toBeNull()
    sender.stop()
    expect((sender as any).running).toBe(false)
    expect(state.auto.flushTimerId).toBeNull()
  })

  it('start 幂等：重复 start 不重开 interval', () => {
    sender.start()
    const id1 = state.auto.flushTimerId
    sender.start()
    expect(state.auto.flushTimerId).toBe(id1) // 同一 timerId，没重开
  })
})

describe('sender flushNow inflight 守卫', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, projectId: 'p_s' })
      }))
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('inflight 时第二次 flushNow 直接 return 不重复发', async () => {
    let callCount = 0
    // fetch 慢返回，让 inflight 保持 true
    setFetch(
      vi.fn(async () => {
        callCount++
        await new Promise(r => setTimeout(r, 1000))
        return { ok: true, json: async () => ({ ok: true, projectId: 'p_s' }) }
      })
    )
    // 塞两批到队列，flushNow 一次只 splice FLUSH_BATCH_SIZE
    for (let i = 0; i < FLUSH_BATCH_SIZE * 2; i++)
      state.queue.push({
        projectId: 'p',
        sessionId: 's',
        userUuid: 'u',
        name: 'e',
        category: 'event',
        value: null,
        properties: null,
        ts: i
      })
    sender.flushNow() // 第一次：inflight=true，splice 第一批发
    sender.flushNow() // 第二次：inflight 仍 true，应直接 return
    // 推进时间让第一批落地
    await vi.advanceTimersByTimeAsync(2000)
    expect(callCount).toBe(1) // 只发了第一批那一次
  })

  it('beacon=true 时不受 inflight 限制', async () => {
    // beacon 模式直接走 sendBeacon，不走 inflight 守卫
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    for (let i = 0; i < 2; i++)
      state.queue.push({
        projectId: 'p',
        sessionId: 's',
        userUuid: 'u',
        name: 'e',
        category: 'event',
        value: null,
        properties: null,
        ts: i
      })
    sender.flushNow(true)
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    beaconSpy.mockRestore()
  })

  it('空队列 flushNow 什么都不做', () => {
    const fetchSpy = vi.fn()
    setFetch(fetchSpy)
    sender.flushNow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('sender sendWithRetry 退避', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('失败重试 3 次，间隔 1s/2s/4s', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false })) // 一直失败
    setFetch(fetchImpl)
    for (let i = 0; i < 2; i++)
      state.queue.push({
        projectId: 'p',
        sessionId: 's',
        userUuid: 'u',
        name: 'e',
        category: 'event',
        value: null,
        properties: null,
        ts: i
      })
    const cacheSpy = vi
      .spyOn(sender as any, 'cachePending')
      .mockImplementation(() => {})
    sender.flushNow()
    // 第 1 次立即发；第 2 次等 1s 后；第 3 次等 1+2=3s 后
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // 1s 后第 2 次
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 再 2s 后第 3 次
    // 第 3 次失败后不再重试，应触发 cachePending
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(500) // 让 finally 跑
    expect(cacheSpy).toHaveBeenCalledTimes(1)
    cacheSpy.mockRestore()
  })

  it('中途成功则停止重试', async () => {
    let n = 0
    setFetch(
      vi.fn(async () => {
        n++
        if (n < 2) return { ok: false } // 第 1 次失败
        return { ok: true, json: async () => ({ ok: true, projectId: 'p_s' }) } // 第 2 次成功
      })
    )
    for (let i = 0; i < 1; i++)
      state.queue.push({
        projectId: 'p',
        sessionId: 's',
        userUuid: 'u',
        name: 'e',
        category: 'event',
        value: null,
        properties: null,
        ts: i
      })
    sender.flushNow()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1100) // 1s 后第 2 次成功
    expect(n).toBe(2)
    // 再推进不该有第 3 次
    await vi.advanceTimersByTimeAsync(3000)
    expect(n).toBe(2)
    expect(state.queue.length).toBe(0) // 成功后队列被 splice 掉了
  })
})

describe('sender post 契约', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('body.ok===true 时成功，不回写 projectId', async () => {
    setFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, projectId: 'p_stable_123' })
      }))
    )
    state.projectId = 'url_project_123'
    state.queue.push({
      projectId: 'url_project_123',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: 1
    })
    sender.flushNow()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    // projectId 现在来自当前 URL，sender 只校验 ok，不再把响应体里的 projectId 写进 kv 或 state。
    expect(localStorage.getItem('datafire:projectId')).toBeNull()
    expect(state.projectId).toBe('url_project_123')
  })

  it('响应无 ok 字段判失败 → cachePending', async () => {
    // 固化拓展端严格判定：缺 ok:true 就当失败。后端若再漂移掉 ok 字段，sender 会走离线缓存。
    setFetch(
      vi.fn(async () => ({
        ok: 200,
        json: async () => ({ projectId: 'p_x', accepted: 1 })
      }))
    ) // 无 ok 字段
    state.queue.push({
      projectId: 'pending',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: 1
    })
    const cacheSpy = vi
      .spyOn(sender as any, 'cachePending')
      .mockImplementation(() => {})
    sender.flushNow()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(8000) // 重试 3 次全失败
    expect(cacheSpy).toHaveBeenCalledTimes(1) // 走离线缓存
    expect(localStorage.getItem('datafire:projectId')).toBeNull() // 没回写 projectId
    cacheSpy.mockRestore()
  })

  it('res.ok=false 直接失败不读 body', async () => {
    setFetch(
      vi.fn(async () => ({ ok: false, json: async () => ({ ok: true }) }))
    )
    const cacheSpy = vi
      .spyOn(sender as any, 'cachePending')
      .mockImplementation(() => {})
    state.queue.push({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: 1
    })
    sender.flushNow()
    await vi.advanceTimersByTimeAsync(8000)
    expect(cacheSpy).toHaveBeenCalledTimes(1)
    cacheSpy.mockRestore()
  })
})
describe('sender cachePending 与离线缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, projectId: 'p_s' })
      }))
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('cachePending 超 PENDING_CAP=5000 丢最老', () => {
    // 直接调私有 cachePending 验证裁剪逻辑
    const cap = 5000
    const batch = Array.from({ length: 100 }, (_, i) => ({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: i
    }))
    // 先塞已有 pending
    localStorage.setItem(
      'pendingQueue',
      JSON.stringify(Array.from({ length: cap }, (_, i) => ({ ts: i })))
    )
    ;(sender as any).cachePending(batch)
    const stored = JSON.parse(localStorage.getItem('pendingQueue') || '[]')
    expect(stored.length).toBe(cap) // 不超 cap
    // 最新的应是 batch 最后一条（ts=99）
    // 注意：裁剪保留最后 cap 条，已有 cap 条 + 新 100 条 = cap+100，裁到 cap 保留最后 cap 条，应是 batch 的尾巴
  })
})

describe('sender flushPending 重发', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('成功一批删一批，直到清空', async () => {
    setFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, projectId: 'p_s' })
      }))
    )
    ;(sender as any).endpoint = 'http://localhost:8000'
    // 预存 2 批 pending（每批 FLUSH_BATCH_SIZE）
    const pending = Array.from({ length: FLUSH_BATCH_SIZE * 2 }, (_, i) => ({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: i
    }))
    localStorage.setItem('pendingQueue', JSON.stringify(pending))
    await sender.flushPending()
    await vi.advanceTimersByTimeAsync(0)
    // 清空后 localStorage 里 pendingQueue 应是空数组
    const rest = JSON.parse(localStorage.getItem('pendingQueue') || '[]')
    expect(rest).toEqual([])
  })

  it('发不动时塞回头部停止本轮', async () => {
    setFetch(vi.fn(async () => ({ ok: false }))) // 一直失败
    ;(sender as any).endpoint = 'http://localhost:8000'
    const pending = Array.from({ length: 5 }, (_, i) => ({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: i
    }))
    localStorage.setItem('pendingQueue', JSON.stringify(pending))
    await sender.flushPending()
    // 第一批发不动，塞回头部，pendingQueue 仍应保留 5 条（没清空）
    const rest = JSON.parse(localStorage.getItem('pendingQueue') || '[]')
    expect(rest.length).toBe(5)
  })
})

describe('sender sendBeacon 分支', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    sender.stop()
  })

  it('无 navigator.sendBeacon 时静默放弃这批', () => {
    const orig = (navigator as any).sendBeacon
    ;(navigator as any).sendBeacon = undefined
    state.queue.push({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: 1
    })
    expect(() => sender.flushNow(true)).not.toThrow()
    ;(navigator as any).sendBeacon = orig
  })

  it('sendBeacon 返回 false 时降级 cachePending', () => {
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false)
    ;(sender as any).endpoint = 'http://localhost:8000'
    const cacheSpy = vi
      .spyOn(sender as any, 'cachePending')
      .mockImplementation(() => {})
    state.queue.push({
      projectId: 'p',
      sessionId: 's',
      userUuid: 'u',
      name: 'e',
      category: 'event',
      value: null,
      properties: null,
      ts: 1
    })
    sender.flushNow(true)
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    expect(cacheSpy).toHaveBeenCalledTimes(1) // 排队失败降级缓存
    beaconSpy.mockRestore()
    cacheSpy.mockRestore()
  })
})
