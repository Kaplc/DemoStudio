/**
 * SettingsPanel - Agent 设置面板
 *
 * 包含：
 * - API Key 配置（按 Provider 分组）
 * - 模型设置
 * - 连接状态
 */
import React, { useState, useEffect, useCallback } from 'react'
import { agentService, type CredentialInfo, type ProviderInfo } from '../../editor/AgentService'

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

  // 加载 Provider 和凭证信息
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 先获取 Provider 列表
      const providerList = await agentService.getLlmProviders()

      // 从 Provider 推导凭证引用名
      const refs = providerList
        .map(p => deriveKeyRef(p.provider))
        .filter(ref => ref.length > 0)

      // 查询凭证状态
      const credentialMap = refs.length > 0
        ? await agentService.describeCredentials(refs)
        : {}

      // 合并 Provider 和凭证信息
      const configs: ProviderConfig[] = providerList.map(p => {
        const keyRef = deriveKeyRef(p.provider)
        const cred = credentialMap[keyRef]
        return {
          id: p.provider,
          name: p.displayName || p.provider,
          configured: p.active || false,
          apiKeyEnv: keyRef,
          hasApiKey: cred?.configured || false,
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
      const keyRef = deriveKeyRef(providerId)
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
  }, [])

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
    <div className="settings-panel__overlay">
      <div className="settings-panel">
        {/* 头部 */}
        <div className="settings-panel__header">
          <h2>Agent 设置</h2>
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
            <h3>API Key 配置</h3>
            <p className="settings-panel__hint">
              配置各 AI Provider 的 API Key 以使用对应的模型
            </p>

            <div className="settings-panel__provider-list">
              {providers.map((provider) => (
                <div key={provider.id} className="settings-panel__provider">
                  <div className="settings-panel__provider-header">
                    <div className="settings-panel__provider-info">
                      <span className="settings-panel__provider-name">{provider.name}</span>
                      <span className="settings-panel__provider-id">{provider.id}</span>
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
                          删除
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
