/**
 * resetSave — fish GM 命令：清除存档并重置为全新开局
 *
 * 走 FishGameInstance.resetSave：KV 整表作废 + 钱包/军队/队列归零 +
 * baseBuildings/clearedLevels 键删除（force flush 立即重写文件）。
 * 若正处于基地阶段，场上建筑也会被清掉（下一帧 commitDestroy 移除），
 * 再次进入基地时按"无布局存档"路径保留初始布局。
 */
import type { GMCommandDef } from '@/engine'

export default {
  name: 'resetSave',
  description: '清除存档并重置为全新开局（金币/药水/军队/队列/基地布局）',
  params: [],
  handler: (ctx) => {
    const inst = ctx.gameInstance as unknown as { resetSave?: () => void }
    if (typeof inst?.resetSave !== 'function') {
      ctx.output('resetSave 不可用（当前游戏实例无 resetSave 方法）')
      return
    }
    inst.resetSave()
    ctx.output('存档已重置：金币=100，药水=0，军队/队列已清空；重新进入基地将使用默认布局')
  },
} as GMCommandDef
