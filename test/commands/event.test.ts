// data-fire 拓展端自定义数据收集指令测试
// 设计思想：Track 各方法都是"改 state.counters/funnels + 调 pushRecord"的纯变换。
// 这里直接读 state.queue 断言记录形状（不 spy pushRecord，理由见 session.test.ts 头注释），
// 并断言 state.counters/funnels 的内存态变化。

import { describe, it, expect, beforeEach } from 'vitest'
import { state } from '../../src/store'
import { Track } from '../../src/commands/event'

// 从队列里取最后一条记录
function last(): (typeof state.queue)[number] {
  return state.queue[state.queue.length - 1]
}

beforeEach(() => {
  state.queue = []
  state.counters = {}
  state.funnels = {}
})

describe('Track 离散事件', () => {
  it('event 只带名字，value/properties 为 null', () => {
    Track.event('like')
    const r = last()
    expect(r.name).toBe('like')
    expect(r.category).toBe('event')
    expect(r.value).toBeNull()
    expect(r.properties).toBeNull()
  })

  it('eventValue 带数值', () => {
    Track.eventValue('level', 3)
    const r = last()
    expect(r.value).toBe(3)
    expect(r.properties).toBeNull()
  })

  it('eventDetail 把任意文本包进 {detail} JSON', () => {
    Track.eventDetail('loot', '拿到了宝剑')
    const r = last()
    expect(r.value).toBeNull()
    expect(JSON.parse(r.properties as string)).toEqual({ detail: '拿到了宝剑' })
  })
})

describe('Track metric', () => {
  it('metric 带 name 与 value、properties 为 null', () => {
    Track.metric('hp', 80)
    const r = last()
    expect(r.name).toBe('hp')
    expect(r.category).toBe('metric')
    expect(r.value).toBe(80)
    expect(r.properties).toBeNull()
  })
})

describe('Track counter', () => {
  it('counterAdd 累加内存态并带 op=add delta', () => {
    Track.counterAdd('kills', 1)
    Track.counterAdd('kills', 2)
    expect(state.counters.kills).toBe(3) // 1+2 累加
    const r = last()
    expect(r.value).toBe(3) // 上报累加后的新值
    expect(JSON.parse(r.properties as string)).toEqual({ op: 'add', delta: 2 })
  })

  it('counterSet 覆盖内存态并带 op=overwrite', () => {
    Track.counterAdd('score', 10)
    Track.counterSet('score', 0) // 清零
    expect(state.counters.score).toBe(0)
    const r = last()
    expect(r.value).toBe(0)
    expect(JSON.parse(r.properties as string)).toEqual({ op: 'overwrite' })
  })
})

describe('Track score', () => {
  it('score 提交分数，name=score、category=score', () => {
    Track.score(9800)
    const r = last()
    expect(r.name).toBe('score')
    expect(r.category).toBe('score')
    expect(r.value).toBe(9800)
    expect(r.properties).toBeNull()
  })
})

describe('Track funnelStep', () => {
  it('首次进入某步骤分配 stepIndex 从 1 递增', () => {
    Track.funnelStep('onboard', 'start')
    Track.funnelStep('onboard', 'step2')
    Track.funnelStep('onboard', 'step3')
    expect(state.funnels.onboard).toEqual({ start: 1, step2: 2, step3: 3 })
    const r = last()
    expect(r.name).toBe('step3')
    expect(r.category).toBe('funnel')
    expect(JSON.parse(r.properties as string)).toEqual({ funnel: 'onboard', stepIndex: 3 })
  })

  it('重复进入同一步骤不递增 stepIndex', () => {
    Track.funnelStep('onboard', 'start')
    Track.funnelStep('onboard', 'start') // 重复进入同一步
    expect(state.funnels.onboard.start).toBe(1) // 还是 1，没递增
  })

  it('不同漏斗的 stepIndex 互不干扰', () => {
    Track.funnelStep('onboard', 'start')
    Track.funnelStep('purchase', 'view')
    Track.funnelStep('purchase', 'pay')
    expect(state.funnels.onboard).toEqual({ start: 1 })
    expect(state.funnels.purchase).toEqual({ view: 1, pay: 2 })
  })
})