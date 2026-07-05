// data-fire 拓展端 l10n 文案测试
// 设计思想：两份语言文案键集必须一致，占位符 [argName] 要和 index.ts 块定义的 arguments 键名匹配，
// 否则 scratch-vm 会 "Message index out of range" 报错。这里纯数据校验，不碰逻辑。

import { describe, it, expect } from 'vitest'
import rawL10n from '../src/l10n/index'

const zh = rawL10n['zh-cn']
const en = rawL10n.en

describe('l10n 文案一致性', () => {
  it('zh-cn 与 en 键集完全一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('每个文案都有非空字符串', () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(typeof v).toBe('string')
      expect((v as string).length).toBeGreaterThan(0)
    }
    for (const [, v] of Object.entries(en)) {
      expect(typeof v).toBe('string')
      expect((v as string).length).toBeGreaterThan(0)
    }
  })

  it('带占位符的文案在中英文里占位符名一致', () => {
    // 抽取 [arg] 占位符名，比对中英文同一键下的占位符集合
    const placeholderRe = /\[(\w+)\]/g
    const placeholders = (s: string) => {
      const out: string[] = []
      let m: RegExpExecArray | null
      while ((m = placeholderRe.exec(s)) !== null) out.push(m[1])
      return out.sort()
    }
    for (const key of Object.keys(zh)) {
      const pz = placeholders(zh[key] as string)
      const pe = placeholders(en[key] as string)
      expect(pz).toEqual(pe)
    }
  })
})