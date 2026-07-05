// data-fire 拓展端测试配置
// 设计思想：vitest 与 tsup/esbuild 同栈，零配置贴合 TypeScript。用 happy-dom 提供
// localStorage/navigator/window 等浏览器全局，让 kv/sender 能在 Node 里跑。
// fakeTimers 让 sender 的指数退避、setInterval 可控，避免真等几秒。
//
// globals: true 让 describe/it/expect/beforeEach 全局可见，测试文件无需逐个 import。
// pool: forks 默认即可，每个测试文件独立进程，state 单例不会跨文件污染。

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom', // 提供 localStorage/navigator/window
    globals: true, // describe/it/expect/beforeEach 全局可见
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'], // 全局桩：Scratch、state 重置等
    fakeTimers: {
      // 让 Date.now/setTimeout/setInterval 默认走假时钟，sender 退避测试可控
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    },
  },
})
