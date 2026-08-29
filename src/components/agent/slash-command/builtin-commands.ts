/**
 * DSH 命令来源
 * DSH 内置命令是固定的，直接硬编码
 * skill.list 可以通过 RPC 获取
 */

import { logger } from '../../../engine/Logger'
import { commandRegistry } from './CommandRegistry'
import type { SlashCommand, CommandSource } from './types'

/**
 * DSH 内置命令（固定列表）
 * 这些命令在 DSH 后端注册，前端只需显示名称
 */
const dshBuiltinCommands: SlashCommand[] = [
  { name: 'compact', description: '压缩对话历史，释放上下文空间' },
  { name: 'clear', description: '清除当前对话' },
  { name: 'goal', description: '设置或查看当前目标' },
  { name: 'plan', description: '进入计划模式' },
  { name: 'todo', description: '管理任务列表' },
  { name: 'ralph', description: '启动 Ralph 迭代执行' },
]

/**
 * 创建 DSH Command 命令来源
 * 直接返回固定的内置命令列表
 */
export function createDshCommandSource(_getAgentService: () => any): CommandSource {
  return {
    name: 'dsh-commands',
    trigger: '/',
    order: 5,  // 最高优先级
    candidates: async (query) => {
      logger.debug(`[SlashCommand] 获取命令: "${query}"`)
      return dshBuiltinCommands.filter(cmd => cmd.name.includes(query))
    },
  }
}

/**
 * 本地备选 skills（当 DSH 后端不可用时使用）
 */
const fallbackSkills: SlashCommand[] = [
  { name: 'skl-create-blueprint-asset', description: '创建蓝图资产' },
  { name: 'skl-create-config-asset', description: '创建配置表资产' },
  { name: 'skl-create-scene-asset', description: '创建场景资产' },
  { name: 'skl-game-ui-design', description: '游戏 UI 设计专家' },
  { name: 'skl-write-doc', description: '编写项目文档' },
]

/**
 * 创建 DSH Skill 命令来源
 * 从 DSH 后端 RPC 获取 skill 列表，失败时使用本地备选
 */
export function createDshSkillSource(getAgentService: () => any): CommandSource {
  return {
    name: 'dsh-skills',
    trigger: '/',
    order: 10,  // 次优先级
    candidates: async (query) => {
      try {
        const agentService = getAgentService()
        if (!agentService?.sessionId) {
          logger.debug('[SlashCommand] 无 session ID，使用备选 skills')
          return fallbackSkills.filter(s => s.name.includes(query))
        }

        // 调用 DSH RPC: skill.list
        const result = await agentService.rpc('skill.list', {
          sessionId: agentService.sessionId,
        })

        if (!result?.skills) {
          logger.debug('[SlashCommand] skill.list 无结果，使用备选 skills')
          return fallbackSkills.filter(s => s.name.includes(query))
        }

        // 转换为 SlashCommand 格式
        return result.skills
          .filter((skill: any) => skill.name.includes(query))
          .map((skill: any) => ({
            name: skill.name,
            description: skill.description,
            handler: () => {
              logger.info(`[SlashCommand] 加载 skill: ${skill.name}`)
            },
          }))
      } catch (error) {
        logger.warn('[SlashCommand] 获取 skill 列表失败，使用备选 skills')
        return fallbackSkills.filter(s => s.name.includes(query))
      }
    },
  }
}

/** 注册 DSH command 来源 */
export function registerDshCommandSource(getAgentService: () => any): () => void {
  return commandRegistry.registerSource(createDshCommandSource(getAgentService))
}

/** 注册 DSH skill 来源 */
export function registerDshSkillSource(getAgentService: () => any): () => void {
  return commandRegistry.registerSource(createDshSkillSource(getAgentService))
}
