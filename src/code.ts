import * as fraq from '@fraqjs/fraq'
import { param, seg } from '@fraqjs/fraq'
import hljs from 'highlight.js'
import shell from 'highlight.js/lib/languages/powershell'

import { formatLine, type PluginCtx, RunJs, resolveTakumi, runShell, stripAnsi } from './utils'

import os from 'node:os'

hljs.registerLanguage('powershell', shell)

export const registerCode = (ctx: PluginCtx) => {
  const router = ctx.router.filter((session) => ctx.master.isMaster(session.raw.sender_id))

  router
    .command('rjs')
    .arg('code', param.greedy())
    .execute(async (session, { code }) => {
      if (!code.trim()) return
      try {
        ctx.logger.info(`[RunJavaScript] 执行代码: \n${code}`)
        const sandbox = {
          ...global,
          ...globalThis,
          fraq,
          ctx,
          session,
          console,
          setTimeout,
          setInterval,
          clearTimeout,
          clearInterval,
          Buffer,
          global,
          globalThis,
          process,
        }
        const result = await RunJs(code, sandbox)
        if (result === '') {
          await session.reply('没有返回值')
          return
        }
        const msg = typeof result === 'object' && result !== null ? JSON.stringify(result, null, 2) : String(result)
        await session.reply(msg, { withQuote: true })
      } catch (error) {
        if (String(error).includes('Script execution timed out')) {
          await session.reply('运行超时30秒,已终止运行', { withQuote: true })
          return
        }
        await session.reply(`错误：\n${error}`, { withQuote: true })
        ctx.logger.error(String(error))
      }
    })

  router
    .command('rc')
    .alias('rcp')
    .arg('cmd', param.greedy())
    .execute(async (session, { cmd }) => {
      const msg = session.raw.segments.find((i) => i.type === 'text')?.data.text
      if (!msg) return
      /** 通过别名 rcp 触发时以图片形式回复 */
      const isPic = msg.startsWith('rcp')
      const username = os.userInfo().username
      const hostname = os.hostname()
      const cwd = process.cwd()
      /** 终端提示符路径：Windows 以 > 结尾，Linux 下 /root 缩写为 ~；root 用户用 # 否则用 $ */
      const displayPath = os.platform() === 'win32' ? `${cwd}>` : cwd.replace(/^\/root/, '~')
      const symbol = username === 'root' ? '#' : '$'
      const { output } = await runShell(ctx, cmd)
      /** takumi 服务在命令执行时按需解析，与插件 apply 顺序解耦 */
      const takumi = isPic ? await resolveTakumi(ctx) : undefined
      if (isPic && takumi) {
        /** render 依赖 @takumi-rs/helpers，懒加载以避免未安装 takumi 时插件加载失败 */
        const { render } = await import('./render')
        const lines = output
          .split(/\r?\n/)
          .filter((i) => i.trim() !== '')
          .map(formatLine)
        /** 输出行与空态分支在 TS 侧拼好（模板只支持插值占位符） */
        const outputHtml = lines.length
          ? `<div class="out-lines">${lines.map((l) => `<div class="out-row"><span class="lt">${l}</span></div>`).join('')}</div>`
          : '<div class="out-empty">— no output —</div>'
        const img = await render(takumi, 'runcode/index', {
          user: username,
          host: hostname,
          path: displayPath,
          symbol,
          time: new Date().toTimeString().slice(0, 8),
          cmd: hljs.highlight(cmd, { language: 'powershell' }).value,
          outputHtml,
        })
        await session.reply([seg.image(`base64://${img.toString('base64')}`)], { withQuote: true })
      } else {
        const text = `${username}@${hostname}:${displayPath}${symbol} ${cmd}\n${stripAnsi(output)}`
        await session.reply(text, { withQuote: true })
      }
    })
}
