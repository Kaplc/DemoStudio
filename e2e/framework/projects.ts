/**
 * e2e/framework/projects — 项目描述符解析（自动扫描，零注册）
 *
 * 新项目接入框架不再需要登记：在 projects/<id>/e2e/ 下写 spec 即可，
 * id = projects/ 下的文件夹名（spec 里 test.use({ project: '<文件夹名>' })）。
 *
 * cardName（工程卡显示名）从 projects/<id>/register.ts 的 ProjectModule.name
 * 文本提取——为什么读文本而不是 import：register.ts 用了 import.meta.glob
 * （vite 专属宏）和 '@/engine'（vite 别名），在 Playwright 的 Node 进程里
 * 无法加载（同款约束见 types.ts 头注释）；而 ProjectModule 契约保证
 * `ProjectModule = { name: '...' }` 形状稳定（src/editor/projects/registry.ts
 * 也依赖 name + createGameInstance 识别），正则提取足够可靠。
 *
 * 特殊情况（register 缺 name / 目录名与卡片名无法对应）可在 PROJECTS 静态覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectDescriptor } from './types'

/** 静态覆盖表：自动扫描不合用时手工登记（优先级高于扫描），也是运行时缓存 */
export const PROJECTS: Record<string, ProjectDescriptor> = {}

/** 工程单根（doc-dev/projects-root-unification）：e2e/framework 的上两级即仓库根 */
const PROJECTS_ROOT = path.resolve(__dirname, '..', '..', 'projects')

export function registerProject(desc: ProjectDescriptor): void {
  PROJECTS[desc.id] = desc
}

/**
 * 从 register.ts 文本提取 ProjectModule.name（纯函数，可单测）
 *
 * ProjectModule 契约：export const xProject: ProjectModule = { name: 'CardName', ...
 * name 紧跟对象字面量开头（fish/warm-current/hoi4 均如此），锚定 "ProjectModule = {"
 * 避免误抓文件里其他 name 字段
 */
export function parseCardName(registerText: string): string | null {
  const m = /ProjectModule\s*=\s*\{\s*name\s*:\s*['"]([^'"]+)['"]/.exec(registerText)
  return m?.[1] ?? null
}

/** 从 projects/<id>/register.ts 文本提取 ProjectModule.name；文件或形状缺失返回 null */
function scanCardName(id: string): string | null {
  const file = path.join(PROJECTS_ROOT, id, 'register.ts')
  if (!fs.existsSync(file)) return null
  return parseCardName(fs.readFileSync(file, 'utf-8'))
}

/**
 * 解析项目描述符：静态覆盖 → register.ts 自动扫描（结果缓存进 PROJECTS）
 *
 * @param id projects/ 下的文件夹名
 * @throws id 对应目录不存在或 register.ts 缺 ProjectModule.name 时抛可读错误
 */
export async function resolveProject(id: string): Promise<ProjectDescriptor> {
  if (PROJECTS[id]) return PROJECTS[id]
  const cardName = scanCardName(id)
  if (!cardName) {
    throw new Error(
      `[e2e] 项目 "${id}" 无法解析：projects/${id}/register.ts 不存在或缺少 ProjectModule.name。` +
        `确认文件夹名与 test.use({ project: '...' }) 一致；特殊项目可在 e2e/framework/projects.ts 用 registerProject() 静态登记`,
    )
  }
  const desc: ProjectDescriptor = { id, cardName, description: `自动扫描自 projects/${id}/register.ts` }
  PROJECTS[id] = desc
  return desc
}
