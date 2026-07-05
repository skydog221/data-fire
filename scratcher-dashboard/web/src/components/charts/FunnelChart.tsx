/*
  漏斗图组件（阶梯柱状，基于 Recharts）
  设计：data-fire 的漏斗是"开始→第一关键动作→…→完成"逐步缩小的转化漏斗。
  用横向阶梯柱状图直观体现每步人数递减，柱子宽度按 count 占总比例缩放，旁边标注转化率。
  调用示例：<FunnelChart data={[{step:'开始',count:100,rate:null},{step:'完成',count:30,rate:0.3}]} />
  rate 是相对上一步的转化率，第一步为 null 不显示。
*/

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts'

export interface FunnelChartProps {
  data: Array<{ step: string; count: number; rate: number | null }>
  height?: number
}

// 漏斗从蓝到紫的渐变色，步数越多颜色越深，视觉上引导从上到下转化
const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']

export default function FunnelChart({ data, height = 300 }: FunnelChartProps) {
  if (!data.length) return <div className="text-sm text-muted-foreground">暂无数据</div>

  // 给每条数据加一个显示用的标签：人数 + 转化率（第一步没转化率只显示人数）
  const labeled = data.map((d, i) => ({
    ...d,
    // label 会在柱子末尾显示，让用户一眼看到这步多少人、从上步转化了多少
    label: d.rate === null ? `${d.count} 人` : `${d.count} 人 (${(d.rate * 100).toFixed(1)}%)`,
    fill: COLORS[i % COLORS.length],
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={labeled} layout="vertical" margin={{ top: 8, right: 80, bottom: 8, left: 8 }}>
        {/* Y 轴放 step 名字（纵向布局时 Y 是分类轴） */}
        <YAxis
          type="category"
          dataKey="step"
          tick={{ fontSize: 13 }}
          stroke="hsl(var(--muted-foreground))"
          width={100}
        />
        <XAxis type="number" hide />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
          formatter={(v: number) => [`${v} 人`, '人数']}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {labeled.map((entry, idx) => (
            <Cell key={idx} fill={entry.fill} />
          ))}
          <LabelList dataKey="label" position="right" style={{ fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
