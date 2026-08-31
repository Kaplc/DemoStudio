/**
 * KernelUpdateModal - DSH 内核版本管理浮动窗口
 *
 * 展示当前版本 + npm 最新版本，用户可一键更新到最新版
 * 自动从 npm registry 获取最新版本并显示
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
  const [latestNpm, setLatestNpm] = useState('')
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

  // 加载版本信息
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
      setLatestNpm(result.latestNpm || '')
      setPhase('ready')
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }, [])

  useEffect(() => { loadVersions() }, [loadVersions])

  // 更新到最新版本
  const handleUpdate = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.dshSwitchVersion || !latestNpm) return
    setSwitchingTarget(latestNpm)
    setPhase('switching')
    setProgressStep('checkout')
    setProgressDetail(`正在切换到 ${latestNpm}...`)
    setError('')
    try {
      await api.dshSwitchVersion(latestNpm)
    } catch (err) {
      setPhase('error')
      setError(String(err))
    }
  }, [latestNpm])

  // 归一化版本号：去掉 dsh-v/dsh- 前缀等本地 tag 特有格式
  const normalizeVersion = (v: string) => v.replace(/^dsh-v?/i, '').trim()

  // 判断当前版本是否就是最新 npm 版本（归一化后比较）
  const isCurrentLatest = !!latestNpm && normalizeVersion(currentVersion) === normalizeVersion(latestNpm)

  return (
    <div className="kernel-update-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kernel-update-modal">
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

          {/* npm 最新版本提示 */}
          {phase === 'ready' && latestNpm && !isCurrentLatest && (
            <div className="kernel-npm-latest">
              <span className="kernel-npm-latest-icon">⬆</span>
              <span>最新版本：<strong>{latestNpm}</strong></span>
              <button
                className="kernel-update-btn kernel-update-btn--primary"
                onClick={handleUpdate}
              >
                更新到此版本
              </button>
            </div>
          )}

          {/* 已是最新 */}
          {phase === 'ready' && latestNpm && isCurrentLatest && (
            <div className="kernel-npm-latest kernel-npm-latest--current">
              <span className="kernel-npm-latest-icon">✓</span>
              <span>当前已是最新版本</span>
            </div>
          )}

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

          {/* 加载中 */}
          {phase === 'loading' && (
            <div className="kernel-version-loading">正在获取版本信息...</div>
          )}
        </div>
      </div>
    </div>
  )
}
