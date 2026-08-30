/**
 * robustDefine.ts — cordis_define_robust + cordis_unwrap_demo 工具
 *
 * 解决模型把嵌套对象参数序列化成字符串导致 cordis_define oneOf 校验失败的问题。
 * 参数全部使用字符串，内部强力反序列化，再通过 ctx 调用宿主 dynamicCordisRunner.define。
 */
import { z } from 'zod'

/**
 * 强力反序列化：兼容模型把对象序列化成双重/多重编码字符串。
 * 循环剥引号 + JSON.parse，兼容正常 JSON、双重编码、键值串。
 */
export function robustUnwrap(input: unknown): unknown {
  if (typeof input !== 'string') return input
  let s = input.trim()
  for (let i = 0; i < 8; i++) {
    if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      try {
        const unquoted: unknown = JSON.parse(s)
        if (typeof unquoted === 'string') { s = unquoted.trim(); continue }
        return unquoted
      } catch { break }
    }
    if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') {
      try {
        const obj: unknown = JSON.parse(s)
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
      } catch { break }
    }
    break
  }
  // key=value&... 形式
  if (s.indexOf('=') > 0) {
    const kv: Record<string, string> = {}
    s.split(/[&;]/).forEach((pair) => {
      const eq = pair.indexOf('=')
      if (eq > 0) kv[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    })
    if (kv.kind || kv.idPrefix || kv.pluginId) return kv
  }
  return s
}

// ─── cordis_define_robust ────────────────────────────────────────────

export const cordisDefineRobustSchema = z.object({
  pluginSpec: z.string().describe('插件身份描述（任意形态，自动解析）'),
  name: z.string().describe('包名'),
  purpose: z.string().describe('用途说明'),
  hostCode: z.string().optional().describe('Host 半代码'),
  clientCode: z.string().optional().describe('Client 半代码'),
})

export const cordisDefineRobustTool = {
  name: 'cordis_define_robust',
  description:
    '与 cordis_define 等价但 plugin 参数以字符串传入，内部强力反序列化兼容模型的双重编码，'
    + '再走宿主真正的 define 通道。pluginSpec 支持 JSON 字符串、双重引号编码、或 kind=new&idPrefix=xxx 键值串。',
  parameters: {
    pluginSpec: { type: 'string', description: '插件身份描述（任意形态，自动解析）' },
    name: { type: 'string', description: '包名' },
    purpose: { type: 'string', description: '用途说明' },
    hostCode: { type: 'string', description: 'Host 半代码' },
    clientCode: { type: 'string', description: 'Client 半代码' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        pluginId: { type: 'string' },
        packageId: { type: 'string' },
        hasHostHalf: { type: 'boolean' },
        hasClientHalf: { type: 'boolean' },
      },
    },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: z.infer<typeof cordisDefineRobustSchema>, ctx: unknown): Promise<unknown> => {
    const plugin = robustUnwrap(args.pluginSpec) as Record<string, string> | null
    if (!plugin || typeof plugin !== 'object' || (plugin.kind !== 'new' && plugin.kind !== 'existing')) {
      throw new Error('解析后的 plugin 必须是 {kind:"new",idPrefix} 或 {kind:"existing",pluginId}，实际: ' + JSON.stringify(plugin))
    }
    if (plugin.kind === 'new' && !/^[a-z]{3,6}$/.test(String(plugin.idPrefix || ''))) {
      throw new Error('idPrefix 必须是 3-6 个小写字母，实际: ' + String(plugin.idPrefix))
    }
    // 通过 ctx 访问宿主服务（不需要 inject 声明，用 get 做 optional lookup）
    const c = ctx as Record<string, unknown> | null
    const getRunner = (): unknown => {
      if (c && typeof c === 'object' && 'dynamicCordisRunner' in c) return c.dynamicCordisRunner
      if (c && typeof (c as any).get === 'function') return (c as any).get('dynamicCordisRunner')
      return undefined
    }
    const runner = getRunner() as Record<string, unknown> | undefined
    if (!runner || typeof runner.define !== 'function') throw new Error('dynamicCordisRunner 服务不可用')
    const getAgents = (): unknown => {
      if (c && typeof c === 'object' && 'agents' in c) return c.agents
      if (c && typeof (c as any).get === 'function') return (c as any).get('agents')
      return undefined
    }
    const agents = getAgents() as Record<string, (() => unknown) | undefined> | undefined
    const agent = agents?.currentInitiator?.() as Record<string, unknown> | undefined
    const sessionId = agent?.id as string | undefined
    if (!sessionId) throw new Error('无法获取 sessionId，请确保在 Agent 会话中使用')
    const receipt = (runner.define as (req: unknown) => unknown)({
      sessionId,
      plugin,
      name: args.name,
      purpose: args.purpose,
      code: {
        ...(args.hostCode === undefined ? {} : { host: args.hostCode }),
        ...(args.clientCode === undefined ? {} : { client: args.clientCode }),
      },
    }) as Record<string, unknown>
    return {
      ok: true,
      pluginId: String(receipt.pluginId),
      packageId: String(receipt.packageId),
      hasHostHalf: receipt.hasHostHalf,
      hasClientHalf: receipt.hasClientHalf,
    }
  },
}

// ─── cordis_unwrap_demo ─────────────────────────────────────────────

export const cordisUnwrapDemoSchema = z.object({
  input: z.string().describe('待解析的字符串'),
})

export const cordisUnwrapDemoTool = {
  name: 'cordis_unwrap_demo',
  description: '演示 robustUnwrap：传入任意被模型序列化坏掉的 plugin 字符串，返回解析结果。',
  parameters: {
    input: { type: 'string', description: '待解析的字符串' },
  },
  output: {
    schema: { type: 'object' },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args: z.infer<typeof cordisUnwrapDemoSchema>): Promise<unknown> => {
    const result = robustUnwrap(args.input)
    return { input: args.input, inputType: typeof args.input, result, resultType: typeof result }
  },
}
