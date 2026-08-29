/**
 * inspect_scene：读取场景资产的结构摘要
 *
 * 实现：读 .scene.json 字段，列出 root actors + 组件类型（不执行引擎）
 *
 * DSH schema（model 推理时给 LLM 看）：
 * - scenePath 可选：省略时取项目当前打开的场景（M2 通过 ai_event 拉）
 * - 返回：actor 列表（name + 组件类型）+ 统计
 */
import { z } from 'zod'
import { getEngineContext } from '../engineContext'

export const inspectSceneSchema = z.object({
  scenePath: z.string().optional().describe('场景资产相对路径（如 src/projects/eatfish/eatfish.scene.json）；省略时取当前打开场景'),
})

export interface SceneActorSummary {
  name: string
  components: string[]
}

export interface InspectSceneResult {
  scenePath: string
  totalActors: number
  actors: SceneActorSummary[]
  warnings: string[]
}

interface SceneAsset {
  name?: string
  objects?: Array<{
    name?: string
    components?: Array<{ type?: string } | string>
  }>
}

function flattenComponents(components: SceneAsset['objects'] extends infer T ? T : never): never {
  return undefined as never
}

function summarizeScene(scene: SceneAsset): { actors: SceneActorSummary[]; warnings: string[] } {
  const warnings: string[] = []
  const actors: SceneActorSummary[] = []
  if (!scene.objects || !Array.isArray(scene.objects)) {
    warnings.push('场景不含 objects 字段')
    return { actors, warnings }
  }
  for (const obj of scene.objects) {
    if (!obj || typeof obj !== 'object') continue
    const name = obj.name ?? '<unnamed>'
    const comps: string[] = []
    if (Array.isArray(obj.components)) {
      for (const c of obj.components) {
        if (typeof c === 'string') comps.push(c)
        else if (c && typeof c === 'object' && typeof c.type === 'string') comps.push(c.type)
      }
    }
    actors.push({ name, components: comps })
  }
  return { actors, warnings }
}

export async function inspectScene(args: z.infer<typeof inspectSceneSchema>, ctx: unknown): Promise<InspectSceneResult> {
  const ec = getEngineContext(ctx)
  if (!ec) {
    return { scenePath: args.scenePath ?? '', totalActors: 0, actors: [], warnings: ['EngineContext 未注入（编辑器未连接）'] }
  }
  // 1. 取场景路径（未指定 → 调 ai_event ai.getState 或读当前项目状态）
  let scenePath = args.scenePath
  if (!scenePath) {
    const state = await ec.engineBridge.callTool('ai_event', { event: 'ai.getState', payload: {} })
    const stateObj = state as { data?: { scenePath?: string } } | null
    scenePath = stateObj?.data?.scenePath ?? ''
  }
  if (!scenePath) {
    return { scenePath: '', totalActors: 0, actors: [], warnings: ['未指定 scenePath 且当前无打开场景'] }
  }
  // 2. 读 JSON
  const file = await ec.fileBridge.readJsonFile(scenePath)
  if (!file || typeof file !== 'object') {
    return { scenePath, totalActors: 0, actors: [], warnings: [`场景文件读取失败: ${scenePath}`] }
  }
  const { actors, warnings } = summarizeScene(file as SceneAsset)
  return { scenePath, totalActors: actors.length, actors, warnings }
}

// shape helper to silence unused warning
void flattenComponents

export const inspectSceneTool = {
  name: 'inspect_scene',
  description: '读取 DemoStudio 场景资产结构摘要（root actors + 组件类型 + 统计）。scenePath 可省略，省略时取当前打开场景。仅读取，不修改。',
  parameters: {
    scenePath: {
      type: 'string',
      description: '场景资产相对路径（如 src/projects/eatfish/eatfish.scene.json）；省略时取当前打开场景',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scenePath: { type: 'string' },
        totalActors: { type: 'number' },
        actors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              components: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: inspectScene,
}
