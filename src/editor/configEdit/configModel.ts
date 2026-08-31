/**
 * configModel — 配置资产表格化模型（*.config.json / *.table.json）
 *
 * 把任意形态的配置 JSON 派生为「段（section）→ 表格」视图：
 *  - rows    段：对象集合（键 = 行 id，值 = 行对象）—— table.json 的根、config 中的对象字段
 *  - array   段：数组字段（元素为对象或标量）
 *  - scalars 段：顶层标量字段（键值对两列）
 *
 * 设计要点：
 *  - 表格视图每次从 root 重新派生，**不做双向同步**，杜绝序列化丢键风险
 *  - 所有编辑操作是纯函数：接受当前 root，返回新 root（调用方负责撤销快照）
 *  - 下划线开头的键（如 `_comment`）为元数据，不进表格，保存时原样保留
 */
import { logger } from '../../engine'

/** 顶层标量段的固定 id（不可能是真实字段名：含 @） */
export const SCALARS_ID = '@scalars'

/** 行 id 列的伪列名（用于单元格定位，不进 columns） */
export const KEY_COLUMN = '@key'

export type CellKind = 'empty' | 'number' | 'boolean' | 'string' | 'json'

/** 表格行 */
export interface ConfigRow {
  /** 行标识：rows 段 = 对象键名；array 段 = 索引字符串（写回时忽略） */
  key: string
  cells: Record<string, unknown>
}

/** 表格结构 */
export interface ConfigTable {
  /** 段 id：'' 表示根行表 */
  id: string
  kind: 'rows' | 'array'
  /** 列顺序（各行键的首次出现并集） */
  columns: string[]
  rows: ConfigRow[]
}

/** 顶层标量字段 */
export interface ConfigScalar {
  key: string
  value: unknown
}

/** 可表格化的一段配置数据 */
export interface ConfigSection {
  id: string
  label: string
  kind: 'rows' | 'array' | 'scalars'
  /** kind = rows/array 时有效 */
  table: ConfigTable | null
  /** kind = scalars 时有效 */
  scalars: ConfigScalar[]
}

/** 元数据键判定（下划线开头，如 _comment / _meta） */
export function isMetaKey(key: string): boolean {
  return key.startsWith('_')
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 深拷贝配置根对象（撤销快照 / 编辑前副本用） */
export function cloneRoot(root: Record<string, unknown>): Record<string, unknown> {
  return clone(root)
}

function collectColumns(rows: ConfigRow[]): string[] {
  const cols: string[] = []
  for (const row of rows) {
    for (const k of Object.keys(row.cells)) {
      if (!cols.includes(k)) cols.push(k)
    }
  }
  return cols
}

function buildTable(id: string, kind: 'rows' | 'array', entries: Array<[string, unknown]>): ConfigTable {
  const rows: ConfigRow[] = entries.map(([key, value]) => ({
    key,
    // 数组元素为标量时包装成 { value }，写回时自动还原
    cells: isPlainObject(value) ? clone(value) : { value: value ?? null },
  }))
  return { id, kind, columns: collectColumns(rows), rows }
}

/**
 * 检测配置根对象包含的所有可编辑段。
 * 全部顶层值都是对象时（table.json 典型形态）→ 单一根行表段。
 */
export function detectSections(root: Record<string, unknown>): ConfigSection[] {
  const entries = Object.entries(root).filter(([k]) => !isMetaKey(k))
  if (entries.length === 0) return []

  const sections: ConfigSection[] = []

  // 根行表：所有顶层值都是纯对象（DataTable 行表）
  if (entries.every(([, v]) => isPlainObject(v))) {
    sections.push({
      id: '',
      label: '数据表',
      kind: 'rows',
      table: buildTable('', 'rows', entries),
      scalars: [],
    })
    return sections
  }

  // 标量段（混合形态的 config.json）
  const scalars: ConfigScalar[] = []
  for (const [k, v] of entries) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      scalars.push({ key: k, value: v })
    }
  }
  if (scalars.length > 0) {
    sections.push({ id: SCALARS_ID, label: '基础字段', kind: 'scalars', table: null, scalars })
  }

  // 表格段：数组字段 / 对象字段（保持原字段顺序）
  for (const [k, v] of entries) {
    if (Array.isArray(v)) {
      sections.push({
        id: k,
        label: `${k}（${v.length}）`,
        kind: 'array',
        table: buildTable(k, 'array', v.map((item, i) => [String(i), item])),
        scalars: [],
      })
    } else if (isPlainObject(v)) {
      sections.push({
        id: k,
        label: k,
        kind: 'rows',
        table: buildTable(k, 'rows', Object.entries(v)),
        scalars: [],
      })
    }
  }
  return sections
}

/** 取元数据说明文本（_comment），没有则返回 null */
export function getComment(root: Record<string, unknown>): string | null {
  const v = root['_comment']
  return typeof v === 'string' && v.trim() ? v : null
}

/** 原地替换 root 内容（保持引用不变） */
function replaceRoot(root: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const k of Object.keys(root)) delete root[k]
  for (const [k, v] of Object.entries(next)) root[k] = v
}

/** 把修改后的表格写回 root 副本 */
function writeTable(root: Record<string, unknown>, table: ConfigTable): void {
  if (table.id === '') {
    // 根行表：保留元数据键，其余按行顺序重建
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(root)) {
      if (isMetaKey(k)) next[k] = v
    }
    for (const row of table.rows) next[row.key] = clone(row.cells)
    replaceRoot(root, next)
    return
  }

  if (table.kind === 'array') {
    root[table.id] = table.rows.map((row) => {
      // 标量包装还原：仅剩 value 一列时存回标量
      if (Object.keys(row.cells).length === 1 && 'value' in row.cells) return row.cells.value
      return clone(row.cells)
    })
    return
  }

  const obj: Record<string, unknown> = {}
  for (const row of table.rows) obj[row.key] = clone(row.cells)
  root[table.id] = obj
}

/**
 * 通用表格编辑入口：深拷贝 root → 定位段表格 → 执行变更 → 写回。
 * 找不到目标段时返回原 root（调用方无副作用）。
 */
function editTable(
  root: Record<string, unknown>,
  section: ConfigSection,
  mutate: (table: ConfigTable) => void,
): Record<string, unknown> {
  const next = clone(root)
  const target = detectSections(next).find((s) => s.id === section.id && s.kind === section.kind)
  if (!target?.table) {
    logger.warn(`[configModel] 未定位到段「${section.id}」，编辑已跳过`)
    return root
  }
  mutate(target.table)
  writeTable(next, target.table)
  return next
}

function uniqueName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}_${i}`)) i++
  return `${base}_${i}`
}

// ─── 单元格值与类型转换 ───

/** 单元格显示文本 */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 单元格类型（决定对齐方式与输入解析策略） */
export function cellKind(v: unknown): CellKind {
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'object') return 'json'
  return 'string'
}

/** 颜色值识别（#rrggbb）→ 返回可渲染色值，否则 null */
export function asColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}

/**
 * 按原值类型把输入文本强制转换为存储值。
 * ok=false 表示解析失败（保留原值，UI 应给出提示）。
 */
export function coerceCell(raw: string, prev: unknown): { value: unknown; ok: boolean } {
  const text = raw.trim()

  // 原值是数组/对象 → 必须解析成合法 JSON
  if (Array.isArray(prev) || isPlainObject(prev)) {
    try {
      return { value: JSON.parse(text), ok: true }
    } catch {
      return { value: prev, ok: false }
    }
  }

  if (typeof prev === 'number') {
    if (text === '') return { value: null, ok: true }
    const n = Number(text)
    if (Number.isNaN(n)) return { value: prev, ok: false }
    return { value: n, ok: true }
  }

  if (typeof prev === 'boolean') {
    return { value: /^(true|1|yes|on)$/i.test(text), ok: true }
  }

  // 字符串 / 空值：允许就地升级为 JSON 结构（如把 "1" 改成 [1,2]）
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return { value: JSON.parse(text), ok: true }
    } catch {
      /* 退回字符串 */
    }
  }
  if (text === '') return { value: null, ok: true }
  if (!Number.isNaN(Number(text))) return { value: Number(text), ok: true }
  if (/^(true|false)$/i.test(text)) return { value: text.toLowerCase() === 'true', ok: true }
  return { value: raw, ok: true }
}

// ─── 表格编辑操作 ───

/** 修改单元格 */
export function setCell(
  root: Record<string, unknown>,
  section: ConfigSection,
  rowKey: string,
  column: string,
  raw: string,
): { root: Record<string, unknown>; ok: boolean } {
  let ok = true
  const next = editTable(root, section, (table) => {
    const row = table.rows.find((r) => r.key === rowKey)
    if (!row) return
    const res = coerceCell(raw, row.cells[column])
    row.cells[column] = res.value
    ok = res.ok
  })
  return { root: next, ok }
}

/** 重命名行键（仅 rows 段） */
export function setRowKey(
  root: Record<string, unknown>,
  section: ConfigSection,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  const key = newKey.trim()
  if (!key || key === oldKey) return root
  return editTable(root, section, (table) => {
    if (table.kind !== 'rows') return
    if (table.rows.some((r) => r.key === key)) return
    const row = table.rows.find((r) => r.key === oldKey)
    if (row) row.key = key
  })
}

/** 追加一行（新行按当前列结构置空） */
export function addRow(root: Record<string, unknown>, section: ConfigSection): Record<string, unknown> {
  return editTable(root, section, (table) => {
    const key = table.kind === 'rows'
      ? uniqueName(table.rows.map((r) => r.key), 'new_row')
      : String(table.rows.length)
    const cells: Record<string, unknown> = {}
    for (const col of table.columns) cells[col] = null
    table.rows.push({ key, cells })
  })
}

/** 删除一行 */
export function removeRow(
  root: Record<string, unknown>,
  section: ConfigSection,
  rowKey: string,
): Record<string, unknown> {
  return editTable(root, section, (table) => {
    table.rows = table.rows.filter((r) => r.key !== rowKey)
  })
}

/** 行上移/下移（delta = -1 上移，+1 下移） */
export function moveRow(
  root: Record<string, unknown>,
  section: ConfigSection,
  rowKey: string,
  delta: number,
): Record<string, unknown> {
  return editTable(root, section, (table) => {
    const idx = table.rows.findIndex((r) => r.key === rowKey)
    const target = idx + delta
    if (idx === -1 || target < 0 || target >= table.rows.length) return
    const [row] = table.rows.splice(idx, 1)
    table.rows.splice(target, 0, row)
  })
}

/** 重命名列（保持键在原对象中的位置） */
export function renameColumn(
  root: Record<string, unknown>,
  section: ConfigSection,
  oldCol: string,
  newCol: string,
): Record<string, unknown> {
  const name = newCol.trim()
  if (!name || name === oldCol) return root
  return editTable(root, section, (table) => {
    if (table.columns.includes(name)) return
    for (const row of table.rows) {
      if (!(oldCol in row.cells)) continue
      const next: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row.cells)) {
        if (k === oldCol) next[name] = v
        else next[k] = v
      }
      row.cells = next
    }
    table.columns = table.columns.map((c) => (c === oldCol ? name : c))
  })
}

/** 追加一列（所有行置空） */
export function addColumn(
  root: Record<string, unknown>,
  section: ConfigSection,
  column?: string,
): Record<string, unknown> {
  return editTable(root, section, (table) => {
    const name = uniqueName(table.columns, (column ?? 'new_col').trim() || 'new_col')
    for (const row of table.rows) row.cells[name] = null
    table.columns.push(name)
  })
}

/** 删除一列 */
export function removeColumn(
  root: Record<string, unknown>,
  section: ConfigSection,
  column: string,
): Record<string, unknown> {
  return editTable(root, section, (table) => {
    for (const row of table.rows) delete row.cells[column]
    table.columns = table.columns.filter((c) => c !== column)
  })
}

// ─── 顶层标量操作 ───

/** 修改顶层标量值 */
export function setScalar(
  root: Record<string, unknown>,
  key: string,
  raw: string,
): { root: Record<string, unknown>; ok: boolean } {
  if (!(key in root) || isMetaKey(key)) return { root, ok: false }
  const res = coerceCell(raw, root[key])
  const next = clone(root)
  next[key] = res.value
  return { root: next, ok: res.ok }
}

/** 新增顶层标量字段 */
export function addScalar(root: Record<string, unknown>, key?: string): Record<string, unknown> {
  const name = uniqueName(Object.keys(root).filter((k) => !isMetaKey(k)), (key ?? 'new_field').trim() || 'new_field')
  const next = clone(root)
  next[name] = null
  return next
}

/** 删除顶层标量字段 */
export function removeScalar(root: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!(key in root) || isMetaKey(key)) return root
  const next = clone(root)
  delete next[key]
  return next
}

/** 重命名顶层标量字段（保持键顺序） */
export function renameScalar(
  root: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  const name = newKey.trim()
  if (!name || name === oldKey || isMetaKey(name) || name in root) return root
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(root)) {
    if (k === oldKey) next[name] = v
    else next[k] = v
  }
  return next
}
