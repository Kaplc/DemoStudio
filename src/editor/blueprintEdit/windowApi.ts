/**
 * windowApi — 把 BlueprintEditorService 暴露到 window.blueprintEditor
 *
 * 供开发者控制台 / 内嵌脚本 / 任何页面内代码直接调用蓝图编辑工具，
 * 与 MCP 外部接口、交互式 UI 共用同一套 dispatch 实现。
 *
 * 用法：
 *   window.blueprintEditor.listTypes()
 *   await window.blueprintEditor.read('src/projects/fish/asset/blueprints/beach_house.blueprint.json')
 *   await window.blueprintEditor.apply(path, 'addComponent', { type:'SpriteComponent', props:{ width:1, height:1 } })
 *   await window.blueprintEditor.dispatch('addComponent', { assetPath: path, type:'SpriteComponent', ... })
 */
import { BlueprintEditorService } from './BlueprintEditorService'
import type { BlueprintEditResult } from './BlueprintEditorService'

export interface BlueprintEditorWindowApi {
  /** 读取蓝图资产 + 当前可用类型 */
  read: (assetPath: string) => Promise<BlueprintEditResult>
  /** 当前注册的 Actor / Component / Blueprint 类型 */
  listTypes: () => BlueprintEditResult['types']
  /** 读盘 → 应用单个 op → 写盘 → 重注册 → 通知刷新 */
  apply: (
    assetPath: string,
    op: string,
    params: Record<string, unknown>,
  ) => Promise<BlueprintEditResult>
  /** 统一入口（op 可为 read / listTypes / 其余编辑 op，params 内带 assetPath） */
  dispatch: (op: string, params?: Record<string, unknown>) => Promise<BlueprintEditResult>
}

declare global {
  interface Window {
    blueprintEditor?: BlueprintEditorWindowApi
  }
}

/** 安装 window.blueprintEditor（幂等） */
export function installBlueprintWindowApi(): void {
  if (typeof window === 'undefined') return
  if (window.blueprintEditor) return
  window.blueprintEditor = {
    read: (assetPath) => BlueprintEditorService.read(assetPath),
    listTypes: () => BlueprintEditorService.listTypes(),
    apply: (assetPath, op, params) => BlueprintEditorService.apply(assetPath, op, params),
    dispatch: (op, params) => BlueprintEditorService.dispatch(op, params),
  }
}
