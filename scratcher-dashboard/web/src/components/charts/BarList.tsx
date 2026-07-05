/*
  横向条形排行组件（基于 Recharts）
  设计：data-fire 的热门事件 Top 用横向条形从长到短排列，一眼看出哪个事件最火。
  也用于分数 Top 排行。条形长度按 count 的相对比例画。
  调用示例：<BarList data={[{name:'金币',count:50},{name:'通关',count:30}]} yKey="count" />
*/

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts'

export interface BarListProps {
  data: Array<{ name: string; count?: number; value?: number }>
  yKey: 'count' | 'value'   // 用哪个键的值当条形长度
  height?: number
}

// 多色调色板，每个条不同色方便区分
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1']

export default function BarList({ data, yKey, height = 300 }: BarListProps) {
  if (!data.length) return <div className="text-sm text-muted-foreground">暂无数据</div>

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 13 }}
          stroke="hsl(var(--muted-foreground))"
          width={100}
        />
        <XAxis type="number" hide />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          formatter={(v: number) => [v, '数量']}
        />
        <Bar dataKey={yKey} radius={[0, 4, 4, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
          {/* 在每根条末尾标出具体数值，不用鼠标悬停也能看到 */}
          <LabelList dataKey={yKey} position="right" style={{ fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
