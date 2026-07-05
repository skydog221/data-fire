// data-fire 玩家身份指令
// 设计思想：回头率等数据依赖"同一玩家多次来玩"，需要一个稳定的玩家身份。
// CLAUDE.md 明确规定用 runtime.ccwAPI.getUserInfo() 拿 uuid，这是 CCW 环境的权威写法。
// 但 TurboWarp 等环境没有 ccwAPI，所以做降级：取不到身份就生成一个本地随机匿名 id 存进浏览器 localStorage，
// 保证本机范围内回头率仍能成立。
//
// 暴露的主体：Player 对象，方法直接对应积木。
// 调用示例：
//   const uuid = await Player.getUuid()   // 拿当前玩家身份（积木"当前玩家 uuid"）

import { state } from '../store'
import { kv } from '../kv'

// 生成一个本地随机匿名 id。用 crypto.randomUUID 更现代，拿不到则退化为时间戳+随机数。
// 这个匿名 id 会存进 localStorage，本机范围内稳定，所以本机回头率仍能算。
function makeAnonymousId(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return 'anon_' + c.randomUUID()
  return 'anon_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 玩家身份指令主体。导出对象名直接用 Player 而非 PlayerCommand——文件路径 commands/ 已说明是指令。
export const Player = {
  // 取当前玩家身份字符串。积木"当前玩家 uuid"调用。
  // 优先用 ccwAPI.getUserInfo().uuid（CCW 环境），拿不到就用 localStorage 里的匿名 id，没有就现造并存。
  async getUuid(): Promise<string> {
    if (state.userUuid) return state.userUuid // 已取过直接返回，避免重复异步调用
    const ccw = (state.runtime as any).ccwAPI // ccwAPI 不在 vm 类型定义里，但 CLAUDE.md 明确这是绝对正确写法，照样用
    if (ccw?.getUserInfo) {
      try {
        const info = await ccw.getUserInfo()
        if (info?.uuid) {
          state.userUuid = info.uuid
          return info.uuid
        }
      } catch {
        // 拿不到就降级走匿名，不抛错保证积木不中断游戏
      }
    }
    // 降级：从 localStorage 取匿名 id，没有就造一个
    const anon = kv.getItem('anonymousId', '') as string
    if (anon) {
      state.userUuid = anon
      return anon
    }
    const newAnon = makeAnonymousId()
    kv.setItem('anonymousId', newAnon)
    state.userUuid = newAnon
    return newAnon
  }
}