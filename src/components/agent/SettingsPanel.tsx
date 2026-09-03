/**
 * SettingsPanel - Agent 设置面板
 *
 * 包含：
 * - API Key 配置（按 Provider 分组）
 * - 模型设置
 * - 连接状态
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  agentService,
  type CredentialInfo,
  type ProviderInfo,
  type SettingsDescribeResult,
} from '../../editor/AgentService'

interface SettingsPanelProps {
  /** 是否显示 */
  visible: boolean
  /** 关闭回调 */
  onClose: () => void
}

/** Provider 配置状态 */
interface ProviderConfig {
  id: string
  name: string
  configured: boolean
  apiKeyEnv?: string
  hasApiKey: boolean
  isCustom?: boolean
  baseURL?: string
  api?: string
  models?: string[]
}

/** 新增自定义第三方 Provider 表单数据 */
interface CustomProviderForm {
  id: string
  displayName: string
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  baseURL: string
  apiKey: string
  models: string // 逗号或换行分隔
}

const INITIAL_CUSTOM_FORM: CustomProviderForm = {
  id: '',
  displayName: '',
  api: 'openai-completions',
  baseURL: '',
  apiKey: '',
  models: '',
}

/** API Key 验证结果 */
type ApiKeyValidation = 'valid' | 'empty' | 'invalid' | 'env-var'

/** 验证 API Key 格式 */
function validateApiKey(value: string): ApiKeyValidation {
  if (!value.trim()) return 'empty'
  // 检查是否是环境变量格式
  if (/^[A-Z][A-Z0-9_]*=[^=]/.test(value)) return 'env-var'
  // 检查是否是合法字符（可打印 ASCII，不含空格）
  if (!/^[\x21-\x7E]+$/.test(value)) return 'invalid'
  return 'valid'
}

/** 推导凭证引用名 */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ visible, onClose }) => {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [credentials, setCredentials] = useState<CredentialInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  // 自定义第三方 Provider 相关状态
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customForm, setCustomForm] = useState<CustomProviderForm>(INITIAL_CUSTOM_FORM)

  // 加载 Provider 和凭证信息
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 先获取 Provider 列表与 settings.describe
      const [providerList, settingsDesc] = await Promise.all([
        agentService.getLlmProviders(),
        agentService.describeSettings('llm-pi-ai').catch(() => ({ namespaces: [] } as SettingsDescribeResult)),
      ])

      // 提取已在 llm-pi-ai 中声明或自定义的 providers 配置
      const piAiNs = settingsDesc.namespaces?.find(n => n.ns === 'llm-pi-ai')
      const userProviders = (piAiNs?.user as any)?.providers || {}

      // 从 Provider 推导凭证引用名
      const refs = providerList
        .map(p => {
          const custom = userProviders[p.provider]
          return custom?.apiKeyEnv || deriveKeyRef(p.provider)
        })
        .filter(ref => ref.length > 0)

      // 查询凭证状态
      const credentialMap = refs.length > 0
        ? await agentService.describeCredentials(refs)
        : {}

      // 合并 Provider 和凭证信息
      const configs: ProviderConfig[] = providerList.map(p => {
        const custom = userProviders[p.provider]
        const keyRef = custom?.apiKeyEnv || deriveKeyRef(p.provider)
        const cred = credentialMap[keyRef]
        const isCustom = Boolean(custom && (custom.baseURL || p.declared))
        const models = Array.isArray(custom?.models)
          ? custom.models.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
          : undefined

        return {
          id: p.provider,
          name: p.displayName || p.provider,
          configured: p.active || false,
          apiKeyEnv: keyRef,
          hasApiKey: cred?.configured || false,
          isCustom,
          baseURL: custom?.baseURL,
          api: custom?.api,
          models,
        }
      })

      setProviders(configs)
      setCredentials(Object.values(credentialMap))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载设置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开时加载
  useEffect(() => {
    if (visible) {
      loadData()
    }
  }, [visible, loadData])

  // 保存 API Key
  const handleSaveApiKey = useCallback(async (providerId: string) => {
    const validation = validateApiKey(apiKeyInput)
    if (validation !== 'valid') {
      setError(validation === 'empty' ? '请输入 API Key' : 
              validation === 'env-var' ? '请直接输入 API Key，而非环境变量格式' :
              'API Key 包含非法字符')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const keyRef = deriveKeyRef(providerId)
      await agentService.setCredential(keyRef, apiKeyInput.trim())
      
      // 更新本地状态
      setProviders(prev => prev.map(p => 
        p.id === providerId ? { ...p, hasApiKey: true } : p
      ))
      
      setApiKeyInput('')
      setEditingProvider(null)
      setSaveSuccess(providerId)
      
      // 3秒后清除成功提示
      setTimeout(() => setSaveSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [apiKeyInput])

  // 删除 API Key
  const handleDeleteApiKey = useCallback(async (providerId: string) => {
    if (!confirm(`确定删除 ${providerId} 的 API Key？`)) return

    setSaving(true)
    setError(null)
    try {
      const provider = providers.find(p => p.id === providerId)
      const keyRef = provider?.apiKeyEnv || deriveKeyRef(providerId)
      await agentService.unsetCredential(keyRef)
      
      // 更新本地状态
      setProviders(prev => prev.map(p => 
        p.id === providerId ? { ...p, hasApiKey: false } : p
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }, [providers])

  // 添加自定义第三方 Provider
  const handleAddCustomProvider = useCallback(async () => {
    const id = customForm.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    if (!id) {
      setError('请输入供应商 ID（如 my-openai, moonshot）')
      return
    }
    if (!customForm.baseURL.trim()) {
      setError('请输入 Base URL（如 https://api.openai.com/v1）')
      return
    }

    const rawModels = customForm.models
      .split(/[,，\s]+/)
      .map(m => m.trim())
      .filter(Boolean)

    const models = rawModels.length > 0
      ? rawModels.map(m => ({ id: m, name: m }))
      : [{ id: 'default', name: 'Default Model' }]

    const apiKeyEnv = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

    setSaving(true)
    setError(null)
    try {
      // 1. 如果输入了 API Key，先写入凭据
      if (customForm.apiKey.trim()) {
        await agentService.setCredential(apiKeyEnv, customForm.apiKey.trim())
      }

      // 2. 通过 settings.mutate 更新 llm-pi-ai.providers
      await agentService.mutateSettings('llm-pi-ai', [
        {
          op: 'set',
          path: ['providers', id],
          value: {
            displayName: customForm.displayName.trim() || id,
            api: customForm.api,
            baseURL: customForm.baseURL.trim(),
            apiKeyEnv,
            models,
          },
        },
      ])

      setShowAddCustom(false)
      setCustomForm(INITIAL_CUSTOM_FORM)
      setSaveSuccess(id)
      setTimeout(() => setSaveSuccess(null), 3000)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加自定义供应商失败')
    } finally {
      setSaving(false)
    }
  }, [customForm, loadData])

  // 删除自定义第三方 Provider
  const handleDeleteCustomProvider = useCallback(async (providerId: string) => {
    if (!confirm(`确定删除自定义供应商 "${providerId}" 吗？`)) return

    setSaving(true)
    setError(null)
    try {
      const provider = providers.find(p => p.id === providerId)
      // 1. 删除凭据（如果有）
      if (provider?.apiKeyEnv) {
        await agentService.unsetCredential(provider.apiKeyEnv).catch(() => {})
      }

      // 2. 移除设置
      await agentService.mutateSettings('llm-pi-ai', [
        {
          op: 'unset',
          path: ['providers', providerId],
        },
      ])

      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除自定义供应商失败')
    } finally {
      setSaving(false)
    }
  }, [providers, loadData])

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('settings-panel__overlay')) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [visible, onClose])

  // ESC 关闭
  useEffect(() => {
    if (!visible) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div className="settings-panel__overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="settings-panel__header">
          <h2>供应商设置</h2>
          <button className="settings-panel__close" onClick={onClose}>✕</button>
        </div>

        {/* 内容 */}
        <div className="settings-panel__content">
          {loading && (
            <div className="settings-panel__loading">加载中...</div>
          )}

          {error && (
            <div className="settings-panel__error">
              {error}
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {saveSuccess && (
            <div className="settings-panel__success">
              ✓ {saveSuccess} API Key 已保存
            </div>
          )}

          {/* Provider 列表 */}
          <div className="settings-panel__section">
            <div className="settings-panel__section-header">
              <h3>供应商与 API Key 配置</h3>
              <button
                className="settings-panel__btn settings-panel__btn--primary"
                onClick={() => {
                  setShowAddCustom(!showAddCustom)
                  setError(null)
                }}
              >
                {showAddCustom ? '收起添加' : '+ 添加自定义第三方'}
              </button>
            </div>
            <p className="settings-panel__hint">
              支持配置主流云端模型（DeepSeek、OpenAI 等）以及自定义兼容第三方大模型 API
            </p>

            {/* 新增自定义第三方 Provider 表单 */}
            {showAddCustom && (
              <div className="settings-panel__custom-form">
                <div className="settings-panel__form-row">
                  <label>
                    供应商 ID (英文字母/数字/连字符)<span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="settings-panel__input"
                    placeholder="如: my-proxy, moonshot, qwen"
                    value={customForm.id}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, id: e.target.value }))}
                  />
                </div>

                <div className="settings-panel__form-row">
                  <label>显示名称</label>
                  <input
                    type="text"
                    className="settings-panel__input"
                    placeholder="如: Moonshot AI / 个人中转"
                    value={customForm.displayName}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, displayName: e.target.value }))}
                  />
                </div>

                <div className="settings-panel__form-row">
                  <label>
                    协议类型<span className="req">*</span>
                  </label>
                  <select
                    className="settings-panel__select"
                    value={customForm.api}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, api: e.target.value as any }))}
                  >
                    <option value="openai-completions">OpenAI Chat Completions (兼容大多数中转与开源网关)</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages (Claude 兼容网关)</option>
                  </select>
                </div>

                <div className="settings-panel__form-row">
                  <label>
                    Base URL<span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="settings-panel__input"
                    placeholder="如: https://api.openai.com/v1 或中转完整地址"
                    value={customForm.baseURL}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, baseURL: e.target.value }))}
                  />
                </div>

                <div className="settings-panel__form-row">
                  <label>API Key</label>
                  <input
                    type="password"
                    className="settings-panel__input"
                    placeholder="可选，留空后续在列表里添加"
                    value={customForm.apiKey}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  />
                </div>

                <div className="settings-panel__form-row">
                  <label>包含的模型 ID (多个模型可用逗号或换行隔开)</label>
                  <input
                    type="text"
                    className="settings-panel__input"
                    placeholder="如: gpt-4o, gpt-4o-mini, claude-3-5-sonnet"
                    value={customForm.models}
                    onChange={(e) => setCustomForm(prev => ({ ...prev, models: e.target.value }))}
                  />
                </div>

                <div className="settings-panel__edit-actions">
                  <button
                    className="settings-panel__btn settings-panel__btn--primary"
                    onClick={handleAddCustomProvider}
                    disabled={saving}
                  >
                    {saving ? '保存中...' : '保存并注册'}
                  </button>
                  <button
                    className="settings-panel__btn settings-panel__btn--secondary"
                    onClick={() => {
                      setShowAddCustom(false)
                      setCustomForm(INITIAL_CUSTOM_FORM)
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <div className="settings-panel__provider-list">
              {providers.map((provider) => (
                <div key={provider.id} className="settings-panel__provider">
                  <div className="settings-panel__provider-header">
                    <div className="settings-panel__provider-info">
                      <span className="settings-panel__provider-name">{provider.name}</span>
                      <span className="settings-panel__provider-id">{provider.id}</span>
                      {provider.isCustom && (
                        <span className="settings-panel__badge settings-panel__badge--custom">第三方</span>
                      )}
                    </div>
                    <div className="settings-panel__provider-status">
                      {provider.hasApiKey ? (
                        <span className="settings-panel__status settings-panel__status--configured">
                          ✓ 已配置
                        </span>
                      ) : (
                        <span className="settings-panel__status settings-panel__status--missing">
                          未配置
                        </span>
                      )}
                    </div>
                  </div>

                  {provider.baseURL && (
                    <div className="settings-panel__provider-details">
                      <span>URL: {provider.baseURL}</span>
                      {provider.models && provider.models.length > 0 && (
                        <span>模型: {provider.models.join(', ')}</span>
                      )}
                    </div>
                  )}

                  {/* 编辑区域 */}
                  {editingProvider === provider.id ? (
                    <div className="settings-panel__edit">
                      <input
                        type="password"
                        className="settings-panel__input"
                        placeholder="输入 API Key"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveApiKey(provider.id)
                          if (e.key === 'Escape') setEditingProvider(null)
                        }}
                        autoFocus
                      />
                      <div className="settings-panel__edit-actions">
                        <button
                          className="settings-panel__btn settings-panel__btn--primary"
                          onClick={() => handleSaveApiKey(provider.id)}
                          disabled={saving}
                        >
                          {saving ? '保存中...' : '保存'}
                        </button>
                        <button
                          className="settings-panel__btn settings-panel__btn--secondary"
                          onClick={() => {
                            setEditingProvider(null)
                            setApiKeyInput('')
                          }}
                        >
                          取消
                        </button>
                      </div>
                      <div className="settings-panel__edit-hint">
                        API Key 将安全存储在本地，不会上传到任何服务器
                      </div>
                    </div>
                  ) : (
                    <div className="settings-panel__actions">
                      <button
                        className="settings-panel__btn settings-panel__btn--secondary"
                        onClick={() => {
                          setEditingProvider(provider.id)
                          setApiKeyInput('')
                        }}
                      >
                        {provider.hasApiKey ? '更新 Key' : '添加 Key'}
                      </button>
                      {provider.hasApiKey && (
                        <button
                          className="settings-panel__btn settings-panel__btn--danger"
                          onClick={() => handleDeleteApiKey(provider.id)}
                          disabled={saving}
                        >
                          删除 Key
                        </button>
                      )}
                      {provider.isCustom && (
                        <button
                          className="settings-panel__btn settings-panel__btn--danger"
                          onClick={() => handleDeleteCustomProvider(provider.id)}
                          disabled={saving}
                        >
                          删除供应商
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {providers.length === 0 && !loading && (
                <div className="settings-panel__empty">
                  暂无可用的 Provider
                </div>
              )}
            </div>
          </div>

          {/* 帮助信息 */}
          <div className="settings-panel__section">
            <h3>常见问题</h3>
            <div className="settings-panel__faq">
              <details>
                <summary>如何获取 API Key？</summary>
                <p>请访问各 Provider 的官方网站获取 API Key：</p>
                <ul>
                  <li>DeepSeek: <a href="https://platform.deepseek.com" target="_blank" rel="noopener">platform.deepseek.com</a></li>
                  <li>OpenAI: <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a></li>
                  <li>Anthropic: <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a></li>
                </ul>
              </details>
              <details>
                <summary>API Key 存储在哪里？</summary>
                <p>API Key 存储在本地的凭证管理器中，使用系统级加密保护，不会上传到任何服务器。</p>
              </details>
              <details>
                <summary>支持哪些模型？</summary>
                <p>支持所有主流 AI 模型，包括 DeepSeek、GPT-4、Claude 等。配置对应的 API Key 后即可使用。</p>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
