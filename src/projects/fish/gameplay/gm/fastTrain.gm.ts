/**
 * fastTrain — fish GM 命令：设置训练时间倍率
 *
 * 设置 TrainingComponent.trainTimeScale = scale（默认 0.01，即训练时间变为 1/100），
 * 在基地阶段打开兵营正常点击训练，实际等待时间从 N 秒变为 N×scale 秒。
 * 不带参数时默认设为 0.01（20s → 0.2s），关闭则设为 1。
 *
 * 适用：调试兵营 UI + 训练队列完整流程，无需等待真实训练时间。
 */
import { logger } from '@/engine'
import type { GMCommandDef } from '@/engine'

export default {
  name: 'fastTrain',
  description: '设置训练时间倍率（默认 0.01，关闭设 0）',
  params: [
    {
      name: 'scale',
      type: 'float',
      required: false,
      desc: '倍率（0.01 = 20s→0.2s，0.001 = 20ms，0 = 关闭恢复1）',
      default: 0.01,
    },
  ],
  handler: (ctx, scale: import('@/engine').GMCommandArg) => {
    logger.info(`[fastTrain] gameInstance=${ctx.gameInstance?.constructor?.name}`)
    const inst = ctx.gameInstance as unknown as {
      training?: {
        trainTimeScale: number
      }
    }
    logger.info(`[fastTrain] training=${inst?.training ? 'exists' : 'MISSING'}`)
    if (!inst?.training) {
      logger.warn('[fastTrain] 找不到 training 对象，请先启动游戏并进入基地')
      ctx.output('[fastTrain] 错误：找不到 training 对象')
      return
    }
    const prev = inst.training.trainTimeScale
    const newScale = scale === 0 ? 1 : (scale === undefined || scale === null ? 0.01 : Number(scale))
    inst.training.trainTimeScale = newScale
    logger.info(`[fastTrain] trainTimeScale: ${prev} → ${newScale}`)
    ctx.output(`[fastTrain] trainTimeScale: ${prev} → ${newScale}`)
  },
} as GMCommandDef
