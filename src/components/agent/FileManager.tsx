/**
 * FileManager - 通用文件管理面板
 *
 * 用于记忆管理（.dsh/memory/）和经验管理（.dsh/experience/）
 * 支持：文件列表、内容查看/编辑、保存、复制路径
 */
import React, { useState, useEffect, useCallback } from 'react'

interface FileManagerProps {
  /** 面板标题 */
  title: string
  /** 目录的相对路径（相对于项目根，如 '.dsh/memory'） */
  dirPath: string
  /** 是否显示 */
  visible: boolean
  /** 关闭回调 */
  onClose: () => void
}

interface FileInfo {
  name: string
  size: number
  mtime: number
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化时间 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const FileManager: React.FC<FileManagerProps> = ({ title, dirPath, visible, onClose }) => {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const api = (window as any).electronAPI
      const result = await api?.listDirFiles(dirPath)
      if (result?.success) {
        setFiles(result.data)
      } else {
        setError(result?.error || '加载失败')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [dirPath])

  useEffect(() => {
    if (visible) {
      loadFiles()
      setSelectedFile(null)
      setFileContent('')
      setEditing(false)
    }
  }, [visible, loadFiles])

  // 加载文件内容
  const loadFile = useCallback(async (fileName: string) => {
    setSelectedFile(fileName)
    setEditing(false)
    setSaveMsg(null)
    try {
      const api = (window as any).electronAPI
      const result = await api?.readTextFile(`${dirPath}/${fileName}`)
      if (result?.success) {
        setFileContent(result.data)
      } else {
        setFileContent(`读取失败: ${result?.error}`)
      }
    } catch (err) {
      setFileContent(`读取失败: ${String(err)}`)
    }
  }, [dirPath])

  // 保存文件
  const saveFile = useCallback(async () => {
    if (!selectedFile) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const api = (window as any).electronAPI
      const result = await api?.writeTextFile(`${dirPath}/${selectedFile}`, editContent)
      if (result?.success) {
        setFileContent(editContent)
        setEditing(false)
        setSaveMsg('已保存')
        loadFiles() // 刷新列表（mtime 变了）
      } else {
        setSaveMsg(`保存失败: ${result?.error}`)
      }
    } catch (err) {
      setSaveMsg(`保存失败: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [selectedFile, editContent, dirPath, loadFiles])

  // 复制完整路径
  const copyPath = useCallback(async () => {
    if (!selectedFile) return
    try {
      const api = (window as any).electronAPI
      const info = await api?.getAppInfo()
      const fullPath = `${info?.appRoot || '.'}/${dirPath}/${selectedFile}`
      await navigator.clipboard.writeText(fullPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const fullPath = `${dirPath}/${selectedFile}`
      await navigator.clipboard.writeText(fullPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [selectedFile, dirPath])

  if (!visible) return null

  return (
    <div className="file-manager-overlay" onClick={onClose}>
      <div className="file-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-manager-header">
          <h3>{title}</h3>
          <button className="file-manager-close" onClick={onClose}>×</button>
        </div>
        <div className="file-manager-body">
          {/* 左侧文件列表 */}
          <div className="file-manager-sidebar">
            <div className="file-manager-sidebar-header">
              <span className="file-manager-count">{files.length} 个文件</span>
              <button className="file-manager-refresh" onClick={loadFiles} title="刷新">↻</button>
            </div>
            {loading && <div className="file-manager-loading">加载中...</div>}
            {error && <div className="file-manager-error">{error}</div>}
            <div className="file-manager-file-list">
              {files.map(file => (
                <div
                  key={file.name}
                  className={`file-manager-file-item ${selectedFile === file.name ? 'active' : ''}`}
                  onClick={() => loadFile(file.name)}
                >
                  <span className="file-manager-file-name">{file.name.replace(/\.md$/, '')}</span>
                  <span className="file-manager-file-meta">{formatTime(file.mtime)}</span>
                </div>
              ))}
              {!loading && files.length === 0 && (
                <div className="file-manager-empty">暂无文件</div>
              )}
            </div>
          </div>

          {/* 右侧内容区 */}
          <div className="file-manager-content">
            {selectedFile ? (
              <>
                <div className="file-manager-content-header">
                  <span className="file-manager-content-title">{selectedFile}</span>
                  <div className="file-manager-content-actions">
                    <button
                      className="file-manager-btn"
                      onClick={copyPath}
                      title="复制完整路径"
                    >
                      {copied ? '已复制' : '复制路径'}
                    </button>
                    {!editing ? (
                      <button
                        className="file-manager-btn file-manager-btn-primary"
                        onClick={() => { setEditContent(fileContent); setEditing(true) }}
                      >
                        编辑
                      </button>
                    ) : (
                      <>
                        <button
                          className="file-manager-btn file-manager-btn-primary"
                          onClick={saveFile}
                          disabled={saving}
                        >
                          {saving ? '保存中...' : '保存'}
                        </button>
                        <button
                          className="file-manager-btn"
                          onClick={() => setEditing(false)}
                        >
                          取消
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {saveMsg && (
                  <div className={`file-manager-save-msg ${saveMsg.includes('失败') ? 'error' : 'success'}`}>
                    {saveMsg}
                  </div>
                )}
                <textarea
                  className="file-manager-editor"
                  value={editing ? editContent : fileContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  readOnly={!editing}
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="file-manager-placeholder">
                <div className="file-manager-placeholder-icon"></div>
                <div>选择左侧文件查看内容</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
