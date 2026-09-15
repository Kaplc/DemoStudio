/**
 * 工具调用卡片组件
 * 参考 DSH Web UI 的 ToolRow 设计
 *
 * write/edit 工具卡片默认自动展开，渲染 diff 视图（行号 + 红/绿行 + 上下文，对齐 DSH DiffBlock 风格）：
 * - 权威路：已完成展示 result meta 携带的已应用权威 hunk（tool.diffs，含 3 行上下文）
 * - 派生路：无权威 hunk 时从入参派生"将要做的修改"（deriveDiffsFromArgs）——进行中意图，
 *   以及 write 新建文件兜底（DSH 对 before===null 不产 hunk，meta.diffs 为空数组，用户反馈 2026-09-13）
 * - 失败/非文件工具：回退通用 JSON 视图（输入/输出）
 * - read_image 图片视图（2026-09-15 用户反馈）：展开渲染目标图片本身（IPC 读文件 → data URL），
 *   替代原始 JSON 输入/输出；读取失败（浏览器模式/路径非法/文件缺失）回退通用视图
 * - 头部摘要（2026-09-15 用户反馈：grep 只显示 include 漏了 pattern）：≥2 个单行短字符串参数时
 *   以 key=value 全展示；单个字符串参数仍只显示值；多行/超长值（write content、长 old_string）
 *   不进摘要，展开卡片查看
 * - 默认全量展开不折叠（用户决策 2026-09-10：剩余行数也要直接显示）
 * - edit/write 卡片默认自动展开（用户决策 2026-09-10），点击头部仍可收起/再展开
 *
 * 使用 React.memo 避免父组件重渲染时不必要的更新。
 */
import React, { useEffect, useState, useMemo } from 'react'
import type { ToolState, FileDiff } from '../../types/agent'
import {
  deriveDiffsFromArgs, buildDiffRows, formatDiffRowsForCopy, resolveDiffStartLines, isDiffToolName,
} from './toolDiff'
import { openImageLightbox } from './ImageLightbox'

interface ToolCardProps {
  tool: ToolState
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

/** 摘要取值上限：单个值 / key=value 对内单值（超过则不进摘要）/ 多参数整行 */
const SUMMARY_VALUE_MAX = 60
const SUMMARY_PAIR_VALUE_MAX = 60
const SUMMARY_MULTI_MAX = 120

/** 缓存 JSON.stringify 结果，避免每次 render 重新序列化 */
function useSerializedJson(value: unknown): string {
  return useMemo(() => {
    if (!value) return ''
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  }, [value])
}

/** 渲染进程文件读取器：定位 hunk 绝对行号用（浏览器模式无 electronAPI 时返回 null） */
async function readDiffFile(path: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.readTextFile) return null
  try {
    const res = await api.readTextFile(path)
    return res?.success ? (res.data ?? null) : null
  } catch {
    return null
  }
}

/** read_image 等图片查看工具：展开渲染图片视图而非原始 JSON */
function isImageToolName(name: string): boolean {
  return name === 'read_image'
}

/** 提取图片查看工具的入参路径（read_image 的 file_path） */
function extractImagePath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const p = (args as Record<string, unknown>).file_path
  return typeof p === 'string' && p ? p : null
}

/** Electron IPC 读本地图片 → data URL（浏览器模式 / 读取失败返回 null，由调用方回退通用视图） */
async function readImageFileAsDataUrl(imagePath: string): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.readImageFile) return null
  try {
    const res = await api.readImageFile(imagePath)
    if (!res?.success || !res.data) return null
    return `data:${res.mime ?? 'image/png'};base64,${res.data}`
  } catch {
    return null
  }
}

/** diff 视图主体（展开卡片内的行序列 + 复制）。默认全量展开不折叠（用户决策 2026-09-10）。 */
const DiffBody: React.FC<{ diffs: FileDiff[] }> = ({ diffs }) => {
  const [copied, setCopied] = useState(false)
  const [startLines, setStartLines] = useState<ReadonlyMap<number, number>>()

  // best-effort 绝对行号定位：展开后异步读当前文件内容，锚定各 hunk 起始行
  useEffect(() => {
    let cancelled = false
    resolveDiffStartLines(diffs, readDiffFile).then((map) => {
      if (!cancelled && map.size > 0) setStartLines(map)
    })
    return () => { cancelled = true }
  }, [diffs])

  const rows = useMemo(() => buildDiffRows(diffs, startLines), [diffs, startLines])

  const handleCopy = () => {
    if (copied) return
    const clip = navigator.clipboard
    if (!clip?.writeText) return
    clip.writeText(formatDiffRowsForCopy(rows)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    }).catch(() => { /* 剪贴板失败静默：复制是辅助能力 */ })
  }

  if (rows.length === 0) return null

  return (
    <div className="tool-diff">
      <button type="button" className="tool-diff__copy" onClick={handleCopy}>
        {copied ? '复制成功' : '复制'}
      </button>
      <div className="tool-diff__body">
        {rows.map((row, i) => (
          <div key={i} className={`tool-diff__row tool-diff__row--${row.kind}`}>
            {row.kind !== 'path' && row.kind !== 'gap' && (
              <span className="tool-diff__gutter" aria-hidden>
                {row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ''}{row.line}
              </span>
            )}
            <span className={row.kind === 'path' || row.kind === 'gap' ? 'tool-diff__pathtext' : 'tool-diff__text'}>
              {row.text === '' ? '\u00A0' : row.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ToolCardInner: React.FC<ToolCardProps> = ({ tool }) => {
  // edit/write 卡片默认自动展开（用户决策 2026-09-10：diff 直接可见），其余工具仍点击展开
  const [expanded, setExpanded] = useState(() => isDiffToolName(tool.name))

  const argsStr = useSerializedJson(tool.args)
  const resultStr = useSerializedJson(tool.result)

  // 摘要：显示参数的关键信息（memoize）
  // 2026-09-15 用户反馈：grep 只显示第一个字符串参数（include=*.ts），pattern 被吞——
  // 改为收集全部"单行短字符串"参数：≥2 个时以 key=value 全展示（与入参顺序一致）；
  // 仅 1 个时仍只显示值（read/glob/write 头部外观不变）；多行/超长值不进摘要，展开可见。
  const summary = useMemo(() => {
    // ask_user_question 特殊摘要：显示问题文本
    if (tool.name === 'ask_user_question' && tool.args && typeof tool.args === 'object') {
      const questions = (tool.args as { questions?: Array<{ question?: string }> }).questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0]
        if (first?.question) {
          return truncate(first.question, 80)
        }
      }
    }
    if (!tool.args || typeof tool.args !== 'object') return ''
    const obj = tool.args as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 0) return ''
    let firstString = ''
    const shortKeys: string[] = []
    const shortVals: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (typeof v !== 'string' || v.length === 0) continue
      if (firstString === '') firstString = v
      if (v.length <= SUMMARY_PAIR_VALUE_MAX && !v.includes('\n')) {
        shortKeys.push(k)
        shortVals.push(v)
      }
    }
    if (shortKeys.length >= 2) {
      return truncate(shortKeys.map((k, i) => `${k}=${shortVals[i]}`).join(' '), SUMMARY_MULTI_MAX)
    }
    if (shortKeys.length === 1) return truncate(shortVals[0], SUMMARY_VALUE_MAX)
    if (firstString !== '') return truncate(firstString, SUMMARY_VALUE_MAX)
    return truncate(JSON.stringify(obj), SUMMARY_VALUE_MAX)
  }, [tool.args, tool.name])

  // diff 数据源：settle 后用权威 meta.diffs；无权威 hunk 时从入参派生（意图 + 兜底）。
  // 兜底场景：DSH write 新建文件（before===null）result meta.diffs 是空数组（dsh-tool-fs 不产 hunk），
  // 编辑器侧派生 content 全 add 视图，让 write 与 edit 一样展示 diff 而不是退回原始 JSON（用户反馈 2026-09-13）。
  // failure 不派生：失败调用的入参未生效，走通用视图展示错误。
  const diffs = useMemo(() => {
    if (tool.diffs && tool.diffs.length > 0) return tool.diffs
    if (tool.status === 'failure') return null
    return deriveDiffsFromArgs(tool.name, tool.args)
  }, [tool.diffs, tool.name, tool.args, tool.status])

  // ── read_image 图片视图（2026-09-15 用户反馈：展开渲染目标图片而非原始 JSON）──
  // 展开时异步 IPC 读文件；加载中抑制通用视图避免闪烁；失败回退通用输入/输出。
  const imagePath = useMemo(
    () => (isImageToolName(tool.name) ? extractImagePath(tool.args) : null),
    [tool.name, tool.args],
  )
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    if (!imagePath) return
    let cancelled = false
    setImageSrc(null)
    setImageFailed(false)
    readImageFileAsDataUrl(imagePath).then((url) => {
      if (cancelled) return
      if (url) setImageSrc(url)
      else setImageFailed(true)
    })
    return () => { cancelled = true }
  }, [imagePath])

  // 图片视图生效判定：加载成功渲染图片本体；读取中抑制通用视图；失败放行回退
  const suppressGenericView = imagePath !== null && !imageFailed

  return (
    <div className={`tool-card tool-card--${tool.status}`}>
      <div
        className="tool-card__head"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded) }}
      >
        <span className="tool-card__name">{tool.name}</span>
        <span className="tool-card__summary">{summary}</span>
        <span className="tool-card__status-dot"></span>
        <span className="tool-card__arrow">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="tool-card__details">
          {imagePath !== null && imageSrc !== null ? (
            /* 图片视图：渲染目标图片 + 路径标注，替代原始 JSON 输入/输出；双击开浮窗放大（2026-09-16） */
            <figure className="tool-image">
              <img
                className="tool-image__img"
                src={imageSrc}
                alt={imagePath}
                draggable={false}
                title="双击放大"
                onDoubleClick={() => openImageLightbox(imageSrc, imagePath)}
              />
              <figcaption className="tool-image__path" title={imagePath}>{imagePath}</figcaption>
            </figure>
          ) : !suppressGenericView && (
            <>
              {diffs && diffs.length > 0 ? (
                <DiffBody diffs={diffs} />
              ) : (
                argsStr && (
                  <div className="tool-card__section">
                    <div className="tool-card__section-label">输入</div>
                    <div className="md-code-block">
                      <pre><code>{argsStr}</code></pre>
                    </div>
                  </div>
                )
              )}
              {(!diffs || !diffs.length || tool.status === 'failure') && resultStr && (
                <div className="tool-card__section">
                  <div className="tool-card__section-label">输出</div>
                  <div className={`md-code-block ${tool.status === 'failure' ? 'md-code-block--error' : ''}`}>
                    <pre><code>{resultStr}</code></pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCard = React.memo(ToolCardInner, (prev, next) => {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.result === next.tool.result
    && prev.tool.args === next.tool.args
    && prev.tool.diffs === next.tool.diffs
})
