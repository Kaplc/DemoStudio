/**
 * PreviewSaveCollector — 预览保存收集器（UI / 蓝图 / 场景三个预览管理器共用）
 *
 * 从各 PreviewManager 的 collectSaveData 中抽出的可复用核心：
 *  1. 属性基线：加载基线快照（组件 → 构造/就绪态持久化属性）+ 差量查询。保存只写
 *     回与基线不同的键——未动过的属性（尤其组件构造缺省键）不进资产，防止"改一个
 *     值、全量缺省键灌进 json"的硬写入污染。
 *  2. 通用组件属性回写：persistType 过滤、isClickOnly 内部组件跳过、按 baseClass
 *     定位 json 组件节点、persistentProps 合入（不删除现有键，避免丢失 JSON 中
 *     只读/代码配置的属性）。
 *  3. 基线注册表：活跃预览按资产路径注册，供 Inspector 批量提交差量化查询。
 *
 * 各管理器保留自己的树遍历与 transform 回写（UI 全屏根豁免 / 场景 ref 节点 /
 * 旧格式 pos 等资产形状差异不在此层）。
 */
import type { Actor } from '../../engine/entity/Actor'
import type { ActorComponent } from '../../engine/entity/ActorComponent'

/** 是否跳过运行时自动生成的内部组件（如 UIButton 透明点击层 UIImageComponent） */
function isInternalComp(comp: ActorComponent): boolean {
  return Boolean((comp as unknown as { isClickOnly?: boolean }).isClickOnly)
}

/** 组件持久化属性 vs 基线的差量；基线为 null 返回 null（调用方决定回退语义） */
export function diffedPersistProps(
  comp: { getPersistentProps(): Record<string, unknown> },
  baseline: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!baseline) return null
  const persist = comp.getPersistentProps()
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(persist)) {
    if (k in baseline && JSON.stringify(v) === JSON.stringify(baseline[k])) continue
    out[k] = v
  }
  return out
}

export interface WriteComponentPropsOptions {
  /**
   * strict = 必须有基线，缺失直接抛错阻止保存（异常即报错，绝不硬写入；
   *          UI 预览用——基线缺失意味着预览与快照不同步，全量写回会灌入缺省键）
   * full   = 无基线语义，persistentProps 原样全量合入（蓝图/场景预览既有行为，默认）
   */
  mode?: 'strict' | 'full'
  /** 节点无该组件时新建（场景节点的组件可能由蓝图/代码生成，不新建则属性永远写不进） */
  createMissing?: boolean
  /** 属性写回前的过滤钩子（如 UI 全屏根剔除视口驱动的 worldWidth/worldHeight） */
  filterProps?: (comp: ActorComponent, persist: Record<string, unknown>) => void
}

export class PreviewSaveCollector {
  /** 加载基线：组件实例 → 持久化属性快照（独立深拷贝） */
  private _baseline = new Map<object, Record<string, unknown>>()

  /** 基线快照（预览就绪态调用：BeginPlay + 首 tick 之后，收编运行时派生改写） */
  snapshotBaselines(actors: Iterable<Actor>): void {
    for (const a of actors) {
      for (const comp of a.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        if (isInternalComp(comp)) continue
        this._baseline.set(comp, JSON.parse(JSON.stringify(comp.getPersistentProps())) as Record<string, unknown>)
      }
    }
  }

  clear(): void {
    this._baseline.clear()
  }

  /** 组件的加载基线快照；无基线返回 null */
  baselineOf(comp: object): Record<string, unknown> | null {
    return this._baseline.get(comp) ?? null
  }

  /** 组件持久化属性 vs 基线的差量；无基线返回 null */
  diffedProps(comp: ActorComponent): Record<string, unknown> | null {
    return diffedPersistProps(comp, this._baseline.get(comp) ?? null)
  }

  /** 通用组件属性持久化：把 actor 全部组件的可持久化属性回写进 jsonNode.components */
  writeComponentProps(actor: Actor, jsonNode: Record<string, unknown>, opts: WriteComponentPropsOptions = {}): void {
    const mode = opts.mode ?? 'full'
    const jsonComps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
    for (const comp of actor.getAllComponents() as ActorComponent[]) {
      if (!comp.persistType) continue
      if (isInternalComp(comp)) continue
      let target = jsonComps.find((c) => c.baseClass === comp.persistType)
      if (!target) {
        if (!opts.createMissing) continue
        target = { baseClass: comp.persistType, properties: {} }
        jsonComps.push(target)
        jsonNode.components = jsonComps
      }
      const props = (target.properties ?? {}) as Record<string, unknown>
      const persist = comp.getPersistentProps()
      opts.filterProps?.(comp, persist)
      if (mode === 'full') {
        for (const [k, v] of Object.entries(persist)) {
          props[k] = v
        }
        continue
      }
      const baseline = this._baseline.get(comp)
      if (!baseline) {
        // 内部不变量破坏（预览与基线快照不同步）：跳过过滤会全量写回组件缺省键，
        // 按保存链路约定直接报错阻止保存，而不是硬写入污染资产
        throw new Error(
          `属性基线缺失: ${String(jsonNode.name ?? '?')}.${comp.persistType}——预览与基线不同步，已拒绝保存（请重新打开资产后重试）`,
        )
      }
      for (const [k, v] of Object.entries(persist)) {
        if (k in baseline && JSON.stringify(v) === JSON.stringify(baseline[k])) continue
        props[k] = v
      }
    }
  }
}

// ─── 活跃预览基线注册表（Inspector 批量提交差量化查询通道）───

const activePreviewBaselines = new Map<string, PreviewSaveCollector>()

/** 预览加载成功后按资产路径注册（assetKey 与磁盘路径都注册，查询方任一格式可达） */
export function registerPreviewBaseline(assetPath: string, collector: PreviewSaveCollector): void {
  activePreviewBaselines.set(assetPath, collector)
}

export function unregisterPreviewBaseline(assetPath: string): void {
  activePreviewBaselines.delete(assetPath)
}

/** 查询组件在当前预览中的加载基线；无活跃预览/无基线返回 null（调用方回退全量语义） */
export function getPreviewBaseline(assetPath: string, comp: object): Record<string, unknown> | null {
  const collector = activePreviewBaselines.get(assetPath)
  return collector ? collector.baselineOf(comp) : null
}
