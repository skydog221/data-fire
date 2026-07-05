/// <reference path="../node_modules/@turbowarp/types/types/scratch-vm-extension.d.ts" />

// Gandi IDE 特有的 window.tempExt 结构。
// TurboWarp 用 Scratch.extensions.register 注册扩展，Gandi 用 window.tempExt 挂载，
// 同一份入口代码靠 runtime.gandi 是否存在来分流，详见 src/index.ts 末尾。
// 另外 Scratch.runtime 在 scratch-vm-extension.d.ts 里没单独声明（只声明了 vm），
// 这里用 namespace 合并补上，TW 和 Gandi 都靠它取运行时实例。
declare namespace Scratch {
  const runtime: VM.Runtime
}
interface Collaborator {
  /**
   * Collaborator name.
   */
  collaborator: string
  /**
   * Collaborator profile URL.
   */
  collaboratorURL?: string
}

declare interface Window {
  tempExt?: {
    /**
     * Extension class.
     */
    Extension: new (runtime: VM.Runtime) => Scratch.Extension
    info: {
      /**
       * Extension name.
       */
      name: string
      /**
       * Extension description.
       */
      description: string
      /**
       * Extension ID.
       */
      extensionId: string
      /**
       * Is the extension featured?
       */
      featured: boolean
      /**
       * Is the extension disabled?
       */
      disabled: boolean
      /**
       * @deprecated Collaborator name.
       */
      collaborator?: string
      /**
       * Extension cover URL.
       */
      iconURL?: string
      /**
       * Extension inset icon URL.
       */
      insetIconURL?: string
      /**
       * @deprecated Collaborator profile URL.
       */
      collaboratorURL?: string
      /**
       * Collaborator list.
       */
      collaboratorList?: Collaborator[]
    }
    /**
     * Translations.
     */
    l10n: Record<string, Record<string, string>>
  }
}
