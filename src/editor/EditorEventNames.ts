/**
 * EditorEventNames — 编辑器事件名常量
 *
 * 所有跨模块事件统一在此定义，使用 `domain:action` 格式。
 * 只包含事件名，不含任何实现逻辑。
 */

export const EditorEvent = {
  /** 选择变化（Gizmo 拖拽每帧、Outline 点击、选中取消等）。
   *  参数：无 */
  SELECTION_CHANGED: 'selection:changed',

  /** 蓝图预览中通过 Gizmo 拖拽修改了 Transform（尚未落盘）。
   *  参数：assetPath: string */
  BLUEPRINT_TRANSFORM_DIRTY: 'blueprint:transformDirty',

  /** 蓝图已保存落盘（handleSave / Inspector apply / MCP edit）。
   *  参数：assetPath: string */
  BLUEPRINT_SAVED: 'blueprint:saved',

  /** 蓝图属性类编辑 ops 快照（快速通道）：服务层 applyBatch 成功后广播，打开的
   *  预览实例就地应用（免销毁重建，保持大纲展开/选中/相机）。
   *  参数：assetPath: string, ops: ReadonlyArray<{op: string; params: Record<string, unknown>}> */
  BLUEPRINT_EDIT_OPS: 'blueprint:editOps',
} as const
