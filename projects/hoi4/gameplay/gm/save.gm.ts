/**
 * save / load — 存档与读档（GameInstance 落盘）
 */
import type { GMCommandDef } from '@/engine'
import type { Hoi4GameInstance } from '../../Hoi4GameInstance'

export const saveCmd: GMCommandDef = {
  name: 'save',
  description: '保存当前整局状态到存档文件',
  params: [],
  handler: (ctx) => {
    const inst = ctx.gameInstance as Hoi4GameInstance
    void inst.saveGame().then((ok) => ctx.output(ok ? '已保存' : '保存失败'))
  },
} as GMCommandDef

export default saveCmd
