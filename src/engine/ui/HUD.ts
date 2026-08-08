/**
 * HUD — 屏幕空间 UI 根容器
 * 模仿 UE AHUD（Actor），承载 GameMode 指定的 HUD 蓝图 UI 树。
 *
 * 职责（纯容器）：
 *  - 由 GameMode.HUDClass（blueprint 路径）声明
 *  - 承载 UI 树：UI Actor（从蓝图生成）attach 到本 HUD，随 HUD 进出场景
 *  - 不参与 UI 生成逻辑 —— UI Actor 的创建统一由 UIManager 负责
 *
 * 生命周期：
 *  - 创建：UIManager.createHUD() → new HUD() → SpawnActor → attachUI(uiActor)
 *  - 销毁：UIManager.destroyAll() 遍历 _uiActors 时 EndPlay（UI 子系统独立管理，不与 World.allActors 混管）
 */
import { Actor } from '../entity/Actor'

export class HUD extends Actor {
  /** 该 HUD 使用的蓝图路径（由 GameMode.HUDClass 声明） */
  blueprintPath: string | null = null

  /** 蓝图实例化的 UI 根 Actor（attach 到本 HUD） */
  private _uiActor: Actor | null = null

  constructor(name = 'HUD') {
    super(name)
  }

  /** 当前 UI Actor（可空） */
  get uiActor(): Actor | null { return this._uiActor }

  /** 是否已有 UI 内容 */
  get hasUI(): boolean { return this._uiActor !== null }

  /** 挂载 UI 根 Actor（由 UIManager 调用） */
  attachUI(uiActor: Actor): void {
    this._uiActor = uiActor
    uiActor.attachTo(this)
  }

  override EndPlay(): void {
    // UI Actor 同时也在 World.allActors 中，由 World 统一遍历 EndPlay。
    // 这里只清引用，不手动 destroy（避免双 EndPlay 重复释放 GPU 资源）。
    this._uiActor = null
    super.EndPlay()
  }
}
