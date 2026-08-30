/**
 * editor_emit — 通过 CDP 调用编辑器 AI 事件
 *
 * 在渲染进程上下文中调用 window.__ai.emit(event, payload)，
 * 复用编辑器已有的 AIModule 事件系统（editor.* / ai.* 事件）。
 *
 * 比走 MCP HTTP 更直接：省去了 main.ts 中转。
 */
import { getEditorPage } from '../cdpBridge'

/** 编辑器 MCP API 默认端口（主进程 HTTP 服务） */
export const EDITOR_MCP_PORT_DEFAULT = 9877

export interface EditorEmitArgs {
  /** 事件名（如 editor.getState, editor.togglePanel） */
  event: string
  /** 事件载荷 */
  payload?: Record<string, unknown>
}

export interface EditorEmitResult {
  ok: boolean
  event: string
  result?: unknown
  error?: string
}

export async function editorEmit(args: EditorEmitArgs): Promise<EditorEmitResult> {
  const { event, payload } = args
  if (!event) return { ok: false, event, error: '缺少 event 参数' }

  try {
    const page = await getEditorPage()

    // 在渲染进程中执行 window.__ai.emit(event, payload)，等待返回值
    const result = await page.evaluate(
      ({ ev, pl }: { ev: string; pl: unknown }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any
        const ai = w.__ai as { emit: (e: string, p?: unknown) => unknown } | undefined
        if (!ai || typeof ai.emit !== 'function') {
          throw new Error('window.__ai 未就绪（编辑器 AIModule 未注入）')
        }
        return ai.emit(ev, pl)
      },
      { ev: event, pl: payload ?? {} },
    )

    return { ok: true, event, result }
  } catch (err) {
    return { ok: false, event, error: `事件调用失败: ${err}` }
  }
}

export const editorEmitTool = {
  name: 'editor_emit',
  description: `调用编辑器 AI 事件（通过 CDP 在渲染进程中执行 window.__ai.emit）。

可用编辑器事件：
- editor.getState: 获取编辑器完整状态 {}
- editor.togglePanel: 开关面板 { panel: 'scene'|'game'|'inspector'|'console'|'project' }
- editor.setActiveTab: 切换视口页签 { tabId: 'scene'|'game'|'bp:...' }
- editor.openBlueprint: 打开蓝图编辑器 { assetPath: 'src/projects/fish/asset/unit.fish.blueprint.json' }
- editor.openScenePreview: 打开场景预览 { assetPath: '...' }
- editor.closeTab: 关闭动态页签 { tabId: '...' }
- editor.switchProject: 切换工程 { folder: 'fish' }
- editor.setLeftPanelTab: 切换左侧页签 { tab: 'outline'|'assets'|'ui' }
- editor.clearConsole: 清空控制台 {}
- editor.toggleConsole: 开关控制台 {}
- editor.setGizmos: 开关 Gizmo { enabled: true|false }

也可调用游戏层事件：
- ai.getState: 获取游戏运行状态
- ai.clickActor: 点击游戏 UI 按钮 { name: '...' }
等等...`,
  parameters: {
    type: 'object',
    properties: {
      event: { type: 'string', description: '事件名（如 editor.getState）' },
      payload: { type: 'object', description: '事件载荷' },
    },
    required: ['event'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        event: { type: 'string' },
        result: {},
        error: { type: 'string' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: editorEmit,
}
