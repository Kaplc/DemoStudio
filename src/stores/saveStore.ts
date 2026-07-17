/**
 * saveStore — 存档 UI 状态与编排
 *
 * 桥接 SaveSystem（文件 IO）与当前运行中的 GameInstance（序列化钩子）。
 * GameInstance 由 Viewport 持有，这里通过模块级 holder 访问（setCurrentGameInstance）。
 *
 * 读档时序：游戏未运行时无法直接 restore（pawn 尚未生成），故先 launchGame() 并把
 * payload 暂存 pendingRestore；Viewport 启动 effect（start 完成）末尾调 consumePendingRestore 消费。
 */
import { create } from 'zustand'
import { SaveSystem } from '@/engine'
import type { GameInstance, SaveSlotInfo } from '@/engine'
import { useEditorStore } from './editorStore'

// ─── 当前运行实例 holder（Viewport 在 instance 就绪时设置）───
let _currentInstance: GameInstance | null = null
export function setCurrentGameInstance(inst: GameInstance | null): void {
  _currentInstance = inst
}

interface SaveStore {
  slots: SaveSlotInfo[]
  loading: boolean
  /** 待恢复快照（游戏未运行时读档：launch 后由 Viewport 消费） */
  pendingRestore: { payload: unknown } | null

  refreshSlots: (game: string) => Promise<void>
  saveGame: (slot: string) => Promise<boolean>
  loadGame: (slot: string) => Promise<boolean>
  deleteSave: (game: string, slot: string) => Promise<void>
  consumePendingRestore: () => { payload: unknown } | null
}

function currentGameName(): string | null {
  return useEditorStore.getState().currentProject?.name ?? null
}

/** 从当前实例捕获快照 + 冗余 score/phase（供 meta 展示） */
function capture(): { payload: unknown; score: number; phase?: string } | null {
  const inst = _currentInstance
  if (!inst) return null
  const payload = inst.captureSnapshot()
  if (payload == null) return null
  const gm = (inst as unknown as { gameMode?: { gameState?: { score: number; phase?: string } } }).gameMode
  return {
    payload,
    score: gm?.gameState?.score ?? 0,
    phase: gm?.gameState?.phase,
  }
}

export const useSaveStore = create<SaveStore>((set, get) => ({
  slots: [],
  loading: false,
  pendingRestore: null,

  refreshSlots: async (game) => {
    set({ loading: true })
    const slots = await SaveSystem.list(game)
    set({ slots, loading: false })
  },

  saveGame: async (slot) => {
    const game = currentGameName()
    const addConsole = useEditorStore.getState().addConsoleOutput
    if (!game) {
      addConsole('[存档] 未选择游戏')
      return false
    }
    const captured = capture()
    if (!captured) {
      addConsole('[存档] 当前游戏未运行或不支持存档')
      return false
    }
    const res = await SaveSystem.save({
      game,
      gameVersion: useEditorStore.getState().currentProject?.version,
      slot,
      payload: captured.payload,
      score: captured.score,
      phase: captured.phase,
    })
    if (res.success) {
      addConsole(`[存档] 已保存到「${slot}」槽`)
      await get().refreshSlots(game)
      return true
    }
    addConsole(`[存档] 保存失败: ${res.error}`)
    return false
  },

  loadGame: async (slot) => {
    const game = currentGameName()
    const addConsole = useEditorStore.getState().addConsoleOutput
    if (!game) {
      addConsole('[存档] 未选择游戏')
      return false
    }
    const res = await SaveSystem.load(game, slot)
    if (!res.success || !res.data) {
      addConsole(`[存档] 读取失败: ${res.error}`)
      return false
    }
    if (useEditorStore.getState().gameState.running) {
      // 游戏运行中：直接恢复
      _currentInstance?.restoreSnapshot(res.data.payload)
      addConsole(`[存档] 已从「${slot}」槽恢复`)
      return true
    }
    // 游戏未运行：暂存快照，启动后由 Viewport 消费
    set({ pendingRestore: { payload: res.data.payload } })
    useEditorStore.getState().launchGame()
    addConsole(`[存档] 启动游戏并从「${slot}」槽恢复...`)
    return true
  },

  deleteSave: async (game, slot) => {
    const res = await SaveSystem.delete(game, slot)
    const addConsole = useEditorStore.getState().addConsoleOutput
    if (res.success) {
      addConsole(`[存档] 已删除「${slot}」槽`)
      await get().refreshSlots(game)
    } else {
      addConsole(`[存档] 删除失败: ${res.error}`)
    }
  },

  consumePendingRestore: () => {
    const p = get().pendingRestore
    if (p) set({ pendingRestore: null })
    return p
  },
}))
