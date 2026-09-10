/**
 * e2e/framework/projects — 项目描述符注册表
 *
 * 新项目接入框架只需两步：
 * ① 在 src/projects/<项目>/register.ts 确认 ProjectModule.name（工程卡显示名）
 * ② 在下方 PROJECTS 加一条 ProjectDescriptor（或在 spec 里调 registerProject 临时注册）
 */
import type { ProjectDescriptor } from './types'

export const PROJECTS: Record<string, ProjectDescriptor> = {
  fish: {
    id: 'fish',
    cardName: 'ClashMaster',
    description: '部落冲突风格养成+战斗（src/projects/fish）',
  },
  warm: {
    id: 'warm',
    cardName: 'WarmCurrent',
    description: '暖流计划（doc/game/暖流计划-游戏设计方案.md）',
  },
}

export function registerProject(desc: ProjectDescriptor): void {
  PROJECTS[desc.id] = desc
}

export function getProject(id: string): ProjectDescriptor {
  const desc = PROJECTS[id]
  if (!desc) {
    throw new Error(
      `[e2e] 项目 "${id}" 未注册；请在 e2e/framework/projects.ts 的 PROJECTS 里登记，或在 spec 里 registerProject()`,
    )
  }
  return desc
}
