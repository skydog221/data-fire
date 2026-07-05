/*
  折线图组件（基于 Recharts）
  设计：data-fire 看板里事件趋势、指标序列都用折线画。这个组件接收 points（x 值 + y 值），
  自动把毫秒时间戳转成日期标签。颜色用 shadcn 的 primary 变量，跟主题走。
  调用示例：
    <LineChart data={points} xKey="bucket" yKey="count" />  // 事件趋势，x 是天桶时间戳
    <LineChart data={points} xKey="ts" yKey="value" />      // 指标序列
  points 形如 [{ bucket: 1719792000000, count: 12 }, ...]
*/

import { Line, LineChart as RLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'

// data 用泛型 T，只要对象里能按 xKey/yKey 取到数字即可，这样 EventBucket/MetricPoint 等具体接口都能传进来
export interface LineChartProps<T> {
  data: T[]
  xKey: string          // x 轴取值的键名（如 'bucket' 或 'ts'）
  yKey: string          // y 轴取值的键名（如 'count' 或 'value'）
  height?: number       // 图表高度，默认 280
  color?: string        // 线条颜色，默认用主题蓝
}

// 把毫秒时间戳格式化成 月/日 的短标签，读起来直观
function formatXLabel(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return String(value)
  const d = new Date(n)
  // toLocaleDateString 在不同环境结果可能不同，这里手写保证一致
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function LineChart<T extends object>({ data, xKey, yKey, height = 280, color = '#3b82f6' }: LineChartProps<T>) {
  if (!data.length) return <div className="text-sm text-muted-foreground">暂无数据</div>

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        {/* 背景网格线，浅灰让数据更突出 */}
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatXLabel}
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
        <Tooltip
          // tooltip 里也把时间戳转成可读日期
          labelFormatter={v => formatXLabel(v as number)}
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
        />
        <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
      </RLineChart>
    </ResponsiveContainer>
  )
}
