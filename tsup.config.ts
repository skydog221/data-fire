import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  name: "data-fire", // 拓展名
  entry: ["src/index.ts"], // 历史上带过 src/index.js，但本仓库没有该文件，留着会让 tsup 打包进陈旧/不存在的入口
  target: ["esnext"],
  format: ["iife"],
  outDir: "dist",
  banner: {
    // 拓展元数据（TurboWarp 读取这些注释来识别拓展）
    js: `// Name: data-fire(玩家数据分析)
// ID: datafire
// Description: 为 Scratcher 提供玩家数据分析基座，自动收集会话/时长/回头率，支持自定义上报事件/指标/计数器/分数/漏斗
// By: 多bug的啸天犬
// Original: 多bug的啸天犬
// License: MPL-2.0
`,
  },
  platform: "browser",
  clean: !options.watch,
  watch: options.watch,
  esbuildOptions(options) {
    options.charset = "utf8";
  },
  onSuccess: options.watch
    ? 'echo "Build completed! Files updated."'
    : undefined,
}));
