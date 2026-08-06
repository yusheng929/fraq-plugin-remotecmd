import type { Context } from '@fraqjs/fraq'
import type { Master } from 'fraq-plugin-master'

import pkg from '../package.json'

import { spawn } from 'node:child_process'
import os from 'node:os'
import vm from 'node:vm'
import type { TakumiService } from '@fraqjs/plugin-takumi'

export type PluginCtx = Context & {
  master: Master
} & {
  takumi: TakumiService | undefined
}

export interface RunShellResult {
  /** 退出码为 0 即成功 */
  status: boolean
  /** stdout + stderr 按产生顺序合并，与终端所见一致 */
  output: string
  /** 退出码，进程启动失败时为 null */
  code: number | null
}

/** 插件名（取自 package.json） */
export const pluginName = pkg.name

/** ANSI SGR 前景色码到 CSS 颜色的映射（适配浅色背景） */
const ANSI_FG: Record<number, string> = {
  30: '#1f2430',
  31: '#dc2626',
  32: '#16a34a',
  33: '#d97706',
  34: '#2563eb',
  35: '#7c3aed',
  36: '#0891b2',
  37: '#6b7280',
  90: '#4b5563',
  91: '#ef4444',
  92: '#22c55e',
  93: '#f59e0b',
  94: '#3b82f6',
  95: '#a855f7',
  96: '#06b6d4',
  97: '#374151',
}

/** ANSI SGR 背景色码到 CSS 颜色的映射（浅色徽标风格） */
const ANSI_BG: Record<number, string> = {
  40: '#e5e7eb',
  41: '#fecaca',
  42: '#bbf7d0',
  43: '#fde68a',
  44: '#bfdbfe',
  45: '#ddd6fe',
  46: '#a5f3fc',
  47: '#f3f4f6',
  100: '#e5e7eb',
  101: '#fecaca',
  102: '#bbf7d0',
  103: '#fde68a',
  104: '#bfdbfe',
  105: '#ddd6fe',
  106: '#a5f3fc',
  107: '#f3f4f6',
}

/** HTML 转义，防止输出内容注入标签 */
const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 去除 ANSI 转义序列，用于日志输出 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列必须匹配控制字符
export const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '')

/**
 * 拼接子进程的原始字节流并按平台解码
 * - 先攒 Buffer 再解码，避免多字节字符跨 chunk 被切断
 * - Windows 中文系统的 cmd/PowerShell 输出为 GBK，按 UTF-8 解码出现替换符时回退 GBK
 */
const decodeOutput = (chunks: Buffer[]): string => {
  const buf = Buffer.concat(chunks)
  const utf8 = buf.toString('utf8')
  if (os.platform() === 'win32' && utf8.includes('�')) {
    return new TextDecoder('gbk').decode(buf)
  }
  return utf8
}

/**
 * 执行 shell 命令
 * - 与 `exec` 分开缓冲 stdout/stderr 不同，这里按到达顺序合并两条流，输出顺序与终端一致
 * - 执行前后会在控制台打印命令与结果
 * @param cmd 命令
 * @param timeout 超时时间（毫秒），超时后终止进程
 */
export const runShell = (ctx: Context, cmd: string, timeout = 60000): Promise<RunShellResult> => {
  return new Promise((resolve) => {
    ctx.logger.info(`[exec] 执行命令: ${cmd}`)
    /** FORCE_COLOR / CLICOLOR_FORCE 让子进程在非 TTY 下也输出 ANSI 颜色，渲染时还原 */
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1', CLICOLOR_FORCE: '1' }
    /** NO_COLOR 与 FORCE_COLOR 冲突会产生警告，优先强制着色 */
    delete env.NO_COLOR
    const child = spawn(cmd, { shell: true, env })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => {
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      chunks.push(chunk)
    })
    let suffix = ''
    const timer = setTimeout(() => {
      suffix = `\n命令执行超时 ${timeout / 1000}s,已终止`
      child.kill()
    }, timeout)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ status: false, output: decodeOutput(chunks) + String(err), code: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const output = decodeOutput(chunks) + suffix
      ctx.logger.info(`[exec] 执行完毕，退出码: ${code}\n${stripAnsi(output)}`)
      resolve({ status: code === 0, output, code })
    })
  })
}

export const formatLine = (line: string): string => {
  const html = ansiToHtml(line)
  if (html.includes('<span')) return html
  const text = html.replace(/https?:\/\/[^\s]+/g, '<span class="hl-url">$&</span>')
  /** 优先按行首级别标记判断（如 WARN / ERR 前缀），再按行内关键词兜底 */
  if (/^\s*(warn|wrn)/i.test(line)) return `<span class="hl-warn">${text}</span>`
  if (/^\s*(err|error|fail|fatal)/i.test(line)) return `<span class="hl-err">${text}</span>`
  if (/(?:error|err_|failed|exception|cannot|错误|失败)/i.test(line)) return `<span class="hl-err">${text}</span>`
  if (/(?:warn|警告)/i.test(line)) return `<span class="hl-warn">${text}</span>`
  if (/(?:success|done\b|ok\b|成功|完成)/i.test(line)) return `<span class="hl-ok">${text}</span>`
  return text
}

/** 将 ANSI 颜色序列还原为 HTML span，其余控制序列（光标移动、清屏等）剔除 */
const ansiToHtml = (str: string): string => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列必须匹配控制字符
  const parts = str.split(/(\x1b\[[0-9;]*m)/)
  let html = ''
  let open = false
  let current = ''
  let fg: string | undefined
  let bg: string | undefined
  let bold = false
  for (let part of parts) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列必须匹配控制字符
    const match = part.match(/^\x1b\[([0-9;]*)m$/)
    if (match) {
      const codes = match[1] === '' ? [0] : match[1].split(';').map(Number)
      for (const c of codes) {
        if (c === 0) {
          fg = undefined
          bg = undefined
          bold = false
        } else if (c === 1) {
          bold = true
        } else if (c === 22) {
          bold = false
        } else if (c === 39) {
          fg = undefined
        } else if (c === 49) {
          bg = undefined
        } else if (ANSI_FG[c]) {
          fg = ANSI_FG[c]
        } else if (ANSI_BG[c]) {
          bg = ANSI_BG[c]
        }
      }
      continue
    }
    /** 剔除非颜色的控制序列（CSI 非 SGR、OSC 等） */
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义序列必须匹配控制字符
    part = part.replace(/\x1b(\[[0-9;?]*[A-Za-z]|\][^\x07]*(\x07|\x1b\\)?)/g, '')
    const text = escapeHtml(part)
    if (!text) continue
    /** 样式变化时才切换 span，避免产生空 span */
    const style = [fg && `color:${fg}`, bg && `background-color:${bg}`, bold && 'font-weight:700']
      .filter(Boolean)
      .join(';')
    if (style !== current) {
      if (open) html += '</span>'
      if (style) html += `<span style="${style}">`
      open = !!style
      current = style
    }
    html += text
  }
  if (open) html += '</span>'
  return html
}
/**
 * 在 vm 沙盒中运行 JS 代码
 * - 先按表达式执行（`return (code)`），语法错误时回退为语句块执行
 * @param code 需要执行的代码
 * @param sandbox 沙盒环境
 * @param repeat 内部递归标记（已回退为语句块模式）
 * @param asExpression 是否按表达式包装执行
 * @returns 代码执行的结果
 */
export const RunJs = async (code: string, sandbox: object, repeat = false, asExpression = true): Promise<unknown> => {
  try {
    const vmContext = vm.createContext(sandbox)
    const script = new vm.Script(`(async () => { ${asExpression ? `return (${code})` : code} })()`, {
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    })
    return await script.runInContext(vmContext, {
      timeout: 30000,
    })
  } catch (e) {
    if (!repeat && String(e).includes('SyntaxError: Unexpected')) {
      return RunJs(code, sandbox, true, false)
    }
    throw e
  }
}
