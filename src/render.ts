import type { TakumiService } from '@fraqjs/plugin-takumi'
import type { FontLoader } from '@takumi-rs/core'
import { fromHtml } from '@takumi-rs/helpers/html'

import { pluginName } from './utils'

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** resources 目录（源码在 src/、构建产物在 dist/，均为包根目录的上一级查找） */
const resDir = fileURLToPath(new URL('../resources', import.meta.url))

const cssCache = new Map<string, string>()

/** 读取 css 文件并缓存（按绝对路径） */
const loadCss = async (file: string) => {
  let css = cssCache.get(file)
  if (!css) {
    css = await fs.readFile(file, 'utf-8')
    cssCache.set(file, css)
  }
  return css
}

/**
 * 收集模板中的 <link rel="stylesheet"> 并内联
 * - takumi 不支持外链样式表：http(s) 链接直接剔除，相对路径按模板所在目录解析后读文件内联
 * - takumi 的 fromHtml 会跳过 <head> 整个子树，故内联后的 <style> 统一注入 <body> 下
 */
const inlineStyles = async (tpl: string, tplDir: string): Promise<string> => {
  const styles: string[] = []
  const html = tpl.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
    const href = tag.match(/href="([^"]*)"/)?.[1]
    if (href && !/^https?:\/\//.test(href)) styles.push(path.resolve(tplDir, href))
    return ''
  })
  const css = (await Promise.all(styles.map(loadCss))).join('\n')
  return html.replace('<body>', `<body><style>${css}</style>`)
}

/** HTML 实体解码（takumi 的 fromHtml 不会解码文本节点中的实体，需在解析后自行处理） */
const decodeEntities = (str: string): string =>
  str.replace(/&(#x?[\da-fA-F]+|[a-zA-Z][\w-]*);/g, (raw, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    return named[entity] ?? raw
  })

/** 模板插值：{{ key }} 转义输出，{{@ key }} 原样输出，支持 a.b 点路径；未定义的键输出为空 */
const fill = (tpl: string, data: Record<string, unknown>): string =>
  tpl.replace(/\{\{\s*(@?)\s*([\w.]+?)\s*\}\}/g, (_raw, at: string, key: string) => {
    const val = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], data)
    const str = val == null ? '' : String(val)
    return at ? str : str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  })

interface RenderNode {
  type: string
  text?: string
  children?: RenderNode[]
}

/**
 * 遍历节点树做两件事：
 * 1. 解码文本节点中的 HTML 实体（如 hljs 转义出的 &amp; &lt;）
 * 2. 剔除含换行的纯空白文本节点（浏览器会折叠它们，takumi 不会，标签间的换行缩进会被渲染成幻影行撑大行距；
 *    不含换行的纯空格节点保留——它们是 hljs 等待行内 <span> 之间真实存在的空格）
 */
const processNodes = (node: RenderNode) => {
  if (node.type === 'text' && node.text) node.text = decodeEntities(node.text)
  if (node.children) {
    node.children = node.children.filter(
      (child) =>
        !(child.type === 'text' && child.text !== undefined && child.text.trim() === '' && child.text.includes('\n')),
    )
    node.children.forEach(processNodes)
  }
}

/** 读取 TakumiService 上已注册的字体（与 renderHtml 内部的合并逻辑一致） */
const getRegisteredFonts = (service: TakumiService): FontLoader[] => {
  const map = (service as unknown as { registeredFontFamilies?: Map<string, FontLoader[]> }).registeredFontFamilies
  return map ? [...map.values()].flat() : []
}

/**
 * 渲染 resources 下的模板为 PNG
 * - 模板通过 <link rel="stylesheet" href="相对路径"> 声明样式，渲染时内联（见 inlineStyles）
 * - 模板仅支持插值占位符（见 fill），循环与分支逻辑在 TS 侧拼好 HTML 后传入
 * - 模板内以 {{ data.xxx }} 取值；sys.copyright 在此统一注入，调用方无需关心
 * @param takumi TakumiService 实例
 * @param name 模板路径（不含后缀），如 'runcode/index'
 * @param data 业务数据（对应模板中的 data 命名空间）
 */
export const render = async (takumi: TakumiService, name: string, data: Record<string, unknown>): Promise<Buffer> => {
  const tpl = await fs.readFile(path.join(resDir, `${name}.html`), 'utf-8')
  const html = fill(await inlineStyles(tpl, path.join(resDir, path.dirname(name))), {
    data,
    sys: { copyright: `© ${new Date().getFullYear()} ${pluginName}` },
  })
  const { node, stylesheets } = fromHtml(html)
  processNodes(node as unknown as RenderNode)
  return takumi.renderer.render(node, {
    devicePixelRatio: 2,
    stylesheets,
    fonts: getRegisteredFonts(takumi),
  })
}
