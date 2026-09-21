/**
 * EventFeedbackComponent — 事件→反馈翻译组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode.drainEvents/toast/fx 老化逻辑原样迁入）：
 *  - drain()：清空 simState.events 仿真事件队列，逐类型翻译为 toast 文案 + 音效 + 地图特效
 *    （脉冲圈/浮动数字）；card_pending 事件附带"弹卡即暂停"（置 owner.paused）；
 *  - ageFx(dt)：特效与 toast 队列按真实时间老化（GameMode.Tick 每帧调用）；
 *  - toast()：入队（上限 5 条，FIFO 淘汰），供 GameMode 交互链路直接调用。
 */
import { BObjectComponent, audioSys } from '@/engine'
import type { MapFx } from '../map/StarMapRenderComponent'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export class EventFeedbackComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 地图特效（脉冲圈 + 浮动数字；渲染层只读消费） */
  fx: MapFx = { pulses: [], floats: [] }
  /** 事件 toast 队列（HudScript 每帧消费渲染） */
  toasts: Array<{ text: string; color: string; age: number }> = []

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'EventFeedbackComponent'
  }

  /** 事件队列翻译（GameMode.Tick 在 sim.runTick 之后调用，保持原时序） */
  drain(): void {
    const sc = this.owner.simState
    if (sc.events.length === 0) return
    let unloadSounds = 0
    for (const ev of sc.events) {
      switch (ev.type) {
        case 'unload':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: ev.value ? `+${ev.value}` : '', x: ev.x, y: ev.y - 30, age: 0 })
          }
          if (unloadSounds++ < 2) audioSys.play('wc.unload', { volume: 0.5 })
          break
        case 'route_built': audioSys.play('wc.ok'); break
        case 'slot_built':
          audioSys.play('wc.ok', { volume: 0.6 })
          this.toast(`第 ${ev.value ?? 0} 环段交付（毛坯空槽）— 全息地球可落位环节点 / 环面板可装建筑`, '#7fdcff')
          break
        case 'ring_installed':
          audioSys.play('wc.build')
          this.toast(`「${ev.text ?? '环建筑'}」已装入 ${ev.value !== undefined ? `第 ${ev.value + 1} 环段` : '环段'}`, '#7fdcff')
          break
        case 'ring_demolished':
          audioSys.play('wc.ok', { volume: 0.4 })
          this.toast(`环段建筑已拆除（${ev.text ?? ''}），槽位回空置可再装`, '#9fc4d8')
          break
        case 'route_deleted': audioSys.play('wc.bad', { volume: 0.5 }); break
        case 'ship_built': this.toast('新船下水，已入列空闲池', '#b8ffd8'); break
        case 'ship_rebuilt': this.toast('冻毁飞船已重建', '#b8ffd8'); break
        case 'hint':
          if (ev.text) { this.toast(ev.text, '#ff8f7a'); audioSys.play('wc.bad', { volume: 0.35 }) }
          break
        case 'card_pending':
          audioSys.play('wc.card')
          this.toast(`「${ev.text ?? ''}」节点达成 — 三选一（仿真暂停中）`, '#ffb03d')
          // 弹卡即暂停：选卡前仿真冻结（Tick 门 + drain 双保险）
          this.owner.paused = true
          break
        case 'card_chosen':
          this.toast(`已解锁「${ev.text ?? ''}」 · 环点亮新交点`, '#7fe0a0')
          break
        case 'window_warn': this.toast('引力窗口 10 秒后开启 — 准备发船', '#ffb03d'); break
        case 'window_open': this.toast('引力窗口开启：木卫二线 ×2 速 · 油耗减半', '#ffb03d'); audioSys.play('wc.ok'); break
        case 'window_close': this.toast('引力窗口关闭', '#6f8ba0'); break
        case 'flare_warn': this.toast('⚠ 事件预警：太阳耀斑 10 秒后来袭！', '#ff8f5a'); audioSys.play('wc.alarm'); break
        case 'flare_start':
          this.toast('☀ 太阳耀斑爆发：通讯中断，在途船失联', '#ff5a4a')
          audioSys.play('wc.flare')
          break
        case 'flare_end': this.toast('耀斑退去，幸存飞船恢复航行', '#9fc4d8'); break
        case 'frozen':
          this.toast(`${ev.value ?? 0} 艘飞船冻毁（150 H3 可重建）`, '#ff5a4a')
          audioSys.play('wc.bad')
          break
        case 'building_built':
          if (ev.x !== undefined && ev.y !== undefined) {
            this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
            this.fx.floats.push({ text: `-${ev.value}`, x: ev.x, y: ev.y - 30, age: 0 })
          }
          this.toast(`「${ev.text ?? '建筑'}」已放置 —— 可从星图拖线链接`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'orbit_building_built':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`「${ev.text ?? '轨道设施'}」已建成 —— 点它打开轨道建设面板`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'mine_built':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`「${ev.text ?? '矿建'}」建成投产 —— 矿产直采入地球储备`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'building_demolished':
          if (ev.x !== undefined && ev.y !== undefined) this.fx.pulses.push({ x: ev.x, y: ev.y, age: 0 })
          this.toast(`建筑拆除，返还 ${Math.round(ev.value ?? 0)} H3`, '#9fc4d8')
          break
        case 'upgrade_installed':
          this.toast(`「${ev.text ?? '强化'}」已装入建筑 #${ev.value ?? ''}`, '#7fdcff')
          audioSys.play('wc.build')
          break
        case 'upgrade_removed':
          this.toast(`建筑强化「${ev.text ?? ''}」已拆除（费用不返还）`, '#9fc4d8')
          audioSys.play('wc.ok', { volume: 0.4 })
          break
        case 'act2':
          this.toast('第二幕 · 复苏：木卫二 / 引力窗口 / 极寒停航启用，需求暴涨！', '#ffb03d')
          audioSys.play('wc.alarm')
          break
        case 'act3':
        case 'module_available':
          this.toast('第三幕 · 质变：火星已解锁 —— 运回环扩展模块，点亮全球环网！', '#ffe9a8')
          break
        case 'victory': audioSys.play('wc.win'); break
        case 'defeat': audioSys.play('wc.lose'); break
        default: break
      }
    }
    sc.events.length = 0
  }

  /** 特效/toast 老化（真实时间；GameMode.Tick 每帧调用） */
  ageFx(dt: number): void {
    for (const p of this.fx.pulses) p.age += dt
    this.fx.pulses = this.fx.pulses.filter((p) => p.age < 0.6)
    for (const f of this.fx.floats) f.age += dt
    this.fx.floats = this.fx.floats.filter((f) => f.age < 1.4)
    for (const t of this.toasts) t.age += dt
    this.toasts = this.toasts.filter((t) => t.age < 3.6)
  }

  /** 入队一条 toast（上限 5 条，FIFO 淘汰） */
  toast(text: string, color = '#cfe3ee'): void {
    this.toasts.push({ text, color, age: 0 })
    if (this.toasts.length > 5) this.toasts.shift()
  }
}
