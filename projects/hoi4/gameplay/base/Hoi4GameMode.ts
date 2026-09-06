/**
 * Hoi4GameMode — 大战略规则权威（plan P0-P4 引擎侧枢纽）
 *
 * 职责（规范 §2.3①）：持有 core（tables/map/state/gameTime），把 tick 驱动、
 * 选省/下令、部署、面板命令、事件决断、胜负、地图重染等规则集中在此；
 * UI 脚本经公开方法读状态/下命令，不直接改 core。
 *
 * 时序：表集异步加载（ConfigRegistry glob）→ tryBootstrap 建 core state →
 * 开闸 tick；地图图片异步加载与表加载互不阻塞。
 */
import { GameMode, PhySys, logger, GameInstance, GenericActor } from '@/engine'
import type { PlayerController } from '@/engine'
import { GameTime, formatGameDate } from '../core/GameTime'
import type { Hoi4Tables } from '../core/tables'
import { makeTables, findLaw } from '../core/tables'
import { MapData } from '../core/MapData'
import type { Hoi4State } from '../core/types'
import { createInitialState, tickHourly, tickDaily } from '../core/Hoi4State'
import { deployDivision, orderMove } from '../core/Military'
import { pickFocus, startResearch } from '../core/FocusSystem'
import { resolveEvent, declareWar, startJustify } from '../core/Diplomacy'
import { queueConstruction, addProductionLine } from '../core/Economy'
import { queueTraining } from '../core/Military'
import { ConfigRegistry } from '@/engine'
import { MapRenderComponent, type MapMode } from '../map/MapRenderComponent'
import { UnitMarkers } from '../map/UnitMarkers'
import { UnitModels } from '../map/UnitModels'
import { Hoi4CameraActor } from './Hoi4CameraActor'
import { Hoi4PlayerController } from './Hoi4PlayerController'
import { Hoi4Pawn } from './Hoi4Pawn'
import mapDefJson from '../../asset/map/map.json'
import provincesPngUrl from '../../asset/map/provinces.png'
import terrainPngUrl from '../../asset/map/terrain.png'
import type { MapDef } from '../core/types'

export class Hoi4GameMode extends GameMode {
  /** HUD：顶栏（全部面板入口在其 data-script 里管理） */
  override HUDClass = 'asset/blueprints/ui/topbar.widget.json'

  readonly map: MapData
  readonly gameTime = new GameTime()
  mapRender: MapRenderComponent | null = null
  markers: UnitMarkers | null = null
  models: UnitModels | null = null
  camera: Hoi4CameraActor

  /** core 整局状态（bootstrap 后非空） */
  coreState: Hoi4State | null = null
  private tables: Hoi4Tables | null = null
  private booted = false

  /** 选择状态（视图无关，规则层） */
  selectedProvince: number | null = null
  readonly selectedDivisions = new Set<string>()
  deployArmed = false
  /** 玩家关闭了选国面板（不再自动弹） */
  countrySelectDismissed = false
  /** 玩家关闭了省面板（选中新省时重新弹出） */
  provincePanelDismissed = false

  /** 对外广播（UI 脚本订阅；GameMode 不反向调 UI）。多订阅者用 Set，脚本 onDestroy 里 remove */
  readonly hourTickListeners = new Set<() => void>()
  readonly selectionListeners = new Set<() => void>()
  onResult: ((result: 'victory' | 'defeat') => void) | null = null
  onDeployArmedChange: ((armed: boolean) => void) | null = null

  emitHourTick(): void {
    for (const cb of this.hourTickListeners) cb()
  }

  emitSelectionChange(): void {
    for (const cb of this.selectionListeners) cb()
  }

  /** 战斗弹窗临时锚点（markers 创建，EndPlay 统一回收） */
  tempAnchors: GenericActor[] = []

  /** 控制权签名缓存（归属变化 → 地图重染） */
  private controlSig = ''

  private static mapDef: MapDef = mapDefJson as unknown as MapDef

  constructor() {
    super()
    this.map = new MapData(Hoi4GameMode.mapDef)
    // 相机 Actor 构造但不托管：由场景 setup 回调 spawnActor 交给 World（fish 同款）
    this.camera = new Hoi4CameraActor(this.map.def.worldWidth, this.map.def.worldHeight)
  }

  override InitGame(): void {
    super.InitGame()
    this.gameState.reset()
    this.cameraManager.RegisterCamera(this.camera.cameraComponent)
    this.camera.place()
  }

  override spawnPlayerInternal() {
    const controller = new Hoi4PlayerController()
    controller.gameMode = this
    // 装配期：相机云台接输入（规范 §2.5 唯一例外现场）
    this.camera.rig.bindInput(controller.inputComponent)
    return { controller, pawn: new Hoi4Pawn() }
  }

  override BeginPlay(): void {
    super.BeginPlay()
    // 地图 Actor + 渲染组件（图片异步加载，加载完自动 repaint）
    const mapActor = new GenericActor('Hoi4MapRoot')
    this.world?.actorMgr.SpawnActor(mapActor)
    const render = new MapRenderComponent(mapActor, this.map)
    mapActor.addComponent(render)
    this.mapRender = render
    void render.loadImages(terrainPngUrl, provincesPngUrl).then(() => {
      logger.info('[Hoi4GameMode] 地图图片就绪')
      this.tryBootstrap()
    })
    this.markers = new UnitMarkers(this)
    this.models = new UnitModels(this)
    // 物理/点击：PhySys 挂游戏相机 + UI 层（UI 点击优先于地图拾取）
    const inst = GameInstance.current
    if (inst?.world.gameRenderer) PhySys.setup(this.camera.cameraComponent.camera, inst.world.gameRenderer.uiLayer)
  }

  /** 尝试 bootstrap：表集就绪 + 图片就绪后建 core state（幂等） */
  tryBootstrap(): void {
    if (this.booted) return
    if (!this.mapRender?.hasImages()) return
    const countries = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.countries')
    const terrains = ConfigRegistry.getConfig<Record<string, unknown>>('hoi4.terrains')
    const buildings = ConfigRegistry.getConfig<Record<string, unknown>>('hoi4.buildings')
    const laws = ConfigRegistry.getConfig<Hoi4Tables['laws']>('hoi4.laws')
    const equipments = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.equipments')
    const battalions = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.battalion_types')
    const supports = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.support_types')
    const templates = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.division_templates')
    const techs = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.techs')
    const focuses = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.focuses')
    const events = ConfigRegistry.getTable<Record<string, unknown>>('hoi4.events')
    const combat = ConfigRegistry.getConfig<Hoi4Tables['combat']>('hoi4.combat_params')
    const aiWeights = ConfigRegistry.getConfig<Hoi4Tables['aiWeights']>('hoi4.ai_weights')
    if (!countries || !terrains || !buildings || !laws || !equipments || !battalions || !supports || !templates || !techs || !focuses || !events || !combat || !aiWeights) {
      return // 表还在异步加载，下一帧再试
    }
    this.tables = makeTables({
      countries: tableToRecord<import('../core/types').CountryDef>(countries),
      terrains: plainRecord<import('../core/types').TerrainDef>(terrains),
      buildings: plainRecord<import('../core/types').BuildingDef>(buildings),
      laws,
      equipments: tableToRecord<import('../core/types').EquipmentDef>(equipments),
      battalions: tableToRecord<import('../core/types').BattalionDef>(battalions),
      supports: tableToRecord<import('../core/types').SupportDef>(supports),
      templates: tableToRecord<import('../core/types').TemplateDef>(templates),
      techs: tableToRecord<import('../core/types').TechDef>(techs),
      focuses: tableToRecord<import('../core/types').FocusDef>(focuses),
      events: tableToRecord<import('../core/types').EventDef>(events),
      combat,
      aiWeights,
    })
    this.coreState = createInitialState(this.tables, this.map, 20260906)
    this.refreshColorLUT()
    this.booted = true
    logger.info(`[Hoi4GameMode] bootstrap 完成（省=${this.map.provinceCount}, 国=${Object.keys(this.tables.countries).length}）`)
  }

  /** 表集（未就绪时抛错——UI 只应在 boot 后交互） */
  getTables(): Hoi4Tables {
    if (!this.tables) throw new Error('[Hoi4GameMode] 表集未就绪')
    return this.tables
  }

  get bootedFlag(): boolean {
    return this.booted
  }

  override Tick(dt: number): void {
    super.Tick(dt)
    if (!this.booted) {
      this.tryBootstrap()
      return
    }
    const state = this.coreState!
    const tables = this.tables!
    // 时间推进（暂停即不走；onHour/onDay 内做全部 core 结算）
    this.gameTime.advance(
      dt,
      () => {
        state.hour = this.gameTime.hour
        tickHourly(state, tables, this.map)
        this.afterCoreStep()
      },
      () => {
        tickDaily(state, tables, this.map)
        this.afterCoreStep()
        this.emitHourTick()
      },
    )
    // 胜负
    if (state.result && this.gameState.phase !== 'gameover') {
      this.onResult?.(state.result)
    }
    // 兵模每帧变换（行军插值/选中光环）
    this.models?.tick(dt)
  }

  /** core 步进后的视图同步（控制权变化检测 → 地图重染；单位计数器） */
  private afterCoreStep(): void {
    const state = this.coreState!
    const sig = Object.entries(state.provinceControl).map(([k, v]) => `${k}:${v}`).join(',')
    if (sig !== this.controlSig) {
      this.controlSig = sig
      this.refreshColorLUT()
    }
    this.markers?.sync()
    this.models?.sync()
  }

  /** 刷新省→控制国颜色与国名标注 LUT 并重绘地图 */
  refreshColorLUT(): void {
    if (!this.mapRender || !this.coreState || !this.tables) return
    const state = this.coreState
    const colorCache = new Map<string, number>()
    const toInt = (hex: string): number => {
      let v = colorCache.get(hex)
      if (v === undefined) {
        v = parseInt(hex.replace('#', ''), 16)
        colorCache.set(hex, v)
      }
      return v
    }
    this.mapRender.setCountryLabels((pid) => {
      const ctrl = state.provinceControl[pid]
      if (!ctrl) return null
      return this.tables!.countries[ctrl]?.name ?? null
    })
    this.mapRender.setColorLUT((pid) => {
      const ctrl = state.provinceControl[pid]
      if (!ctrl) return null
      const def = this.tables!.countries[ctrl]
      return def ? toInt(def.color) : null
    })
    // 选中省高亮补画
    if (this.selectedProvince !== null) this.mapRender.setHighlight(this.selectedProvince, 0xffe082)
  }

  // ═══════════════ 输入规则：选省/下令/部署 ═══════════════

  onScreenClick(screenX: number, screenY: number): void {
    if (!this.booted || !this.mapRender) return
    const pick = this.mapRender.pickProvince(screenX, screenY)
    if (!pick) {
      this.clearSelection()
      return
    }
    this.handleProvinceClick(pick.province)
  }

  private handleProvinceClick(pid: number): void {
    const state = this.coreState!
    const tables = this.tables!
    const tag = state.playerTag
    if (!tag) {
      this.selectProvince(pid)
      return
    }
    const c = state.countries[tag]
    const ctrl = state.provinceControl[pid]

    // 部署模式：点己方省落一个师
    if (this.deployArmed && c.deployPool.length > 0) {
      if (ctrl !== tag) {
        logger.warn('[Hoi4GameMode] 部署目标须为己方控制省')
        return
      }
      const div = deployDivision(state, tables, this.map, tag, pid)
      this.deployArmed = false
      this.onDeployArmedChange?.(false)
      if (div) {
        this.markers?.sync()
        this.models?.sync()
        this.emitHourTick()
        logger.info(`[Hoi4GameMode] 师已部署: ${div.name} → 省 ${pid}`)
      }
      return
    }

    // 有选中师 → 下令移动/进攻（下令后保留选择）
    if (this.selectedDivisions.size > 0) {
      let ordered = 0
      for (const id of this.selectedDivisions) {
        const div = state.divisions[id]
        if (div && div.owner === tag && div.battle === 0) {
          if (orderMove(state, tables, this.map, div, pid)) ordered++
        }
      }
      if (ordered > 0) {
        this.markers?.sync()
        this.models?.sync()
        this.emitHourTick()
      }
      return
    }

    this.selectProvince(pid)
  }

  /** 选省（自动选中该省己方师） */
  selectProvince(pid: number): void {
    const state = this.coreState
    this.provincePanelDismissed = false
    this.mapRender?.clearHighlights()
    this.selectedDivisions.clear()
    this.selectedProvince = pid
    this.mapRender?.setHighlight(pid, 0xffe082)
    if (state && state.playerTag) {
      for (const d of Object.values(state.divisions)) {
        if (d.province === pid && d.owner === state.playerTag) this.selectedDivisions.add(String(d.id))
      }
    }
    this.emitSelectionChange()
  }

  clearSelection(): void {
    if (this.selectedProvince === null && this.selectedDivisions.size === 0) return
    this.selectedProvince = null
    this.selectedDivisions.clear()
    this.mapRender?.clearHighlights()
    this.emitSelectionChange()
  }

  /** 师选中切换（省面板师行点击） */
  toggleDivisionSelection(divId: string): void {
    if (this.selectedDivisions.has(divId)) this.selectedDivisions.delete(divId)
    else this.selectedDivisions.add(divId)
    this.emitSelectionChange()
  }

  setMapMode(mode: MapMode): void {
    this.mapRender?.setMode(mode)
  }

  // ═══════════════ 时间控制 ═══════════════

  /** 鼠标坐标转发（Controller → 相机云台边缘平移） */
  setMouseScreen(sx: number, sy: number): void {
    this.camera.rig.setMouseScreen(sx, sy)
  }

  /** 滚轮缩放（Controller → 相机云台） */
  zoomMap(delta: number): void {
    this.camera.rig.zoom(delta)
  }

  setPaused(paused: boolean): void {
    this.gameTime.paused = paused
    if (this.coreState) this.coreState.paused = paused
    this.emitHourTick()
  }

  setSpeed(speed: number): void {
    this.gameTime.speed = Math.min(5, Math.max(1, speed))
    if (this.coreState) this.coreState.speed = this.gameTime.speed
    this.emitHourTick()
  }

  /** GM 单步（小时） */
  gmStepHours(n: number): void {
    if (!this.booted) return
    const state = this.coreState!
    for (let i = 0; i < n; i++) {
      this.gameTime.hour++
      state.hour = this.gameTime.hour
      tickHourly(state, this.tables!, this.map)
      if (this.gameTime.hour % 24 === 0) tickDaily(state, this.tables!, this.map)
    }
    this.afterCoreStep()
    this.emitHourTick()
  }

  get dateText(): string {
    return formatGameDate(this.gameTime.hour)
  }

  // ═══════════════ 面板命令（UI 脚本调用；规则校验在 core） ═══════════════

  private requirePlayer(): { state: Hoi4State; tag: string } | null {
    const state = this.coreState
    if (!state || !state.playerTag || !this.booted) return null
    return { state, tag: state.playerTag }
  }

  cmdQueueConstruction(building: string, stateId = -1): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = queueConstruction(p.state, this.getTables(), this.map, p.tag, building, stateId)
    this.emitHourTick()
    return ok
  }

  cmdAddProductionLine(equipment: string, factories: number): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    addProductionLine(p.state, this.getTables(), p.tag, equipment, factories)
    this.emitHourTick()
    return true
  }

  cmdStartResearch(techId: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = startResearch(p.state, this.getTables(), p.tag, techId)
    this.emitHourTick()
    return ok
  }

  cmdPickFocus(focusId: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = pickFocus(p.state, this.getTables(), p.tag, focusId)
    this.emitHourTick()
    return ok
  }

  cmdSwitchLaw(category: 'economy' | 'conscription' | 'trade', lawId: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const c = p.state.countries[p.tag]
    const tables = this.getTables()
    const list = tables.laws[category]
    const law = findLaw(list, lawId)
    if (!law || c.laws[category] === lawId) return false
    if (c.pp < law.ppCost) return false
    if (law.reqWarSupport !== undefined && c.warSupport < law.reqWarSupport) return false
    c.pp -= law.ppCost
    c.laws[category] = lawId
    this.emitHourTick()
    return true
  }

  cmdQueueTraining(templateId: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = queueTraining(p.state, this.getTables(), p.tag, templateId)
    this.emitHourTick()
    return ok
  }

  cmdSetDeployArmed(armed: boolean): void {
    const p = this.requirePlayer()
    if (!p || p.state.countries[p.tag].deployPool.length === 0) armed = false
    this.deployArmed = armed
    this.onDeployArmedChange?.(armed)
  }

  cmdSelectCountry(tag: string): void {
    const state = this.coreState
    if (!state) return
    state.playerTag = tag
    for (const [t, c] of Object.entries(state.countries)) c.isAI = t !== tag
    this.countrySelectDismissed = false
    this.provincePanelDismissed = false
    logger.info(`[Hoi4GameMode] 玩家国家: ${tag}`)
    this.emitHourTick()
  }

  cmdJustify(target: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = startJustify(p.state, p.tag, target)
    this.emitHourTick()
    return ok
  }

  cmdDeclareWar(target: string): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = declareWar(p.state, p.tag, target)
    this.emitHourTick()
    return ok
  }

  cmdResolveEvent(eventId: string, optionIndex: number): boolean {
    const p = this.requirePlayer()
    if (!p) return false
    const ok = resolveEvent(p.state, this.getTables(), p.tag, eventId, optionIndex)
    this.emitHourTick()
    return ok
  }

  /** 存档快照（GameInstance 落盘） */
  captureSave(): unknown | null {
    if (!this.coreState) return null
    return {
      hour: this.gameTime.hour,
      speed: this.gameTime.speed,
      paused: this.gameTime.paused,
      state: this.coreState,
    }
  }

  /** 读档回填（GameInstance 载入后调用） */
  restoreSave(data: unknown): boolean {
    const snap = data as { hour: number; speed: number; paused: boolean; state: Hoi4State } | null
    if (!snap?.state?.countries) return false
    if (!this.booted) this.tryBootstrap()
    if (!this.booted || !this.tables) return false
    this.coreState = snap.state
    this.gameTime.reset(snap.hour, snap.speed, snap.paused)
    this.clearSelection()
    this.refreshColorLUT()
    this.markers?.sync()
    this.models?.sync()
    this.emitHourTick()
    logger.info(`[Hoi4GameMode] 存档已回填（hour=${snap.hour}）`)
    return true
  }

  override EndPlay(): void {
    this.models?.destroyAll()
    this.markers?.destroyAll()
    for (const a of this.tempAnchors) this.world?.actorMgr.DestroyActor(a)
    this.tempAnchors = []
    // 相机 Actor 由 World 托管时走销毁队列；未托管（未进 setup）时自清理
    this.camera.destroy()
    super.EndPlay()
  }
}

/** DataTable → 行表 Record（行内容运行时来自 JSON，按 Row 断言） */
function tableToRecord<Row>(dt: { getRowNames(): string[]; getRow(name: string): unknown }): Record<string, Row> {
  const out: Record<string, Row> = {}
  for (const name of dt.getRowNames()) {
    const row = dt.getRow(name)
    if (row !== undefined && row !== null) out[name] = row as Row
  }
  return out
}

/** getConfig 返回的普通对象剥元键（值运行时来自 JSON，按 T 断言） */
function plainRecord<T>(o: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) out[k] = v as T
  return out
}
