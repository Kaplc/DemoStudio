/**
 * GMCommand — GM 命令定义类型（引擎级调试命令系统）
 *
 * 一个命令 = 一个 `*.gm.ts` 文件默认导出的 `GMCommandDef` 对象：
 *   - name：调用名（execute 时命令行的第一个词）
 *   - params：声明式参数（int/float/string/bool），GMModule 负责类型转换与校验
 *   - handler：同步执行函数，签名 (ctx, ...typedArgs)
 *
 * 注册：GMRegistry（静态注册表）接收项目 register.ts 的 import.meta.glob 结果，
 * id 由文件路径推导（如 'gameplay/gm/addCoins'），与 ScriptRegistry 的
 * globKeyToScriptId 同风格。id 用于唯一标识与查重，name 用于调用。
 */
import type { GameInstance } from '../gameflow/GameInstance'
import type { Logger } from '../Logger'

/** 命令参数类型（仅标量，不支持数组/复杂类型） */
export type GMCommandParamType = 'int' | 'float' | 'string' | 'bool'

/** 命令参数声明 */
export interface GMCommandParam {
  /** 参数名（帮助文本/报错回显用） */
  name: string
  /** 参数类型 */
  type: GMCommandParamType
  /** 是否必填（缺省 true） */
  required?: boolean
  /** 参数说明 */
  desc?: string
  /** 默认值（仅对非 required 参数生效） */
  default?: number | string | boolean
}

/**
 * GM 命令执行上下文（最小上下文）：
 *  - gameInstance：实际为项目子类实例（如 FishGameInstance），
 *    命令自行强转获取 world/gameMode/resources 等全部能力
 *  - output：统一输出通道（控制台面板显示 + AI 桥接回传）
 *  - logger：引擎日志器（带 [GM] 前缀输出到日志文件）
 */
export interface GMCommandContext {
  gameInstance: GameInstance
  output: (text: string) => void
  logger: Logger
}

/** 转换后的参数值类型（与 GMCommandParamType 一一对应） */
export type GMCommandArg = number | string | boolean

/** 命令 handler：仅同步（不支持 async） */
export type GMCommandHandler = (ctx: GMCommandContext, ...args: GMCommandArg[]) => void

/** 命令定义（*.gm.ts 文件默认导出对象） */
export interface GMCommandDef {
  /** 调用名（必填，如 'addCoins'） */
  name: string
  /** 帮助文本（必填，help 命令列出） */
  description: string
  /** 可选：true 表示仅 GM 模式开启时可执行（默认 false） */
  gmOnly?: boolean
  /** 可选参数声明 */
  params?: GMCommandParam[]
  /** 执行函数（同步） */
  handler: GMCommandHandler
}

/** 参数类型转换：字符串 → 目标类型；非法返回 null（含空串） */
export function convertGMArg(raw: string, type: GMCommandParamType): GMCommandArg | null {
  switch (type) {
    case 'int': {
      if (!/^-?\d+$/.test(raw.trim())) return null
      const v = parseInt(raw.trim(), 10)
      return Number.isFinite(v) ? v : null
    }
    case 'float': {
      if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return null
      const v = parseFloat(raw.trim())
      return Number.isFinite(v) ? v : null
    }
    case 'bool': {
      const t = raw.trim().toLowerCase()
      if (t === 'true' || t === '1') return true
      if (t === 'false' || t === '0') return false
      return null
    }
    case 'string':
    default:
      return raw
  }
}

/** 参数声明 → 用法字符串（如 'addCoins <amount:int> [silent:bool]'） */
export function formatGMUsage(def: GMCommandDef): string {
  const parts = def.params?.map((p) => {
    const token = `${p.name}:${p.type}`
    return p.required === false ? `[${token}]` : `<${token}>`
  }) ?? []
  return [def.name, ...parts].join(' ')
}

/**
 * 参数声明 → 可执行命令字符串（点击命令按钮填入输入框用）。
 * 必填参数用类型默认值（int→1, float→1.0, string→跳过, bool→true），
 * 可选参数用 default 值（有则填入，无则省略）。
 */
export function formatGMExecutable(def: GMCommandDef): string {
  const parts: string[] = [def.name]
  for (const p of def.params ?? []) {
    if (p.required === false && p.default === undefined) continue
    const val = p.default ?? (p.type === 'int' ? 1 : p.type === 'float' ? 1.0 : p.type === 'bool' ? true : null)
    if (val === null) continue // 必填 string 无默认值时跳过（用户需自行填写）
    // float 保留原始精度，但整数值补 ".0"（JS 的 2.0 → "2"，需补 ".0" 确保命令行解析为 float）
    const s = String(val)
    parts.push(p.type === 'float' && !s.includes('.') ? s + '.0' : s)
  }
  return parts.join(' ')
}
