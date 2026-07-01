import rawL10n from './l10n'
;(function (Scratch) {
  if (Scratch.extensions.unsandboxed === false) {
    throw new Error('Sandboxed mode is not supported')
  }

  class Confetti implements Scratch.Extension {
    runtime: VM.Runtime
    _formatMessage: any
    constructor(runtime: VM.Runtime) {
      this.runtime = runtime
      // @ts-ignore
      this._formatMessage = runtime.getFormatMessage(rawL10n)
    }
    l10n(id: keyof (typeof rawL10n)['zh-cn']) {
      return this._formatMessage({
        id,
        default: id,
        description: id
      })
    }
    getInfo() {
      return {
        id: 'newExtension',
        name: 'example extension',
        blocks: [
          {
            blockType: Scratch.BlockType.COMMAND,
            opcode: 'test',
            text: this.l10n('confetti.name')
          }
        ]
      }
    }
    test(args: Record<string, string>, util: VM.BlockUtility) {
      console.log('Hello World', args, util)
    }
  }
  // @ts-ignore
  if (!Scratch.vm.runtime.gandi) {
    // For Turbowarp
    Scratch.extensions.register(new Confetti(Scratch.runtime))
  } else {
    // For Gandi
    window.tempExt = {
      Extension: Confetti,
      info: {
        extensionId: 'confetti',
        name: 'confetti.name',
        description: 'confetti.description',
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
      l10n: {
        'zh-cn': {
          'confetti.name': '彩带喷射',
          'confetti.description':
            '在 Scratch 中喷射彩带！不受舞台限制，在整个网页上喷射吧~'
        },
        en: {
          'confetti.name': 'Confetti',
          'confetti.description':
            'Spray confetti in Scratch! Unrestricted by the stage, spray all over the web~'
        }
      }
    }
  }
})(Scratch)
