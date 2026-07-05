/*
  柱状图组件（基于 Recharts）
  设计：data-fire 看板里会话时长分布用纵向柱状图分桶展示。这个组件接收分桶后的数据，
  x 轴是桶标签（如 "0-10秒"），y 轴是会话数。
  调用示例：<BarChart data={buckets} xKey="label" yKey="count" />
  buckets 形如 [{ label: '0-10秒', count: 5 }, { label: '10-30秒', count: 12 }, ...]
*/

import { Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts'

export interface BarChartProps {
  data: Array<{ label: string; count: number }>
  height?: number
}

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e']

export default function BarChart({ data, height = 280 }: BarChartProps) {
  if (!data.length) return <div className="text-sm text-muted-foreground">暂无数据</div>

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          formatter={(v: number) => [`${v} 次`, '会话数']}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  )
}
