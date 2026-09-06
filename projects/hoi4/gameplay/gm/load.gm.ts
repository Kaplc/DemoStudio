/**
 * load — 读档回填
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameInstance } from '../../Hoi4GameInstance'

export default {
  name: 'load',
  description: '从存档文件回填整局状态',
  params: [],
  handler: (ctx) => {
    const inst = ctx.gameInstance as Hoi4GameInstance
    void inst.loadGame().then((ok) => ctx.output(ok ? '已读档' : '读档失败（无存档或版本不符）'))
  },
} as GMCommandDef
