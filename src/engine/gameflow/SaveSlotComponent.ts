/**
 * SaveSlotComponent — 游戏存档组件（KV 内存模型 + 手动落盘）
 *
 * 挂到 GameInstance 上即可获得 KV 风格的持久化能力：
 *   const save = new SaveSlotComponent(instance, {
 *     filePath: 'src/projects/fish/data/save.kv.json',
 *   })
 *   instance.addComponent(save)
 *
 * 工作模型（参考设计决策）：
 *  - KV：所有数据以 `key → JSON 可序列化值` 形式管理（set/get/delete/has/keys）
 *  - 内存优先：所有 set/delete 只改内存 Map，**不触发 IO**
 *  - 手动落盘：调 flush() 才把当前内存整表写入 filePath（writeJsonFile IPC）
 *  - 文件位置：由调用方在构造时指定（约定每个游戏项目用 data/ 子目录）
 *
 * 设计决策：
 *  - 不依赖 GameInstance 快照虚方法，游戏侧无需实现序列化钩子
 *  - 整体落盘逻辑直接走 electronAPI.writeJsonFile（与蓝图资产写盘共用 IPC）
 *
 * 路径约束（避免常见误用）：
 *  - 必须是 `.json` 结尾（writeJsonFile IPC 在 main.ts 已强校验）
 *  - 必须在项目根目录（baseDir）之内（main.ts 路径逃逸防护会拒绝 .. 等）
 *  - 推荐约定：<repoRoot>/src/projects/<game>/data/*.json
 *
 * 浏览器降级：渲染进程无 electronAPI.writeJsonFile 时（编辑器 Mock 或纯页面），
 *  改走内存模式（data 实际不落盘，刷新即丢，控制台 WARN 一次），保证开发不阻塞。
 */
import { AObjectComponent } from '../entity/AObjectComponent'
import { logger } from '../Logger'
import type { GameInstance } from './GameInstance'

export interface SaveSlotComponentOptions {
  /**
   * 相对于项目根目录（electron/main.ts 中 baseDir = __dirname/.. = 仓库根）的 JSON 文件路径。
   * 约定：`src/projects/<game>/data/<scope>.json`，如 `src/projects/fish/data/save.kv.json`
   */
  filePath: string
  /**
   * 自动 flush 触发器（可选；默认全部关闭 = 纯手动）：
   *  - 'onStop'   ：实例 stop 钩子时自动 flush 一次（防丢失）
   *  - 'onDestroy': 实例 destroy 钩子时自动 flush 一次
   *  - 数字       ：tick 周期自动 flush（毫秒；0 = 不启）
   *  - 数组       ：组合多项
   */
  autoFlush?: 'onStop' | 'onDestroy' | number | Array<'onStop' | 'onDestroy' | number>
}

type AutoFlushItem = 'onStop' | 'onDestroy' | number

/** 兼容 JSON 的值类型（标量 / 数组 / plain 对象 / null） */
export type KVValue =
  | string
  | number
  | boolean
  | null
  | KVValue[]
  | { [key: string]: KVValue }

export class SaveSlotComponent extends AObjectComponent<GameInstance> {
  /** 落盘文件相对路径（项目根内） */
  readonly filePath: string

  /** 内存 KV 表（唯一数据源；flush 时整表序列化） */
  private _data = new Map<string, KVValue>()

  /** 是否需要落盘（任何 set/delete 置 true；flush 成功后清零） */
  private _dirty = false

  /** 上一次落盘时间戳（ISO；用于 Inspector 展示） */
  private _lastFlushedAt: string | null = null

  /** 已解析的自动 flush 策略 */
  private readonly _autoFlush: AutoFlushItem[]

  /** 周期 flush 的累计计时器（ms） */
  private _tickAccum = 0

  constructor(owner: GameInstance, options: SaveSlotComponentOptions) {
    super(owner)
    this.name = 'SaveSlotComponent'
    if (!options?.filePath) {
      throw new Error('[SaveSlot] options.filePath 必填（KV 落盘文件路径）')
    }
    this.filePath = options.filePath
    this._autoFlush = normalizeAutoFlush(options.autoFlush)
  }

  // ════════════════════════════════════════════
  //  KV 访问（内存操作，0 IO）
  // ════════════════════════════════════════════

  /** 读取单个 key —— 不存在返回 null */
  get<T extends KVValue = KVValue>(key: string): T | null {
    return (this._data.get(key) as T | undefined) ?? null
  }

  /** 读取单个 key —— 不存在抛错（明确语义场景） */
  require<T extends KVValue = KVValue>(key: string): T {
    const v = this._data.get(key) as T | undefined
    if (v === undefined) throw new Error(`[SaveSlot] 缺少 key: ${key}`)
    return v
  }

  /** 读取单个 key —— 不存在返回 fallback（默认值场景） */
  getOrDefault<T extends KVValue = KVValue>(key: string, fallback: T): T {
    return (this._data.get(key) as T | undefined) ?? fallback
  }

  /** 是否存在某 key */
  has(key: string): boolean {
    return this._data.has(key)
  }

  /** 写入 key（仅内存；标记 dirty） */
  set(key: string, value: KVValue): void {
    this._data.set(key, value)
    this._dirty = true
  }

  /** 删除 key（仅内存；标记 dirty；返回是否原本存在） */
  delete(key: string): boolean {
    const existed = this._data.delete(key)
    if (existed) this._dirty = true
    return existed
  }

  /** 列出所有 key（无序快照副本） */
  keys(): string[] {
    return [...this._data.keys()]
  }

  /** 全表快照（plain object 形式；外部修改不影响内部） */
  toObject(): Record<string, KVValue> {
    const out: Record<string, KVValue> = {}
    for (const [k, v] of this._data) out[k] = v
    return out
  }

  /** 用 plain object 批量覆盖内部表（不清空已有项；同名 key 覆盖） */
  fromObject(obj: Record<string, KVValue>): void {
    for (const [k, v] of Object.entries(obj)) this.set(k, v)
  }

  /** 清空所有 KV（仅内存；标记 dirty） */
  clear(): void {
    if (this._data.size === 0) return
    this._data.clear()
    this._dirty = true
  }

  // ════════════════════════════════════════════
  //  落盘 / 加载
  // ════════════════════════════════════════════

  /** 是否有未落盘的改动 */
  get dirty(): boolean {
    return this._dirty
  }

  /** 上一次 flush 成功时间（ISO） */
  get lastFlushedAt(): string | null {
    return this._lastFlushedAt
  }

  /**
   * 从文件加载到内存（覆盖当前内存；不调用 set 避免污染 dirty）。
   * 文件不存在 → 视为空 KV，返回 false（不视为错误）。
   * 文件存在但内容非对象 → 警告并保留空表。
   * @returns 是否实际加载了数据
   */
  async load(): Promise<boolean> {
    const api = window.electronAPI
    if (!api?.readJsonFile) {
      warnOnceNoIO('load')
      return false
    }
    const res = await api.readJsonFile(this.filePath)
    if (!res.success) {
      // 文件不存在不视为错误（首次运行 / 刚清档），其余错误日志一次
      if (!/不存在|No such/i.test(res.error ?? '')) {
        logger.warn(`[SaveSlot] load 失败 "${this.filePath}": ${res.error}`)
      }
      return false
    }
    const data = res.data
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
      logger.warn(`[SaveSlot] load 跳过：${this.filePath} 内容非对象（已忽略）`)
      return false
    }
    // 整表覆盖（清空后塞入，不触发 dirty）
    this._data.clear()
    for (const [k, v] of Object.entries(data as Record<string, KVValue>)) {
      this._data.set(k, v)
    }
    this._dirty = false
    logger.info(`[SaveSlot] 已加载 ${this._data.size} 项 ← ${this.filePath}`)
    return true
  }

  /**
   * 把当前内存整表写入文件（手动落盘；成功后清 dirty）。
   * @param force 即便 !dirty 也强制重写（首次创建文件 / 解决外部修改）
   * @returns 是否成功
   */
  async flush(force = false): Promise<boolean> {
    if (!this._dirty && !force) return true
    const api = window.electronAPI
    if (!api?.writeJsonFile) {
      warnOnceNoIO('flush')
      return false
    }
    // 整表序列化为 plain object（writeJsonFile 在 main.ts 已序列化 + 缩进）
    const obj: Record<string, KVValue> = {}
    for (const [k, v] of this._data) obj[k] = v
    const res = await api.writeJsonFile(this.filePath, obj)
    if (!res.success) {
      logger.warn(`[SaveSlot] flush 失败 "${this.filePath}": ${res.error}`)
      return false
    }
    this._dirty = false
    this._lastFlushedAt = new Date().toISOString()
    logger.info(`[SaveSlot] 已落盘 ${this._data.size} 项 → ${this.filePath}`)
    return true
  }

  // ════════════════════════════════════════════
  //  自动 flush 策略（钩子由宿主 GameInstance 显式转发）
  // ════════════════════════════════════════════

  /**
   * 宿主在 tick 中调用（GameInstance.tick 末尾转发）。
   * 用于周期 flush；非周期策略忽略。
   */
  tick(dtSeconds: number): void {
    if (this._autoFlush.length === 0) return
    const periodItems = this._autoFlush.filter((x) => typeof x === 'number') as number[]
    if (periodItems.length === 0) return
    const minPeriod = Math.min(...periodItems)
    this._tickAccum += dtSeconds * 1000
    if (this._tickAccum >= minPeriod && this._dirty) {
      this._tickAccum = 0
      void this.flush()
    }
  }

  /**
   * 宿主在 stop 中调用（GameInstance.stop 末尾转发）。
   * 若策略含 'onStop' 且 dirty 则 flush 一次。
   */
  onStop(): void {
    if (this._autoFlush.includes('onStop') && this._dirty) {
      void this.flush()
    }
  }

  /**
   * 宿主在 destroy 中调用（GameInstance.destroy 末尾转发）。
   * 若策略含 'onDestroy' 且 dirty 则 flush 一次。
   */
  onDestroy(): void {
    if (this._autoFlush.includes('onDestroy') && this._dirty) {
      void this.flush()
    }
  }

  // ════════════════════════════════════════════
  //  Inspector 展示
  // ════════════════════════════════════════════

  override getProperties(): Record<string, unknown> {
    return {
      filePath: this.filePath,
      keys: this._data.size,
      dirty: this._dirty,
      lastFlushedAt: this._lastFlushedAt ?? '(never)',
      autoFlush: formatAutoFlush(this._autoFlush),
    }
  }
}

// ════════════════════════════════════════════
//  内部工具
// ════════════════════════════════════════════

/** 归一化 autoFlush 选项 */
function normalizeAutoFlush(opt: SaveSlotComponentOptions['autoFlush']): AutoFlushItem[] {
  if (opt == null) return []
  const arr = Array.isArray(opt) ? opt : [opt]
  const out: AutoFlushItem[] = []
  for (const x of arr) {
    if (typeof x === 'string') out.push(x)
    else if (typeof x === 'number' && x > 0) out.push(x)
  }
  return out
}

/** 格式化 autoFlush 用于展示 */
function formatAutoFlush(items: AutoFlushItem[]): string {
  if (items.length === 0) return 'manual'
  return items
    .map((x) => (typeof x === 'number' ? `tick@${x}ms` : x))
    .join('+')
}

/** 无 IPC 环境只 WARN 一次（避免每帧噪声） */
let _noIoWarned = false
function warnOnceNoIO(op: string): void {
  if (_noIoWarned) return
  _noIoWarned = true
  logger.warn(`[SaveSlot] electronAPI JSON IPC 不可用（${op} 降级为内存模式，刷新即丢）`)
}
