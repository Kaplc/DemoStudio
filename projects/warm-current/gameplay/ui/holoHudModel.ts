/**
 * holoHudModel — 全息 HUD 底栏的纯呈现口径（无引擎依赖，单测锁定）
 *
 * 全息态底部 HUD（holo_hud.widget）的文案/可见性判定抽在此处，
 * 单测 tests/warm/holo_hud_model.test.ts 锁定口径；脚本只做差分套用。
 * 注意：此文件不是 .script.ts（不注册为脚本），仅被脚本与测试 import。
 */
import type { HudHologram, HudHoloToolRow } from '../base/WarmCurrentGameMode'

/** 全息 HUD 工具按钮池容量（ring 1 行 + 矿建表行；当前 mine_building 2 行恰好占满） */
export const HOLO_TOOL_ROWS = 3

/** 模式标题：全息地球态不带天体名（地球是唯一建造场景）；勘探态带天体名 */
export function holoHudModeTitle(holo: HudHologram): string {
  return holo.body === 'earth' ? '全息地球' : `全息勘探 · ${holo.bodyName}`
}

/** 状态行：地球态 = ghost 校验文案 > 工具落点引导 > 节点统计；勘探态 = 选中详情首行 > 操作引导 */
export function holoHudStatusLine(holo: HudHologram): string {
  const e = holo.earth
  if (holo.body === 'earth' && e) {
    if (e.ghostLabel) return e.ghostLabel
    if (e.toolActive) return '移动指针选择落点…'
    return `环节点 ${e.placedNodes}/${e.builtSlots} · 待落位 ${e.pendingNodes}`
  }
  if (holo.selectedId && holo.detail) return holo.detail.split('\n')[0] ?? ''
  return '拖拽旋转检视 · 点矿点或列表行选中 · Esc 退出'
}

/** 工具按钮标签：选中态加 ● 前缀（金色由颜色层表达）；无行时回退占位文案 */
export function holoToolLabel(row: HudHoloToolRow | undefined, fallback: string): string {
  if (!row) return fallback
  return row.selected ? `● ${row.name}` : row.name
}
