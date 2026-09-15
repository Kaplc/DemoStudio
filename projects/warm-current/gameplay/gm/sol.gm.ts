/**
 * sol — 太阳系取景（GM）：2026-09-14 视角锁定地球系，本命令收敛为仅 earth。
 * 非 earth 参数一律拒绝（sun 全景与其它行星系视角的玩家入口已全部屏蔽，
 * 内部机制 focusSolarSystem 保留供 e2e/开发直调）。
 */
import type { GMCommandDef } from '@/engine'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

export default {
  name: 'sol',
  description: '太阳系取景 sol(body)：视角已锁定地球系，仅接受 earth（缺省 earth）',
  params: [
    { name: 'body', type: 'string', required: false, desc: '天体名（仅 earth；sun/其它行星系已屏蔽）' },
  ],
  handler: (ctx, body) => {
    const mode = (ctx.gameInstance as unknown as { gameMode?: WarmCurrentGameMode }).gameMode
    if (!mode) return ctx.output('游戏未就绪')
    const name = body ?? 'earth'
    if (name !== 'earth') {
      return ctx.output(`视角已锁定地球系（2026-09-14），"${name}" 取景已屏蔽`)
    }
    mode.focusSolarSystem('earth')
    ctx.output('镜头聚焦 → earth（斜视角）')
  },
} as GMCommandDef
