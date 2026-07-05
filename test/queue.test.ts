// data-fire 拓展端队列测试
// 设计思想：pushRecord 是所有指令的统一写入出口，要补齐字段（projectId/sessionId『s_none』兜底/userUuid/ts），
// 且队列达阈值（FLUSH_BATCH_SIZE=20）要触发 sender.flushNow。这里 spy sender.flushNow，
// 不真发 HTTP——只校验入队字段与阈值触发。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { state } from '../src/store'
import { sender } from '../src/sender'
import { pushRecord, FLUSH_BATCH_SIZE, QUEUE_MEMORY_CAP } from '../src/queue'

describe('pushRecord 入队', () => {
  it('补齐记录字段：projectId/sessionId『s_none』兜底/userUuid/ts', () => {
    state.projectId = 'p_abc'
    state.userUuid = 'u1'
    state.sessionId = '' // 无会话，应兜底 's_none'
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    pushRecord('like', 'event', 1, null)
    expect(state.queue.length).toBe(1)
    const r = state.queue[0]
    expect(r).toEqual({
      projectId: 'p_abc',
      sessionId: 's_none', // 无会话兜底占位
      userUuid: 'u1',
      name: 'like',
      category: 'event',
      value: 1,
      properties: null,
      ts: 1700000000000,
    })
    spy.mockRestore()
  })

  it('有会话时用真实 sessionId', () => {
    state.sessionId = 's_real'
    pushRecord('x', 'event', null, null)
    expect(state.queue[0].sessionId).toBe('s_real')
  })

  it('未达阈值不触发 flushNow', () => {
    const flushSpy = vi.spyOn(sender, 'flushNow').mockImplementation(() => {})
    for (let i = 0; i < FLUSH_BATCH_SIZE - 1; i++) pushRecord('e', 'event', null, null)
    expect(flushSpy).not.toHaveBeenCalled()
    flushSpy.mockRestore()
  })

  it('队列超过内存上限时丢最老记录，避免持续打点撑爆页面', () => {
    const flushSpy = vi.spyOn(sender, 'flushNow').mockImplementation(() => {})
    const nowSpy = vi.spyOn(Date, 'now')
    for (let i = 0; i < QUEUE_MEMORY_CAP + 5; i++) {
      nowSpy.mockReturnValue(i)
      pushRecord(`e_${i}`, 'event', null, null)
    }
    expect(state.queue.length).toBe(QUEUE_MEMORY_CAP)
    expect(state.queue[0].name).toBe('e_5') // 最早 5 条被裁掉，保留最新的 1000 条
    expect(state.queue[state.queue.length - 1].name).toBe(`e_${QUEUE_MEMORY_CAP + 4}`)
    flushSpy.mockRestore()
    nowSpy.mockRestore()
  })
})