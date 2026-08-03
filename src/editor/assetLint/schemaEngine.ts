/**
 * assetLint/schemaEngine — 声明式 schema 校验引擎
 *
 * 纯函数 validateBySchema：按 FieldSpec[] 逐条校验节点字段，产出 LintIssue[]。
 * 能力：dot 路径取值、类型检查、值域（含严格不等）、枚举、color 正则、向量分量、数组元素。
 *
 * 覆盖约 90% 的校验场景；少数关系型校验（如 opacity<1 需配 transparent）由 checker 的
 * validate() 钩子补足，避免把 schema 膨胀成迷你 DSL。
 */
import type { FieldSpec, LintIssue, CheckerContext, FieldType } from './types'

/** CSS hex 颜色：#rgb / #rgba / #rrggbb / #rrggbbaa */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
/** CSS rgb()/rgba() 颜色：数字分量 + 可选 alpha */
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0?\.\d+|\d(?:\.\d+)?%?)\s*)?\)$/

/** 按 dot 路径取值；中间 undefined 直接返回 undefined（不报中间缺失）。 */
function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined
  let cur: any = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

/** 判断值是否符合 FieldType。 */
function matchesType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'color':
      return typeof value === 'string' && (HEX_RE.test(value) || RGB_RE.test(value))
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'any':
      return true
    case 'vec2':
      return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number')
    case 'vec3':
      return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')
    default:
      return true
  }
}

/** 向量/数值的可读展示（用于消息）。 */
function numList(value: unknown): string {
  return Array.isArray(value) ? `[${(value as number[]).join(',')}]` : String(value)
}

/** 人类可读的值类型描述（用于 type mismatch 消息）。 */
function describe(value: unknown): string {
  if (Array.isArray(value)) return `array(length=${value.length})`
  if (value === null) return 'null'
  return typeof value
}

/** 对一组数值分量做 min/max（含严格不等）校验，最多产一条 issue。 */
function rangeCheck(spec: FieldSpec, values: number[], ctx: CheckerContext): LintIssue[] {
  const issues: LintIssue[] = []
  const sev = spec.severity ?? 'warn'
  for (const v of values) {
    if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) {
      issues.push(
        ctx.issue(
          spec.field,
          `${spec.field}-min`,
          `${spec.label ?? spec.field} 值 ${numList(values)} 必须 ${spec.minExclusive ? '>' : '>='} ${spec.min}`,
          sev,
          values,
        ),
      )
      break
    }
    if (spec.max !== undefined && (spec.maxExclusive ? v >= spec.max : v > spec.max)) {
      issues.push(
        ctx.issue(
          spec.field,
          `${spec.field}-max`,
          `${spec.label ?? spec.field} 值 ${numList(values)} 必须 ${spec.maxExclusive ? '<' : '<='} ${spec.max}`,
          sev,
          values,
        ),
      )
      break
    }
  }
  return issues
}

/**
 * 按 schema 校验单个节点，产出违规列表。
 * @param node   被校验的节点对象
 * @param schema 字段规则列表
 * @param ctx    运行时上下文（用于构造带定位的 issue）
 */
export function validateBySchema(node: unknown, schema: FieldSpec[], ctx: CheckerContext): LintIssue[] {
  const issues: LintIssue[] = []

  for (const spec of schema) {
    const value = getByPath(node, spec.field)
    const sev: 'error' | 'warn' = spec.severity ?? (spec.required ? 'error' : 'warn')

    // 1. 缺失
    if (value === undefined || value === null) {
      if (spec.required) {
        issues.push(
          ctx.issue(spec.field, `${spec.field}-required`, `缺失必填字段 ${spec.label ?? spec.field}`, 'error'),
        )
      }
      continue
    }

    // 2. 类型不匹配（后续值域校验无意义，跳过）
    if (!matchesType(value, spec.type)) {
      issues.push(
        ctx.issue(
          spec.field,
          `${spec.field}-type`,
          `字段 ${spec.label ?? spec.field} 期望 ${spec.type}，实际 ${describe(value)}`,
          sev,
          value,
        ),
      )
      continue
    }

    // 3. 枚举白名单
    if (spec.enum && !spec.enum.includes(value as string | number)) {
      issues.push(
        ctx.issue(
          spec.field,
          `${spec.field}-enum`,
          `字段 ${spec.label ?? spec.field} 取值 ${JSON.stringify(value)} 不在允许范围 [${spec.enum
            .map(String)
            .join('|')}]`,
          sev,
          value,
        ),
      )
    }

    // 4. 正则（string）
    if (spec.type === 'string' && spec.pattern && typeof value === 'string') {
      if (!new RegExp(spec.pattern).test(value)) {
        issues.push(
          ctx.issue(spec.field, `${spec.field}-pattern`, `字段 ${spec.label ?? spec.field} 不匹配模式 /${spec.pattern}/`, sev, value),
        )
      }
    }

    // 5. 值域（number/integer 直接；vec2/vec3 作用于各分量）
    if (spec.type === 'number' || spec.type === 'integer') {
      issues.push(...rangeCheck(spec, [value as number], ctx))
    } else if (spec.type === 'vec2' || spec.type === 'vec3') {
      issues.push(...rangeCheck(spec, value as number[], ctx))
    }

    // 6. 数组长度 + 元素类型
    if (spec.type === 'array') {
      const arr = value as unknown[]
      if (spec.minItems !== undefined && arr.length < spec.minItems) {
        issues.push(ctx.issue(spec.field, `${spec.field}-minItems`, `数组 ${spec.label ?? spec.field} 长度 ${arr.length} < ${spec.minItems}`, sev, value))
      }
      if (spec.maxItems !== undefined && arr.length > spec.maxItems) {
        issues.push(ctx.issue(spec.field, `${spec.field}-maxItems`, `数组 ${spec.label ?? spec.field} 长度 ${arr.length} > ${spec.maxItems}`, sev, value))
      }
      if (spec.itemsType) {
        arr.forEach((el, i) => {
          if (!matchesType(el, spec.itemsType!)) {
            issues.push(
              ctx.issue(
                `${spec.field}[${i}]`,
                `${spec.field}-itemsType`,
                `数组元素 ${spec.field}[${i}] 期望 ${spec.itemsType}，实际 ${describe(el)}`,
                sev,
                el,
              ),
            )
          }
        })
      }
    }
  }

  return issues
}

/**
 * 未知属性检查：schema 声明了哪些 properties.* 字段，节点 properties 里出现
 * 未声明的 key 就报 unknown-property 违规（error），防止资产出现 schema 外脏字段
 * （如给 UIImageComponent 写 position、随意添加组件不支持的自定义字段等）。
 *
 * 只收集 schema 中 'properties.' 前缀的 field 名；非 properties 段的字段（如顶层
 * position/rotation/scale、id/name 等）不参与。未提供 schema（[]）时视为无约束，跳过。
 *
 * @param props   组件节点上的 properties 对象（必须为 object，否则返回空）
 * @param schema  该组件类型注册的 FieldSpec 列表
 * @param ctx     运行时上下文（构造带定位的 issue）
 */
export function validateUnknownProperties(
  props: unknown,
  schema: FieldSpec[],
  ctx: CheckerContext,
): LintIssue[] {
  const issues: LintIssue[] = []
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return issues
  if (!schema || schema.length === 0) return issues

  // 收集 schema 允许的 properties.* key（按首个 '.' 截断，properties.a.b → a）
  const allowed = new Set<string>()
  for (const spec of schema) {
    if (!spec.field.startsWith('properties.')) continue
    const rest = spec.field.slice('properties.'.length)
    const key = rest.includes('.') ? rest.slice(0, rest.indexOf('.')) : rest
    allowed.add(key)
  }

  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (!allowed.has(k)) {
      issues.push(
        ctx.issue(
          `properties.${k}`,
          'unknown-property',
          `未知属性 "properties.${k}"：该组件不允许此字段（schema 未声明）`,
          'error',
          v,
        ),
      )
    }
  }
  return issues
}
