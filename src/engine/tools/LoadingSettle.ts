/**
 * LoadingSettle — 场景进入/重负载任务完成追踪器（引擎级微设施）
 *
 * loading 面板等表现层需要知道「完全加载完毕」的时点，而重负载工作分散在
 * 各组件（云图柔化、贴图装配、配置覆盖……）且多为异步回调收尾。本追踪器
 * 只做一件事：组内任务全部 done 的瞬间触发该组监听（一次）。
 *
 * 用法（生产方 = 重负载组件）：
 *   const finish = LoadingSettle.task('scene-enter', 'cloud:CloudLow')
 *   img.onload = () => { ...; finish() }
 *   img.onerror = () => finish()
 * 用法（消费方 = 面板/游戏侧）：
 *   LoadingSettle.onSettled('scene-enter', () => hideLoadingPanel())
 *
 * HMR 免疫：编辑器 dev 模式下热更会把应用模块图换成 ?t= 实例，模块级单例会
 * 分裂（引擎侧 task 与项目侧 onSettled 落在两份实例 → 面板永不关闭）。挂到
 * globalThis 保证全图共享同一实例；单测/打包运行同样不受影响。
 */

type DoneFn = () => void
type Listener = () => void

class LoadingSettleImpl {
  private pending = new Map<string, Set<string>>()
  private listeners = new Map<string, Set<Listener>>()

  /** 登记一个未完成任务；返回 done 闭包（幂等，重复/过期调用安全） */
  task(group: string, id: string): DoneFn {
    let set = this.pending.get(group)
    if (!set) {
      set = new Set()
      this.pending.set(group, set)
    }
    set.add(id)
    let called = false
    return () => {
      if (called) return
      called = true
      const s = this.pending.get(group)
      if (!s) return
      s.delete(id)
      if (s.size === 0) {
        this.pending.delete(group)
        const ls = this.listeners.get(group)
        this.listeners.delete(group)
        if (ls) for (const l of ls) l()
      }
    }
  }

  /** 组内任务全部完成时触发一次；返回取消函数。 */
  onSettled(group: string, cb: Listener): () => void {
    let ls = this.listeners.get(group)
    if (!ls) {
      ls = new Set()
      this.listeners.set(group, ls)
    }
    ls.add(cb)
    return () => {
      ls?.delete(cb)
    }
  }

  /** 组当前未完成任务数（诊断/测试用） */
  pendingCount(group: string): number {
    return this.pending.get(group)?.size ?? 0
  }
}

const g = globalThis as { __dsLoadingSettle?: LoadingSettleImpl }
export const LoadingSettle = (g.__dsLoadingSettle ??= new LoadingSettleImpl())
