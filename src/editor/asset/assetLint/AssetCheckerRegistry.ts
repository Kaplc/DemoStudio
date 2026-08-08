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
