import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  dts: true,
  // takumi 是运行时可选依赖（仅 devDependencies 提供类型），必须保持外部化，不能被打包
  deps: { neverBundle: ['@fraqjs/plugin-takumi'] },
});
