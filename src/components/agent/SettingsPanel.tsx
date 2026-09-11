/**
 * SettingsPanel - Agent 设置面板
 *
 * 包含：
 * - API Key 配置（按 Provider 分组）
 * - 供应商编辑（显示名称 / Base URL / 模型列表）
 * - 模型能力配置（上下文大小 contextWindow、视觉 input: [text, image]）
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

/** settings.yaml llm-pi-ai.providers.<id>.models[] 的模型条目（只取面板关心的字段，其余透传保留） */
export interface ProviderModelInfo {
  id: string
  name?: string
  /** 上下文窗口大小（token 数），未设置则跟随目录默认 */
  contextWindow?: number
  /** 模态声明，含 'image' 表示支持视觉输入 */
  input?: string[]
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
  models?: ProviderModelInfo[]
  /** 是否存在用户级配置（settings.yaml 有该 provider 条目），可进入"编辑" */
  canEditConfig: boolean
}

/** 模型编辑行（表单态：上下文用字符串承载输入，空串 = 不设置） */
export interface ModelRow {
  id: string
  contextWindow: string
  vision: boolean
}

/** 空模型行 */
export function emptyModelRow(): ModelRow {
  return { id: '', contextWindow: '', vision: false }
}

/** settings.yaml 模型条目 → 表单行 */
export function modelToRow(m: unknown): ModelRow {
  if (typeof m === 'string') return { id: m, contextWindow: '', vision: false }
  const obj = (m || {}) as ProviderModelInfo
  return {
    id: obj.id || '',
    contextWindow: obj.contextWindow ? String(obj.contextWindow) : '',
    vision: Array.isArray(obj.input) && obj.input.includes('image'),
  }
}

/**
 * 表单行 → settings.yaml 模型条目。
 * 以旧条目（原始对象）为底保留未知字段（maxTokens 等）；上下文为空/非法则删除 contextWindow，
 * 视觉未勾选则删除 input（回退内置目录默认模态），勾选则写 ['text','image']。
 */
export function rowToModel(row: ModelRow, prev?: Record<string, unknown>): Record<string, unknown> {
  const ctx = parseInt(row.contextWindow, 10)
  const next: Record<string, unknown> = { ...(prev || {}), id: row.id, name: (prev?.name as string) || row.id }
  if (Number.isFinite(ctx) && ctx > 0) next.contextWindow = ctx
  else delete next.contextWindow
  if (row.vision) next.input = ['text', 'image']
  else delete next.input
  return next
}

/** 行列表 → 模型条目列表：去空白、按 ID 去重（保留首个），全空返回空数组 */
export function buildModelsFromRows(
  rows: ModelRow[],
  prevModels?: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const id = row.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(rowToModel({ ...row, id }, prevModels?.find(m => m?.id === id)))
  }
  return out
}

/** 上下文大小展示：1e6 以上用 M，1e4 以上用 k，更小直接原值 */
export function formatContextWindow(n?: number): string {
  if (!n || n <= 0) return ''
  if (n >= 1_000_000) return `${Number.isInteger(n / 1_000_000) ? n / 1_000_000 : (n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** 新增自定义第三方 Provider 表单数据 */
interface CustomProviderForm {
  id: string
  displayName: string
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  baseURL: string
  apiKey: string
  models: ModelRow[]
}

const INITIAL_CUSTOM_FORM: CustomProviderForm = {
  id: '',
  displayName: '',
  api: 'openai-completions',
  baseURL: '',
  apiKey: '',
  models: [emptyModelRow()],
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

/** 模型行编辑器：每行 = 模型 ID + 上下文大小 + 视觉勾选 + 删除；顶层定义避免每次输入重挂载丢焦点 */
const ModelRowsEditor: React.FC<{
  rows: ModelRow[]
  onChange: (rows: ModelRow[]) => void
}> = ({ rows, onChange }) => {
  const update = (i: number, patch: Partial<ModelRow>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  return (
    <div className="settings-panel__model-rows">
      {rows.map((row, i) => (
        <div key={i} className="settings-panel__model-row" data-model-row>
          <input
            type="text"
            className="settings-panel__input settings-panel__model-id"
            placeholder="模型 ID（如 gpt-4o）"
            title="模型 ID"
            value={row.id}
            onChange={(e) => update(i, { id: e.target.value })}
          />
          <input
            type="number"
            min={0}
            className="settings-panel__input settings-panel__model-ctx"
            placeholder="上下文"
            title="上下文窗口大小（token 数，留空则跟随默认）"
            value={row.contextWindow}
            onChange={(e) => update(i, { contextWindow: e.target.value })}
          />
          <label
            className="settings-panel__model-vision"
            title="勾选表示该模型支持图像输入（input: [text, image]）"
          >
            <input
              type="checkbox"
              checked={row.vision}
              onChange={(e) => update(i, { vision: e.target.checked })}
            />
            <span>视觉</span>
          </label>
          <button
            type="button"
            className="settings-panel__btn settings-panel__btn--danger settings-panel__model-remove"
            title="删除该模型"
            disabled={rows.length <= 1}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            删除
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="settings-panel__btn settings-panel__btn--secondary settings-panel__model-add"
          onClick={() => onChange([...rows, emptyModelRow()])}
        >
          + 添加模型
        </button>
      </div>
    </div>
  )
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

  // settings.yaml 用户级 llm-pi-ai.providers 原始配置（编辑表单回填与合并的底）
  const [userProviders, setUserProviders] = useState<Record<string, any>>({})
  // 供应商配置编辑（显示名称 / Base URL / 模型上下文与视觉）
  const [editingConfigProvider, setEditingConfigProvider] = useState<string | null>(null)
  const [configForm, setConfigForm] = useState<{ displayName: string; baseURL: string; models: ModelRow[] }>({
    displayName: '',
    baseURL: '',
    models: [emptyModelRow()],
  })

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
      setUserProviders(userProviders)

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
          ? custom.models
              .map((m: any): ProviderModelInfo =>
                typeof m === 'string'
                  ? { id: m }
                  : { id: m?.id || m?.name || '', name: m?.name, contextWindow: m?.contextWindow, input: m?.input },
              )
              .filter((m: ProviderModelInfo) => m.id)
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
          canEditConfig: Boolean(custom),
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
      setSaveSuccess(`${providerId} API Key 已保存`)
      
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

    // 模型行 → settings.yaml 条目（含上下文/视觉）；全空时回落 default 占位
    const parsed = buildModelsFromRows(customForm.models)
    const models = parsed.length > 0
      ? parsed
      : [{ id: 'default', name: 'Default Model' }]

    const apiKeyEnv = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

    setSaving(true)
    setError(null)
    try {
      console.info('[SettingsPanel] 添加自定义供应商:', id, '模型数:', models.length)
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
      setSaveSuccess(`${id} 配置已保存`)
      setTimeout(() => setSaveSuccess(null), 3000)
      await loadData()
    } catch (err) {
      console.warn('[SettingsPanel] 添加自定义供应商失败:', err)
      setError(err instanceof Error ? err.message : '添加自定义供应商失败')
    } finally {
      setSaving(false)
    }
  }, [customForm, loadData])

  // 打开供应商配置编辑（回填显示名称 / Base URL / 模型行）
  const openConfigEditor = useCallback((provider: ProviderConfig) => {
    const raw = userProviders[provider.id] || {}
    const rawModels: unknown[] = Array.isArray(raw.models) ? raw.models : []
    setEditingConfigProvider(provider.id)
    setConfigForm({
      displayName: raw.displayName || provider.name,
      baseURL: raw.baseURL || provider.baseURL || '',
      models: rawModels.length > 0 ? rawModels.map(modelToRow) : [emptyModelRow()],
    })
    setError(null)
  }, [userProviders])

  // 保存供应商配置：合并用户级既有字段，仅重写 displayName/baseURL/models
  const handleSaveProviderConfig = useCallback(async () => {
    if (!editingConfigProvider) return
    const id = editingConfigProvider
    if (!configForm.baseURL.trim()) {
      setError('Base URL 不能为空')
      return
    }
    const existing = userProviders[id] || {}
    // 传入原始 models 作为合并底，保留 maxTokens 等未编辑字段
    const rawModels: Array<Record<string, unknown>> = Array.isArray(existing.models) ? existing.models : []
    const models = buildModelsFromRows(configForm.models, rawModels)
    if (models.length === 0) {
      setError('请至少填写一个模型 ID')
      return
    }

    setSaving(true)
    setError(null)
    try {
      console.info('[SettingsPanel] 保存供应商配置:', id, '模型数:', models.length)
      await agentService.mutateSettings('llm-pi-ai', [
        {
          op: 'set',
          path: ['providers', id],
          value: {
            ...existing,
            displayName: configForm.displayName.trim() || id,
            api: existing.api || 'openai-completions',
            baseURL: configForm.baseURL.trim(),
            models,
          },
        },
      ])
      setEditingConfigProvider(null)
      setSaveSuccess(`${id} 配置已保存`)
      setTimeout(() => setSaveSuccess(null), 3000)
      await loadData()
    } catch (err) {
      console.warn('[SettingsPanel] 保存供应商配置失败:', err)
      setError(err instanceof Error ? err.message : '保存供应商配置失败')
    } finally {
      setSaving(false)
    }
  }, [editingConfigProvider, configForm, userProviders, loadData])

  // 删除自定义第三方 Provider
  const handleDeleteCustomProvider = useCallback(async (providerId: string) => {
    if (!confirm(`确定删除自定义供应商 "${providerId}" 吗？`)) return

    setSaving(true)
    setError(null)
    try {
      console.info('[SettingsPanel] 删除自定义供应商:', providerId)
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

      if (editingConfigProvider === providerId) setEditingConfigProvider(null)
      await loadData()
    } catch (err) {
      console.warn('[SettingsPanel] 删除自定义供应商失败:', err)
      setError(err instanceof Error ? err.message : '删除自定义供应商失败')
    } finally {
      setSaving(false)
    }
  }, [providers, loadData, editingConfigProvider])

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
              ✓ {saveSuccess}
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
                  <label>模型列表（可设置每个模型的上下文大小与视觉能力）</label>
                  <ModelRowsEditor
                    rows={customForm.models}
                    onChange={(models) => setCustomForm(prev => ({ ...prev, models }))}
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
                        <span className="settings-panel__provider-models">
                          {provider.models.map(m => (
                            <span
                              key={m.id}
                              className="settings-panel__model-tag"
                              title={[
                                m.contextWindow ? `上下文 ${m.contextWindow} tokens` : null,
                                m.input?.includes('image') ? '支持图像输入' : '仅文本输入',
                              ].filter(Boolean).join('，')}
                            >
                              {m.id}
                              {m.contextWindow ? ` · ${formatContextWindow(m.contextWindow)}` : ''}
                              {m.input?.includes('image') ? ' · 视觉' : ''}
                            </span>
                          ))}
                        </span>
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
                      {provider.canEditConfig && (
                        <button
                          className="settings-panel__btn settings-panel__btn--secondary"
                          onClick={() => openConfigEditor(provider)}
                          disabled={saving}
                        >
                          编辑
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

                  {/* 供应商配置编辑（显示名称 / Base URL / 模型上下文与视觉） */}
                  {editingConfigProvider === provider.id && (
                    <div className="settings-panel__edit settings-panel__config-edit">
                      <div className="settings-panel__form-row">
                        <label htmlFor="settings-provider-display-name">显示名称</label>
                        <input
                          id="settings-provider-display-name"
                          type="text"
                          className="settings-panel__input"
                          value={configForm.displayName}
                          onChange={(e) => setConfigForm(prev => ({ ...prev, displayName: e.target.value }))}
                        />
                      </div>
                      <div className="settings-panel__form-row">
                        <label htmlFor="settings-provider-base-url">Base URL</label>
                        <input
                          id="settings-provider-base-url"
                          type="text"
                          className="settings-panel__input"
                          value={configForm.baseURL}
                          onChange={(e) => setConfigForm(prev => ({ ...prev, baseURL: e.target.value }))}
                        />
                      </div>
                      <div className="settings-panel__form-row">
                        <label>模型列表（上下文单位为 token；视觉 = 支持图像输入）</label>
                        <ModelRowsEditor
                          rows={configForm.models}
                          onChange={(models) => setConfigForm(prev => ({ ...prev, models }))}
                        />
                      </div>
                      <div className="settings-panel__edit-actions">
                        <button
                          className="settings-panel__btn settings-panel__btn--primary"
                          onClick={handleSaveProviderConfig}
                          disabled={saving}
                        >
                          {saving ? '保存中...' : '保存配置'}
                        </button>
                        <button
                          className="settings-panel__btn settings-panel__btn--secondary"
                          onClick={() => setEditingConfigProvider(null)}
                        >
                          取消
                        </button>
                      </div>
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
