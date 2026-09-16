/**
 * dsl — 蓝图 TS 源的 DSL helper（doc-dev/bp-ts-compile 方案 §4.2）
 *
 * 纯函数、零引擎运行时依赖（只许 import type）——保证可被 esbuild 安全打包进用户源 bundle。
 * children 用普通对象字面量（name/baseClass/children 直接写，配合 spread 最灵活）；
 * helper 只做组件层的高频语法糖。组件 properties 一期宽松类型（Record<string, unknown>），
 * schema 校验交给 assetLint comp:* 检查器（它比 TS 类型更权威）。
 *
 * 使用范式：
 * ```ts
 * export default defineBlueprint({
 *   build: () => ({
 *     name: 'Demo',
 *     components: [transform([0, 0, 0]), comp('SphereMeshComponent', { radius: 38 })],
 *     children: [{ name: 'Pylon', components: [transform([0, 1, 0])] }],
 *   }),
 * })
 * ```
 */
import type { PropertyPatch } from '../../../engine/tools/deepMerge'

/** 对齐引擎 TransformComponent 的三维向量 */
export type Vec3 = [number, number, number]

/** 蓝图组件输入（显式 id 优先；缺省由编译器分配——仅子节点自动分配，组件不分配） */
export interface BpComponentInput {
  /** Component 注册类型（ComponentRegistry key），如 'SphereMeshComponent' */
  baseClass: string
  /** 组件显示名称 */
  name?: string
  /** 显式组件 id（该蓝图内唯一）；缺省保留无 id */
  id?: number
  /** 组件特有属性（构造参数 + 可配置属性） */
  properties?: Record<string, unknown>
}

/** 蓝图子 Actor 输入（与手写 BlueprintChildDef 对齐，ref 与 baseClass 互斥） */
export interface BpChildInput {
  /** 子 Actor 名（具名子节点用于继承链合并定位；无 name 则纯追加） */
  name?: string
  /** 显式子节点 id（文件内唯一）；缺省由编译器从 10001 起先序递增分配 */
  id?: number
  /** 引用另一个蓝图资产（asset/**\/*.blueprint.json），与 baseClass 互斥 */
  ref?: string
  /** 内联的 ActorRegistry 类型（缺省不允许——编译器报 child-missing-type） */
  baseClass?: string
  /** 子 Actor 的默认属性覆盖（仅 ref 引用时有效） */
  overrides?: PropertyPatch
  /** 内联组件列表 */
  components?: BpComponentInput[]
  /** 是否激活（false = 已创建但不渲染，作用于该节点及整个子树） */
  active?: boolean
  /** 递归嵌套子 Actor */
  children?: BpChildInput[]
}

/** 蓝图根输入（build() 的返回值） */
export interface BpRootInput {
  /** 蓝图显示名称（必填非空） */
  name: string
  /** baseClass（ActorRegistry key）；缺省由编译器补 'Actor' */
  baseClass?: string
  /** 根组件列表（缺省补 []；位置/旋转/缩放写 transform()，顶层禁止 position 等旧字段） */
  components?: BpComponentInput[]
  /** 子 Actor 列表（缺省补 []） */
  children?: BpChildInput[]
}

/** defineBlueprint 的入参与返回值（恒等；仅作类型锚点） */
export interface BlueprintDef {
  build: () => BpRootInput
}

/** 恒等函数：给 build 箭头函数提供类型锚点与编译器 duck 校验目标（须 default export 其返回值） */
export function defineBlueprint(def: BlueprintDef): BlueprintDef {
  return def
}

/** 组件语法糖：properties/name 未传时不产出对应键（保持产物无 undefined 键） */
export function comp(
  baseClass: string,
  properties?: Record<string, unknown>,
  name?: string,
): BpComponentInput {
  const out: BpComponentInput = { baseClass }
  if (properties !== undefined) out.properties = properties
  if (name !== undefined) out.name = name
  return out
}

/** 变换组件语法糖：rotation 缺省 [0,0,0]，scale 缺省 [1,1,1]（中性值——补 0 会把 Actor 压成一点） */
export function transform(position: Vec3, rotation?: Vec3, scale?: Vec3): BpComponentInput {
  return {
    baseClass: 'TransformComponent',
    properties: {
      position,
      rotation: rotation ?? [0, 0, 0],
      scale: scale ?? [1, 1, 1],
    },
  }
}

/** 盒体网格组件语法糖（MeshComponent 是抽象基类、assetLint 禁止直接挂载，故糖固定 BoxMeshComponent） */
export function mesh(properties: Record<string, unknown>): BpComponentInput {
  return { baseClass: 'BoxMeshComponent', properties }
}

/**
 * 游戏脚本组件语法糖。
 * 产物 = { baseClass: 'UIScriptComponent', properties: { script } }；
 * 带 args 时 properties.args = args，不带时无 args 键（与 uiCompiler emitDataScript 一致）。
 */
export function scriptRef(scriptId: string, args?: unknown): BpComponentInput {
  const properties: Record<string, unknown> = { script: scriptId }
  if (args !== undefined) properties.args = args
  return { baseClass: 'UIScriptComponent', properties }
}
