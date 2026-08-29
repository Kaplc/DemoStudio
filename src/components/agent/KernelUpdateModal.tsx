/**
 * KernelUpdateModal - DSH 内核版本管理浮动窗口
 *
 * 展示当前版本 + 可用 tag 列表，用户手动选择切换
 * 支持版本回退：选择任意 tag 即可切回旧版
 */
import React, { useState, useEffect, useCallback } from 'react'

interface KernelUpdateModalProps {
  onClose: () => void
  onVersionChanged?: () => void
}

type UpdatePhase = 'loading' | 'ready' | 'switching' | 'done' | 'error'

const STEP_LABELS: Record<string, string> = {
  checkout: '切换版本...',
  install: '安装依赖...',
  build: '构建内核...',
  restart: '重启服务...',
  done: '完成！',
  error: '失败',
}

export const KernelUpdateModal: React.FC<KernelUpdateModalProps> = ({ onClose, onVersionChanged }) => {
  const [phase, setPhase] = useState<UpdatePhase>('loading')
  const [currentVersion, setCurrentVersion] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState('')
  const [switchingTarget, setSwitchingTarget] = useState('')
  const [progressStep, setProgressStep] = useState('')
  const [progressDetail, setProgressDetail] = useState('')

  // 监听切换进度
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onDshUpdateProgress) return
    const unsub = api.onDshUpdateProgress((progress) => {
      setProgressStep(progress.step)
      setProgressDetail(progress.detail || '')
      if (progress.step === 'done') {
        setPhase('done')
        onVersionChanged?.()
      } else if (progress.step === 'error') {
        setPhase('error')
        setError(progress.detail || '未知错误')
      }
    })
    return unsub
  }, [onVersionChanged])

  // 加载版本列表
  const loadVersions = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.dshListVersions) return
    setPhase('loading')
    try {
      const result = await api.dshListVersions()
      if (result.error) {
        setPhase('error')
        setError(result.error)
        return
      }
      setCurrentVersion(result.current)
      setTags(result.tags)
      setPhase('ready')
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }, [])

  useEffect(() => { loadVersions() }, [loadVersions])

  // 切换版本
  const handleSwitch = useCallback(async (target: string) => {
    const api = window.electronAPI
    if (!api?.dshSwitchVersion) return
    setSwitchingTarget(target)
    setPhase('switching')
    setProgressStep('checkout')
    setProgressDetail(`正在切换到 ${target}...`)
    setError('')
    try {
      await api.dshSwitchVersion(target)
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }, [])

  return (
    <div className="kernel-update-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kernel-update-modal kernel-update-modal--wide">
        <div className="kernel-update-header">
          <span className="kernel-update-title">DSH 内核版本管理</span>
          <button className="kernel-update-close" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="kernel-update-body">
          {/* 当前版本 */}
          <div className="kernel-version-current">
            <span className="kernel-version-label">当前版本</span>
            <span className="kernel-version-hash">{currentVersion || '...'}</span>
          </div>

          {/* 切换中进度 */}
          {phase === 'switching' && (
            <div className="kernel-switch-progress">
              <div className="kernel-update-progress-bar">
                <div className="kernel-update-progress-fill kernel-update-progress-fill--indeterminate" />
              </div>
              <div className="kernel-update-step">
                <span className="kernel-update-step-dot active" />
                <span className="kernel-update-step-label">
                  {STEP_LABELS[progressStep] || progressStep}
                </span>
              </div>
              {progressDetail && (
                <div className="kernel-update-detail">{progressDetail}</div>
              )}
            </div>
          )}

          {/* 完成 */}
          {phase === 'done' && (
            <div className="kernel-switch-done">
              <span className="kernel-update-step-dot success" />
              <span>已切换到 {switchingTarget}，重启 Agent 后生效</span>
            </div>
          )}

          {/* 错误 */}
          {phase === 'error' && (
            <div className="kernel-update-error">{error}</div>
          )}

          {/* Tag 列表 */}
          {phase !== 'switching' && tags.length > 0 && (
            <div className="kernel-version-section">
              <div className="kernel-version-section-title">Tag 版本</div>
              <div className="kernel-version-list">
                {tags.map(tag => (
                  <div
                    key={tag}
                    className={`kernel-version-item ${tag === currentVersion ? 'kernel-version-item--current' : ''}`}
                    onClick={() => { if (tag !== currentVersion && phase === 'ready') handleSwitch(tag) }}
                  >
                    <span className="kernel-version-tag">{tag}</span>
                    {tag === currentVersion && <span className="kernel-version-badge">当前</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 加载中 */}
          {phase === 'loading' && (
            <div className="kernel-version-loading">正在加载版本列表...</div>
          )}
        </div>
      </div>
    </div>
  )
}
