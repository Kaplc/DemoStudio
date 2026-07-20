import React, { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'

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
  { re: /\.config\.json$/i, kind: 'config', icon: '⚙️' },
  { re: /\.(png|jpe?g|gif|svg)$/i, kind: 'image', icon: '🖼️' },
]

/** 按文件名匹配资产类型；不在白名单返回 null（project.json、其他 json、代码等不显示） */
function classify(filename: string): AssetKind | null {
  for (const p of ASSET_PATTERNS) {
    if (p.re.test(filename)) return p
  }
  return null
}

interface TreeNode {
  name: string
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
          dir = { name: part, path: '', isDir: true, children: [] }
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

function formatSize(size: number): string {
  if (size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function AssetBrowser() {
  const currentProject = useEditorStore((s) => s.currentProject)
  const openScenePreview = useEditorStore((s) => s.openScenePreview)
  const openBlueprintEditor = useEditorStore((s) => s.openBlueprintEditor)

  const [files, setFiles] = useState<AssetFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<TreeNode | null>(null)
  /** 折叠的目录 key 集合（默认全展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentProject) {
      setFiles([])
      setSelected(null)
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
          setSelected(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => { cancelled = true }
  }, [currentProject])

  const tree = useMemo(() => {
    if (!currentProject) return []
    return buildTree(files, `src/projects/${currentProject.folder}/asset/`)
  }, [files, currentProject])

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
    } else if (node.kind?.kind === 'blueprint') {
      const label = node.name.replace(/\.blueprint\.json$/i, '')
      openBlueprintEditor(node.path, label)
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

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const key = node.path || `d${depth}/${node.name}`
    if (node.isDir) {
      const isOpen = !collapsed.has(key)
      return (
        <div key={key}>
          <div
            style={{ padding: '2px 4px', paddingLeft: 8 + depth * 14, cursor: 'pointer', color: 'var(--text-secondary)' }}
            onClick={() => toggleDir(key)}
          >
            {isOpen ? '📂 ' : '📁 '}{node.name}
          </div>
          {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }
    const isSelected = selected?.path === node.path
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
        onClick={() => setSelected(node)}
        onDoubleClick={() => handleFileDoubleClick(node)}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        title={node.path}
      >
        {node.kind?.icon} {node.name}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontSize: 11, fontFamily: 'monospace', flex: 1, overflow: 'auto' }}>
        {tree.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
            暂无资产文件
          </div>
        ) : (
          tree.map((n) => renderNode(n, 0))
        )}
      </div>
      {selected && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px', fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-tertiary)' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {selected.kind?.icon} {selected.kind?.kind}
          </div>
          <div style={{ wordBreak: 'break-all' }}>{selected.path}</div>
          <div>大小: {formatSize(selected.size ?? 0)}</div>
        </div>
      )}
    </div>
  )
}
