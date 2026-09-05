import React, { useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { validateProjectName } from '../editor'

type ProjectMode = '2d' | '3d'

export function NewProjectDialog() {
  const { showNewProjectDialog, setShowNewProjectDialog, addConsoleOutput } = useEditorStore()
  const { projects, discoverProjects } = useProjectStore()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<ProjectMode>('3d')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!showNewProjectDialog) return null

  const handleCreate = async () => {
    const validation = validateProjectName(name, projects.map((p) => p.name))
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    setCreating(true)
    setError(null)

    try {
      // 通过 IPC 创建目录和模板文件
      const projectName = name.trim()
      let result: { success: boolean; error?: string; path?: string }
      if (window.electronAPI?.createProject) {
        result = await window.electronAPI.createProject(projectName, mode)
      } else {
        // 非 Electron 环境（开发测试）
        result = { success: true }
      }

      if (result.success) {
        // 不自动进入工程：新建会触发 vite 对新 register.ts 的热重载（整页刷新 →
        // discoverProjects 重新扫描，拿到带 defaultScene/source 的完整工程条目），
        // 用户从工程列表点"打开工程"进入，避免用内存里的残缺条目（无 defaultScene）进编辑器
        addConsoleOutput(`✅ 工程 "${projectName}" (${mode.toUpperCase()}) 已创建，热重载后从工程列表打开`)
        setShowNewProjectDialog(false)
        setName('')
        setMode('3d')
        // 热重载未触发时（如打包环境无 vite）也要刷新列表；dev 下随后被整页刷新覆盖，无副作用
        void discoverProjects()
      } else {
        setError(result.error || '创建失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleClose = () => {
    if (!creating) {
      setShowNewProjectDialog(false)
      setName('')
      setMode('3d')
      setError(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !creating) {
      handleCreate()
    } else if (e.key === 'Escape') {
      handleClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">新建工程</div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            工程名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            onKeyDown={handleKeyDown}
            placeholder="输入工程名称..."
            autoFocus
            disabled={creating}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {error && (
            <div style={{ color: '#f44336', fontSize: 12, marginTop: 6 }}>{error}</div>
          )}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            渲染模式
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['3d', '2d'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={creating}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: `1px solid ${mode === m ? 'var(--accent, #4a90d9)' : 'var(--border)'}`,
                  background: mode === m ? 'var(--accent, #4a90d9)' : 'var(--bg-tertiary)',
                  color: mode === m ? '#fff' : 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: creating ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              >
                {m === '3d' ? '3D 透视' : '2D 正交'}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={handleClose} disabled={creating}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
