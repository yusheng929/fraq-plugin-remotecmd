import { definePlugin, serviceToken } from '@fraqjs/fraq'
import { Master } from 'fraq-plugin-master'

import { registerCode } from './code'
import { registerSnapcode } from './snapcode'
import { pluginName } from './utils'

import { createRequire } from 'node:module'
import { TakumiService } from '@fraqjs/plugin-takumi'

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
    takumi: serviceToken<TakumiService>('fraqjs/takumi/TakumiService'),
  },
  async apply (ctx) {
    registerCode(ctx)
    if (!ctx.takumi) {
      ctx.logger.warn('未检测到 @fraqjs/plugin-takumi,rcp / sc 图片渲染功能已禁用')
    } else {
      await ctx.takumi.registerFontFamily('JetBrains Mono', jetbrainsMono)
      registerSnapcode(ctx)
    }
  },
})

export default RunCmdPlugin
