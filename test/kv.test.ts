// data-fire 拓展端 kv 测试
// 设计思想：kv 是 localStorage 的命名空间封装，纯数据往返。测 set/get/keys/remove 往返、
// 前缀隔离、JSON 解析失败回退、localStorage 抛错降级。happy-dom 提供 localStorage。

import { describe, it, expect, vi } from 'vitest'
import { kv } from '../src/kv'

describe('kv localStorage 封装', () => {
  it('setItem/getItem 往返', () => {
    expect(kv.setItem('projectId', 'p_abc')).toBe(true)
    expect(kv.getItem('projectId', '')).toBe('p_abc')
  })

  it('getItem 不存在返回默认值', () => {
    expect(kv.getItem('missing', 'default')).toBe('default')
    expect(kv.getItem('missing', 42)).toBe(42)
  })

  it('对象也能往返（自动 JSON 序列化）', () => {
    kv.setItem('obj', { a: 1, b: [2, 3] })
    expect(kv.getItem('obj', {})).toEqual({ a: 1, b: [2, 3] })
  })

  it('键带 datafire: 前缀存进 localStorage', () => {
    kv.setItem('k', 'v')
    expect(localStorage.getItem('datafire:k')).toBe(JSON.stringify('v'))
  })

  it('keys 返回去前缀后的所有命名空间键', () => {
    kv.setItem('a', 1)
    kv.setItem('b', 2)
    localStorage.setItem('other:x', 'y') // 别的命名空间，不应出现
    expect(kv.keys().sort()).toEqual(['a', 'b'])
  })

  it('hasItem 与 removeItem', () => {
    kv.setItem('k', 1)
    expect(kv.hasItem('k')).toBe(true)
    expect(kv.removeItem('k')).toBe(true)
    expect(kv.hasItem('k')).toBe(false)
  })

  it('解析失败回退默认值不抛错', () => {
    localStorage.setItem('datafire:bad', '{不是合法json')
    expect(kv.getItem('bad', 'fallback')).toBe('fallback')
  })

  it('setItem 抛错时返回 false 不外泄（沙箱配额受限兜底）', () => {
    // kv.setItem 内部 try-catch localStorage.setItem，沙箱抛 QuotaExceededError 时应返回 false 不抛。
    // spy 到 localStorage 实例方法（happy-dom 不走 Storage.prototype，故 spy 实例）
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(kv.setItem('x', 1)).toBe(false)
    vi.restoreAllMocks()
  })

  it('getItem 抛错时返回默认值不外泄', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('sandbox denied')
    })
    expect(kv.getItem('x', 'fallback')).toBe('fallback')
    vi.restoreAllMocks()
  })
})