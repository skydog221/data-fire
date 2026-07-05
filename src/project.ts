// data-fire 当前作品 ID 解析工具
// 设计思想：作品 ID 不再由后端哈希分配，也不从 localStorage 读写；它就是 CCW 当前页面 URL 里的真实作品 ID。
// 支持三种路径：/extension/{id}、/detail/{id}、/project/{id}。只取路径段本身，不含 ? 后面的传参。
// 这比后端回写更直观：同一个 CCW 作品在 detail/project/extension 页面都有稳定 ID，Dashboard 地址也能直接复用这个 ID。
//
// 调用示例：
//   const id = getProjectIDFromURL('https://www.ccw.site/detail/6743db44e6d6684b55c0e58f?module=1')
//   // id === '6743db44e6d6684b55c0e58f'
//   const current = getCurrentProjectID() // 从 window.location.href 解析当前作品 ID

const PROJECT_PATH_NAMES = ['extension', 'detail', 'project']

// 从任意 URL 字符串里解析作品 ID。解析失败返回空字符串，调用方决定兜底策略。
export function getProjectIDFromURL(urlText: string): string {
  let url: URL
  try {
    // URL 构造器会自动剥离 query/search，pathname 只剩路径，正好满足"不含传参"。
    url = new URL(urlText, window.location.origin)
  } catch {
    return ''
  }

  const parts = url.pathname.split('/').filter(Boolean)
  for (let i = 0; i < parts.length - 1; i++) {
    if (PROJECT_PATH_NAMES.includes(parts[i])) return decodeURIComponent(parts[i + 1])
  }
  return ''
}

// 从当前浏览器地址解析作品 ID。拓展在 CCW 页面里运行时优先用这个。
export function getCurrentProjectID(): string {
  return getProjectIDFromURL(window.location.href)
}
