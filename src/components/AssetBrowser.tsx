import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '../engine'
import { useEditorStore } from '../stores/editorStore'
import { select } from '../editor/SelectionManager'
import { compileUiSourceToAsset } from '../editor/asset/uiSourceActions'
import { decompileWidgetJson } from '../editor/asset/uiCompiler'
import { sourcePathOf } from '../editor/asset/uiSourceSync'

/** 资产文件条目（由 listProjectAssets 返回） */
interface AssetFile {
  path: string
  ext: string
  size: number
}

/** 已知资产类型白名单（决定显示与图标） */
interface AssetKind {
  re: RegExp
  kind: string
  icon: string
}

const ASSET_PATTERNS: AssetKind[] = [
  { re: /\.scene\.json$/i, kind: 'scene', icon: '🎬' },
  { re: /\.blueprint\.json$/i, kind: 'blueprint', icon: '🧩' },
  { re: /\.widget\.json$/i, kind: 'widget', icon: '🪟' },
  { re: /\.config\.json$/i, kind: 'config', icon: '⚙️' },
  { re: /\.table\.json$/i, kind: 'config', icon: '⚙️' },
  { re: /\.(png|jpe?g|gif|svg)$/i, kind: 'image', icon: '🖼️' },
]

/** 按文件名匹配资产类型；不在白名单返回 null（project.json、其他 json、代码等不显示） */
function classify(filename: string): AssetKind | null {
  for (const p of ASSET_PATTERNS) {
    if (p.re.test(filename)) return p
  }
  return null
}

/** 右键「创建资产」菜单支持的类型 */
interface CreateKind {
  kind: string
  label: string
  suffix: string
}

const CREATE_KINDS: CreateKind[] = [
  { kind: 'scene', label: '场景资产', suffix: '.scene.json' },
  { kind: 'blueprint', label: '蓝图资产', suffix: '.blueprint.json' },
  { kind: 'widget', label: 'UI Widget', suffix: '.widget.json' },
  { kind: 'config', label: '配置单例', suffix: '.config.json' },
  { kind: 'table', label: '数据表', suffix: '.table.json' },
]

/**
 * 按类型生成最小合法资产模板（满足 assetLint 文档根必填字段，零 lint 错误）：
 *  - scene: doc:scene 必填 name/objects（mode/skybox 参照 fish_menu.scene.json）
 *  - blueprint/widget: doc:blueprint 必填 name/baseClass/components/children（Actor 为注册默认基类）
 *  - config/table: assetLint 不扫描该类型，仅留 _comment 说明填写约定
 */
function buildAssetTemplate(kind: string, name: string): unknown {
  switch (kind) {
    case 'scene':
      return { name, mode: 'game', skybox: { backgroundColor: '#1a1a2e' }, objects: [] }
    case 'blueprint':
      return {
        name,
        baseClass: 'Actor',
        components: [
          {
            baseClass: 'TransformComponent',
            properties: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        ],
        children: [],
      }
    case 'widget':
      return {
        name,
        baseClass: 'Actor',
        components: [
          {
            baseClass: 'UITransformComponent',
            properties: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], worldWidth: 4.8, worldHeight: 2.7 },
          },
          {
            baseClass: 'CanvasUIComponent',
            properties: { width: 960, height: 540, name: 'Canvas', zOrder: 0, active: true },
          },
        ],
        children: [],
      }
    case 'config':
      return { _comment: `${name} 单例配置（字段按项目 ConfigLoader 约定填写）` }
    case 'table':
      return { _comment: `${name} 数据表（键 = 行 id，值 = 行属性）` }
    default:
      return {}
  }
}

interface TreeNode {
  name: string
  /** 文件 = 完整相对路径（src/projects/...）；目录 = 相对 asset/ 的路径（右键创建资产时定位目录） */
  path: string
  isDir: boolean
  kind?: AssetKind
  size?: number
  children: TreeNode[]
}

/** 扁平 path 列表 → 目录树（白名单过滤 + 目录优先字母序） */
function buildTree(files: AssetFile[], projectRootPrefix: string): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  for (const f of files) {
    const kind = classify(f.path)
    if (!kind) continue
    const rel = f.path.startsWith(projectRootPrefix) ? f.path.slice(projectRootPrefix.length) : f.path
    const parts = rel.split('/').filter(Boolean)
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (i === parts.length - 1) {
        cur.children.push({ name: part, path: f.path, isDir: false, kind, size: f.size, children: [] })
      } else {
        let dir = cur.children.find((c) => c.isDir && c.name === part)
        if (!dir) {
          // 目录节点记录相对 asset/ 的路径（blueprints/troops 形式），供右键「在此目录创建资产」
          const dirPath = cur.path ? `${cur.path}/${part}` : part
          dir = { name: part, path: dirPath, isDir: true, children: [] }
          cur.children.push(dir)
        }
        cur = dir
      }
    }
  }
  const sortNode = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sortNode)
  }
  sortNode(root)
  return root.children
}

/** 格式化文件大小（导出供 Inspector 的资产信息卡片复用） */
export function formatSize(size: number): string {
  if (size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** FNV-1a 32 位源指纹（与 uiCompiler compile.ts / uiSourceSync.ts 三处保持一致，勿单点修改） */
function fnv1aSourceHash(str: string): string {
  const s = str.replace(/^\uFEFF/, '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`
}

/** 右键菜单目标：targetPath 为空 = asset 根目录（空白处右键） */
interface MenuTarget {
  x: number
  y: number
  dirRelPath: string
  /** 右键命中的文件完整路径（目录/空白右键为 null） */
  targetPath: string | null
  /** 右键命中的文件名（文件右键才有） */
  targetName: string | null
}

export function AssetBrowser() {
  const currentProject = useEditorStore((s) => s.currentProject)
  const openScenePreview = useEditorStore((s) => s.openScenePreview)
  const openBlueprintEditor = useEditorStore((s) => s.openBlueprintEditor)
  const openConfigEditor = useEditorStore((s) => s.openConfigEditor)
  const addConsoleOutput = useEditorStore((s) => s.addConsoleOutput)
  const assetSelection = useEditorStore((s) => s.assetSelection)
  const setAssetSelection = useEditorStore((s) => s.setAssetSelection)

  const [files, setFiles] = useState<AssetFile[]>([])
  const [error, setError] = useState<string | null>(null)
  /** 折叠的目录 key 集合（默认全展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 右键菜单：null 关闭（含创建区 + 文件/目录操作区） */
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  /** 创建输入态：点击某资产类型后菜单内显示输入框（dirRelPath 跟随创建目标） */
  const [creating, setCreating] = useState<(CreateKind & { dirRelPath: string }) | null>(null)
  const [assetName, setAssetName] = useState('')
  /** 重命名对话框：null 关闭；oldName 含完整相对路径，name 为输入值 */
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  /** widget 源状态缓存：widget.json 路径 → 同名 .widget.html 是否存在（决定右键菜单编译/生成源项） */
  const [widgetSourceState, setWidgetSourceState] = useState<Map<string, boolean>>(new Map())
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentProject) {
      setFiles([])
      setAssetSelection(null)
      return
    }
    const listProjectAssets = window.electronAPI?.listProjectAssets
    if (!listProjectAssets) {
      setError('资产浏览需要 Electron / Mock 环境')
      setFiles([])
      return
    }
    let cancelled = false
    setError(null)
    listProjectAssets(currentProject.folder)
      .then((result) => {
        if (!cancelled) {
          setFiles(result)
          setAssetSelection(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => { cancelled = true }
  }, [currentProject])

  /** 探测每个 .widget.json 的同名 .widget.html 是否存在（右键菜单「编译 UI 源」显隐依据） */
  const refreshWidgetSourceState = useCallback((list: AssetFile[]) => {
    const read = window.electronAPI?.readTextFile
    const widgets = list.filter((f) => /\.widget\.json$/i.test(f.path))
    if (!read || widgets.length === 0) {
      setWidgetSourceState(new Map())
      return
    }
    Promise.all(
      widgets.map(async (f) => {
        try {
          const r = await read(sourcePathOf(f.path))
          return [f.path, Boolean(r.success && r.data)] as const
        } catch {
          return [f.path, false] as const
        }
      }),
    ).then((entries) => setWidgetSourceState(new Map(entries)))
  }, [])

  useEffect(() => {
    refreshWidgetSourceState(files)
  }, [files, refreshWidgetSourceState])

  /** 手动刷新单个 widget 的源状态（编译/生成源动作后调用，保持右键菜单显隐同步） */
  const refreshOneWidgetSourceState = useCallback((path: string) => {
    const read = window.electronAPI?.readTextFile
    if (!read) return
    read(sourcePathOf(path))
      .then((r) => {
        setWidgetSourceState((prev) => {
          const next = new Map(prev)
          next.set(path, Boolean(r.success && r.data))
          return next
        })
      })
      .catch(() => { /* 探测失败视为无源，维持现状 */ })
  }, [])

  /** 创建/操作成功后手动刷新资产列表（文件变化同时会触发 asset-changed → assetLint 自动重扫） */
  const refreshAssets = useCallback(() => {
    if (!currentProject) return
    const listProjectAssets = window.electronAPI?.listProjectAssets
    if (!listProjectAssets) return
    listProjectAssets(currentProject.folder)
      .then((result) => {
        setFiles(result)
        setAssetSelection(null)
      })
      .catch((e) => {
        logger.error(`[AssetBrowser] 刷新资产列表失败: ${String(e)}`)
      })
  }, [currentProject])

  /** 关闭菜单并复位创建输入态 */
  const closeMenu = useCallback(() => {
    setMenu(null)
    setCreating(null)
    setAssetName('')
  }, [])

  /** 确认创建：写入模板文件（重名拒绝），成功后刷新列表 */
  const confirmCreate = useCallback(async () => {
    if (!creating || !currentProject) return
    const base = assetName.trim()
    if (!base) return
    const filename = `${base.replace(/\s+/g, '_')}${creating.suffix}`
    const jsonName = base.replace(/\s+/g, '')
    const dirPart = creating.dirRelPath ? `/${creating.dirRelPath}` : ''
    const filePath = `src/projects/${currentProject.folder}/asset${dirPart}/${filename}`
    if (files.some((f) => f.path === filePath)) {
      logger.warn(`[AssetBrowser] 创建资产重名: ${filePath}`)
      addConsoleOutput(`❌ 创建失败: ${filename} 已存在于 asset${dirPart}/`)
      return
    }
    const write = window.electronAPI?.writeJsonFile
    if (!write) {
      logger.error('[AssetBrowser] 创建资产失败: writeJsonFile 不可用')
      addConsoleOutput('❌ 创建资产需要 Electron / Mock 环境')
      return
    }
    logger.info(`[AssetBrowser] 创建资产: ${filePath}（${creating.kind}）`)
    const res = await write(filePath, buildAssetTemplate(creating.kind, jsonName))
    if (res.success) {
      logger.info(`[AssetBrowser] 资产已创建: ${filePath}`)
      addConsoleOutput(`✅ 资产已创建: asset${dirPart}/${filename}`)
      closeMenu()
      refreshAssets()
    } else {
      logger.error(`[AssetBrowser] 创建资产失败 ${filePath}: ${res.error ?? '未知错误'}`)
      addConsoleOutput(`❌ 创建失败: ${res.error ?? '未知错误'}`)
    }
  }, [creating, currentProject, assetName, files, addConsoleOutput, closeMenu, refreshAssets])

  /** 确认重命名：rename → assetFileOps（重名拒绝），成功后清选中并刷新 */
  const confirmRename = useCallback(async () => {
    if (!renaming || !currentProject) return
    const next = renaming.name.trim()
    if (!next || next === renaming.name) {
      setRenaming(null)
      return
    }
    const dir = renaming.path.slice(0, renaming.path.lastIndexOf('/') + 1)
    const ops = window.electronAPI?.assetFileOps
    if (!ops) {
      logger.error('[AssetBrowser] 重命名失败: assetFileOps 不可用')
      addConsoleOutput('❌ 重命名需要 Electron / Mock 环境')
      setRenaming(null)
      return
    }
    if (files.some((f) => f.path === `${dir}${next}`)) {
      logger.warn(`[AssetBrowser] 重命名目标已存在: ${dir}${next}`)
      addConsoleOutput(`❌ 重命名失败: ${next} 已存在`)
      return
    }
    logger.info(`[AssetBrowser] 重命名资产: ${renaming.path} → ${next}`)
    const res = await ops('rename', renaming.path, next)
    if (res.success) {
      logger.info(`[AssetBrowser] 资产已重命名: ${renaming.path} → ${next}`)
      addConsoleOutput(`✅ 已重命名: ${renaming.name.slice(renaming.path.lastIndexOf('/') + 1)} → ${next}`)
      setRenaming(null)
      refreshAssets()
    } else {
      logger.error(`[AssetBrowser] 重命名失败 ${renaming.path}: ${res.error ?? '未知错误'}`)
      addConsoleOutput(`❌ 重命名失败: ${res.error ?? '未知错误'}`)
    }
  }, [renaming, currentProject, files, addConsoleOutput, refreshAssets])

  /** 删除资产：assetFileOps delete，成功后清选中并刷新 */
  const deleteAsset = useCallback(async (path: string, name: string) => {
    const ops = window.electronAPI?.assetFileOps
    if (!ops) {
      logger.error('[AssetBrowser] 删除资产失败: assetFileOps 不可用')
      addConsoleOutput('❌ 删除需要 Electron / Mock 环境')
      return
    }
    logger.info(`[AssetBrowser] 删除资产: ${path}`)
    const res = await ops('delete', path)
    if (res.success) {
      logger.info(`[AssetBrowser] 资产已删除: ${path}`)
      addConsoleOutput(`✅ 已删除: ${name}`)
      refreshAssets()
    } else {
      logger.error(`[AssetBrowser] 删除失败 ${path}: ${res.error ?? '未知错误'}`)
      addConsoleOutput(`❌ 删除失败: ${res.error ?? '未知错误'}`)
    }
  }, [addConsoleOutput, refreshAssets])

  /** 在系统文件管理器中定位资产文件 */
  const revealAsset = useCallback(async (path: string, name: string) => {
    const ops = window.electronAPI?.assetFileOps
    if (!ops) return
    logger.info(`[AssetBrowser] 在文件管理器中定位: ${path}`)
    const res = await ops('reveal', path)
    if (!res.success) {
      logger.error(`[AssetBrowser] 定位失败 ${path}: ${res.error ?? '未知错误'}`)
      addConsoleOutput(`❌ 定位失败: ${res.error ?? '未知错误'}`)
    }
  }, [addConsoleOutput])

  /** 复制资产绝对路径到剪贴板 */
  const copyAssetPath = useCallback(async (path: string) => {
    const ops = window.electronAPI?.assetFileOps
    if (!ops) return
    const res = await ops('copy-path', path)
    if (res.success) {
      logger.info(`[AssetBrowser] 已复制路径: ${path}`)
      addConsoleOutput(`✅ 已复制路径: ${path}`)
    } else {
      logger.error(`[AssetBrowser] 复制路径失败 ${path}: ${res.error ?? '未知错误'}`)
      addConsoleOutput(`❌ 复制路径失败: ${res.error ?? '未知错误'}`)
    }
  }, [addConsoleOutput])

  /** 编译 .widget.html 源 → 覆写 .widget.json（lint 零错误门槛，经 uiSourceActions 完整链路） */
  const compileSource = useCallback(async (path: string, name: string) => {
    logger.info(`[AssetBrowser] 编译 UI 源: ${path}`)
    const res = await compileUiSourceToAsset(path)
    refreshOneWidgetSourceState(path)
    if (res.ok) {
      logger.info(`[AssetBrowser] 编译成功: ${name}（assetLint 零错误）`)
      addConsoleOutput(`✅ 编译成功: ${name}（assetLint 零错误）`)
    } else {
      const detail = res.errors.map((e) => (e.line ? `行${e.line}: ${e.message}` : e.message)).join(' | ')
      const lintErr = res.lintIssues.filter((i) => i.severity === 'error').map((i) => `${i.nodePath}: ${i.message}`).join(' | ')
      logger.warn(`[AssetBrowser] 编译失败 ${path}: ${detail || lintErr}`)
      addConsoleOutput(`❌ 编译失败: ${detail || lintErr || '未知错误'}`)
    }
  }, [addConsoleOutput, refreshOneWidgetSourceState])

  /** 无源旧资产：反编译 widget.json → 生成 .widget.html（sourceHash 写回后保存链路可自动同步） */
  const generateSource = useCallback(async (path: string, name: string) => {
    const read = window.electronAPI?.readJsonFile
    const write = window.electronAPI?.writeTextFile
    if (!read || !write) {
      logger.error('[AssetBrowser] 生成源失败: readJsonFile/writeTextFile 不可用')
      addConsoleOutput('❌ 生成源需要 Electron / Mock 环境')
      return
    }
    try {
      logger.info(`[AssetBrowser] 生成 HTML 源: ${path}`)
      const r = await read(path)
      if (!r.success) throw new Error(String(r.error ?? '读取失败'))
      const doc = r.data as Record<string, unknown>
      const de = decompileWidgetJson(doc)
      if (!de.ok || !de.html) {
        throw new Error(de.warnings.join('; ') || '反编译失败')
      }
      // sourceHash 写回（保存链路同步/冲突检测依赖该指纹）
      doc.sourceHash = fnv1aSourceHash(de.html)
      const save = await window.electronAPI?.writeJsonFile(path, doc)
      if (!save?.success) throw new Error(String(save?.error ?? 'json 写回失败'))
      const srcPath = sourcePathOf(path)
      const wr = await write(srcPath, de.html)
      if (!wr.success) throw new Error(String(wr.error ?? '源文件写入失败'))
      refreshOneWidgetSourceState(path)
      logger.info(`[AssetBrowser] HTML 源已生成: ${srcPath}（${de.warnings.length} 个警告）`)
      addConsoleOutput(de.warnings.length > 0
        ? `✅ 已生成源: ${name.replace(/\.widget\.json$/i, '')}.widget.html（${de.warnings.length} 个警告，详见日志）`
        : `✅ 已生成源: ${name.replace(/\.widget\.json$/i, '')}.widget.html`)
    } catch (e) {
      const msg = (e as Error).message
      logger.error(`[AssetBrowser] 生成源失败 ${path}: ${msg}`)
      addConsoleOutput(`❌ 生成源失败: ${msg}`)
    }
  }, [addConsoleOutput, refreshOneWidgetSourceState])

  // 菜单/对话框键盘：Enter 确认 / Esc 关闭（capture 阶段先于 React 合成事件）；点击外部关闭
  const confirmCreateRef = useRef(confirmCreate)
  confirmCreateRef.current = confirmCreate
  const confirmRenameRef = useRef(confirmRename)
  confirmRenameRef.current = confirmRename
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeMenu()
        setRenaming(null)
      } else if (e.key === 'Enter') {
        if (renaming) {
          e.stopPropagation()
          confirmRenameRef.current()
        } else if (creating) {
          e.stopPropagation()
          confirmCreateRef.current()
        }
      }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t)) {
        closeMenu()
        setRenaming(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [creating, renaming, closeMenu])

  /** 打开右键菜单：文件右键带操作项，目录/空白右键仅创建区 */
  const openMenu = (e: React.MouseEvent, targetPath: string | null, targetName: string | null, dirRelPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCreating(null)
    setMenu({ x: e.clientX, y: e.clientY, dirRelPath, targetPath, targetName })
  }

  const tree = useMemo(() => {
    if (!currentProject) return []
    return buildTree(files, `src/projects/${currentProject.folder}/asset/`)
  }, [files, currentProject])

  /** 资产根前缀（带尾斜杠），用于从文件完整路径截取所在目录 */
  const assetPrefix = currentProject ? `src/projects/${currentProject.folder}/asset/` : ''

  const toggleDir = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleFileDoubleClick = (node: TreeNode) => {
    if (node.kind?.kind === 'scene') {
      const label = node.name.replace(/\.scene\.json$/i, '')
      openScenePreview(node.path, label)
    } else if (node.kind?.kind === 'blueprint' || node.kind?.kind === 'widget') {
      const label = node.name.replace(/\.(blueprint|widget)\.json$/i, '')
      openBlueprintEditor(node.path, label)
    } else if (node.kind?.kind === 'config') {
      const label = node.name.replace(/\.(config|table)\.json$/i, '')
      openConfigEditor(node.path, label)
    }
  }

  if (!currentProject) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
        请先选择一个项目
      </div>
    )
  }

  if (error) {
    return <div style={{ color: 'var(--error)', fontSize: 12, padding: 12 }}>{error}</div>
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px',
    cursor: 'pointer', color: 'var(--text-primary)', whiteSpace: 'nowrap',
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const key = node.isDir ? `dir:${node.path}` : node.path
    if (node.isDir) {
      const isOpen = !collapsed.has(key)
      return (
        <div key={key}>
          <div
            style={{ padding: '2px 4px', paddingLeft: 8 + depth * 14, cursor: 'pointer', color: 'var(--text-secondary)' }}
            onClick={() => toggleDir(key)}
            onContextMenu={(e) => openMenu(e, null, null, node.path)}
            title={`右键在 asset/${node.path} 下创建资产`}
          >
            {isOpen ? '📂 ' : '📁 '}{node.name}
          </div>
          {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }
    const isSelected = assetSelection?.path === node.path
    return (
      <div
        key={key}
        style={{
          padding: '2px 4px',
          paddingLeft: 8 + depth * 14,
          cursor: 'pointer',
          background: isSelected ? 'var(--accent)' : 'transparent',
          color: isSelected ? '#fff' : 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onClick={() => {
          // 资产信息改在 Inspector 展示；同时清空视口选中，保证 Inspector「最近操作优先」
          select(null)
          setAssetSelection(node.kind
            ? { kind: node.kind.kind, icon: node.kind.icon, path: node.path, name: node.name, size: node.size ?? 0 }
            : null)
        }}
        onDoubleClick={() => handleFileDoubleClick(node)}
        onContextMenu={(e) => {
          // 文件右键：菜单含文件操作项；创建区落在其所在目录（截取父目录相对 asset/ 的路径）
          const parentRel = assetPrefix ? node.path.slice(assetPrefix.length, node.path.lastIndexOf('/')) : ''
          openMenu(e, node.path, node.name, parentRel)
        }}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        title={node.path}
      >
        {node.kind?.icon} {node.name}
      </div>
    )
  }

  // 视口边界钳制：菜单不超出窗口右下角
  const clampedMenuX = menu ? Math.min(menu.x, window.innerWidth - 210) : 0
  const clampedMenuY = menu ? Math.min(menu.y, window.innerHeight - 280) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onContextMenu={(e) => openMenu(e, null, null, '')}>
      <div style={{ fontSize: 11, fontFamily: 'monospace', flex: 1, overflow: 'auto' }}>
        {tree.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            暂无资产文件（右键空白处创建）
          </div>
        ) : (
          tree.map((n) => renderNode(n, 0))
        )}
      </div>
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: clampedMenuX,
            top: clampedMenuY,
            zIndex: 10000,
            minWidth: 190,
            padding: '4px 0',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            fontSize: 12,
            userSelect: 'none',
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.targetPath ? (
            <>
              <div style={{ padding: '3px 14px 2px', fontSize: 10, color: 'var(--text-dim)', cursor: 'default', wordBreak: 'break-all' }}>
                {menu.targetName}
              </div>
              <div style={{ height: 1, margin: '4px 8px', background: 'var(--border)' }} />
              {menu.targetPath!.endsWith('.widget.json') && widgetSourceState.get(menu.targetPath!) && (
                <div
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  onClick={() => { const p = menu.targetPath!, n = menu.targetName!; closeMenu(); compileSource(p, n) }}
                >
                  <span>🔨 编译 UI 源</span>
                </div>
              )}
              {menu.targetPath!.endsWith('.widget.json') && !widgetSourceState.get(menu.targetPath!) && (
                <div
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  onClick={() => { const p = menu.targetPath!, n = menu.targetName!; closeMenu(); generateSource(p, n) }}
                >
                  <span>🛠️ 生成 HTML 源</span>
                </div>
              )}
              <div
                style={menuItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { setRenaming({ path: menu.targetPath!, name: menu.targetName! }); closeMenu() }}
              >
                <span>重命名</span>
              </div>
              <div
                style={menuItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { const p = menu.targetPath!, n = menu.targetName!; closeMenu(); revealAsset(p, n) }}
              >
                <span>在文件管理器中显示</span>
              </div>
              <div
                style={menuItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { const p = menu.targetPath!; closeMenu(); copyAssetPath(p) }}
              >
                <span>复制路径</span>
              </div>
              <div style={{ height: 1, margin: '4px 8px', background: 'var(--border)' }} />
              <div
                style={{ ...menuItemStyle, color: 'var(--error)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { const p = menu.targetPath!, n = menu.targetName!; closeMenu(); deleteAsset(p, n) }}
              >
                <span>删除</span>
              </div>
              <div style={{ height: 1, margin: '4px 8px', background: 'var(--border)' }} />
            </>
          ) : null}
          <div style={{ padding: '3px 14px 2px', fontSize: 10, color: 'var(--accent)', fontWeight: 600, cursor: 'default', wordBreak: 'break-all' }}>
            创建资产 → asset/{menu.dirRelPath}
          </div>
          <div style={{ height: 1, margin: '4px 8px', background: 'var(--border)' }} />
          {creating ? (
            <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                autoFocus
                value={assetName}
                placeholder={`${creating.label}名`}
                onChange={(e) => setAssetName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter/Esc 由全局 keydown（capture）处理；此处仅阻断默认行为与冒泡
                  if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  minWidth: 110,
                  padding: '3px 6px',
                  fontSize: 12,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent)',
                  borderRadius: 3,
                  outline: 'none',
                }}
              />
              <span
                style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => confirmCreateRef.current()}
              >
                创建
              </span>
            </div>
          ) : (
            CREATE_KINDS.map((k) => (
              <div
                key={k.kind}
                style={menuItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { setAssetName(''); setCreating({ ...k, dirRelPath: menu.dirRelPath }) }}
              >
                <span>{k.label}</span>
              </div>
            ))
          )}
        </div>
      )}
      {renaming && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setRenaming(null) }}>
          <div
            style={{ minWidth: 300, padding: 14, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', userSelect: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>重命名资产</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, wordBreak: 'break-all' }}>{renaming.path.slice(renaming.path.lastIndexOf('/') + 1)}</div>
            <input
              autoFocus
              value={renaming.name}
              placeholder="新文件名（含后缀）"
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={(e) => {
                // Enter/Esc 由全局 keydown（capture）处理；此处仅阻断默认行为与冒泡
                if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 4, outline: 'none', fontFamily: 'monospace' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <span style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 4 }} onClick={() => setRenaming(null)}>取消</span>
              <span style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: '#fff', background: 'var(--accent)', borderRadius: 4 }} onClick={() => confirmRenameRef.current()}>确定</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
