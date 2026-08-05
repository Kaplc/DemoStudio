/**
 * TransformComponent — 变换组件
 *
 * 模仿 Unity Transform：把 Actor 的"位置/旋转/缩放修改能力"组件化。
 * 数据驱动：blueprint { baseClass: 'TransformComponent', properties: { position?, rotation?, scale? } }。
 *
 * 与 Actor 内置 setPosition/setRotation/setScale 的关系：
 *  - 本组件是"修改能力"的组件化入口（编辑器/数据流统一经组件读写）
 *  - 底层仍操作 owner.root（Actor.root 是唯一变换来源，二者等价）
 *  - Actor 内置方法保留（引擎内部与游戏逻辑仍在用，不受影响）
 */
import type { Actor } from './Actor'
import { Component, type EditableProperty } from './Component'
import { logger } from '../Logger'

export interface TransformComponentOptions {
  /** 世界位置 [x, y, z]，默认 [0, 0, 0] */
  position?: [number, number, number]
  /** 欧拉旋转 [x, y, z]（度），默认 [0, 0, 0] */
  rotation?: [number, number, number]
  /** 缩放 [x, y, z]，默认 [1, 1, 1] */
  scale?: [number, number, number]
}

export class TransformComponent extends Component {
  constructor(owner: Actor, options: TransformComponentOptions = {}) {
    super(owner)
    this.name = 'TransformComponent'
    if (options.position) this.setPosition(options.position[0], options.position[1], options.position[2])
    if (options.rotation) this.setRotation(options.rotation[0], options.rotation[1], options.rotation[2])
    if (options.scale) this.setScale(options.scale[0], options.scale[1], options.scale[2])
    logger.debug(
      `[TransformComponent] 创建 "${this.name}": position=${this.owner.position.x},${this.owner.position.y},${this.owner.position.z}`,
    )
  }

  // ─── 读取（转发 owner.root） ───

  get position() { return this.owner.position }
  get rotation() { return this.owner.rotation }
  get scale() { return this.owner.scale }

  // ─── 修改（组件化入口） ───

  setPosition(x: number, y: number, z: number): void {
    this.owner.setPosition(x, y, z)
    logger.debug(`[TransformComponent] "${this.name}" 设置位置: ${x}, ${y}, ${z}`)
  }

  setRotation(x: number, y: number, z: number): void {
    this.owner.setRotation(x, y, z)
    logger.debug(`[TransformComponent] "${this.name}" 设置旋转: ${x}, ${y}, ${z}`)
  }

  setScale(x: number, y: number, z: number): void {
    this.owner.setScale(x, y, z)
    logger.debug(`[TransformComponent] "${this.name}" 设置缩放: ${x}, ${y}, ${z}`)
  }

  // ─── Inspector 属性展示 ───

  override getProperties(): Record<string, unknown> {
    const p = this.position
    const r = this.rotation
    const s = this.scale
    return {
      position: [round3(p.x), round3(p.y), round3(p.z)],
      rotation: [round3(r.x), round3(r.y), round3(r.z)],
      scale: [round3(s.x), round3(s.y), round3(s.z)],
    }
  }

  /** Inspector 可编辑属性：位置/旋转/缩放（vec3，camelCase 与 JSON 属性名一致） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'position', type: 'vec3', step: 0.01,
        get: () => [round3(this.position.x), round3(this.position.y), round3(this.position.z)],
        set: (v) => this.setPosition((v as number[])[0], (v as number[])[1], (v as number[])[2]),
      },
      {
        key: 'rotation', type: 'vec3', step: 1,
        get: () => [round3(this.rotation.x), round3(this.rotation.y), round3(this.rotation.z)],
        set: (v) => this.setRotation((v as number[])[0], (v as number[])[1], (v as number[])[2]),
      },
      {
        key: 'scale', type: 'vec3', step: 0.01,
        get: () => [round3(this.scale.x), round3(this.scale.y), round3(this.scale.z)],
        set: (v) => this.setScale((v as number[])[0], (v as number[])[1], (v as number[])[2]),
      },
    ]
  }

  /**
   * 持久化：position/rotation/scale 由 collectSaveData 统一回写
   * （含 gizmo 拖拽 / 角把手拖拽结果，与 actor 实时变换一致），此处不输出。
   */
  override getPersistentProps(): Record<string, unknown> {
    return {}
  }
}

/** 保留 3 位小数的数值（Inspector 展示用） */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 确保 Actor 已挂载 TransformComponent（组件化约定：每个 Actor 都有变换组件）。
 * 数据里显式配置了 transform 组件（widget 等）则复用；否则以当前变换补挂。
 * 实例化入口（World / UIManager）在组件循环后调用。
 */
export function ensureTransformComponent(actor: Actor): TransformComponent {
  let tf = actor.getComponent(TransformComponent)
  if (!tf) {
    tf = new TransformComponent(actor)
    actor.addComponent(tf)
    logger.debug(`[TransformComponent] 自动补挂到 "${actor.name}" (uid=${actor.uid})`)
  }
  return tf
}
