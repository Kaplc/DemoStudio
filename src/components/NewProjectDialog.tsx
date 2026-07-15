import React, { useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import type { Project } from '../stores/editorStore'

export function NewProjectDialog() {
  const { showNewProjectDialog, setShowNewProjectDialog, addConsoleOutput } = useEditorStore()
  const { projects, setProjects } = useProjectStore()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!showNewProjectDialog) return null

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入工程名称')
      return
    }
    if (!/^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9\u4e00-\u9fa5_-]*$/.test(trimmed)) {
      setError('工程名只能包含字母、中文、数字、下划线和连字符')
      return
    }
    if (projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('工程名已存在')
      return
    }

    setCreating(true)
    setError(null)

    try {
      // 通过 IPC 创建目录和模板文件
      let result: { success: boolean; error?: string; path?: string }
      if (window.electronAPI?.createProject) {
        result = await window.electronAPI.createProject(trimmed)
      } else {
        // 非 Electron 环境（开发测试）
        result = { success: true }
      }

      if (result.success) {
        const newProject: Project = {
          name: trimmed,
          description: `${trimmed} 游戏项目`,
          version: '1.0.0',
          tags: ['game'],
          folder: trimmed.toLowerCase(),
        }
        setProjects([...projects, newProject])
        addConsoleOutput(`✅ 工程 "${trimmed}" 已创建`)
        setShowNewProjectDialog(false)
        setName('')
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
