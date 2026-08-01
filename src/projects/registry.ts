/**
 * projects/registry — 项目模块自动注册中心
 *
 * 每个项目通过 ProjectModule 接口自描述需要注册什么，
 * registry.ts 统一收集并自动完成注册。
 *
 * 新增游戏项目只需：
 *   1. 在项目目录下创建 register.ts，导出 ProjectModule
 *   2. 在本文件的 ALL_PROJECTS 数组中加入 import + 条目
 */
import type * as THREE from 'three'
import {
  GameFactoryRegistry,
  registerBuiltinComponents,
  registerBuiltinActors,
  BlueprintRegistry,
  AssetRegistry,
} from '../engine'
import { registerBuiltinAIHandlers } from '../engine/ai'
import type { GameInstance } from '../engine'

// ─── 项目注册模块接口 ───

export interface ProjectModule {
  /** 游戏名称（也是注册用的 key） */
  readonly name: string

  /** 创建游戏实例的工厂函数 */
  createGameInstance: (scene: THREE.Scene) => GameInstance

  /** 初始化配置表（可选）。异步加载 JSON 覆盖默认值 */
  initConfigs?: (log: (message: string) => void) => void

  /**
   * 注册项目资产（可选）。打开工程时调用，自动扫描项目 asset/ 目录并注册到 AssetRegistry / BlueprintRegistry。
   * 确保在 createGameInstance、BlueprintEditor 等工作之前，资产已就绪。
   */
  registerAssets?: () => void
}

// ─── 逐个导入项目注册模块 ───

import { snakeProject } from './snake/register'
import { eatFishProject } from './eatfish/register'
import { demo2DProject } from './demo2d/register'
import { racingProject } from './racing/register'
import { fishMasterProject } from './fish/register'

const ALL_PROJECTS: ProjectModule[] = [
  snakeProject,
  eatFishProject,
  demo2DProject,
  racingProject,
  fishMasterProject,
]

// ─── 项目模块名称索引（供延迟加载用）───

const projectModuleMap = new Map<string, ProjectModule>()
for (const p of ALL_PROJECTS) {
  projectModuleMap.set(p.name, p)
}

// ─── 自动注册所有项目（仅工厂，不含配置表）───

/**
 * 注册所有项目到编辑器的各个注册表中。
 * 遍历 ALL_PROJECTS，自动完成 GameFactoryRegistry 注册。
 * 配置表改为延迟加载（由 initProjectConfigs 触发），
 * 避免编辑器启动时加载所有项目的配置文件。
 * @param log 日志输出回调
 */
export function registerAllProjectModules(
  log: (message: string) => void = console.log,
): void {
  // 注册引擎内置 Component / Actor（Blueprint 系统的工厂基础，幂等）
  registerBuiltinComponents()
  registerBuiltinActors()

  // 注册内置 AI 事件处理器（AI 经 MCP 控制游戏场景的事件总线，幂等）
  registerBuiltinAIHandlers()

  for (const project of ALL_PROJECTS) {
    // 游戏实例工厂
    GameFactoryRegistry.register(project.name, (scene) => project.createGameInstance(scene))
    log(`[Game] ${project.name} 游戏工厂已注册`)
  }
}

// ─── 延迟配置表加载 ───

/**
 * 按项目名延迟加载配置表。
 * 仅在项目被选中或游戏启动前调用，避免浪费。
 * @param name   项目名称（ProjectModule.name）
 * @param log    日志输出回调
 */
export function initProjectConfigs(
  name: string,
  log: (message: string) => void = console.log,
): void {
  const project = projectModuleMap.get(name)
  if (project?.initConfigs) {
    project.initConfigs(log)
  }
}

/**
 * 打开工程时调用：清空前一个工程的资产，注册当前工程的资产。
 * @param name   项目名称（ProjectModule.name）
 */
export function registerProjectAssets(name: string): void {
  // 清空上一个工程的资产
  clearProjectAssets()

  const project = projectModuleMap.get(name)
  if (project?.registerAssets) {
    project.registerAssets()
  }
}

/** 清空当前工程的资产（关闭工程 / 切换工程时调用） */
export function clearProjectAssets(): void {
  AssetRegistry.reset()
  BlueprintRegistry.clearAll()
}
