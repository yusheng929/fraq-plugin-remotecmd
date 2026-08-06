import type { Session } from '@fraqjs/fraq'
import { param, seg } from '@fraqjs/fraq'
import hljs from 'highlight.js'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

import type { PluginCtx } from './utils'

import fs from 'node:fs'
import path from 'node:path'

// 注册常用语言高亮（html 复用 xml 语法）
const languages = {
  typescript,
  javascript,
  json,
  xml,
  css,
  bash,
  shell,
  powershell,
  python,
  java,
  c,
  cpp,
  csharp,
  go,
  rust,
  php,
  ruby,
  swift,
  kotlin,
  sql,
  yaml,
  ini,
  dockerfile,
  makefile,
  markdown,
}
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang)
hljs.registerLanguage('html', xml)

const extToLanguage: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  py: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  ini: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  mk: 'makefile',
}

const detectLanguageByExt = (filePath: string): string | undefined => {
  const ext = path.extname(filePath).replace('.', '').toLowerCase()
  return extToLanguage[ext]
}

const buildCodeHtmlWithLineNumbers = (highlightedHtml: string, startLine: number): string =>
  highlightedHtml
    .split('\n')
    .map((line, idx) => {
      const ln = startLine + idx
      const content = line === '' ? '&nbsp;' : line
      return `<div class="code-line"><span class="line-number">${ln}</span><span class="line-content">${content}</span></div>`
    })
    .join('')

/** 依次按绝对路径、cwd 相对路径、src 相对路径解析目标文件 */
const resolveTargetPath = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) return trimmed
  const fromCwd = path.resolve(process.cwd(), trimmed)
  if (fs.existsSync(fromCwd)) return fromCwd
  const fromSrc = path.resolve(process.cwd(), 'src', trimmed)
  if (fs.existsSync(fromSrc)) return fromSrc
  return null
}

/** 注册 sc 命令（仅在有 takumi 时调用，见 index.ts） */
export const registerSnapcode = (ctx: PluginCtx) => {
  ctx.router
    .filter((session) => ctx.master.isMaster(session.raw.sender_id))
    .command('sc')
    .arg('rest', param.greedy())
    .execute((session, { rest }) => snapcode(ctx, session, rest))
}

/**
 * sc 命令：将代码文件片段渲染为图片
 * 用法：sc <文件路径> [起始行] [~结束行]，如 `sc src/index.ts 10~30`
 */
export const snapcode = async (ctx: PluginCtx, session: Session, rest: string) => {
  const match = rest.trim().match(/^(.+?)(?:\s+(\d+)(?:~(\d+))?)?$/)
  if (!match) return
  const [, rawPath, startStr, endStr] = match

  const fullPath = resolveTargetPath(rawPath)
  if (!fullPath) {
    await session.reply('未找到文件，请检查路径是否正确', { withQuote: true })
    return
  }

  let codeText: string
  try {
    codeText = fs.readFileSync(fullPath, 'utf-8')
  } catch (err) {
    ctx.logger.error(`读取文件失败: ${fullPath}`, err)
    await session.reply('读取文件失败', { withQuote: true })
    return
  }

  const allLines = codeText.split(/\r?\n/)
  const totalLines = allLines.length

  /** 正则已保证行号是数字；未指定时默认为全文 / 单行，再钳制到 [1, totalLines] */
  let startLine = Math.min(Math.max(startStr ? parseInt(startStr, 10) : 1, 1), totalLines)
  let endLine = Math.min(Math.max(endStr ? parseInt(endStr, 10) : startStr ? startLine : totalLines, 1), totalLines)
  if (startLine > endLine) [startLine, endLine] = [endLine, startLine]

  const slice = allLines.slice(startLine - 1, endLine).join('\n')

  // 语法高亮
  const language = detectLanguageByExt(fullPath)
  let highlighted = ''
  try {
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(slice, { language }).value
    } else {
      highlighted = hljs.highlightAuto(slice).value
    }
  } catch {
    highlighted = hljs.highlightAuto(slice).value
  }

  const codeHtml = buildCodeHtmlWithLineNumbers(highlighted, startLine)
  const fileName = path.basename(fullPath)
  const relFromCwd = path.relative(process.cwd(), fullPath)
  const rangeText = `${startLine} ~ ${endLine}`

  /** render 依赖 @takumi-rs/helpers，懒加载以避免未安装 takumi 时插件加载失败 */
  const { render } = await import('./render')
  const img = await render(ctx.takumi!, 'snapcode/index', {
    fileName,
    filePath: relFromCwd || fullPath,
    totalLines,
    rangeText,
    codeHtml,
  })

  await session.reply([seg.image(`base64://${img.toString('base64')}`)], { withQuote: true })
}
