/**
 * UIScriptComponent — UI 资产「挂载脚本」组件（Unity MonoBehaviour 挂载点）
 *
 * 数据驱动：在 widget 蓝图里给某个 UI 节点加上本组件，并在 properties.script 指定
 * 已注册的脚本 id，引擎实例化该节点时即自动创建脚本实例、注入宿主 Actor 并接入
 * 生命周期（onStart / onUpdate / onDestroy）。从而把「UI 结构」与「行为」解耦——
 * 无需在 GameInstance 里手写遍历 UI 树按名字绑定的代码。
 *
 * 数据配置：
 *   { baseClass: 'UIScriptComponent', properties: { script: 'gameplay/base/BaseHud', args?: {...} } }
 *
 * 脚本 id 由项目 asset/index.ts 的 import.meta.glob 自动扫描注册（见 ScriptRegistry）。
 */
import { Component, type EditableProperty } from '../entity/Component'
import type { Actor } from '../entity/Actor'
import { BehaviourScript } from '../script/BehaviourScript'
import { ScriptRegistry } from '../script/ScriptRegistry'
import { logger } from '../Logger'

export class UIScriptComponent extends Component {
  /** 已注册的脚本 id（路径式，如 'gameplay/base/BaseHud'） */
  public script = ''
  /** 传给脚本 onStart 的可选参数 */
  public args?: Record<string, unknown>

  /** 实例化后的脚本实例（BeginPlay 后可用，便于外部代码访问） */
  instance: BehaviourScript | null = null

  constructor(owner: Actor, name = 'UIScriptComponent') {
    super(owner)
    this.name = name
  }

  override BeginPlay() {
    super.BeginPlay()
    if (!this.script) {
      logger.warn(`[UIScriptComponent] "${this.owner.name}" 未配置 script，跳过`)
      return
    }
    const inst = ScriptRegistry.create(this.script)
    if (!inst) {
      logger.error(
        `[UIScriptComponent] 脚本 "${this.script}" 未注册（owner="${this.owner.name}"）。已注册: [${ScriptRegistry.getRegisteredIds().join(', ')}]`,
      )
      return
    }
    inst.actor = this.owner
    this.instance = inst
    try {
      inst.onStart(this.args)
      logger.info(`[UIScriptComponent] 脚本 "${this.script}" 已挂载到 "${this.owner.name}"`)
    } catch (e) {
      logger.error(`[UIScriptComponent] 脚本 "${this.script}" onStart 抛错: ${(e as Error).message}`)
    }
  }

  override Tick(deltaTime: number) {
    super.Tick(deltaTime)
    this.instance?.onUpdate(deltaTime)
  }

  override EndPlay() {
    super.EndPlay()
    try {
      this.instance?.onDestroy()
    } catch (e) {
      logger.error(`[UIScriptComponent] 脚本 "${this.script}" onDestroy 抛错: ${(e as Error).message}`)
    }
    this.instance = null
  }

  /** Inspector 属性展示 */
  override getProperties(): Record<string, unknown> {
    return { Script: this.script || '（未设置）', Args: this.args ?? null }
  }

  /** Inspector 可编辑属性：script（字符串）。args 不直接编辑（结构不定，由代码/JSON 配置） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'script',
        type: 'string',
        get: () => this.script,
        set: (v) => { this.script = (v as string) ?? '' },
      },
    ]
  }

  /** 持久化：仅 script（args 若需持久化可在 JSON 里直接写） */
  override getPersistentProps(): Record<string, unknown> {
    const out: Record<string, unknown> = { script: this.script }
    if (this.args !== undefined) out.args = this.args
    return out
  }
}
