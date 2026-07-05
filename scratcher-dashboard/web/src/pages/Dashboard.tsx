/*
  data-fire dashboard 看板主页
  设计思想：HOP 里这是"效果反馈"层。触发是用户进入 /p/:projectId 路由，
  Dashboard 从 URL 拿 projectId，调 useDashboardData hook（指令层）拉数据，
  数据存进 hook 的 state，本组件根据 state 渲染各分析卡片。
  每张卡片是独立的 section，loading 时显 Skeleton，出错显错误提示，有数据显图表。

  卡片清单（呼应拓展端"自动模式+自定义积木"上报的数据域）：
    1. KPI 总览行：总会话/玩家/时长/完整率/回头率
    2. 回头率：新老玩家构成
    3. 会话时长分布：柱状图分桶
    4. 事件趋势：折线，可切全部/单事件
    5. 热门事件 Top：横向条形
    6. 指标折线：输入指标名画 series
    7. 计数器当前值：表格
    8. 分数分布：最高/最低/平均 + Top 排行
    9. 漏斗：输入漏斗名画转化

  调用：浏览器访问 /p/某projectId → App 路由匹配 → 渲染本组件。
*/

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import LineChart from '@/components/charts/LineChart'
import BarChart from '@/components/charts/BarChart'
import BarList from '@/components/charts/BarList'
import FunnelChart from '@/components/charts/FunnelChart'
import { useDashboardData, getDurationBuckets } from './useDashboardData'
import { formatMs, formatPercent, formatDate } from '@/lib/format'


// 单个错误提示块，卡片出错时显示
function ErrorBox({ message }: { message: string }) {
  return <div className="text-sm text-destructive">加载失败：{message}</div>
}


// ===== KPI 总览行里的单个数字卡片 =====
function KpiCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-24" /> : <span className="text-2xl font-bold">{value}</span>}
      </CardContent>
    </Card>
  )
}


export default function Dashboard() {
  // 从 URL 拿 projectId，这是看板的数据范围限定符
  const { projectId } = useParams<{ projectId: string }>()
  const { state, refresh, loadMetricSeries, loadFunnel, loadTimeline } = useDashboardData(projectId ?? '')

  // 交互式视图的输入框值：指标名、漏斗名、单事件名
  const [metricName, setMetricName] = useState('')
  const [funnelName, setFunnelName] = useState('')
  const [eventName, setEventName] = useState('')
  const [timelineTab, setTimelineTab] = useState('all')

  // 卫语句：projectId 没拿到时不渲染（理论上路由不会匹配到，但防御一下）
  if (!projectId) return <div className="p-8">缺少 projectId</div>

  const durationBuckets = getDurationBuckets(state.sessions)


  return (
    <div className="min-h-screen bg-background">
      {/* 顶部标题栏：作品 id + 刷新按钮 */}
      <header className="border-b bg-card">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-2xl font-bold">data-fire 数据看板</h1>
            <p className="text-sm text-muted-foreground">作品 ID：{projectId}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={state.loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* ===== 1. KPI 总览行 ===== */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="总会话数"
            value={state.summary ? String(state.summary.totalSessions) : '-'}
            loading={state.loading}
          />
          <KpiCard
            label="唯一玩家数"
            value={state.summary ? String(state.summary.uniquePlayers) : '-'}
            loading={state.loading}
          />
          <KpiCard
            label="平均时长"
            value={state.summary ? formatMs(state.summary.avgDurationMs) : '-'}
            loading={state.loading}
          />
          <KpiCard
            label="完整率"
            value={state.summary ? formatPercent(state.summary.completionRate) : '-'}
            loading={state.loading}
          />
          <KpiCard
            label="回头率"
            value={state.retention ? formatPercent(state.retention.returningPlayerRate) : '-'}
            loading={state.loading}
          />
        </section>

        {/* ===== 2. 回头率卡片：新老玩家构成 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>玩家回头率</CardTitle>
              <CardDescription>新玩家与回头玩家的构成，反映作品的留存能力</CardDescription>
            </CardHeader>
            <CardContent>
              {state.retentionError ? (
                <ErrorBox message={state.retentionError} />
              ) : state.loading ? (
                <Skeleton className="h-24 w-full" />
              ) : state.retention ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">唯一玩家</p>
                    <p className="text-xl font-bold">{state.retention.uniquePlayers}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">新玩家</p>
                    <p className="text-xl font-bold text-blue-500">{state.retention.newPlayers}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">回头玩家</p>
                    <p className="text-xl font-bold text-green-500">{state.retention.returningPlayers}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">人均访问次数</p>
                    <p className="text-xl font-bold">{state.retention.avgVisitsPerPlayer.toFixed(1)}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* ===== 3. 会话时长分布 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>会话时长分布</CardTitle>
              <CardDescription>把所有会话按时长分桶，看玩家停留分布</CardDescription>
            </CardHeader>
            <CardContent>
              {state.sessionsError ? (
                <ErrorBox message={state.sessionsError} />
              ) : state.loading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <BarChart data={durationBuckets} />
              )}
            </CardContent>
          </Card>
        </section>

        {/* ===== 4. 事件趋势折线（可切全部/单事件）===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>事件趋势</CardTitle>
              <CardDescription>按天统计事件触发次数，可切换查看单个事件</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={timelineTab}
                onValueChange={v => {
                  setTimelineTab(v)
                  // 切到"全部"立刻拉合计趋势；切到"单事件"等用户输入事件名再拉
                  if (v === 'all') loadTimeline()
                }}
              >
                <TabsList>
                  <TabsTrigger value="all">全部事件</TabsTrigger>
                  <TabsTrigger value="one">单事件</TabsTrigger>
                </TabsList>
                <TabsContent value="all">
                  {state.timelineError ? (
                    <ErrorBox message={state.timelineError} />
                  ) : state.loading ? (
                    <Skeleton className="h-72 w-full" />
                  ) : (
                    <LineChart data={state.timeline} xKey="bucket" yKey="count" />
                  )}
                </TabsContent>
                <TabsContent value="one" className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={eventName}
                      onChange={e => setEventName(e.target.value)}
                      placeholder="输入事件名，如 game_start"
                      onKeyDown={e => {
                        // 回车触发查询，跟点按钮等价，提升操作效率
                        if (e.key === 'Enter') loadTimeline(eventName)
                      }}
                    />
                    <Button onClick={() => loadTimeline(eventName)}>查询</Button>
                  </div>
                  {state.timelineError ? (
                    <ErrorBox message={state.timelineError} />
                  ) : (
                    <LineChart data={state.timeline} xKey="bucket" yKey="count" />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* ===== 5. 热门事件 Top ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>热门事件 Top</CardTitle>
              <CardDescription>触发次数最多的事件排行</CardDescription>
            </CardHeader>
            <CardContent>
              {state.topError ? (
                <ErrorBox message={state.topError} />
              ) : state.loading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <BarList data={state.top} yKey="count" />
              )}
            </CardContent>
          </Card>
        </section>

        {/* ===== 6. 指标折线 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>指标趋势</CardTitle>
              <CardDescription>输入自定义积木上报的指标名，画该指标的时序折线</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={metricName}
                  onChange={e => setMetricName(e.target.value)}
                  placeholder="输入指标名，如 gold_count"
                  onKeyDown={e => {
                    if (e.key === 'Enter') loadMetricSeries(metricName)
                  }}
                />
                <Button onClick={() => loadMetricSeries(metricName)} disabled={state.metricSeriesLoading}>
                  查询
                </Button>
              </div>
              {state.metricSeriesError ? (
                <ErrorBox message={state.metricSeriesError} />
              ) : state.metricSeriesLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <LineChart data={state.metricSeries} xKey="ts" yKey="value" />
              )}
            </CardContent>
          </Card>
        </section>

        {/* ===== 7. 计数器当前值表格 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>计数器当前值</CardTitle>
              <CardDescription>所有计数器（自定义积木累加值）的最新值</CardDescription>
            </CardHeader>
            <CardContent>
              {state.countersError ? (
                <ErrorBox message={state.countersError} />
              ) : state.loading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>当前值</TableHead>
                      <TableHead>更新时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.counters.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          暂无计数器
                        </TableCell>
                      </TableRow>
                    ) : (
                      state.counters.map(c => (
                        <TableRow key={c.name}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>{c.value}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(c.ts)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ===== 8. 分数分布 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>分数分布</CardTitle>
              <CardDescription>最高/最低/平均分，以及分数排行</CardDescription>
            </CardHeader>
            <CardContent>
              {state.scoresError ? (
                <ErrorBox message={state.scoresError} />
              ) : state.loading ? (
                <Skeleton className="h-72 w-full" />
              ) : state.scores ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-sm text-muted-foreground">总分次数</p>
                      <p className="text-xl font-bold">{state.scores.count}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">最高分</p>
                      <p className="text-xl font-bold text-green-500">{state.scores.max}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">最低分</p>
                      <p className="text-xl font-bold text-red-500">{state.scores.min}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">平均分</p>
                      <p className="text-xl font-bold">{state.scores.avg.toFixed(1)}</p>
                    </div>
                  </div>
                  {state.scores.topScores.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium">分数 Top 排行</p>
                      {/* 把 topScores 转成 BarList 需要的 [{name, value}] 格式 */}
                      <BarList
                        data={state.scores.topScores.map((v, i) => ({ name: `第${i + 1}名`, value: v }))}
                        yKey="value"
                      />
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* ===== 9. 漏斗图 ===== */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>漏斗转化</CardTitle>
              <CardDescription>输入漏斗名，查看每步人数与转化率</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={funnelName}
                  onChange={e => setFunnelName(e.target.value)}
                  placeholder="输入漏斗名，如 tutorial"
                  onKeyDown={e => {
                    if (e.key === 'Enter') loadFunnel(funnelName)
                  }}
                />
                <Button onClick={() => loadFunnel(funnelName)} disabled={state.funnelLoading}>
                  查询
                </Button>
              </div>
              {state.funnelError ? (
                <ErrorBox message={state.funnelError} />
              ) : state.funnelLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <FunnelChart data={state.funnel} />
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
