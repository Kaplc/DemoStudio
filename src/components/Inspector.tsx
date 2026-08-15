import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useEditorStore, type BlueprintSelection } from '../stores/editorStore'
import { useSaveStore } from '../stores/saveStore'
import { getSelected, getSelectedActor, select, getSelectionKey, onSelectionChange } from '../editor/SelectionManager'
import { Actor, Component, type EditableProperty, type EditablePropertyAssetTarget } from '../engine'
import type { BlueprintAsset } from '../engine'
import { BlueprintEditorService } from '../editor/blueprintEdit/BlueprintEditorService'
import { AssetPreviewManager } from '../editor/asset/AssetPreviewManager'

function formatSaveTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmt(v: number): string {
  return v.toFixed(2)
}

/** Actor Transform 可编辑输入框（蓝图根 Transform 编辑用） */
const transformInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 56, maxWidth: 80,
  background: 'var(--bg-tertiary)', color: 'var(--success)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11,
  fontFamily: 'var(--font-mono)', outline: 'none',
}

// ─── 组件垂直列表：每个组件一个区块，显示名称 + 属性键值 ───

/** 可编辑属性控件统一样式 */
const editableInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11, outline: 'none',
  fontFamily: 'var(--font-mono)',
}

/** 向量分量输入框（vec2/vec3 用） */
const vecAxisInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 32, maxWidth: 56, background: 'var(--bg-tertiary)', color: 'var(--success)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 4px', fontSize: 11,
  fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'center',
}

/**
 * 可编辑属性输入控件：根据 EditableProperty.type 渲染对应编辑器。
 * - number → 数字输入（blur/Enter 提交）
 * - string → 文本输入（blur/Enter 提交）
 * - boolean → 复选框（即时提交）
 * - enum → 下拉框（即时提交）
 * - vec2/vec3 → 分量数字输入（blur/Enter 提交）
 * - color → 颜色选择器（即时提交）
 */
function EditablePropertyInput({ prop, onEdited, assetTarget, currentComp, siblingComponents, scenePreviewMgr }: {
  prop: EditableProperty
  onEdited: () => void
  /** 蓝图预览模式注入：提交走资产通道（工作副本 + 撤销快照）；无 → 运行时 prop.set 直改 */
  assetTarget?: EditablePropertyAssetTarget
  /** 当前编辑的组件（蓝图模式下合并其全量持久化属性提交，避免单 key 写入丢失派生系数） */
  currentComp?: Component
  /** 同 actor 的其它组件（蓝图模式下随本次编辑一并持久化其 persistentProps，原子进撤销栈） */
  siblingComponents?: Component[]
  /** 场景预览模式注入：运行时直改后调用 commitPropertyEdit 进撤回系统（不重建预览） */
  scenePreviewMgr?: { commitPropertyEdit(): void } | null
}) {
  const [val, setVal] = useState<unknown>(prop.get())
  /** 只读属性：由系统推导（如 widget 根节点视口尺寸），输入禁用、仅展示当前值 */
  const readOnly = prop.readonly === true
  /** 输入框聚焦中（用户正在编辑）：跳过外部同步，避免每次重渲染把输入重置回旧值 */
  const editingRef = useRef(false)
  /** 蓝图模式 color picker 防抖（拖动停止后才提交，避免连续重建卡死） */
  const colorDebounceRef = useRef<number | null>(null)
  /**
   * 最近一次提交的值（提交后未解除）。蓝图模式下 apply 只改资产、运行时组件值不变，
   * 重建前 prop.get() 仍是旧值——若立即同步会把用户刚提交的值弹回（"点击无效"）。
   * 保护规则：提交后保持显示提交值，直到外部组件值追上提交值才解除并接管。
   */
  const lastCommittedRef = useRef<unknown>(null)

  // 外部变更（如锚点修改导致位置联动 / 蓝图重建）时同步本地值。
  // ⚠️ prop 每次渲染都是新引用（getEditableProperties 每次新建对象），不能直接依赖：
  //   · 聚焦中跳过（否则 onChange → 重渲染 → setVal(prop.get())=旧值 → 输入被吞，"打架"）
  //   · 提交保护：上次提交未确认前保持提交值显示（蓝图模式等重建；游戏模式 prop.set 已同步，
  //     组件值==提交值立即解除）
  //   · 函数式 setVal + 值比较：值没变返回原引用（vec3/数组类型避免无限重渲染）
  useEffect(() => {
    if (editingRef.current) return
    const next = prop.get()
    const committed = lastCommittedRef.current
    if (committed !== null) {
      // 外部值已追上提交值（游戏模式立即 / 蓝图重建后）→ 解除保护，接管为外部值
      if (JSON.stringify(next) === JSON.stringify(committed)) {
        lastCommittedRef.current = null
        setVal(next)
      }
      // 否则保持提交值显示（蓝图重建完成前的窗口期）
      return
    }
    setVal((prev: unknown) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prop])

  const commit = (v: unknown) => {
    setVal(v)
    // 提交保护：在外部值确认前保持显示提交值（修复蓝图模式下复选框/输入被 useEffect 弹回）
    lastCommittedRef.current = v
    if (assetTarget) {
      // 蓝图预览模式：走 BlueprintEditorService（工作副本 + 撤销快照 + 预览重建），
      // 运行时组件不改——apply 成功后 bump 触发蓝图重建，场景值由重建刷新。
      // 根节点组件（assetTarget.root）作用于 asset.components → setComponentProps；
      // 子节点组件 → setChildComponentProps（按 name 递归定位 children）
      //
      // ⚠️ 批量提交（原子撤销）：一次用户编辑 = 一次 applyBatch = 一个撤销点。
      // 不仅写当前 key，还一并写入：
      //   1. 当前组件的全量 persistentProps（当前 key 用新值覆盖）——避免单 key 写入
      //      只存一个字段，其它持久化字段（如派生系数 fontSizeScale）在重建后丢失；
      //   2. 同 actor 其它组件的 persistentProps——如改 UITransform 尺寸时同步固化
      //      同节点 UITextComponent 的字号系数，防止重建时按新尺寸重算导致字号漂移。
      const buildProps = (c: Component, overrideKey?: string, overrideVal?: unknown) => {
        const p: Record<string, unknown> =
          (c.getPersistentProps ? c.getPersistentProps() : {}) as Record<string, unknown>
        if (overrideKey) p[overrideKey] = overrideVal
        return p
      }
      const makeOpParams = (baseClass: string, props: Record<string, unknown>) =>
        assetTarget.root
          ? { baseClass, properties: props }
          : { name: assetTarget.childName, baseClass, properties: props, strict: true }
      const opName = assetTarget.root ? 'setComponentProps' : 'setChildComponentProps'
      const ops: Array<{ op: string; params: Record<string, unknown> }> = []
      // 当前组件：全量 persistentProps + 当前 key 覆盖为新值
      if (currentComp) {
        ops.push({
          op: opName,
          params: makeOpParams(assetTarget.baseClass, buildProps(currentComp, prop.key, v)),
        })
      } else {
        // 兜底（旧调用点未传 currentComp）：保持原单 key 写入行为
        ops.push({
          op: opName,
          params: makeOpParams(assetTarget.baseClass, { [prop.key]: v }),
        })
      }
      // 同 actor 其它组件：各自 persistentProps 全量持久化（跳过与当前组件重复的 baseClass）
      for (const sibling of siblingComponents ?? []) {
        if (!sibling.persistType || sibling.persistType === assetTarget.baseClass) continue
        ops.push({
          op: opName,
          params: makeOpParams(sibling.persistType, buildProps(sibling)),
        })
      }
      BlueprintEditorService.applyBatch(assetTarget.assetPath, ops)
        .then((r) => {
          if (!r.ok) {
            console.warn(`[Inspector] ${assetTarget.root ? '根组件' : '子控件'}属性写入资产失败: ${assetTarget.childName}.${prop.key} → ${r.error}`)
            // 写入失败：解除提交保护并恢复真实值，避免界面停留在错误的提交值上
            lastCommittedRef.current = null
            setVal(prop.get())
          } else {
            console.log(
              `[Inspector] 属性已提交: ${assetTarget.childName}.${prop.key} = ${JSON.stringify(v)} ` +
              `(${assetTarget.root ? '根组件→setComponentProps' : '子控件→setChildComponentProps'}, baseClass=${assetTarget.baseClass}, 批量 ${ops.length} ops, apply=${r.ok})`,
            )
          }
        })
    } else {
      // 游戏模式/非蓝图：直接改运行时组件
      console.log(`[Inspector] 属性已提交(运行时直改): ${prop.key} = ${JSON.stringify(v)}`)
      prop.set(v)
      // 场景预览模式：直改已生效，补一个撤回点（对比基准有变化才 push，不重建预览）
      scenePreviewMgr?.commitPropertyEdit()
    }
    onEdited()
  }

  switch (prop.type) {
    case 'number': {
      const n = (typeof val === 'number' ? val : 0)
      return (
        <input
          type="number"
          style={editableInputStyle}
          value={String(n)}
          step={prop.step ?? 1}
          min={prop.min}
          max={prop.max}
          disabled={readOnly}
          title={readOnly ? '由视口比例决定，不可修改' : undefined}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) setVal(v)
          }}
          onFocus={() => { editingRef.current = true }}
          onBlur={() => {
            editingRef.current = false
            const v = typeof val === 'number' ? val : parseFloat(String(val))
            commit(isNaN(v) ? 0 : v)
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      )
    }
    case 'string': {
      const s = typeof val === 'string' ? val : String(val ?? '')
      return (
        <input
          type="text"
          style={editableInputStyle}
          value={s}
          disabled={readOnly}
          title={readOnly ? '由视口比例决定，不可修改' : undefined}
          onChange={(e) => setVal(e.target.value)}
          onFocus={() => { editingRef.current = true }}
          onBlur={() => { editingRef.current = false; commit(s) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      )
    }
    case 'boolean': {
      return (
        <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, cursor: readOnly ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={!!val}
            disabled={readOnly}
            onChange={(e) => commit(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: readOnly ? 'not-allowed' : 'pointer' }}
          />
          <span style={{ fontSize: 11, color: val ? '#fff' : 'var(--text-dim)' }}>
            {val ? 'true' : 'false'}
          </span>
        </label>
      )
    }
    case 'enum': {
      const opts = prop.options ?? []
      const cur = String(val ?? opts[0] ?? '')
      return (
        <select
          style={{ ...editableInputStyle, cursor: readOnly ? 'not-allowed' : 'pointer' }}
          value={cur}
          disabled={readOnly}
          onChange={(e) => commit(e.target.value)}
        >
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    case 'color': {
      const c = typeof val === 'string' ? val : '#ffffff'
      // 兼容 3 位短 hex
      const fullHex = /^#[0-9a-fA-F]{3}$/.test(c)
        ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
        : c
      // color picker 拖动时 onChange 连续触发（即时提交）。蓝图模式每次提交都触发
      // 全量重建（销毁+重实例化+troika 字体重载）→ 防抖：停止拖动后才提交一次
      const debouncedCommit = (v: string) => {
        setVal(v)
        if (!assetTarget) { commit(v); return } // 游戏模式即时改组件，无重建，无需防抖
        if (colorDebounceRef.current !== null) window.clearTimeout(colorDebounceRef.current)
        colorDebounceRef.current = window.setTimeout(() => {
          colorDebounceRef.current = null
          commit(v)
        }, 400)
      }
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(fullHex) ? fullHex : '#ffffff'}
            disabled={readOnly}
            onChange={(e) => debouncedCommit(e.target.value)}
            style={{ width: 26, height: 20, padding: 0, border: '1px solid var(--border)', borderRadius: 3, background: 'transparent', cursor: readOnly ? 'not-allowed' : 'pointer' }}
          />
          <input
            type="text"
            style={{ ...editableInputStyle, fontSize: 10 }}
            value={c}
            disabled={readOnly}
            onChange={(e) => setVal(e.target.value)}
            onFocus={() => { editingRef.current = true }}
            onBlur={() => { editingRef.current = false; commit(c) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
        </div>
      )
    }
    case 'vec2':
    case 'vec3': {
      const dims = prop.type === 'vec3' ? 3 : 2
      const arr = Array.isArray(val) ? (val as number[]).slice(0, dims) : Array(dims).fill(0)
      const labels = prop.type === 'vec3' ? ['x', 'y', 'z'] : ['x', 'y']
      return (
        <div style={{ flex: 1, display: 'flex', gap: 3, minWidth: 0 }}>
          {Array.from({ length: dims }).map((_, idx) => {
            const v = typeof arr[idx] === 'number' ? arr[idx] : 0
            return (
              <div key={idx} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>{labels[idx]}</span>
                <input
                  type="number"
                  style={vecAxisInputStyle}
                  value={String(v)}
                  step={prop.step ?? 0.1}
                  disabled={readOnly}
                  title={readOnly ? '由视口比例决定，不可修改' : undefined}
                  onChange={(e) => {
                    const nv = parseFloat(e.target.value)
                    const next = [...arr]
                    next[idx] = isNaN(nv) ? v : nv
                    setVal(next)
                  }}
                  onFocus={() => { editingRef.current = true }}
                  onBlur={() => {
                    editingRef.current = false
                    const next = arr.map((x) => (typeof x === 'number' ? x : 0))
                    commit(next)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
              </div>
            )
          })}
        </div>
      )
    }
    default:
      return <span style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)' }}>{String(val)}</span>
  }
}

/**
 * 单条属性行：注册了可编辑属性 → 渲染编辑器；否则 → 只读展示。
 */
function ComponentPropertyRow({
  comp, k, v, onEdited, assetTarget, siblingComponents, scenePreviewMgr,
}: {
  comp: Component; k: string; v: unknown; onEdited: () => void
  /** 蓝图预览模式注入的资产持久化目标（组件级）；null → 运行时直改 */
  assetTarget?: EditablePropertyAssetTarget | null
  /** 同 actor 的其它组件（蓝图模式下随本次编辑一并持久化，原子进撤销栈） */
  siblingComponents?: Component[]
  /** 场景预览模式注入：直改后进撤回系统 */
  scenePreviewMgr?: { commitPropertyEdit(): void } | null
}) {
  const editable = (comp.getEditableProperties ? comp.getEditableProperties() : [])
    .find((p) => p.key === k)
  // 组件声明为非持久化的运行时派生值（persistent=false）→ 不注入资产通道，保持 prop.set
  const target = assetTarget && editable && editable.persistent !== false ? assetTarget : null
  return (
    <div className="property-row" style={{ gap: 4, padding: '2px 0', alignItems: 'center' }}>
      <span style={{ flex: '0 0 92px', fontSize: 11, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{humanizeKey(k)}</span>
      {editable ? (
        <EditablePropertyInput prop={editable} onEdited={onEdited} assetTarget={target ?? undefined} currentComp={comp} siblingComponents={siblingComponents} scenePreviewMgr={scenePreviewMgr ?? undefined} />
      ) : (
        <span
          style={{
            flex: 1, fontSize: 11, color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
          }}
        >
          {displayValue(v)}
        </span>
      )}
    </div>
  )
}

function ActorComponentsView({ actor, assetPath = null, scenePreviewMgr }: {
  actor: Actor
  assetPath?: string | null
  /** 场景预览模式：直改属性后提交撤回点（不重建预览） */
  scenePreviewMgr?: { commitPropertyEdit(): void } | null
}) {
  const components = (actor as any).components as Component[] | undefined
  // 折叠状态：组件名 → 是否折叠（默认展开；切换选中对象时重置）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // 属性编辑后递增，强制刷新所有输入框（联动值同步）
  const [editNonce, setEditNonce] = useState(0)

  useEffect(() => {
    setCollapsed(new Set())
    setEditNonce(0)
  }, [actor])

  // 蓝图预览模式：构建资产定位（子节点名 = actor.root.name，组件按 baseClass 匹配）。
  // 顶层 Actor（无 parent）= 资产根节点 → root=true（组件编辑走 setComponentProps）；
  // 否则为 children 中的子节点 → 走 setChildComponentProps
  const childName = actor.root?.name || undefined
  const isRoot = !!assetPath && !actor.parent
  const makeTarget = (baseClass: string): EditablePropertyAssetTarget | undefined =>
    assetPath && childName ? { assetPath, childName, baseClass, root: isRoot } : undefined

  const toggleCollapse = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (!components || components.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 0' }}>
        该 Actor 没有组件
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {components.map((comp, i) => {
        const props = comp.getProperties ? comp.getProperties() : {}
        const entries = Object.entries(props)
        const compName = comp.name || comp.constructor.name
        const isCollapsed = collapsed.has(compName)
        return (
          <div key={i} className="property-group">
            <div
              className="property-group-title"
              style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => toggleCollapse(compName)}
              title={isCollapsed ? '展开组件属性' : '折叠组件属性'}
            >
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 12, flexShrink: 0 }}>
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span style={{ textTransform: 'none' }}>{compName}</span>
              <span
                style={{
                  marginLeft: 'auto', fontWeight: 400, fontSize: 10,
                  color: comp.bEnabled ? 'var(--success)' : 'var(--text-dim)',
                }}
              >
                {comp.bEnabled ? '✓ 启用' : '✗ 禁用'}
              </span>
            </div>
            {!isCollapsed &&
              (entries.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 0' }}>（无属性）</div>
              ) : (
                entries.map(([k, v]) => (
                  <ComponentPropertyRow
                    key={k}
                    comp={comp}
                    k={k}
                    v={v}
                    assetTarget={makeTarget(comp.persistType)}
                    onEdited={() => setEditNonce((n) => n + 1)}
                    siblingComponents={components.filter((c) => c !== comp)}
                    scenePreviewMgr={scenePreviewMgr}
                  />
                ))
              ))}
          </div>
        )
      })}
    </div>
  )
}

// ─── 组件属性搜索（类似 UE 细节面板）───
/** 高亮文本中匹配搜索词的部分 */
function highlightMatch(text: string, query: string): React.ReactNode {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: 'var(--accent)', color: '#000', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  )
}

/**
 * 搜索组件属性：按"组件名匹配 → 显示整组；属性名匹配 → 只显示匹配属性"过滤，
 * 结果仍按组件分组展示，保留所属组标题（UE 风格）。
 */
function ComponentSearchResults({ actor, query, assetPath = null, scenePreviewMgr }: {
  actor: Actor; query: string; assetPath?: string | null
  /** 场景预览模式：直改属性后提交撤回点（不重建预览） */
  scenePreviewMgr?: { commitPropertyEdit(): void } | null
}) {
  const components = (actor as any).components as Component[] | undefined
  const [editNonce, setEditNonce] = useState(0)
  const q = query.trim()
  if (!components || components.length === 0 || !q) return null

  const ql = q.toLowerCase()
  // 蓝图预览模式：构建资产定位（子节点名 = actor.root.name，组件按 baseClass 匹配）。
  // 顶层 Actor（无 parent）= 资产根节点 → root=true（组件编辑走 setComponentProps）
  const childName = actor.root?.name || undefined
  const isRoot = !!assetPath && !actor.parent
  const makeTarget = (baseClass: string): EditablePropertyAssetTarget | undefined =>
    assetPath && childName ? { assetPath, childName, baseClass, root: isRoot } : undefined
  const groups: { comp: Component; name: string; enabled: boolean; entries: [string, unknown][] }[] = []

  for (const comp of components) {
    const props = comp.getProperties ? comp.getProperties() : {}
    const allEntries = Object.entries(props)
    const compName = comp.name || comp.constructor.name
    // 组件名匹配 → 显示该组全部属性
    if (compName.toLowerCase().includes(ql)) {
      groups.push({ comp, name: compName, enabled: comp.bEnabled, entries: allEntries })
      continue
    }
    // 属性名匹配 → 只显示匹配的属性
    const matched = allEntries.filter(([k]) => k.toLowerCase().includes(ql))
    if (matched.length > 0) groups.push({ comp, name: compName, enabled: comp.bEnabled, entries: matched })
  }

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '10px 0', textAlign: 'center' }}>
        未找到匹配 “{q}” 的属性
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {groups.map((g, i) => (
        <div key={i} className="property-group">
          <div className="property-group-title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 12, flexShrink: 0 }}>▾</span>
            <span style={{ textTransform: 'none' }}>{highlightMatch(g.name, q)}</span>
            <span
              style={{
                marginLeft: 'auto', fontWeight: 400, fontSize: 10,
                color: g.enabled ? 'var(--success)' : 'var(--text-dim)',
              }}
            >
              {g.enabled ? '✓ 启用' : '✗ 禁用'}
            </span>
          </div>
          {g.entries.map(([k, v]) => (
            <div key={k} className="property-row" style={{ gap: 4, padding: '2px 0' }}>
              {(() => {
                const editable = (g.comp.getEditableProperties ? g.comp.getEditableProperties() : [])
                  .find((p) => p.key === k)
                // 组件声明为非持久化的运行时派生值 → 不注入资产通道
                const target = makeTarget(g.comp.persistType)
                const assetT = target && editable && editable.persistent !== false ? target : undefined
                return (
                  <>
                    <span style={{ flex: '0 0 92px', fontSize: 11, color: 'var(--text-primary)' }}>
                      {highlightMatch(humanizeKey(k), q)}
                    </span>
                    {editable ? (
                      <EditablePropertyInput prop={editable} onEdited={() => setEditNonce((n) => n + 1)} assetTarget={assetT} currentComp={g.comp} siblingComponents={components.filter((c) => c !== g.comp)} scenePreviewMgr={scenePreviewMgr ?? undefined} />
                    ) : (
                      <span
                        style={{
                          flex: 1, fontSize: 11, color: 'var(--text-dim)',
                          fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
                        }}
                      >
                        {displayValue(v)}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── 只读键值展示（替代蓝图编辑中的 KVEditor）───
function ReadOnlyKV({ data }: { data: Record<string, unknown> | undefined }) {
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) {
    return <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 0' }}>（空）</div>
  }
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="property-row" style={{ gap: 4, padding: '2px 0' }}>
          <span style={{ flex: '0 0 80px', fontSize: 11, color: 'var(--text-primary)' }}>{k}</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {displayValue(v)}
          </span>
        </div>
      ))}
    </>
  )
}

// ─── 通用键值编辑器（用于组件 props / 子物体 overrides / CDO defaults）───
// 所有编辑都通过 BlueprintEditorService 落盘，不直接改 JSON。

const kvKeyStyle: React.CSSProperties = {
  flex: '0 0 80px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11, outline: 'none',
}
const kvValStyle: React.CSSProperties = {
  flex: 1, background: 'var(--bg-tertiary)', color: 'var(--success)',
  border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', fontSize: 11,
  fontFamily: 'var(--font-mono)', outline: 'none', minWidth: 0,
}
const kvBtnStyle: React.CSSProperties = {
  flex: '0 0 auto', padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer',
  color: 'var(--text-dim)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
}

/** 宽松解析：先按 JSON 解析，失败则按原始字符串保留 */
function lenientParse(v: string): unknown {
  const s = v.trim()
  if (s === '') return ''
  try { return JSON.parse(s) } catch { return s }
}

/** 展示值：字符串原样（不加引号），其余 JSON 序列化 */
function displayValue(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/**
 * camelCase 键 → 可读标签（属性键与 JSON/TS 属性名一致为 camelCase，仅展示层美化）：
 * 'fontSize' → 'Font Size'，'worldWidth' → 'World Width'，'zOrder' → 'Z Order'，'position' → 'Position'
 */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

function KVEditor({
  initial,
  onSave,
  disabled,
  saveLabel = '保存',
}: {
  initial: Record<string, unknown> | undefined
  onSave: (patch: Record<string, unknown>) => Promise<void>
  disabled?: boolean
  saveLabel?: string
}) {
  const sig = JSON.stringify(initial ?? {})
  const [rows, setRows] = useState<{ key: string; val: string }[]>([])
  const [nk, setNk] = useState('')
  const [nv, setNv] = useState('')

  // 外部数据变化时（编辑落盘后刷新）重置编辑缓冲
  useEffect(() => {
    setRows(Object.entries(initial ?? {}).map(([k, v]) => ({ key: k, val: displayValue(v) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const updateRow = (i: number, patch: Partial<{ key: string; val: string }>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i))
  const addRow = () => {
    if (!nk) return
    setRows((rs) => [...rs, { key: nk, val: nv }])
    setNk('')
    setNv('')
  }

  const save = async () => {
    const patch: Record<string, unknown> = {}
    for (const r of rows) {
      if (!r.key) continue
      patch[r.key] = lenientParse(r.val)
    }
    // 被删除的原有键 → null（配合深合并实现精确替换）
    for (const k of Object.keys(initial ?? {})) {
      if (!rows.some((r) => r.key === k)) patch[k] = null
    }
    await onSave(patch)
  }

  return (
    <>
      {rows.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '2px 0' }}>（空）</div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="property-row" style={{ gap: 4, padding: '2px 0' }}>
          <input value={r.key} onChange={(e) => updateRow(i, { key: e.target.value })} style={kvKeyStyle} />
          <input value={r.val} onChange={(e) => updateRow(i, { val: e.target.value })} style={kvValStyle} />
          <button title="删除该键" disabled={disabled} onClick={() => removeRow(i)} style={kvBtnStyle}>×</button>
        </div>
      ))}
      <div className="property-row" style={{ gap: 4, padding: '2px 0', marginTop: 2 }}>
        <input placeholder="新键" value={nk} onChange={(e) => setNk(e.target.value)} style={kvKeyStyle} />
        <input placeholder='值（数字/布尔/对象用 JSON）' value={nv} onChange={(e) => setNv(e.target.value)} style={kvValStyle} />
        <button title="添加键" disabled={disabled} onClick={addRow} style={kvBtnStyle}>+</button>
      </div>
      <div style={{ marginTop: 6 }}>
        <button className="btn btn-primary" disabled={disabled} onClick={save} style={{ padding: '3px 12px', fontSize: 11 }}>
          {saveLabel}
        </button>
      </div>
    </>
  )
}

// ─── 蓝图编辑器选中组件详情（只读）───
function BlueprintComponentDetail({ data, selection }: { data: NonNullable<BlueprintSelection['compData']>; selection: BlueprintSelection }) {
  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Component — {data.name || data.baseClass}</div>
        <div className="property-row">
          <span className="property-label">baseClass</span>
          <span className="property-value" style={{ fontSize: 11, color: 'var(--accent)' }}>{data.baseClass}</span>
        </div>
        {data.id !== undefined && (
          <div className="property-row">
            <span className="property-label">ID</span>
            <span className="property-value" style={{ fontSize: 11 }}>#{data.id}</span>
          </div>
        )}
        {data.name && (
          <div className="property-row">
            <span className="property-label">Name</span>
            <span className="property-value" style={{ fontSize: 11 }}>{data.name}</span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Index</span>
          <span className="property-value" style={{ fontSize: 11 }}>#{selection.index}</span>
        </div>
        {data._remove && (
          <div className="property-row">
            <span className="property-label">Status</span>
            <span className="property-value" style={{ color: 'var(--error)' }}>Removed (inherited)</span>
          </div>
        )}
      </div>
      <div className="property-group">
        <div className="property-group-title">Properties（只读）</div>
        <ReadOnlyKV data={data.properties} />
      </div>
    </>
  )
}

// ─── 蓝图编辑器选中子 Actor 详情（只读）───
function BlueprintChildDetail({ data, selection }: { data: NonNullable<BlueprintSelection['childData']>; selection: BlueprintSelection }) {
  // 组件优先约定：位置/旋转/缩放写在 TransformComponent/UITransformComponent 组件 properties（顶层字段已废弃）
  const tsf = (data.components ?? []).find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
  const tsfProps = (tsf?.properties ?? {}) as Record<string, unknown>
  const p = Array.isArray(tsfProps.position) ? (tsfProps.position as number[]) : [0, 0, 0]
  const r = Array.isArray(tsfProps.rotation) ? (tsfProps.rotation as number[]) : [0, 0, 0]
  const s = Array.isArray(tsfProps.scale) ? (tsfProps.scale as number[]) : [1, 1, 1]
  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Child Actor — {selection.label}</div>
        {data.name && (
          <div className="property-row">
            <span className="property-label">Name</span>
            <span className="property-value" style={{ fontSize: 11, fontWeight: 600 }}>{data.name}</span>
          </div>
        )}
        {data.ref && (
          <div className="property-row">
            <span className="property-label">Ref</span>
            <span className="property-value" style={{ fontSize: 11, color: 'var(--info)' }}>🧩 {data.ref}</span>
          </div>
        )}
        {!data.ref && data.baseClass && (
          <div className="property-row">
            <span className="property-label">baseClass</span>
            <span className="property-value" style={{ fontSize: 11, color: 'var(--warning)' }}>⚙️ {data.baseClass}</span>
          </div>
        )}
        {data.id !== undefined && (
          <div className="property-row">
            <span className="property-label">ID</span>
            <span className="property-value" style={{ fontSize: 11 }}>#{data.id}</span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Index</span>
          <span className="property-value" style={{ fontSize: 11 }}>#{selection.index}</span>
        </div>
        {data._remove && (
          <div className="property-row">
            <span className="property-label">Status</span>
            <span className="property-value" style={{ color: 'var(--error)' }}>Removed (inherited)</span>
          </div>
        )}
      </div>
      <div className="property-group">
        <div className="property-group-title">Transform（组件）</div>
        {!tsf && (
          <div className="property-row">
            <span className="property-value" style={{ fontSize: 11, color: 'var(--warning)' }}>
              ⚠️ 缺少 TransformComponent/UITransformComponent 组件（位置必须写在变换组件）
            </span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Position</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(p[0])} Y:{fmt(p[1])} Z:{fmt(p[2])}
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Rotation</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(r[0])} Y:{fmt(r[1])} Z:{fmt(r[2])}
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Scale</span>
          <span className="property-value" style={{ fontSize: 11 }}>
            X:{fmt(s[0])} Y:{fmt(s[1])} Z:{fmt(s[2])}
          </span>
        </div>
      </div>
      <div className="property-group">
        <div className="property-group-title">Overrides（只读）</div>
        <ReadOnlyKV data={data.overrides} />
      </div>
    </>
  )
}

// ─── 蓝图根：Transform + Components + Children 总览（未选中任何元素时）───
function BlueprintOverviewDetail({ assetPath }: { assetPath: string }) {
  const [busy, setBusy] = useState(false)
  const [asset, setAsset] = useState<BlueprintAsset | null>(null)
  const nonce = useEditorStore((s) => s.blueprintEditNonce)

  useEffect(() => {
    let cancelled = false
    BlueprintEditorService.read(assetPath).then((r) => {
      if (!cancelled && r.ok && r.asset) setAsset(r.asset)
    })
    return () => { cancelled = true }
  }, [assetPath, nonce])

  if (!asset) {
    return <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>加载蓝图…</div>
  }

  // 组件优先约定：蓝图根位置/旋转/缩放写在 TransformComponent/UITransformComponent 组件 properties（旧格式顶层字段已废弃）
  const tsf = (asset.components ?? []).find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
  const tsfProps = (tsf?.properties ?? {}) as Record<string, unknown>
  const p = Array.isArray(tsfProps.position) ? (tsfProps.position as number[]) : [0, 0, 0]
  const r = Array.isArray(tsfProps.rotation) ? (tsfProps.rotation as number[]) : [0, 0, 0]
  const s = Array.isArray(tsfProps.scale) ? (tsfProps.scale as number[]) : [1, 1, 1]
  const noTsf = !tsf
  const compCount = asset.components?.length ?? 0
  const childCount = asset.children?.length ?? 0

  return (
    <>
      <div className="property-group">
        <div className="property-group-title">{assetPath} · Class</div>
        <div className="property-row">
          <span className="property-label">baseClass</span>
          <span className="property-value" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{asset.baseClass}</span>
        </div>
      </div>

      <div className="property-group">
        <div className="property-group-title">Transform（组件）</div>
        {noTsf && (
          <div className="property-row">
            <span className="property-value" style={{ fontSize: 11, color: 'var(--warning)' }}>
              ⚠️ 缺少 TransformComponent/UITransformComponent 组件：位置必须写在变换组件（组件优先约定）
            </span>
          </div>
        )}
        <div className="property-row">
          <span className="property-label">Position</span>
          <span className="property-value" style={{ fontSize: 11, display: 'flex', gap: 2 }}>
            <input key={`px-${p[0]}`} type="number" step="0.01" disabled={noTsf} defaultValue={p[0]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[0] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
            <input key={`py-${p[1]}`} type="number" step="0.01" disabled={noTsf} defaultValue={p[1]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[1] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
            <input key={`pz-${p[2]}`} type="number" step="0.01" disabled={noTsf} defaultValue={p[2]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) p[2] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setPosition', { position: [p[0], p[1], p[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Rotation</span>
          <span className="property-value" style={{ fontSize: 11, display: 'flex', gap: 2 }}>
            <input key={`rx-${r[0]}`} type="number" step="0.01" disabled={noTsf} defaultValue={r[0]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[0] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
            <input key={`ry-${r[1]}`} type="number" step="0.01" disabled={noTsf} defaultValue={r[1]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[1] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
            <input key={`rz-${r[2]}`} type="number" step="0.01" disabled={noTsf} defaultValue={r[2]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) r[2] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setRotation', { rotation: [r[0], r[1], r[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
        <div className="property-row">
          <span className="property-label">Scale</span>
          <span className="property-value" style={{ fontSize: 11, display: 'flex', gap: 2 }}>
            <input key={`sx-${s[0]}`} type="number" step="0.01" disabled={noTsf} defaultValue={s[0]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[0] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
            <input key={`sy-${s[1]}`} type="number" step="0.01" disabled={noTsf} defaultValue={s[1]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[1] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
            <input key={`sz-${s[2]}`} type="number" step="0.01" disabled={noTsf} defaultValue={s[2]} style={transformInputStyle}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) s[2] = v }}
              onBlur={() => { if (busy || noTsf) return; setBusy(true); BlueprintEditorService.apply(assetPath, 'setScale', { scale: [s[0], s[1], s[2]] }).finally(() => setBusy(false)) }} />
          </span>
        </div>
      </div>

      <div className="property-group">
        <div className="property-group-title">Components（{compCount}）</div>
        {(asset.components ?? []).map((comp, i) => (
          <div key={i} className="property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span className="property-label" style={{ fontWeight: 600 }}>{comp.name || comp.baseClass}</span>
            {comp._remove && <span className="property-value" style={{ fontSize: 10, color: 'var(--error)' }}>Removed</span>}
          </div>
        ))}
      </div>

      <div className="property-group">
        <div className="property-group-title">Children（{childCount}）</div>
        {(asset.children ?? []).map((ch, i) => (
          <div key={i} className="property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span className="property-label" style={{ fontWeight: 600 }}>{ch.name || `#${i}`}</span>
            <span className="property-value" style={{ fontSize: 10 }}>
              {ch.id !== undefined ? `#${ch.id} ` : ''}{ch.ref ? `🧩 ref:${ch.ref}` : ch.baseClass ? `⚙️ ${ch.baseClass}` : ''}
              {ch._remove ? ' · Removed' : ''}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── 蓝图编辑器基本选中信息 ───
function BlueprintGeneralInfo({ selection }: { selection: BlueprintSelection }) {
  return (
    <div className="property-group">
      <div className="property-group-title">Blueprint Element</div>
      <div className="property-row">
        <span className="property-label">Type</span>
        <span className="property-value" style={{ fontSize: 11 }}>{selection.type}</span>
      </div>
      <div className="property-row">
        <span className="property-label">Label</span>
        <span className="property-value" style={{ fontSize: 11 }}>{selection.label}</span>
      </div>
    </div>
  )
}

function Object3DInfoView({ obj }: { obj: THREE.Object3D }) {
  const actorRef = (obj as any).userData?.actorRef as Actor | undefined
  if (actorRef) {
    // 有 Actor 关联：只显示组件列表
    return (
      <>
        <div className="property-group-title" style={{ marginBottom: 6 }}>{obj.name || obj.type}</div>
        <ActorComponentsView actor={actorRef} />
      </>
    )
  }
  return (
    <div className="property-group">
      <div className="property-group-title">{obj.name || obj.type}</div>
      <div className="property-row">
        <span className="property-label">Type</span>
        <span className="property-value" style={{ fontSize: 11 }}>{obj.type}</span>
      </div>
      {obj.parent && (
        <div className="property-row">
          <span className="property-label">Parent</span>
          <span className="property-value" style={{ fontSize: 11 }}>{obj.parent.name || obj.parent.type}</span>
        </div>
      )}
      <div className="property-row">
        <span className="property-label">Children</span>
        <span className="property-value" style={{ fontSize: 11 }}>{obj.children.length}</span>
      </div>
    </div>
  )
}

// ─── 主 Inspector 组件 ───
export function Inspector() {
  const [selectionKey, setSelectionKey] = useState(getSelectionKey())
  const [searchQuery, setSearchQuery] = useState('')
  const selected = getSelected()
  const selectedActor = getSelectedActor()
  const blueprintSelection = useEditorStore((s) => s.blueprintSelection)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const isBlueprintTab = activeTabId.startsWith('bp:')
  // 场景预览页签（sp: 前缀）：属性直改走 ScenePreviewManager.commitPropertyEdit 进撤回系统
  const isScenePreviewTab = activeTabId.startsWith('sp:')
  const scenePreviewMgr = isScenePreviewTab
    ? AssetPreviewManager.get<import('../editor/asset/ScenePreviewManager').ScenePreviewManager>(activeTabId.slice(3))
    : null
  // 蓝图被编辑后刷新当前选中元素的数据，避免显示陈旧快照
  const blueprintEditNonce = useEditorStore((s) => s.blueprintEditNonce)

  useEffect(() => {
    const unsub = onSelectionChange(() => {
      setSelectionKey(getSelectionKey())
      // 切换选中对象时清空搜索，避免残留旧的过滤状态
      setSearchQuery('')
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!blueprintEditNonce) return
    const cur = useEditorStore.getState().blueprintSelection
    if (!cur) return
    let cancelled = false
    BlueprintEditorService.read(cur.assetPath).then((r) => {
      if (cancelled || !r.ok || !r.asset) return
      const asset = r.asset
      if (cur.type === 'component') {
        const comp = (asset.components ?? []).find((c, i) => c.baseClass === cur.compType || i === cur.index)
        if (comp) useEditorStore.getState().setBlueprintSelection({ ...cur, compData: comp })
      } else if (cur.type === 'child') {
        const name = cur.childData?.name
        const child = (asset.children ?? []).find((c, i) => (name ? c.name === name : i === cur.index))
        if (child) useEditorStore.getState().setBlueprintSelection({ ...cur, childData: child })
      }
    })
    return () => { cancelled = true }
  }, [blueprintEditNonce])

  const isActor = selected instanceof Actor || (selected instanceof THREE.Object3D && !!(selected as any).userData?.actorRef)
  const actorTarget = selectedActor || (isActor && selected instanceof Actor ? selected : null) as Actor | null

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Inspector</span>
        {blueprintSelection && isBlueprintTab ? (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => useEditorStore.getState().setBlueprintSelection(null)}
          >
            ✕
          </button>
        ) : isBlueprintTab && selected ? (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => select(null)}
          >
            ✕
          </button>
        ) : selected ? (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
            onClick={() => select(null)}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {actorTarget && !blueprintSelection && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery('') }}
              placeholder="🔍 搜索组件/属性…"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0, background: 'var(--bg-tertiary)', color: '#fff',
                border: '1px solid var(--border)', borderRadius: 3, padding: '3px 8px', fontSize: 11, outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="清除搜索 (Esc)"
              >
                ✕
              </button>
            )}
          </div>
        )}
        {actorTarget && !blueprintSelection && searchQuery.trim() ? (
          <ComponentSearchResults actor={actorTarget} query={searchQuery} assetPath={isBlueprintTab ? activeTabId.slice(3) : null} scenePreviewMgr={scenePreviewMgr} />
        ) : (
          <>
            {blueprintSelection && isBlueprintTab ? (
              blueprintSelection.type === 'component' && blueprintSelection.compData ? (
                <BlueprintComponentDetail data={blueprintSelection.compData} selection={blueprintSelection} />
              ) : blueprintSelection.type === 'child' && blueprintSelection.childData ? (
                <BlueprintChildDetail data={blueprintSelection.childData} selection={blueprintSelection} />
              ) : (
                <BlueprintGeneralInfo selection={blueprintSelection} />
              )
            ) : isBlueprintTab && selected && isActor && actorTarget ? (
              /* 蓝图预览中通过 Outline 点击或 Gizmo 附着选中了子 Actor：只显示组件列表
                 注入资产路径 → 组件编辑走 setChildComponentProps 进撤销系统 */
              <>
                <div className="property-group-title" style={{ marginBottom: 6 }}>{actorTarget.name}</div>
                <ActorComponentsView actor={actorTarget} assetPath={activeTabId.slice(3)} />
              </>
            ) : isBlueprintTab && activeTabId.length > 3 ? (
              <BlueprintOverviewDetail assetPath={activeTabId.slice(3)} />
            ) : selected ? (
              isActor && actorTarget ? (
                <>
                  <div className="property-group-title" style={{ marginBottom: 6 }}>{actorTarget.name}</div>
                  <ActorComponentsView actor={actorTarget} scenePreviewMgr={scenePreviewMgr} />
                </>
              ) : selected instanceof THREE.Object3D ? (
                <Object3DInfoView obj={selected} />
              ) : null
            ) : (
              <ProjectInfoView />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── 项目信息面板 ───
function ProjectInfoView() {
  const { currentProject, gameState } = useEditorStore()
  const slots = useSaveStore((s) => s.slots)
  const saveGame = useSaveStore((s) => s.saveGame)
  const loadGame = useSaveStore((s) => s.loadGame)
  const deleteSave = useSaveStore((s) => s.deleteSave)
  const refreshSlots = useSaveStore((s) => s.refreshSlots)

  useEffect(() => {
    if (currentProject) refreshSlots(currentProject.name)
  }, [currentProject, gameState.running, refreshSlots])

  return (
    <>
      <div className="property-group">
        <div className="property-group-title">Project</div>
        <div className="property-row">
          <span className="property-label">Name</span>
          <span className="property-value">{currentProject?.name}</span>
        </div>
        <div className="property-row">
          <span className="property-label">Version</span>
          <span className="property-value">{currentProject?.version}</span>
        </div>
        <div className="property-row">
          <span className="property-label">Description</span>
          <span className="property-value" style={{ fontSize: 11 }}>{currentProject?.description}</span>
        </div>
      </div>

      <div className="property-group">
        <div className="property-group-title">Game State</div>
        <div className="property-row">
          <span className="property-label">Status</span>
          <span className="property-value">
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: gameState.running ? 'var(--success)' : 'var(--text-dim)', marginRight: 6,
            }} />
            {gameState.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        {gameState.running && (
          <>
            <div className="property-row">
              <span className="property-label">Score</span>
              <span className="property-value">{gameState.score}</span>
            </div>
            <div className="property-row">
              <span className="property-label">Game Over</span>
              <span className="property-value">{gameState.gameOver ? 'Yes' : 'No'}</span>
            </div>
          </>
        )}
      </div>

      <div className="property-group">
        <div className="property-group-title">Save Game</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <button className="btn" disabled={!gameState.running} onClick={() => saveGame('quick')}>
            💾 Quick Save (F6)
          </button>
          <button className="btn" disabled={slots.length === 0} onClick={() => loadGame('quick')}>
            📂 Quick Load (F9)
          </button>
        </div>
        {slots.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11 }}>
            <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>存档槽 ({slots.length})</div>
            {slots.map((s) => (
              <div key={s.slot} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <button className="btn" style={{ flex: 1, padding: '2px 6px', fontSize: 11, textAlign: 'left' }}
                  onClick={() => loadGame(s.slot)} title={`恢复 ${s.slot}`}>
                  {s.slot} · {formatSaveTime(s.meta.savedAt)} · {s.meta.score}分
                </button>
                <button className="btn" style={{ padding: '2px 6px', fontSize: 11, color: '#ff8888' }}
                  onClick={() => currentProject && deleteSave(currentProject!.name, s.slot)} title="删除">✕</button>
              </div>
            ))}
          </div>
        )}      </div>
    </>
  )
}
