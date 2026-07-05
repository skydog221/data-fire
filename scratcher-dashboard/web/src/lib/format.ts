/*
  data-fire dashboard 数值/时间格式化工具
  设计：HOP 里这是"无业务身份的小工具"。看板里多处要把毫秒转秒、把比率转百分比、把时间戳转可读时间，
  这些跟具体业务主体无关、换到别的项目也能用，所以放在 tool 里。
  调用示例：
    formatMs(123456)              // "123.5 秒"
    formatPercent(0.4521)        // "45.2%"
    formatDate(1719792000000)    // "2024-07-01"
*/

// 毫秒转秒，保留 1 位小数；小于 1 秒显示毫秒，更直观
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '-'
  if (ms < 1000) return `${Math.round(ms)} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}

// 比率（0-1）转百分比字符串，保留 1 位小数
export function formatPercent(rate: number): string {
  if (!Number.isFinite(rate)) return '-'
  return `${(rate * 100).toFixed(1)}%`
}

// 毫秒时间戳转 YYYY-MM-DD，看板里多处需要可读日期
export function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 毫秒时间戳转 YYYY-MM-DD HH:mm，需要精确到分钟时用
export function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts)) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 把会话时长数组分桶，返回柱状图用的 [{label, count}]
// 桶的划分按经验：大部分会话很短，所以小值桶细、大值桶粗，让分布更可读
export function bucketDurations(durationMsArr: number[]): Array<{ label: string; count: number }> {
  if (!durationMsArr.length) return []
  // 桶边界（秒）：0-10、10-30、30-60、60-180、180-600、600+，覆盖短中长会话
  const bounds = [0, 10000, 30000, 60000, 180000, 600000, Infinity]
  const labels = ['0-10秒', '10-30秒', '30-60秒', '1-3分', '3-10分', '10分+']
  const counts = new Array(labels.length).fill(0)

  for (const ms of durationMsArr) {
    // 找到第一个上界大于 ms 的桶
    for (let i = 1; i < bounds.length; i++) {
      if (ms < bounds[i]) {
        counts[i - 1]++
        break
      }
    }
  }

  // 只保留有数据的桶，避免空桶占位
  return labels
    .map((label, i) => ({ label, count: counts[i] }))
    .filter(b => b.count > 0)
}
