// data-fire 拓展多语言文案
// 设计思想：所有积木的显示文字集中在这里，中英文各一份。
// 占位符用 [参数名] 方括号语法（scratch-vm 拓展规范），不是 Blockly 的 %1 序号——
// 框架按 arguments 里的键名做命名替换，所以方括号里的名字必须和 index.ts 里 arguments 的键完全一致，
// 顺序无关，写错名字或用 %1/%2 会触发 "Message index out of range" 报错。
// 改文案不动逻辑，本地化只改本文件。

export default {
  'zh-cn': {
    'datafire.name': '玩家数据分析',
    'datafire.description': '为 Scratcher 提供玩家数据分析基座，一键自动收集会话/时长/回头率，或自定义上报事件/指标/计数器/分数/漏斗',
    'datafire.autoStart': '开启自动数据收集',
    'datafire.getPlayerUuid': '当前玩家 uuid',
    'datafire.getDashboardUrl': '看板地址',
    'datafire.sessionStart': '开始记录本次会话',
    'datafire.sessionEnd': '结束记录本次会话',
    'datafire.sessionElapsed': '本次会话已游玩秒数',
    'datafire.trackEvent': '记录事件 [name]',
    'datafire.trackEventValue': '记录事件 [name] 值为 [value]',
    'datafire.trackEventDetail': '记录事件 [name] 详情 [detail]',
    'datafire.trackMetric': '记录指标 [name] 当前值 [value]',
    'datafire.counterAdd': '计数器 [name] 增加 [delta]',
    'datafire.counterSet': '计数器 [name] 设为 [value]',
    'datafire.submitScore': '提交分数 [value]',
    'datafire.funnelStep': '漏斗 [funnel] 进入步骤 [step]'
  },
  en: {
    'datafire.name': 'Player Analytics',
    'datafire.description': 'Analytics base for Scratcher: auto-collect session/duration/retention, or report custom events/metrics/counters/scores/funnels',
    'datafire.autoStart': 'enable auto data collection',
    'datafire.getPlayerUuid': 'current player uuid',
    'datafire.getDashboardUrl': 'dashboard url',
    'datafire.sessionStart': 'start recording this session',
    'datafire.sessionEnd': 'end recording this session',
    'datafire.sessionElapsed': 'seconds elapsed in this session',
    'datafire.trackEvent': 'track event [name]',
    'datafire.trackEventValue': 'track event [name] value [value]',
    'datafire.trackEventDetail': 'track event [name] detail [detail]',
    'datafire.trackMetric': 'track metric [name] value [value]',
    'datafire.counterAdd': 'counter [name] add [delta]',
    'datafire.counterSet': 'counter [name] set to [value]',
    'datafire.submitScore': 'submit score [value]',
    'datafire.funnelStep': 'funnel [funnel] enter step [step]'
  }
}