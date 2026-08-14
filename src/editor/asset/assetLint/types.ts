/**
 * assetLint/types — 资产检查器共享类型定义
 *
 * - FieldSpec：驱动声明式 schema 校验，checker 只需声明字段规则即可
 * - CheckerKind：派发键命名空间，消解 'blueprint' 既是文档根又是节点 type 的歧义
 * - LintIssue：检查器产出的单条违规，filePath/nodePath/field/ruleId 组成去重指纹
 */

/** 字段值类型。vec2/vec3 校验"数组 + 长度 + 各分量 number"；color 校验 CSS hex 字符串。 */
export type FieldType =
  | 'number'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'vec2'
  | 'vec3'
  | 'color'
  | 'array'
  | 'object'
  | 'any'

/** 声明式字段规则。field 支持 dot 路径（如 'material.opacity'），遇中间 undefined 不报中间缺失。 */
export interface FieldSpec {
  field: string
  type: FieldType
  /** 必填缺失 → error */
  required?: boolean
  /** 数值 / 向量分量下界（含） */
  min?: number
  /** 数值 / 向量分量上界（含） */
  max?: number
  /** 严格不等：minExclusive 让 size 分量必须 > min */
  minExclusive?: boolean
  maxExclusive?: boolean
  /** 字符串 / 数字白名单 */
  enum?: (string | number)[]
  /** type='array' 时的元素类型 */
  itemsType?: FieldType
  minItems?: number
  maxItems?: number
  /** type='string' 时的正则 */
  pattern?: string
  /** 覆盖默认严重级别（默认 required→error，其余→warn） */
  severity?: 'error' | 'warn'
  /** issue 中展示的人类可读字段名 */
  label?: string
}

/**
 * 派发键（命名空间消歧义）：
 *   doc:scene / doc:blueprint  — 文档根（每文件命中一次）
 *   node:<SceneNode.type>      - 场景/蓝图内联节点（box/sphere/actor/ref/...）
 *   comp:<Component.type>      - 蓝图 component（mesh/sprite/camera/...）
 */
export type CheckerKind =
  | 'doc:scene'
  | 'doc:blueprint'
  | 'doc:ui-design'
  | `node:${string}`
  | `comp:${string}`

/** 单条违规。filePath::nodePath::field::ruleId 组成去重指纹。 */
export interface LintIssue {
  filePath: string
  nodePath: string
  field: string
  ruleId: string
  severity: 'error' | 'warn'
  message: string
  /** 实际值（诊断用，可选） */
  value?: unknown
}

/** AssetSource.list 返回的资产文件。ok=false 时 doc 为 null、error 含解析/读取错误。 */
export interface AssetFile {
  path: string
  ext: string
  ok: boolean
  doc: unknown
  error?: string
}

/** 检查器运行时上下文：定位当前节点，并提供便捷的 issue 构造器。 */
export interface CheckerContext {
  filePath: string
  nodePath: string
  /** 构造 issue（自动填充 filePath/nodePath） */
  issue: (
    field: string,
    ruleId: string,
    message: string,
    severity?: 'error' | 'warn',
    value?: unknown,
  ) => LintIssue
}
