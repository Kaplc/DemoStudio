/**
 * editHudModel — 轨道蓝图台编辑 HUD 的纯呈现口径（无引擎依赖，单测锁定）
 *
 * 编辑态底部 HUD（edit_hud.widget）的文案/可见性判定抽在此处，
 * 单测 tests/warmEditHudModel.test.ts 锁定口径；脚本只做差分套用。
 * 注意：此文件不是 .script.ts（不注册为脚本），仅被脚本与测试 import。
 */

/** 编辑 HUD 模式标题（主行左端，与全息底栏同位） */
export const EDIT_HUD_TITLE = '轨道蓝图台'

/** 建造选型按钮标签：面板展开加 ● 前缀（金色由颜色层表达，与全息底栏选中态同约定） */
export function editBuildButtonLabel(panelOpen: boolean): string {
  return panelOpen ? '● 建造选型' : '建造选型'
}

/** 状态行：放置中 = 选型 + 落位引导（覆盖通用提示，玩家最关心落点）；否则 = 蓝图台上下文提示 */
export function editHudStatusLine(buildName: string | null, hint: string): string {
  return buildName ? `放置：${buildName} — 点轨道环落位 · Esc 取消` : hint
}

/** 取消放置按钮可见性：仅放置中（buildActive 非空）显形（Esc 第一优先的鼠标等价） */
export function editCancelVisible(buildActive: string | null): boolean {
  return buildActive !== null
}
