// data-fire 浏览器 localStorage KV 存储
// 设计思想：把拓展要持久化的键值对（projectId、匿名 id、访问计数）存进浏览器 localStorage，
// 数据随浏览器存留，不污染 Scratch 工程文件。localStorage 是 KV 存储，封装成跟原来
// " getItem/setItem/removeItem/keys " 一样的接口，调用处无需改写法。
//
// 之所以不用舞台注释存储：舞台注释把数据塞进工程文件注释里，会撑大工程文件、影响注释可读性，
// 且浏览器 localStorage 这类运行时临时/本机数据本来就更适合存浏览器本地。
//
// 调用示例：
//   import { kv } from '../kv'
//   kv.setItem('projectId', 'p_abc')        // 创建/更新
//   const pid = kv.getItem('projectId', '')  // 读取，缺省返回 ''
//   kv.removeItem('projectId')               // 删除
//   const all = kv.keys()                     // 所有键名
//
// 注意：沙箱 iframe 里 localStorage 可能受限抛错，故每个方法外层 try-catch，
// 读抛错返回 defaultValue，写抛错静默失败——保守取舍，不中断游戏。

// localStorage 在 KV 里的命名空间前缀，避免和其他拓展/页面键撞名。所有 key 都拼成 `datafire:${k}`。
const PREFIX = 'datafire:'

// localStorage 是否可用。沙箱里可能没有 localStorage 或 setItem 抛 QuotaExceededError。
function available(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null
  } catch {
    return false
  }
}

export const kv = {
  // 创建或更新某个键。localStorage 不可用或写失败时静默返回 false，不抛错。
  setItem(key: string, value: unknown): boolean {
    if (!available()) return false
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  },

  // 读取某个键。不存在或 localStorage 不可用或解析失败，都返回 defaultValue，绝不抛错。
  getItem<T = unknown>(key: string, defaultValue: T): T {
    if (!available()) return defaultValue
    try {
      const raw = localStorage.getItem(PREFIX + key)
      if (raw === null) return defaultValue
      return JSON.parse(raw) as T
    } catch {
      return defaultValue
    }
  },

  // 删除某个键。返回是否真的删掉了（不存在也算删成功=false 的语义这里改成：成功调用了 removeItem 即 true）。
  removeItem(key: string): boolean {
    if (!available()) return false
    try {
      localStorage.removeItem(PREFIX + key)
      return true
    } catch {
      return false
    }
  },

  // 是否存在某个键。
  hasItem(key: string): boolean {
    if (!available()) return false
    try {
      return localStorage.getItem(PREFIX + key) !== null
    } catch {
      return false
    }
  },

  // 所有本拓展命名空间下的键名（去掉前缀返回）。
  keys(): string[] {
    if (!available()) return []
    try {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i)
        if (full && full.startsWith(PREFIX)) out.push(full.slice(PREFIX.length))
      }
      return out
    } catch {
      return []
    }
  }
}