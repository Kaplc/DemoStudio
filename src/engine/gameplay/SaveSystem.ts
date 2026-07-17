/**
 * SaveSystem — 渲染进程侧存档管理
 *
 * 通过 Electron IPC 读写 userData/saves/<game>/<slot>.json。
 * SaveSystem 只搬运 SaveData，不解释 payload；load 时校验 meta.game 防止跨游戏误读。
 * 非 Electron 环境（无 electronAPI）时各方法安全降级，返回 success:false 而非抛异常。
 */
import type { SaveData, SaveSlotInfo } from './ISaveData'
import { SAVE_FORMAT_VERSION } from './ISaveData'

export interface SaveParams {
  game: string
  gameVersion?: string
  slot: string
  payload: unknown
  score: number
  phase?: string
  label?: string
}

export interface SaveResult {
  success: boolean
  error?: string
  savedAt?: string
}

export class SaveSystem {
  /** 写存档：补全 meta 后落盘 */
  static async save(params: SaveParams): Promise<SaveResult> {
    if (!window.electronAPI?.saveGameFile) {
      return { success: false, error: '存档 IPC 不可用（非 Electron 环境）' }
    }
    const data: SaveData = {
      meta: {
        formatVersion: SAVE_FORMAT_VERSION,
        game: params.game,
        gameVersion: params.gameVersion,
        slot: params.slot,
        savedAt: new Date().toISOString(),
        score: params.score,
        phase: params.phase,
        label: params.label,
      },
      payload: params.payload,
    }
    return window.electronAPI.saveGameFile(params.game, params.slot, data)
  }

  /**
   * 读存档：返回完整 SaveData。
   * 校验 meta.game（目录已隔离，此处二次防御）；版本校验预留迁移点。
   */
  static async load(
    game: string,
    slot: string,
  ): Promise<{ success: boolean; data?: SaveData; error?: string }> {
    if (!window.electronAPI?.loadGameFile) {
      return { success: false, error: '存档 IPC 不可用（非 Electron 环境）' }
    }
    const res = await window.electronAPI.loadGameFile(game, slot)
    if (!res.success || !res.data) return res
    const data = res.data as SaveData
    if (data.meta?.game && data.meta.game !== game) {
      return { success: false, error: `存档属于 ${data.meta.game}，与当前游戏 ${game} 不匹配` }
    }
    // 当前仅 v1；未来 formatVersion !== SAVE_FORMAT_VERSION 时在此调用 migrate()
    return { success: true, data }
  }

  /** 列出某游戏所有存档槽（仅 meta） */
  static async list(game: string): Promise<SaveSlotInfo[]> {
    if (!window.electronAPI?.listGameSaves) return []
    return window.electronAPI.listGameSaves(game)
  }

  /** 删除一个存档槽 */
  static async delete(
    game: string,
    slot: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI?.deleteGameSave) {
      return { success: false, error: '存档 IPC 不可用（非 Electron 环境）' }
    }
    return window.electronAPI.deleteGameSave(game, slot)
  }
}
