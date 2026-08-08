/**
 * Component — 兼容层（已迁移）
 *
 * 原 Component 基类已更名为 ActorComponent（语义：Actor 专用组件）。
 * 本文件保留旧导出，避免破坏既有引用；新代码请直接使用：
 *   - ActorComponent    → Actor 组件基类（含可编辑属性体系）
 *   - BObjectComponent  → BObject（含 Actor）组件基类（含生命周期）
 *   - AObjectComponent  → AObject 组件基类（最底层基础）
 */
export { ActorComponent } from './ActorComponent'
export { ActorComponent as Component } from './ActorComponent'
export type {
  EditableProperty,
  EditablePropertyType,
  EditablePropertyAssetTarget,
} from './ActorComponent'

