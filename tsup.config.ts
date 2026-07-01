import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  name: "scratch-ext", // Replace it with your extension name
  entry: ["src/index.ts", "src/index.js"],
  target: ["esnext"],
  format: ["iife"],
  outDir: "dist",
  banner: {
    // Replace it with your extension's metadata
    js: `// Name: Confetti(彩带特效)
// ID: confetti
// Description: Spray confetti in Scratch! Unrestricted by the stage, spray all over the web~(在 Scratch 中喷射彩带！不受舞台限制，在整个网页上喷射吧~)
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
