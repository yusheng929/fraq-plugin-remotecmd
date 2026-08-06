import { definePlugin, serviceToken } from '@fraqjs/fraq'
import { Master } from 'fraq-plugin-master'

import { registerCode } from './code'
import { registerSnapcode } from './snapcode'
import { pluginName, resolveTakumi } from './utils'

import { createRequire } from 'node:module'
import type { TakumiService } from '@fraqjs/plugin-takumi'

const require = createRequire(import.meta.url)

const jetbrainsMono = [
  require.resolve('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
  {
    path: require.resolve('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2'),
    style: 'italic' as const,
  },
]

export const RunCmdPlugin = definePlugin({
  name: pluginName,
  inject: {
    master: Master,
  },
  optionalInject: {
    takumi: serviceToken<TakumiService>('takumi/TakumiService'),
  },
  apply (ctx) {
    registerCode(ctx)
  },
  /**
   * takumi 服务在其插件的 apply 中 provide，框架保证所有插件 apply 完成后才执行 start，
   * 因此在这里解析 takumi 才不会受插件 apply 顺序影响
   */
  async start (ctx) {
    const takumi = await resolveTakumi(ctx)
    if (!takumi) {
      ctx.logger.warn('未检测到 @fraqjs/plugin-takumi,rcp / sc 图片渲染功能已禁用（rc / rjs 不受影响）')
      return
    }
    await takumi.registerFontFamily('JetBrains Mono', jetbrainsMono)
    registerSnapcode(ctx, takumi)
  },
})

export default RunCmdPlugin
