// data-fire 拓展端入口
// 设计思想：这是 HOP 链路的"触发入口"——Scratch 加载拓展时调到这里，入口只负责：
// 1) 初始化 store（拿 runtime、初始化 KV 存储实例）
// 2) 声明所有积木（getInfo）并把 opcode 映射到 commands 里对应方法
// 3) 按 Gandi / TurboWarp 两种环境分别注册
// 入口不写业务逻辑，业务都在 commands/ 各文件里。看到某个 opcode 就能顺着 getInfo 找到映射的方法。
//
// 调用示例（Scratch 自动调用，无需手动）：
//   拓展加载 → new DataFire(runtime) → 初始化 store → getInfo() 声明积木 → 玩家用积木触发对应指令

import rawL10n from './l10n'
import { state } from './store'
import { Player } from './commands/player'
import { Session } from './commands/session'
import { Track } from './commands/event'
import { Collect } from './commands/collect'
;(function (Scratch) {
  if (Scratch.extensions.unsandboxed === false) {
    throw new Error('Sandboxed mode is not supported')
  }

  class DataFire implements Scratch.Extension {
    runtime: VM.Runtime
    _formatMessage: any
    constructor(runtime: VM.Runtime) {
      this.runtime = runtime
      // 初始化全局 store：runtime 给事件绑定用。持久化 KV 走浏览器 localStorage（见 ./kv），
      // 不再用舞台注释存储——避免撑大工程文件、影响注释可读性。
      state.runtime = runtime
      // @ts-ignore
      this._formatMessage = runtime.getFormatMessage(rawL10n)
    }

    // l10n 取文案。id 在 l10n/index.ts 里定义，缺了就回退用 id 本身。
    l10n(id: keyof (typeof rawL10n)['zh-cn']) {
      return this._formatMessage({ id, default: id, description: id })
    }

    // 声明所有积木。opcode 是积木内部名，func 同名指向本类上的方法（在下面 methods 区定义）。
    // 分隔符 '---' 把积木分成三组：自动模式 / 会话与身份 / 自定义数据收集。
    // 返回类型显式标注 Scratch.Info，分隔符用 as const 固定为字面量类型，避免 TS 把字符串推断宽化导致类型不匹配。
    getInfo(): Scratch.Info {
      return {
        id: 'datafire',
        name: this.l10n('datafire.name'),
        color1: '#ff7b00',
        color2: '#cc6300',
        color3: '#994900',
        blockIconURI: '',
        blocks: [
          // ===== A 组：自动模式 =====
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'autoStart',
            text: this.l10n('datafire.autoStart')
          },
          {
            blockType: Scratch.BlockType.REPORTER,
            opcode: 'getDashboardUrl',
            text: this.l10n('datafire.getDashboardUrl'),
            disableMonitor: true
          },
          '---' as Scratch.Separator,
          // ===== B 组：会话与身份 =====
          {
            blockType: Scratch.BlockType.REPORTER,
            opcode: 'getPlayerUuid',
            text: this.l10n('datafire.getPlayerUuid'),
            disableMonitor: true
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'sessionStart',
            text: this.l10n('datafire.sessionStart')
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'sessionEnd',
            text: this.l10n('datafire.sessionEnd')
          },
          {
            blockType: Scratch.BlockType.REPORTER,
            opcode: 'sessionElapsed',
            text: this.l10n('datafire.sessionElapsed'),
            disableMonitor: true
          },
          '---' as Scratch.Separator,
          // ===== C 组：自定义数据收集 =====
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'trackEvent',
            text: this.l10n('datafire.trackEvent'),
            arguments: {
              name: { type: Scratch.ArgumentType.STRING, defaultValue: 'event' }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'trackEventValue',
            text: this.l10n('datafire.trackEventValue'),
            arguments: {
              name: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'event'
              },
              value: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'trackEventDetail',
            text: this.l10n('datafire.trackEventDetail'),
            arguments: {
              name: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'event'
              },
              detail: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'trackMetric',
            text: this.l10n('datafire.trackMetric'),
            arguments: {
              name: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'metric'
              },
              value: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'counterAdd',
            text: this.l10n('datafire.counterAdd'),
            arguments: {
              name: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'counter'
              },
              delta: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'counterSet',
            text: this.l10n('datafire.counterSet'),
            arguments: {
              name: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'counter'
              },
              value: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'submitScore',
            text: this.l10n('datafire.submitScore'),
            arguments: {
              value: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'funnelStep',
            text: this.l10n('datafire.funnelStep'),
            arguments: {
              funnel: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'funnel'
              },
              step: { type: Scratch.ArgumentType.STRING, defaultValue: 'step' }
            }
          }
        ]
      }
    }

    // ===== 方法区：opcode 到指令的映射 =====
    // 每个方法签名都是 (args, util)，args 是积木输入参数，util 含 runtime/target。
    // 方法体只做"转发"：把 args 取出来调 commands 里对应主体，业务逻辑都在 commands。
    // 这样入口里看一眼就知道某 opcode 调了哪个指令、传了什么参数。

    autoStart() {
      return Collect.start()
    }
    dispose() {
      Collect.stop()
    }
    getDashboardUrl() {
      return Collect.dashboardUrl()
    }
    getPlayerUuid() {
      return Player.getUuid()
    }
    sessionStart() {
      return Session.start()
    }
    sessionEnd() {
      return Session.end()
    }
    sessionElapsed() {
      return Session.elapsedSeconds()
    }
    trackEvent(args: Record<string, string>) {
      Track.event(args.name)
    }
    trackEventValue(args: Record<string, string>) {
      Track.eventValue(args.name, Scratch.Cast.toNumber(args.value))
    }
    trackEventDetail(args: Record<string, string>) {
      Track.eventDetail(args.name, args.detail)
    }
    trackMetric(args: Record<string, string>) {
      Track.metric(args.name, Scratch.Cast.toNumber(args.value))
    }
    counterAdd(args: Record<string, string>) {
      Track.counterAdd(args.name, Scratch.Cast.toNumber(args.delta))
    }
    counterSet(args: Record<string, string>) {
      Track.counterSet(args.name, Scratch.Cast.toNumber(args.value))
    }
    submitScore(args: Record<string, string>) {
      Track.score(Scratch.Cast.toNumber(args.value))
    }
    funnelStep(args: Record<string, string>) {
      Track.funnelStep(args.funnel, args.step)
    }
  }

  // @ts-ignore
  if (!Scratch.vm.runtime.gandi) {
    Scratch.extensions.register(new DataFire(Scratch.runtime))
  } else {
    // Gandi 环境：挂到 window.tempExt
    window.tempExt = {
      Extension: DataFire,
      info: {
        extensionId: 'datafire',
        name: 'datafire.name',
        description: 'datafire.description',
        iconURL: '',
        featured: false,
        disabled: false,
        collaboratorList: [
          {
            collaborator: '多bug的啸天犬 @ CCW',
            collaboratorURL: 'https://ccw.site/student/197354885'
          }
        ]
      },
      l10n: rawL10n
    }
  }
})(Scratch)
