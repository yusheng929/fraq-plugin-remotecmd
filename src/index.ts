import { type Context, definePlugin } from '@fraqjs/fraq'
import type { TakumiService } from '@fraqjs/plugin-takumi'
import { Master } from 'fraq-plugin-master'

import { registerCode } from './code'
import { registerSnapcode } from './snapcode'
import { pluginName } from './utils'

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const jetbrainsMono = [
  require.resolve('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
  {
    path: require.resolve('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2'),
    style: 'italic' as const,
  },
]

/**
 * 动态加载并解析 TakumiService
 * - takumi 是可选依赖，静态 import 会在未安装 @fraqjs/plugin-takumi 时直接导致插件加载失败
 * - 返回 undefined 表示未安装或未加载该插件
 */
const resolveTakumi = async (ctx: Context): Promise<TakumiService | undefined> => {
  try {
    const { TakumiService } = await import('@fraqjs/plugin-takumi')
    return ctx.tryResolve(TakumiService)
  } catch {
    return undefined
  }
}

export const RunCmdPlugin = definePlugin({
  name: pluginName,
  inject: {
    master: Master,
  },
  async apply (ctx) {
    const takumi = await resolveTakumi(ctx)
    registerCode(ctx, takumi)
    if (!takumi) {
      ctx.logger.warn('未检测到 @fraqjs/plugin-takumi,rcp / sc 图片渲染功能已禁用（rc / rjs 不受影响）')
      return
    }
    await takumi.registerFontFamily('JetBrains Mono', jetbrainsMono)
    registerSnapcode(ctx, takumi)
  },
})

export default RunCmdPlugin
