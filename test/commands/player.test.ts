// data-fire 拓展端玩家身份指令测试
// 设计思想：Player.getUuid 三级降级：缓存 state.userUuid → ccwAPI.getUserInfo().uuid →
// kv anonymousId → 现造 makeAnonymousId。测每条分支与 memoization。
// 桩 state.runtime.ccwAPI、crypto、kv 来驱动各分支。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { state } from '../../src/store'
import { Player } from '../../src/commands/player'
import { kv } from '../../src/kv'

beforeEach(() => {
  state.userUuid = ''
  ;(state as any).runtime = {}
  kv.removeItem('anonymousId')
})

describe('Player.getUuid 降级链', () => {
  it('缓存：state.userUuid 已设直接返回，不再异步', async () => {
    state.userUuid = 'u_cached'
    const uuid = await Player.getUuid()
    expect(uuid).toBe('u_cached')
  })

  it('ccwAPI.getUserInfo().uuid 成功 → 写入 state', async () => {
    ;(state as any).runtime = { ccwAPI: { getUserInfo: async () => ({ uuid: 'ccw_u1' }) } }
    const uuid = await Player.getUuid()
    expect(uuid).toBe('ccw_u1')
    expect(state.userUuid).toBe('ccw_u1')
  })

  it('ccwAPI 存在但 getUserInfo 抛错 → 降级走匿名', async () => {
    ;(state as any).runtime = { ccwAPI: { getUserInfo: async () => { throw new Error('no') } } }
    const uuid = await Player.getUuid()
    // 落到 makeAnonymousId 走 crypto.randomUUID（setup 桩返 fake-uuid-0001）
    expect(uuid).toBe('anon_fake-uuid-0001')
  })

  it('ccwAPI.getUserInfo 返回无 uuid → 降级走匿名', async () => {
    ;(state as any).runtime = { ccwAPI: { getUserInfo: async () => ({}) } }
    const uuid = await Player.getUuid()
    expect(uuid).toBe('anon_fake-uuid-0001')
  })

  it('无 ccwAPI，kv 有 anonymousId → 用它并写入 state', async () => {
    kv.setItem('anonymousId', 'anon_persisted')
    const uuid = await Player.getUuid()
    expect(uuid).toBe('anon_persisted')
    expect(state.userUuid).toBe('anon_persisted')
  })

  it('全无 → 造匿名 id 并持久化进 kv', async () => {
    const uuid = await Player.getUuid()
    expect(uuid).toBe('anon_fake-uuid-0001')
    expect(kv.getItem('anonymousId', '')).toBe('anon_fake-uuid-0001')
    expect(state.userUuid).toBe('anon_fake-uuid-0001')
  })

  it('memoization：首次取后第二次直接返回缓存不再调 ccwAPI', async () => {
    let calls = 0
    ;(state as any).runtime = { ccwAPI: { getUserInfo: async () => { calls++; return { uuid: 'ccw_x' } } } }
    await Player.getUuid()
    await Player.getUuid()
    expect(calls).toBe(1) // 第二次走缓存，ccwAPI 只调一次
  })
})