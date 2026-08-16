/**
 * codeLint/CodeCheckerRegistry — 代码规则检查器注册中心
 *
 * 函数式自注册（与 assetLint 的 AssetCheckerRegistry 范式一致）：
 *   registerCodeChecker('addComponent', AddComponentChecker)
 * barrel `import './checkers'` 触发各 checker 模块的副作用注册。
 *
 * 幂等：同 kind 重复注册只保留首次（防 HMR 重复注册）。
 * 新增规则只需"新建 checker 文件 + barrel 加一行 import"，不改既有代码。
 */
import type { AbstractCodeChecker } from './AbstractCodeChecker'

type CheckerCtor = new () => AbstractCodeChecker

const registry = new Map<string, CheckerCtor>()

/** 注册检查器（幂等：同 kind 重复注册只保留首次）。 */
export function registerCodeChecker(kind: string, Ctor: CheckerCtor): void {
  if (registry.has(kind)) return
  registry.set(kind, Ctor)
}

/** 取检查器实例；未注册返回 null。 */
export function getChecker(kind: string): AbstractCodeChecker | null {
  const Ctor = registry.get(kind)
  return Ctor ? new Ctor() : null
}

/** 已注册的所有 kind（engine 逐规则遍历用）。 */
export function registeredKinds(): string[] {
  return [...registry.keys()]
}
