/**
 * OObject — 引擎对象体系的最顶层基类
 *
 * 完全空的对象根，仅作为类型标记（marker）存在：
 * 所有引擎对象（AObject/BObject/Actor/GameMode/...）统一收拢到 OObject 名下，
 * 便于"是否是引擎对象"的类型判断与未来公共能力的挂载点。
 *
 * 分层：
 *   OObject（本类：完全空，仅标记）
 *    └── AObject（+ 组件系统）
 *         └── BObject（+ uid/name + 生命周期 + 序列化）
 *              ├── Actor（场景对象）
 *              ├── GameMode / GameState / PlayerController（非场景对象）
 */
export abstract class OObject {}
