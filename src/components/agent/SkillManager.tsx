/**
 * SkillManager - Skill 管理面板
 *
 * 显示已加载的 skill 列表，包括：
 * - 从 DSH 后端获取的 skill
 * - 本地备选 skill
 */
import React, { useState, useEffect, useCallback } from 'react'
import { agentService } from '../../editor/AgentService'
import { logger } from '../../engine/Logger'

interface SkillManagerProps {
  /** 是否显示 */
  visible: boolean
  /** 关闭回调 */
  onClose: () => void
}

/** Skill 信息 */
interface SkillInfo {
  name: string
  description: string
  source: 'dsh' | 'local'
}

/** 本地备选 skills */
const localSkills: SkillInfo[] = [
  { name: 'skl-create-blueprint-asset', description: '创建蓝图资产', source: 'local' },
  { name: 'skl-create-config-asset', description: '创建配置表资产', source: 'local' },
  { name: 'skl-create-scene-asset', description: '创建场景资产', source: 'local' },
  { name: 'skl-create-ui-widget-asset', description: '创建 UI Widget 资产', source: 'local' },
  { name: 'skl-game-ui-design', description: '游戏 UI 设计专家', source: 'local' },
  { name: 'skl-write-doc', description: '编写项目文档', source: 'local' },
  { name: 'skl-manage-instructions', description: '管理目录指令文件', source: 'local' },
]

export const SkillManager: React.FC<SkillManagerProps> = ({ visible, onClose }) => {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 加载 skill 列表
  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 尝试从 DSH 后端获取 skill 列表
      const dshSkills = await loadDshSkills()
      
      // 合并本地 skill 和 DSH skill（去重）
      const allSkills = mergeSkills(localSkills, dshSkills)
      setSkills(allSkills)
    } catch (err) {
      logger.error('[SkillManager] 加载 skill 列表失败:', err)
      setError('加载 skill 列表失败')
      // 失败时只显示本地 skill
      setSkills(localSkills)
    } finally {
      setLoading(false)
    }
  }, [])

  // 从 DSH 后端加载 skill 列表
  const loadDshSkills = async (): Promise<SkillInfo[]> => {
    try {
      const sessionId = agentService.getSessionId()
      if (!sessionId) {
        logger.debug('[SkillManager] 无 session ID，跳过 DSH skill 加载')
        return []
      }

      const result = await agentService.rpc('skill.list', { sessionId }) as {
        skills?: Array<{ name?: string; description?: string }>
      } | null

      if (!result?.skills || !Array.isArray(result.skills)) {
        logger.debug('[SkillManager] skill.list 无结果')
        return []
      }

      return result.skills.map((skill: { name?: string; description?: string }) => ({
        name: skill.name || 'unknown',
        description: skill.description || '',
        source: 'dsh' as const,
      }))
    } catch (err) {
      logger.warn('[SkillManager] 获取 DSH skill 列表失败:', err)
      return []
    }
  }

  // 合并本地和 DSH skill（去重，DSH 优先）
  const mergeSkills = (local: SkillInfo[], dsh: SkillInfo[]): SkillInfo[] => {
    const skillMap = new Map<string, SkillInfo>()

    // 先添加本地 skill
    for (const skill of local) {
      skillMap.set(skill.name, skill)
    }

    // 再添加 DSH skill（覆盖同名的本地 skill）
    for (const skill of dsh) {
      skillMap.set(skill.name, skill)
    }

    return Array.from(skillMap.values())
  }

  // 组件显示时加载 skill 列表
  useEffect(() => {
    if (visible) {
      loadSkills()
    }
  }, [visible, loadSkills])

  if (!visible) return null

  return (
    <div className="skill-manager-overlay">
      <div className="skill-manager">
        <div className="skill-manager__header">
          <h2>Skill 管理</h2>
          <button
            className="skill-manager__close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭 Skill 管理面板"
          >
            ✕
          </button>
        </div>

        <div className="skill-manager__content">
          {loading && (
            <div className="skill-manager__loading">
              加载中...
            </div>
          )}

          {error && (
            <div className="skill-manager__error">
              {error}
            </div>
          )}

          {!loading && !error && skills.length === 0 && (
            <div className="skill-manager__empty">
              没有找到已加载的 skill
            </div>
          )}

          {!loading && !error && skills.length > 0 && (
            <div className="skill-manager__list">
              <div className="skill-manager__stats">
                共 {skills.length} 个 skill
                {skills.some(s => s.source === 'dsh') && (
                  <span className="skill-manager__stats-detail">
                    （{skills.filter(s => s.source === 'dsh').length} 个来自 DSH，
                    {skills.filter(s => s.source === 'local').length} 个本地）
                  </span>
                )}
              </div>

              {skills.map((skill) => (
                <div
                  key={skill.name}
                  className={`skill-manager__item ${skill.source === 'dsh' ? 'skill-manager__item--dsh' : ''}`}
                >
                  <div className="skill-manager__item-header">
                    <span className="skill-manager__item-name">
                      {skill.name}
                    </span>
                    <span className={`skill-manager__item-source skill-manager__item-source--${skill.source}`}>
                      {skill.source === 'dsh' ? 'DSH' : '本地'}
                    </span>
                  </div>
                  {skill.description && (
                    <div className="skill-manager__item-description">
                      {skill.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="skill-manager__footer">
          <div className="skill-manager__hint">
            使用 / 命令可以触发 skill
          </div>
          <button
            className="skill-manager__refresh"
            onClick={loadSkills}
            disabled={loading}
          >
            刷新
          </button>
        </div>
      </div>
    </div>
  )
}
