/**
 * assetLint/AssetCheckerRegistry — 检查器注册中心
 *
 * 函数式自注册（与项目既有 Registry 范式一致，规避 esbuild 装饰器转译风险）：
 *   registerAssetChecker('node:box', BoxChecker)
 * barrel `import './checkers'` 触发各 checker 模块的副作用注册。
 *
 * 幂等：同 kind 重复注册只保留首次（防 HMR 重复注册）。
 * 新增类型只需"新建 checker 文件 + barrel 加一行 import"，不改既有代码。
 */
import type { AbstractAssetChecker } from './AbstractAssetChecker'
import type { CheckerKind } from './types'
import { ComponentRegistry } from '../../../engine/tools/ComponentRegistry'

type CheckerCtor = new () => AbstractAssetChecker

const registry = new Map<CheckerKind, CheckerCtor>()

/** 注册检查器（幂等：同 kind 重复注册只保留首次）。 */
export function registerAssetChecker(kind: CheckerKind, Ctor: CheckerCtor): void {
  if (registry.has(kind)) return
  registry.set(kind, Ctor)
}

/** 取检查器实例；未注册返回 null（由 engine 记一条 warn）。 */
export function getChecker(kind: CheckerKind): AbstractAssetChecker | null {
  const Ctor = registry.get(kind)
  return Ctor ? new Ctor() : null
}

/** 已注册的所有 kind（诊断用）。 */
export function registeredKinds(): CheckerKind[] {
  return [...registry.keys()]
}

/** kind 解析结果：lint 检查器命中 / 合法组件缺 schema / 完全未知。 */
export type CheckerResolution =
  | { type: 'checker'; checker: AbstractAssetChecker }
  | { type: 'schemaless'; baseClass: string }
  | { type: 'unknown' }

/**
 * kind 解析——AssetLintEngine 与 uiCompiler/lintBridge 两条派发路径共用的唯一策略：
 *   1. lint 检查器命中 → checker；
 *   2. comp:* 且 ComponentRegistry 工厂注册过 → schemaless（合法组件、无 lint schema，
 *      properties 不校验；调用方降级为 warn，避免把合法资产误伤成「未注册的检查器」error）；
 *   3. 其余 → unknown（调用方报 error）。
 * 依赖 ComponentRegistry 已初始化（编辑器进程内 registerBuiltinComponents 已跑）；
 * 离线 CLI 未初始化时工厂判定从紧（unknown），仅影响极少数声明游戏组件的 widget。
 */
export function resolveChecker(kind: CheckerKind): CheckerResolution {
  const checker = getChecker(kind)
  if (checker) return { type: 'checker', checker }
  if (kind.startsWith('comp:')) {
    const baseClass = kind.slice('comp:'.length)
    if (ComponentRegistry.has(baseClass)) return { type: 'schemaless', baseClass }
  }
  return { type: 'unknown' }
}
