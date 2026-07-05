// data-fire 自定义数据收集指令
// 设计思想：把 Scratcher 想记录的任意业务动作统一成 EventRecord 落进队列。
// 事件、指标、计数器、分数、漏斗都是同一张表的语义化包装，让 Scratcher 选最贴合业务的积木即可。
// 所有方法都调 ./queue 里的 pushRecord 统一出口，保证记录结构永远一致——之前的"各自复制一份 enqueue"
// 会让无会话兜底策略两处不一致（session 那份没塞 's_none'），现在统一收敛到 pushRecord。
//
// 暴露主体：Track 对象，方法一一对应积木。
// 调用示例：
//   Track.event('like')                  // 记录点赞时机
//   Track.eventValue('level', 3)        // 记录到达第 3 关
//   Track.metric('hp', 80)              // 记录当前血量 80
//   Track.counterAdd('kills', 1)        // 击杀数 +1（上报 op=delta 让后端可正确累加/重放）
//   Track.counterSet('score', 0)        // 分数清零（上报 op=overwrite）
//   Track.score(9800)                   // 提交最终得分
//   Track.funnelStep('onboard', 'start') // 进入漏斗 onboard 的 start 步骤

import { state } from '../store'
import { pushRecord } from '../queue'

// 把"任意文本"安全转成 JSON 字符串塞进 properties。
// Scratcher 可能传非 JSON 文本（比如 "拿到了宝剑"），包进 { detail } 再 stringify，后端统一取 detail 字段。
function detailToJson(detail: string): string {
  return JSON.stringify({ detail: String(detail) })
}

export const Track = {
  // 记录一个离散事件，只带名字。积木"记录事件 [名]"。
  event(name: string) {
    pushRecord(name, 'event', null, null)
  },

  // 记录带数值的事件。积木"记录事件 [名] 值为 [N]"。适合"到达第 N 关""收集到 N 个"。
  eventValue(name: string, value: number) {
    pushRecord(name, 'event', value, null)
  },

  // 记录带自定义详情的事件。积木"记录事件 [名] 详情 [任意文本]"。
  // 详情可能是 Scratcher 任意业务文本，包进 { detail } 里后端统一取。
  eventDetail(name: string, detail: string) {
    pushRecord(name, 'event', null, detailToJson(detail))
  },

  // 记录瞬时指标。积木"记录指标 [名] 当前值 [N]"。适合画折线，如血量、速度、金币。
  metric(name: string, value: number) {
    pushRecord(name, 'metric', value, null)
  },

  // 计数器累加。积木"计数器 [名] 增加 [N]"。
  // 关键：上报的 value 是累加后的新值，properties 里带 op:'add' + delta，让后端能区分这是累加还是覆盖。
  // 之前只报新值、无 op，后端无法区分，离线重发时会重复累加。
  counterAdd(name: string, delta: number) {
    state.counters[name] = (state.counters[name] || 0) + delta
    pushRecord(name, 'counter', state.counters[name], JSON.stringify({ op: 'add', delta }))
  },

  // 计数器覆盖。积木"计数器 [名] 设为 [N]"。清零或重置时用。op:'overwrite' 告诉后端直接取这个值。
  counterSet(name: string, value: number) {
    state.counters[name] = value
    pushRecord(name, 'counter', value, JSON.stringify({ op: 'overwrite' }))
  },

  // 提交最终得分。积木"提交分数 [N]"。本质是特殊的 counter，category=score 让后端单独做排行/分布。
  score(value: number) {
    pushRecord('score', 'score', value, null)
  },

  // 漏斗打点。积木"漏斗 [漏斗名] 进入步骤 [步骤名]"。
  // properties 存漏斗名 + 本会话内分配的 stepIndex（首次进入序号，从 1 递增）。
  // name 存步骤名。后端按 (funnel, stepIndex) 分组、按 stepIndex 排序就能算每步到达率与转化顺序——
  // 之前漏斗里没有任何顺序字段，后端只能靠时间戳近似，转化顺序无保障。
  funnelStep(funnelName: string, stepName: string) {
    const funnel = state.funnels[funnelName] || {}
    // 该步骤在本会话内首次进入才分配序号；重复进入同一步用原序号，避免后端把同一步聚到不同桶。
    if (!(stepName in funnel)) funnel[stepName] = Object.keys(funnel).length + 1
    state.funnels[funnelName] = funnel
    pushRecord(stepName, 'funnel', null, JSON.stringify({ funnel: funnelName, stepIndex: funnel[stepName] }))
  }
}