/// <reference types="vite/client" />

// 声明环境变量类型，这样 import.meta.env.VITE_API_BASE 会有类型提示和检查
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
