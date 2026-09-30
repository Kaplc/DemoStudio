/**
 * DSH 内核适配器注册表
 *
 * 可插拔契约：每个内核大版本一个适配器文件（adapters/<id>.ts），在此登记。
 * - 内核破坏性更新 → 新增适配器文件 + 本表登记一行，编辑器代码零改动；
 * - 内核回退（npm i -g @deepseek-ai/dsh@<旧版>）→ 安装版本变化，注册表自动重新
 *   选中旧适配器，编辑器代码零改动；
 * - 未知版本 → 回落最新适配器并告警（fail-open，能力按其声明运行，日志可溯）。
 */

import { normalizeVersion } from '../dshKernelVersion'
import type { DshKernelAdapter } from './gateway'
import { dsh017Adapter } from './adapters/dsh017'
import { dsh011Adapter } from './adapters/dsh011'
import { setDshAuthRequired } from './auth'

/** 注册表：新版本在前（按 matches 顺序命中即选中） */
const REGISTRY: readonly DshKernelAdapter[] = [dsh017Adapter, dsh011Adapter]

export function listAdapters(): readonly DshKernelAdapter[] {
  return REGISTRY
}

let _active: DshKernelAdapter = REGISTRY[0]
let _activeExact = false
let _activeKernelVersion = ''

export function getActiveAdapter(): DshKernelAdapter {
  return _active
}

export function getActiveKernelVersion(): string {
  return _activeKernelVersion
}

/** 当前适配器是否为内核版本的精确匹配（false = 未知版本回落，编辑器可提示「未验证」） */
export function isActiveAdapterExact(): boolean {
  return _activeExact
}

/** 按安装的内核版本选中适配器并激活（含鉴权模式同步），返回选中项 */
export function selectAdapterForKernel(version: string): DshKernelAdapter {
  const v = normalizeVersion(version)
  let chosen = REGISTRY[0]
  let exact = false
  if (v) {
    const hit = REGISTRY.find((a) => a.matches(v))
    if (hit) {
      chosen = hit
      exact = true
    }
  }
  if (!exact) {
    console.warn(
      `[dsh-adapter] 内核版本 "${version || '未知'}" 无精确匹配的注册适配器，回落最新适配器 ${chosen.id}（能力按其声明运行）`,
    )
  }
  setActiveAdapter(chosen, version, exact)
  return chosen
}

export function setActiveAdapter(adapter: DshKernelAdapter, kernelVersion = '', exact = true): void {
  if (_active !== adapter || _activeKernelVersion !== kernelVersion || _activeExact !== exact) {
    console.log(`[dsh-adapter] 适配器选择: ${adapter.id} (kernel=${kernelVersion || '未知'}, 精确匹配=${exact})`)
    console.log(`[dsh-adapter] 能力矩阵: ${JSON.stringify(adapter.capabilities)} stream=${adapter.streamMode} mux=${adapter.muxEndpoint}`)
  }
  _active = adapter
  _activeKernelVersion = kernelVersion
  _activeExact = exact
  // 鉴权模式随适配器切换（0.1.7 cookie ↔ 0.1.1 无鉴权），下游零分支
  setDshAuthRequired(adapter.capabilities.authRequired)
}

/** 仅测试用：复位到初始态 */
export function __resetRegistryForTest(): void {
  _active = REGISTRY[0]
  _activeExact = false
  _activeKernelVersion = ''
  setDshAuthRequired(REGISTRY[0].capabilities.authRequired)
}
