/**
 * ConfigEditor — 配置资产表格编辑器（*.config.json / *.table.json）
 *
 * Excel 式表格编辑体验：
 *  - 单元格双击编辑，Enter 提交 / Esc 取消，Tab 移到下一格
 *  - 支持行增删、行排序、行键重命名、列增删与重命名
 *  - 数字按数字类型回写，数组/对象列必须填合法 JSON
 *  - 顶部工具：撤销/重做（Ctrl+Z/Ctrl+Y）、保存（Ctrl+S）、重置
 *
 * 编辑模型为「root 派生视图 + 纯函数编辑」，表格不持有独立副本，
 * 保证保存时不会丢失未展示字段（如 _comment）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '../engine'
import { useEditorStore } from '../stores/editorStore'
import { editorBus } from '../editor/EditorEvents'
import { EditorEvent } from '../editor/EditorEventNames'
import { UndoManager } from '../editor/blueprintEdit/UndoManager'
import {
  asColor,
  cellKind,
  coerceCell,
  detectSections,
  formatCell,
  getComment,
  isMetaKey,
  addColumn,
  addRow,
  addScalar,
  moveRow,
  removeColumn,
  removeRow,
  removeScalar,
  renameColumn,
  renameScalar,
  setCell,
  setRowKey,
  setScalar,
  KEY_COLUMN,
  SCALARS_ID,
  type ConfigSection,
} from '../editor/configEdit/configModel'

interface ConfigEditorProps {
  assetPath: string
}

interface CellPos {
  rowKey: string
  column: string
}

/** 撤销栈 key（与蓝图共用 UndoManager，按资产路径隔离） */
function undoKey(assetPath: string): string {
  return `cfg:${assetPath}`
}

export function ConfigEditor({ assetPath }: ConfigEditorProps) {
  const [root, setRoot] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 正在编辑的单元格 */
  const [editing, setEditing] = useState<{ sectionId: string; pos: CellPos } | null>(null)
  const [draft, setDraft] = useState('')
  /** 展开的段（默认全展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const activeTabId = useEditorStore((s) => s.activeTabId)
  const addConsoleOutput = useEditorStore((s) => s.addConsoleOutput)
  const isTabActive = activeTabId === `cfg:${assetPath}`
  const inputRef = useRef<HTMLInputElement>(null)

  // ─── 读取配置 JSON ───
  useEffect(() => {
    const readJsonFile = window.electronAPI?.readJsonFile
    if (!readJsonFile) {
      setError('读取文件需要 Electron / Mock 环境')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    logger.info(`[ConfigEditor] 读取配置资产: ${assetPath}`)
    readJsonFile(assetPath)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          setRoot(result.data as Record<string, unknown>)
          UndoManager.clear(undoKey(assetPath))
          setHistoryVersion((v) => v + 1)
        } else {
          setError(result.error ?? '读取配置失败：内容不是 JSON 对象')
        }
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        logger.error(`[ConfigEditor] 读取失败 ${assetPath}: ${String(e)}`)
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [assetPath])

  const sections = useMemo(() => (root ? detectSections(root) : []), [root])
  const comment = useMemo(() => (root ? getComment(root) : null), [root])

  /** 应用新 root（统一入口：推撤销快照 + 刷新历史按钮） */
  const commit = useCallback(
    (next: Record<string, unknown>) => {
      setRoot((prev) => {
        if (prev) UndoManager.push(undoKey(assetPath), prev)
        return next
      })
      setHistoryVersion((v) => v + 1)
    },
    [assetPath],
  )

  const flash = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setMessage({ text, kind })
    window.setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 2600)
  }, [])

  // ─── 撤销 / 重做 ───
  const handleUndo = useCallback(() => {
    if (!root) return
    const snap = UndoManager.undo(undoKey(assetPath), root)
    if (snap === null) return
    setRoot(snap as Record<string, unknown>)
    setEditing(null)
    setHistoryVersion((v) => v + 1)
  }, [root, assetPath])

  const handleRedo = useCallback(() => {
    if (!root) return
    const snap = UndoManager.redo(undoKey(assetPath), root)
    if (snap === null) return
    setRoot(snap as Record<string, unknown>)
    setEditing(null)
    setHistoryVersion((v) => v + 1)
  }, [root, assetPath])

  useEffect(() => {
    if (!isTabActive) return
    const onUndo = () => handleUndo()
    const onRedo = () => handleRedo()
    window.addEventListener('shortcut-undo', onUndo)
    window.addEventListener('shortcut-redo', onRedo)
    return () => {
      window.removeEventListener('shortcut-undo', onUndo)
      window.removeEventListener('shortcut-redo', onRedo)
    }
  }, [isTabActive, handleUndo, handleRedo])

  const canUndo = UndoManager.canUndo(undoKey(assetPath))
  const canRedo = UndoManager.canRedo(undoKey(assetPath))

  // ─── 保存 ───
  const handleSave = useCallback(async () => {
    if (!root || saving) return
    const writeJsonFile = window.electronAPI?.writeJsonFile
    if (!writeJsonFile) {
      flash('当前环境不支持写文件', 'err')
      return
    }
    setSaving(true)
    try {
      const res = await writeJsonFile(assetPath, root)
      if (res.success) {
        logger.info(`[ConfigEditor] 已保存: ${assetPath}`)
        flash('已保存')
        addConsoleOutput(`💾 配置已保存: ${assetPath.split('/').pop()}`)
        editorBus.emit(EditorEvent.BLUEPRINT_SAVED, assetPath)
      } else {
        logger.error(`[ConfigEditor] 保存失败 ${assetPath}: ${res.error ?? '未知错误'}`)
        flash(res.error ?? '保存失败', 'err')
      }
    } catch (e) {
      logger.error(`[ConfigEditor] 保存异常 ${assetPath}: ${String(e)}`)
      flash(String(e), 'err')
    } finally {
      setSaving(false)
    }
  }, [root, saving, assetPath, flash, addConsoleOutput])

  // Ctrl+S 保存（仅激活页签）
  useEffect(() => {
    if (!isTabActive) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTabActive, handleSave])

  // ─── 单元格编辑 ───
  const startEdit = useCallback((sectionId: string, pos: CellPos, initial: unknown) => {
    setEditing({ sectionId, pos })
    setDraft(formatCell(initial))
  }, [])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commitEdit = useCallback(
    (move: 'none' | 'next' | 'down' = 'none') => {
      if (!editing || !root) return
      const section = sections.find((s) => s.id === editing.sectionId)
      if (!section) { setEditing(null); return }

      if (section.kind === 'scalars') {
        const res = setScalar(root, editing.pos.column, draft)
        if (res.ok) commit(res.root)
        else flash('数值格式不正确，已保留原值', 'err')
      } else {
        const res = setCell(root, section, editing.pos.rowKey, editing.pos.column, draft)
        if (res.ok) commit(res.root)
        else flash('JSON 格式不正确，已保留原值', 'err')
      }

      // 移动焦点：定位目标格并进入编辑
      if (move !== 'none' && section.table) {
        const rowIdx = section.table.rows.findIndex((r) => r.key === editing.pos.rowKey)
        const colIdx = section.table.columns.indexOf(editing.pos.column)
        const nextRow = move === 'down' ? rowIdx + 1 : rowIdx
        const nextCol = move === 'next' ? colIdx + 1 : colIdx
        if (move === 'down' && nextRow < section.table.rows.length) {
          const target = section.table.rows[nextRow]
          startEdit(section.id, { rowKey: target.key, column: section.table.columns[colIdx] }, target.cells[section.table.columns[colIdx]])
          return
        }
        if (move === 'next' && nextCol < section.table.columns.length) {
          const target = section.table.rows[rowIdx]
          const col = section.table.columns[nextCol]
          startEdit(section.id, { rowKey: editing.pos.rowKey, column: col }, target.cells[col])
          return
        }
      }
      setEditing(null)
    },
    [editing, root, sections, draft, commit, flash, startEdit],
  )

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); return }
    if (e.key === 'Tab') { e.preventDefault(); commitEdit('next'); return }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
    e.stopPropagation()
  }

  // ─── 表格操作 ───
  const handleRowKeyRename = (section: ConfigSection, oldKey: string, newKey: string) => {
    if (!root) return
    const next = setRowKey(root, section, oldKey, newKey)
    if (next === root) return
    commit(next)
  }

  const handleColumnRename = (section: ConfigSection, oldCol: string, newCol: string) => {
    if (!root) return
    const next = renameColumn(root, section, oldCol, newCol)
    if (next === root) return
    commit(next)
  }

  const handleReload = () => {
    setRoot(null)
    setEditing(null)
    setLoading(true)
    const readJsonFile = window.electronAPI?.readJsonFile
    if (!readJsonFile) return
    readJsonFile(assetPath).then((res) => {
      if (res.success && res.data) {
        setRoot(res.data as Record<string, unknown>)
        UndoManager.clear(undoKey(assetPath))
        setHistoryVersion((v) => v + 1)
        flash('已放弃修改，重新载入')
      }
      setLoading(false)
    })
  }

  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filename = assetPath.split('/').pop() ?? assetPath
  const isTable = /\.table\.json$/i.test(assetPath)

  // ─── 渲染：表格段 ───
  const renderTableSection = (section: ConfigSection) => {
    const table = section.table
    if (!table) return null
    const open = !collapsed.has(section.id)
    const colCount = table.columns.length

    return (
      <div key={section.id} style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        {/* 段头 */}
        <div
          onClick={() => toggleSection(section.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
            background: 'var(--bg-tertiary)', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{open ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {section.id === '' ? '行表' : section.id}
          </span>
          <span style={{ color: 'var(--text-dim)' }}>{table.rows.length} 行 × {colCount} 列</span>
          <div style={{ flex: 1 }} />
          {open && section.kind === 'rows' && (
            <ToolbarBtn onClick={() => root && commit(addColumn(root, section))} title="新增列">+ 列</ToolbarBtn>
          )}
          {open && (
            <ToolbarBtn onClick={() => root && commit(addRow(root, section))} title="新增行">+ 行</ToolbarBtn>
          )}
        </div>

        {open && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {/* 行号 */}
                  <th style={thStyle(36, 'center')}>#</th>
                  {/* 行键列（仅 rows 段） */}
                  {section.kind === 'rows' && (
                    <th style={thStyle(140)}>
                      {isTable ? '行 id' : '键'}
                    </th>
                  )}
                  {table.columns.map((col) => (
                    <th key={col} style={thStyle(undefined)} title="双击重命名列">
                      <ColumnHeader
                        name={col}
                        onRename={(next) => section.kind === 'rows' && handleColumnRename(section, col, next)}
                        onRemove={() => root && commit(removeColumn(root, section, col))}
                        canEdit={section.kind === 'rows'}
                      />
                    </th>
                  ))}
                  {/* 行操作列 */}
                  <th style={thStyle(96, 'center')}>操作</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rIdx) => (
                  <tr key={`${row.key}#${rIdx}`} style={{ background: rIdx % 2 === 1 ? 'var(--bg-secondary)' : 'transparent' }}>
                    <td style={tdStyle('center', 'var(--text-dim)')}>{rIdx + 1}</td>

                    {section.kind === 'rows' && (
                      <td style={tdStyle('left', 'var(--accent)')}>
                        {editing?.sectionId === section.id && editing.pos.rowKey === row.key && editing.pos.column === KEY_COLUMN ? (
                          <input
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => { handleRowKeyRename(section, row.key, draft); setEditing(null) }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); handleRowKeyRename(section, row.key, draft); setEditing(null) }
                              else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                              e.stopPropagation()
                            }}
                            style={inputStyle}
                          />
                        ) : (
                          <span
                            onDoubleClick={() => startEdit(section.id, { rowKey: row.key, column: KEY_COLUMN }, row.key)}
                            style={{ cursor: 'text', display: 'block', padding: '3px 4px', fontFamily: 'monospace' }}
                            title="双击重命名行键"
                          >
                            {row.key}
                          </span>
                        )}
                      </td>
                    )}

                    {table.columns.map((col) => {
                      const value = row.cells[col]
                      const isEditing = editing?.sectionId === section.id
                        && editing.pos.rowKey === row.key && editing.pos.column === col
                      const color = asColor(value)
                      return (
                        <td
                          key={col}
                          onDoubleClick={() => startEdit(section.id, { rowKey: row.key, column: col }, value)}
                          style={{
                            ...tdStyle(cellKind(value) === 'number' ? 'right' : 'left'),
                            padding: 0,
                            cursor: 'text',
                          }}
                          title="双击编辑"
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commitEdit('none')}
                              onKeyDown={onEditKeyDown}
                              style={inputStyle}
                            />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px' }}>
                              {color && (
                                <span style={{
                                  width: 10, height: 10, borderRadius: 2,
                                  background: color, border: '1px solid var(--border)', flexShrink: 0,
                                }} />
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {formatCell(value)}
                              </span>
                            </div>
                          )}
                        </td>
                      )
                    })}

                    {/* 行操作 */}
                    <td style={tdStyle('center')}>
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                        <ToolbarBtn onClick={() => root && commit(moveRow(root, section, row.key, -1))} title="上移" disabled={rIdx === 0}>↑</ToolbarBtn>
                        <ToolbarBtn onClick={() => root && commit(moveRow(root, section, row.key, 1))} title="下移" disabled={rIdx === table.rows.length - 1}>↓</ToolbarBtn>
                        <ToolbarBtn onClick={() => root && commit(removeRow(root, section, row.key))} title="删除行">✕</ToolbarBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount + (section.kind === 'rows' ? 3 : 2)} style={{ ...tdStyle('center', 'var(--text-dim)'), padding: 14 }}>
                      暂无数据行，点击段头「+ 行」新增
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ─── 渲染：顶层标量段 ───
  const renderScalarsSection = (section: ConfigSection) => {
    const open = !collapsed.has(section.id)
    return (
      <div key={section.id} style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        <div
          onClick={() => toggleSection(section.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
            background: 'var(--bg-tertiary)', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{open ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>基础字段</span>
          <span style={{ color: 'var(--text-dim)' }}>{section.scalars.length} 项</span>
          <div style={{ flex: 1 }} />
          {open && (
            <ToolbarBtn onClick={() => root && commit(addScalar(root))} title="新增字段">+ 字段</ToolbarBtn>
          )}
        </div>

        {open && (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <tbody>
              {section.scalars.map((s) => {
                const isEditingKey = editing?.sectionId === SCALARS_ID
                  && editing.pos.rowKey === s.key && editing.pos.column === KEY_COLUMN
                const isEditingVal = editing?.sectionId === SCALARS_ID
                  && editing.pos.rowKey === s.key && editing.pos.column === '@value'
                return (
                  <tr key={s.key}>
                    <td style={{ ...tdStyle('left', 'var(--accent)'), width: 200, padding: 0 }}>
                      {isEditingKey ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => { root && commit(renameScalar(root, s.key, draft)); setEditing(null) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); root && commit(renameScalar(root, s.key, draft)); setEditing(null) }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                            e.stopPropagation()
                          }}
                          style={inputStyle}
                        />
                      ) : (
                        <span
                          onDoubleClick={() => startEdit(SCALARS_ID, { rowKey: s.key, column: KEY_COLUMN }, s.key)}
                          style={{ display: 'block', padding: '4px 6px', cursor: 'text', fontFamily: 'monospace' }}
                          title="双击重命名字段"
                        >
                          {s.key}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle(cellKind(s.value) === 'number' ? 'right' : 'left'), padding: 0, cursor: 'text' }}
                      onDoubleClick={() => startEdit(SCALARS_ID, { rowKey: s.key, column: '@value' }, s.value)}
                    >
                      {isEditingVal ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit('none')}
                          onKeyDown={onEditKeyDown}
                          style={inputStyle}
                        />
                      ) : (
                        <span style={{ display: 'block', padding: '4px 6px' }}>{formatCell(s.value)}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle('center'), width: 56 }}>
                      <ToolbarBtn onClick={() => root && commit(removeScalar(root, s.key))} title="删除字段">✕</ToolbarBtn>
                    </td>
                  </tr>
                )
              })}
              {section.scalars.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ ...tdStyle('center', 'var(--text-dim)'), padding: 14 }}>
                    暂无标量字段
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  // ─── 渲染骨架 ───
  if (loading) return <Center>加载配置...</Center>
  if (error) return <Center color="var(--error)">{error}</Center>
  if (!root) return <Center>无配置数据</Center>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 头部工具栏 */}
      <div style={{
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>⚙️</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{filename}</span>
        <span style={{ color: 'var(--text-dim)' }}>
          {isTable ? 'DataTable 数据表' : 'Config 配置'}
        </span>
        {message && (
          <span style={{ color: message.kind === 'ok' ? '#4ade80' : 'var(--error)' }}>{message.text}</span>
        )}
        <div style={{ flex: 1 }} />
        <ActionBtn onClick={handleUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶ 撤销</ActionBtn>
        <ActionBtn onClick={handleRedo} disabled={!canRedo} title="重做 (Ctrl+Y)">↷ 重做</ActionBtn>
        <ActionBtn onClick={handleReload} title="放弃修改并重新载入">重置</ActionBtn>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            fontSize: 11, padding: '3px 12px', cursor: saving ? 'default' : 'pointer',
            background: saving ? 'var(--bg-tertiary)' : 'var(--accent)',
            color: saving ? 'var(--text-dim)' : '#fff',
            border: 'none', borderRadius: 3,
          }}
        >
          {saving ? '保存中' : '保存 (Ctrl+S)'}
        </button>
      </div>

      {/* 正文 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {comment && (
          <div style={{
            marginBottom: 12, padding: '8px 10px', fontSize: 11, lineHeight: 1.6,
            color: 'var(--text-dim)', background: 'var(--bg-secondary)',
            border: '1px solid var(--border)', borderRadius: 4, whiteSpace: 'pre-wrap',
          }}>
            {comment}
          </div>
        )}
        {sections.length === 0 && (
          <Center>该配置没有可编辑字段（仅含元数据）</Center>
        )}
        {sections.map((s) => (
          s.kind === 'scalars' ? renderScalarsSection(s) : renderTableSection(s)
        ))}
      </div>
    </div>
  )
}

// ─── 小组件与样式工具 ───

function Center({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: color ?? 'var(--text-dim)', fontSize: 12,
    }}>
      {children}
    </div>
  )
}

function thStyle(width?: number, align: 'left' | 'center' | 'right' = 'left'): React.CSSProperties {
  return {
    position: 'sticky', top: 0, zIndex: 1,
    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', padding: '5px 6px',
    fontSize: 11, fontWeight: 600, textAlign: align,
    width, whiteSpace: 'nowrap',
  }
}

function tdStyle(align: 'left' | 'center' | 'right' = 'left', color?: string): React.CSSProperties {
  return {
    border: '1px solid var(--border)', padding: '4px 6px',
    fontSize: 12, textAlign: align, color: color ?? 'var(--text-primary)',
    verticalAlign: 'middle',
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '3px 5px',
  fontSize: 12, fontFamily: 'monospace',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  border: '1px solid var(--accent)', borderRadius: 2, outline: 'none',
}

function ToolbarBtn({
  children, onClick, title, disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}
      title={title}
      disabled={disabled}
      style={{
        fontSize: 10, padding: '1px 5px', lineHeight: 1.5,
        cursor: disabled ? 'default' : 'pointer',
        background: 'var(--bg-secondary)',
        color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
        border: '1px solid var(--border)', borderRadius: 2, opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

function ActionBtn({
  children, onClick, disabled, title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        fontSize: 11, padding: '3px 10px',
        cursor: disabled ? 'default' : 'pointer',
        background: 'var(--bg-tertiary)',
        color: disabled ? 'var(--text-dim)' : 'var(--text-primary)',
        border: '1px solid var(--border)', borderRadius: 3,
      }}
    >
      {children}
    </button>
  )
}

/** 列头：双击重命名 + 删除 */
function ColumnHeader({
  name, onRename, onRemove, canEdit,
}: {
  name: string
  onRename: (next: string) => void
  onRemove: () => void
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { setDraft(name) }, [name])

  const submit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim())
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          e.stopPropagation()
        }}
        style={{ ...inputStyle, width: 110 }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }}>
      <span
        onDoubleClick={() => canEdit && setEditing(true)}
        style={{ cursor: canEdit ? 'text' : 'default', fontFamily: 'monospace' }}
        title={canEdit ? '双击重命名列' : '数组段暂不支持重命名列'}
      >
        {name}
      </span>
      {canEdit && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="删除列"
          style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10 }}
        >
          ✕
        </span>
      )}
    </div>
  )
}
