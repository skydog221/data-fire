/*
  data-fire dashboard 数据获取 hook
  设计思想：HOP 里这是"触发事件→指令执行→数据修改"的中间层。
  触发事件是 projectId 变化或用户点刷新；指令执行是调 api/client.ts 的各方法；
  数据修改是把结果存进 state；效果反馈是组件根据 state 渲染加载态/数据/错误态。
  这个 hook 把所有并发请求和状态管理收拢在一处，Dashboard 组件只管渲染不管怎么拉数据。

  调用示例（在 Dashboard.tsx 里）：
    const { state, refresh, setMetricName, reloadMetricSeries } = useDashboardData(projectId)
    state 包含 summary / sessions / retention / timeline / top / counters / scores / 各交互视图

  所有接口并发拉取，任一失败不影响其它（用 Promise.allSettled），失败的卡片单独显示错误。
*/

import { useCallback, useEffect, useState } from 'react'
import * as api from '@/api/client'
import { bucketDurations } from '@/lib/format'

// 一次数据的完整快照：包含所有卡片需要的数据，加载态和错误态分字段存
export interface DashboardState {
  loading: boolean                              // 整体首次加载中
  summary: api.SessionSummary | null
  summaryError: string | null
  sessions: api.SessionRow[]
  sessionsError: string | null
  retention: api.PlayerRetention | null
  retentionError: string | null
  timeline: api.EventBucket[]
  timelineError: string | null
  top: api.EventTop[]
  topError: string | null
  counters: api.CounterRow[]
  countersError: string | null
  scores: api.ScoreDist | null
  scoresError: string | null
  // 这些是交互式视图，用户输入参数后才拉
  metricSeries: api.MetricPoint[]
  metricSeriesLoading: boolean
  metricSeriesError: string | null
  funnel: api.FunnelStep[]
  funnelLoading: boolean
  funnelError: string | null
}

const emptyState: DashboardState = {
  loading: true,
  summary: null,
  summaryError: null,
  sessions: [],
  sessionsError: null,
  retention: null,
  retentionError: null,
  timeline: [],
  timelineError: null,
  top: [],
  topError: null,
  counters: [],
  countersError: null,
  scores: null,
  scoresError: null,
  metricSeries: [],
  metricSeriesLoading: false,
  metricSeriesError: null,
  funnel: [],
  funnelLoading: false,
  funnelError: null,
}

// 把 Error 对象转成字符串消息，方便存进 state 显示给用户
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useDashboardData(projectId: string, days = 30) {
  const [state, setState] = useState<DashboardState>(emptyState)

  // 拉取所有卡片需要的并发数据。用 allSettled 让单个失败不影响其它卡片
  const loadAll = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))

    // 并发发六个请求，每个独立处理成功/失败，写进对应字段
    const [summaryR, sessionsR, retentionR, timelineR, topR, countersR, scoresR] =
      await Promise.allSettled([
        api.getSessionSummary(projectId, days),
        api.getSessions(projectId, days),
        api.getPlayerRetention(projectId, days),
        api.getEventTimeline(projectId, { days }),
        api.getEventTop(projectId, days),
        api.getCounters(projectId),
        api.getScores(projectId, days),
      ])

    setState(s => ({
      ...s,
      loading: false,
      summary: summaryR.status === 'fulfilled' ? summaryR.value : null,
      summaryError: summaryR.status === 'rejected' ? errMsg(summaryR.reason) : null,
      sessions: sessionsR.status === 'fulfilled' ? sessionsR.value : [],
      sessionsError: sessionsR.status === 'rejected' ? errMsg(sessionsR.reason) : null,
      retention: retentionR.status === 'fulfilled' ? retentionR.value : null,
      retentionError: retentionR.status === 'rejected' ? errMsg(retentionR.reason) : null,
      timeline: timelineR.status === 'fulfilled' ? timelineR.value : [],
      timelineError: timelineR.status === 'rejected' ? errMsg(timelineR.reason) : null,
      top: topR.status === 'fulfilled' ? topR.value : [],
      topError: topR.status === 'rejected' ? errMsg(topR.reason) : null,
      counters: countersR.status === 'fulfilled' ? countersR.value : [],
      countersError: countersR.status === 'rejected' ? errMsg(countersR.reason) : null,
      scores: scoresR.status === 'fulfilled' ? scoresR.value : null,
      scoresError: scoresR.status === 'rejected' ? errMsg(scoresR.reason) : null,
    }))
  }, [projectId, days])

  // projectId 或 days 变化时自动拉一次
  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 单独拉指标序列（用户输入 metric 名后触发）
  const loadMetricSeries = useCallback(
    async (name: string) => {
      if (!name.trim()) return
      setState(s => ({ ...s, metricSeriesLoading: true, metricSeriesError: null }))
      try {
        const data = await api.getMetricSeries(projectId, name.trim(), days)
        setState(s => ({ ...s, metricSeries: data, metricSeriesLoading: false }))
      } catch (e) {
        setState(s => ({ ...s, metricSeries: [], metricSeriesLoading: false, metricSeriesError: errMsg(e) }))
      }
    },
    [projectId, days],
  )

  // 单独拉漏斗（用户输入漏斗名后触发）
  const loadFunnel = useCallback(
    async (funnel: string) => {
      if (!funnel.trim()) return
      setState(s => ({ ...s, funnelLoading: true, funnelError: null }))
      try {
        const data = await api.getFunnel(projectId, funnel.trim(), days)
        setState(s => ({ ...s, funnel: data, funnelLoading: false }))
      } catch (e) {
        setState(s => ({ ...s, funnel: [], funnelLoading: false, funnelError: errMsg(e) }))
      }
    },
    [projectId, days],
  )

  // 拉单事件趋势（用户在 Tabs 里切到单事件、输入事件名后触发）
  const loadTimeline = useCallback(
    async (name?: string) => {
      setState(s => ({ ...s, timelineError: null }))
      try {
        const data = await api.getEventTimeline(projectId, name ? { name, days } : { days })
        setState(s => ({ ...s, timeline: data }))
      } catch (e) {
        setState(s => ({ ...s, timeline: [], timelineError: errMsg(e) }))
      }
    },
    [projectId, days],
  )

  return { state, refresh: loadAll, loadMetricSeries, loadFunnel, loadTimeline }
}

// 派生：把会话列表的 durationMs 分桶，给柱状图用
export function getDurationBuckets(sessions: api.SessionRow[]): Array<{ label: string; count: number }> {
  return bucketDurations(sessions.map(s => s.durationMs))
}
