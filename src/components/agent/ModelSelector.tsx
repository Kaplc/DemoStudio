/**
 * ModelSelector - 模型选择器
 *
 * 两级选择：Provider 分组 → 具体模型
 * 支持 reasoning effort 选择
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { agentService, type ModelGroup, type ModelInfo } from '../../editor/AgentService'

interface ModelSelectorProps {
  /** 当前选中的模型（null = 尚未加载/未知） */
  currentModel?: { provider: string; model: string } | null
  /** 模型切换回调 */
  onModelChange?: (provider: string, model: string) => void
  /** 是否禁用 */
  disabled?: boolean
}

/** 选择面板状态 */
type Pane = 'root' | 'model' | 'effort'

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  onModelChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [groups, setGroups] = useState<ModelGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    currentModel?.provider || null
  )
  const [selectedModel, setSelectedModel] = useState<string | null>(
    currentModel?.model || null
  )
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined)
  // 从 Host 的 current 恢复 effort（首次加载时）
  const initEffortDone = useRef(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 加载模型列表
  const loadModels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await agentService.getModels()
      setGroups(result.groups)
      
      // 使用 Host 返回的当前选择初始化
      if (result.current) {
        setSelectedProvider(result.current.provider)
        setSelectedModel(result.current.model)
        // 从 Host 恢复 reasoning effort（仅首次）
        if (!initEffortDone.current && result.current.reasoningEffort) {
          setSelectedEffort(result.current.reasoningEffort)
          initEffortDone.current = true
        }
        onModelChange?.(result.current.provider, result.current.model)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载模型失败')
    } finally {
      setLoading(false)
    }
  }, [onModelChange])

  // 初始化时加载模型列表（从 Host 获取当前选择）
  useEffect(() => {
    loadModels()
  }, [loadModels])

  // 打开时刷新
  useEffect(() => {
    if (open) {
      loadModels()
    }
  }, [open, loadModels])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPane('root')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // 键盘导航
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pane !== 'root') {
          setPane('root')
        } else {
          setOpen(false)
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, pane])

  // 选择模型
  const handleSelectModel = useCallback(async (provider: string, model: string) => {
    setSelectedProvider(provider)
    setSelectedModel(model)

    // 查找模型的 reasoning 信息
    const group = groups.find(g => g.id === provider)
    const modelInfo = group?.models.find(m => m.id === model)
    
    console.log(`[ModelSelector] 选择模型: provider=${provider}, model=${model}, group=${group?.name}, modelInfo=`, modelInfo)
    
    if (modelInfo?.reasoning?.efforts && modelInfo.reasoning.efforts.length > 0) {
      // 有 reasoning 选项，显示 effort 选择
      setPane('effort')
    } else {
      // 没有 reasoning 选项，直接提交
      try {
        console.log(`[ModelSelector] 调用 selectModel: provider=${provider}, model=${model}`)
        await agentService.selectModel(provider, model)
        console.log(`[ModelSelector] selectModel 成功`)
        onModelChange?.(provider, model)
        setOpen(false)
        setPane('root')
      } catch (err) {
        console.error(`[ModelSelector] selectModel 失败:`, err)
        setError(err instanceof Error ? err.message : '切换模型失败')
      }
    }
  }, [groups, onModelChange])

  // 选择 effort
  const handleSelectEffort = useCallback(async (effort: string | undefined) => {
    if (!selectedProvider || !selectedModel) return
    setSelectedEffort(effort)

    console.log(`[ModelSelector] 选择 effort: provider=${selectedProvider}, model=${selectedModel}, effort=${effort}`)
    try {
      await agentService.selectModel(selectedProvider, selectedModel, effort)
      console.log(`[ModelSelector] selectModel with effort 成功`)
      onModelChange?.(selectedProvider, selectedModel)
      setOpen(false)
      setPane('root')
    } catch (err) {
      console.error(`[ModelSelector] selectModel with effort 失败:`, err)
      setError(err instanceof Error ? err.message : '切换模型失败')
    }
  }, [selectedProvider, selectedModel, onModelChange])

  // 获取当前模型的显示名称
  const getDisplayName = () => {
    if (!currentModel) return '选择模型'
    const group = groups.find(g => g.id === currentModel.provider)
    const model = group?.models.find(m => m.id === currentModel.model)
    return model?.name || currentModel.model
  }

  // 获取当前 effort 标签
  const getEffortLabel = () => {
    if (!currentModel) return undefined
    const group = groups.find(g => g.id === currentModel.provider)
    const model = group?.models.find(m => m.id === currentModel.model)
    if (!model?.reasoning) return undefined
    const effort = selectedEffort ?? model.reasoning.defaultEffort
    if (effort === undefined) return undefined
    return model.reasoning.efforts.find(e => e.id === effort)?.name ?? effort
  }

  // 获取触发器显示文本
  const getTriggerLabel = () => {
    const modelName = getDisplayName()
    const effortLabel = getEffortLabel()
    return effortLabel ? `${modelName} · ${effortLabel}` : modelName
  }

  // 获取当前选中的模型信息
  const getCurrentModelInfo = (): ModelInfo | null => {
    if (!selectedProvider || !selectedModel) return null
    const group = groups.find(g => g.id === selectedProvider)
    return group?.models.find(m => m.id === selectedModel) || null
  }

  return (
    <div className="model-selector" ref={rootRef}>
      {/* 触发按钮 */}
      <button
        ref={triggerRef}
        className={`model-selector__trigger ${open ? 'active' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        title={getTriggerLabel()}
      >
        <span className="model-selector__label">{getDisplayName()}</span>
        {getEffortLabel() && (
          <span className="model-selector__trigger-effort">{getEffortLabel()}</span>
        )}
        <span className={`model-selector__chevron ${open ? 'open' : ''}`}>▾</span>
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="model-selector__dropdown">
          {/* 根面板：模型 + 推理强度 两个入口 */}
          {pane === 'root' && (
            <div className="model-selector__pane">
              <div className="model-selector__header">
                <span>选择模型</span>
                <button
                  className="model-selector__refresh"
                  onClick={loadModels}
                  disabled={loading}
                  title="刷新"
                >
                  ↻
                </button>
              </div>

              {loading && (
                <div className="model-selector__loading">加载中...</div>
              )}

              {error && (
                <div className="model-selector__error">
                  {error}
                  <button onClick={loadModels}>重试</button>
                </div>
              )}

              {/* 模型入口 */}
              <button
                className="model-selector__cell"
                onClick={() => setPane('model')}
              >
                <span className="model-selector__cell-label">模型</span>
                <span className="model-selector__cell-value">{getDisplayName()}</span>
                <span className="model-selector__cell-chevron">›</span>
              </button>

              {/* 推理强度入口（仅当模型有 reasoning 时显示） */}
              {getCurrentModelInfo()?.reasoning && (
                <button
                  className="model-selector__cell"
                  onClick={() => setPane('effort')}
                >
                  <span className="model-selector__cell-label">推理强度</span>
                  <span className="model-selector__cell-value">
                    {getEffortLabel() || '默认'}
                  </span>
                  <span className="model-selector__cell-chevron">›</span>
                </button>
              )}
            </div>
          )}

          {/* 模型列表面板 */}
          {pane === 'model' && (
            <div className="model-selector__pane">
              <div className="model-selector__header">
                <button
                  className="model-selector__back"
                  onClick={() => setPane('root')}
                >
                  ←
                </button>
                <span>选择模型</span>
              </div>

              {groups.map((group) => (
                <div key={group.id} className="model-selector__group">
                  <div className="model-selector__group-name">
                    {group.name || group.id}
                  </div>
                  {group.models.map((model) => (
                    <button
                      key={model.id}
                      className={`model-selector__item ${
                        selectedProvider === group.id && selectedModel === model.id
                          ? 'selected'
                          : ''
                      }`}
                      onClick={() => handleSelectModel(group.id, model.id)}
                    >
                      <span className="model-selector__item-name">
                        {model.name || model.id}
                      </span>
                      {selectedProvider === group.id && selectedModel === model.id && (
                        <span className="model-selector__item-check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}

              {groups.length === 0 && !loading && !error && (
                <div className="model-selector__empty">
                  暂无可用模型
                </div>
              )}
            </div>
          )}

          {/* Effort 选择面板 */}
          {pane === 'effort' && (
            <div className="model-selector__pane">
              <div className="model-selector__header">
                <button
                  className="model-selector__back"
                  onClick={() => setPane('root')}
                >
                  ←
                </button>
                <span>推理强度</span>
              </div>

              <div className="model-selector__effort-list">
                <button
                  className={`model-selector__item ${selectedEffort === undefined ? 'selected' : ''}`}
                  onClick={() => handleSelectEffort(undefined)}
                >
                  <span className="model-selector__item-name">默认</span>
                  <span className="model-selector__item-desc">使用 Provider 默认设置</span>
                </button>

                {getCurrentModelInfo()?.reasoning?.efforts.map((effort) => (
                  <button
                    key={effort.id}
                    className={`model-selector__item ${selectedEffort === effort.id ? 'selected' : ''}`}
                    onClick={() => handleSelectEffort(effort.id)}
                  >
                    <span className="model-selector__item-name">{effort.name}</span>
                    {effort.description && (
                      <span className="model-selector__item-desc">{effort.description}</span>
                    )}
                    {selectedEffort === effort.id && (
                      <span className="model-selector__item-check">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
