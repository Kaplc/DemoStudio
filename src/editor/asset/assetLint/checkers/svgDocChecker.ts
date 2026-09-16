/**
 * assetLint/checkers/svgDocChecker — SVG 贴图资产检查器（doc:svg）
 *
 * SVG 是纯文本文档（AssetSource 经 readTextFile 读入，AssetFile.doc = 字符串），
 * 不走 walkDocument 的 JSON 结构遍历，由 AssetLintEngine 按 .svg 后缀直接派发本检查器。
 *
 * 规则与运行时栅格化（SVGTexture）的失败模式一一对应：
 * error（进 assetLint 零错误门槛）：
 *  - svg:xml-parse        XML 解析失败（DOMParser parseerror，附解析器行信息）
 *  - svg:no-size          根元素既无 viewBox 也无显式 width/height（运行时无法定标）
 *  - svg:external-ref     href/xlink:href/src 外链（http(s):// 或 //）——SVG-in-img
 *                         静态快照不加载外链资源；且外链图片会污染 canvas →
 *                         CanvasTexture GPU 上传静默失败，必须硬拦
 *  - svg:external-url     属性值中 url(http...) 外链（fill/style 等同理污染 canvas）
 *  - svg:script           <script> 元素（SVG-in-img 本就不执行，error 防呆）
 *  - svg:event-handler    on* 事件属性（同上防呆）
 * warn：
 *  - svg:declare-size     有 viewBox 但缺显式 width/height（运行时会注入兜底，建议声明）
 *  - svg:oversize         声明尺寸 > 4096（运行时 clamp，声明超限多为笔误）
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { CheckerContext, FieldSpec, LintIssue } from '../types'

/** 光栅化单边上限（与 SVGTexture MAX_TEXTURE_EDGE 一致） */
const MAX_EDGE = 4096

/** 外链地址：http(s):// 或协议相对 //（blob/data/相对路径安全） */
function isExternalUrl(v: string): boolean {
  return /^(https?:)?\/\//i.test(v.trim())
}

/** 属性值中 url(...) 形式的外链（fill="url(http://…)" / style 内嵌均命中） */
function hasExternalUrlRef(v: string): boolean {
  return /url\(\s*['"]?(?:https?:)?\/\//i.test(v)
}

/** 解析根元素显式宽/高（纯数字/px；% 等无法定标的单位视为缺省） */
function parseLength(v: string | null): number | null {
  if (!v) return null
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 解析 viewBox 四元组，返回宽高（无法解析返回 null） */
function parseViewBoxSize(v: string | null): { width: number; height: number } | null {
  if (!v) return null
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , w, h] = parts
  if (w <= 0 || h <= 0) return null
  return { width: w, height: h }
}

class SvgDocChecker extends AbstractAssetChecker {
  readonly kind = 'doc:svg'
  /** 纯文本文档：声明式 schema 不适用，规则全部在 validate */
  schema: FieldSpec[] = []

  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    const text = typeof node === 'string' ? node : ''
    if (!text.trim()) {
      issues.push(ctx.issue('-', 'svg:empty', 'SVG 文件为空', 'error'))
      return issues
    }

    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const parserErrors = doc.getElementsByTagName('parsererror')
    if (parserErrors.length > 0) {
      // 解析器错误文本自带行/列信息（Chromium 为 "…Line Number X, Column Y…"），原样带出
      const detail = (parserErrors[0].textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
      issues.push(ctx.issue('-', 'svg:xml-parse', `SVG XML 解析失败${detail ? `：${detail}` : ''}`, 'error'))
      return issues
    }
    const root = doc.documentElement
    if (!root || root.localName !== 'svg') {
      issues.push(ctx.issue('-', 'svg:root', '根元素不是 <svg>', 'error'))
      return issues
    }

    // 尺寸规则：error（完全无法定标）/ warn（有 viewBox 建议补显式尺寸）
    const w = parseLength(root.getAttribute('width'))
    const h = parseLength(root.getAttribute('height'))
    const vbSize = parseViewBoxSize(root.getAttribute('viewBox'))
    if (!vbSize && (w === null || h === null)) {
      issues.push(ctx.issue(
        'viewBox', 'svg:no-size',
        '根元素既无 viewBox 也无显式 width/height：运行时无法定标（loadSVGImage 会失败占位），请补 viewBox="0 0 w h" 与 width/height',
        'error',
      ))
    } else if (vbSize && (w === null || h === null)) {
      issues.push(ctx.issue(
        'width', 'svg:declare-size',
        '有 viewBox 但缺显式 width/height：运行时会按 viewBox 注入兜底，建议显式声明（跨浏览器解码行为一致）',
        'warn',
      ))
    }
    if ((w !== null && w > MAX_EDGE) || (h !== null && h > MAX_EDGE)) {
      issues.push(ctx.issue(
        'width', 'svg:oversize',
        `声明尺寸 ${[w, h].filter((n) => n !== null && n > MAX_EDGE).join('x')} 超过 ${MAX_EDGE}：运行时光栅化会 clamp，确认是否笔误`,
        'warn',
      ))
    }

    // 全元素扫描：外链引用 / <script> / on* 事件属性
    const all = Array.from(doc.getElementsByTagName('*'))
    for (const el of all) {
      if (el.localName === 'script') {
        issues.push(ctx.issue('<script>', 'svg:script', 'SVG 内包含 <script> 元素：SVG-in-img 不执行脚本，禁止携带', 'error'))
      }
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) {
          issues.push(ctx.issue(attr.name, 'svg:event-handler', `事件属性 ${attr.name} 禁止出现（SVG-in-img 不执行脚本，防呆）`, 'error'))
          continue
        }
        if (/^(href|xlink:href|src)$/i.test(attr.name) && isExternalUrl(attr.value)) {
          issues.push(ctx.issue(
            attr.name, 'svg:external-ref',
            `外链引用 "${attr.value}"：SVG-in-img 静态快照不加载外链资源，且外链图片会污染 canvas（GPU 上传静默失败）；资源须内嵌或转同源资产`,
            'error',
          ))
          continue
        }
        if (hasExternalUrlRef(attr.value)) {
          issues.push(ctx.issue(attr.name, 'svg:external-url', `属性 ${attr.name} 含外链 url() 引用（canvas 污染 → 纹理 GPU 上传静默失败）`, 'error'))
        }
      }
    }

    return issues
  }
}
registerAssetChecker('doc:svg', SvgDocChecker)
