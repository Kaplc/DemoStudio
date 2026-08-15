/**
 * registerBuiltinGMCommands — 内置 GM 命令（引擎通用，幂等注册）
 *
 * 内置命令（与项目无关，注册一次全局可用）：
 *  - help：列出全部命令 + 参数用法
 *  - list：只列命令名
 *  - clear：清空面板输出区
 *  - gm.enable / gm.disable：切换 GM 开关（gmOnly 命令的闸门）
 *
 * 注意：引擎无 timeScale 机制，本系统不提供 timescale 命令。
 * 注册幂等：每次调用先 clear 内置命令 id（HMR 重载不产生重复条目），
 * 再逐个 register。
 */
import { GMRegistry } from '../GMRegistry'
import { formatGMUsage } from '../GMCommand'
import { logger } from '../../Logger'

/** 内置命令定义集合 */
const BUILTIN_COMMANDS: Array<{ id: string; def: Parameters<typeof GMRegistry.register>[1] }> = [
  {
    id: 'builtin/help',
    def: {
      name: 'help',
      description: '列出全部 GM 命令与参数用法',
      handler: (ctx) => {
        const lines: string[] = ['── GM 命令列表 ──']
        for (const [, def] of GMRegistry.getAll()) {
          lines.push(`  ${formatGMUsage(def)} — ${def.description}`)
        }
        ctx.output(lines.join('\n'))
      },
    },
  },
  {
    id: 'builtin/list',
    def: {
      name: 'list',
      description: '只列命令名',
      handler: (ctx) => {
        const names = GMRegistry.getAll().map(([, def]) => def.name)
        ctx.output(`命令: ${names.join(' / ')}`)
      },
    },
  },
  {
    id: 'builtin/clear',
    def: {
      name: 'clear',
      description: '清空控制台输出区',
      handler: (ctx) => {
        // 输出区由 GMModule 控制台持有；经 gameInstance.gm 访问
        const gm = (ctx.gameInstance as unknown as { gm?: { clearConsoleOutput?: () => void } }).gm
        gm?.clearConsoleOutput?.()
        ctx.output('输出区已清空')
      },
    },
  },
  {
    id: 'builtin/gmEnable',
    def: {
      name: 'gm.enable',
      description: '开启 GM 模式（gmOnly 命令闸门，默认已开启）',
      handler: (ctx) => {
        const gm = (ctx.gameInstance as unknown as { gm?: { enabled: boolean } }).gm
        if (!gm) return
        gm.enabled = true
        ctx.output('GM 模式已开启')
      },
    },
  },
  {
    id: 'builtin/gmDisable',
    def: {
      name: 'gm.disable',
      description: '关闭 GM 模式（gmOnly 命令将被拒绝；用 gm.enable 恢复）',
      gmOnly: true,
      handler: (ctx) => {
        const gm = (ctx.gameInstance as unknown as { gm?: { enabled: boolean } }).gm
        if (!gm) return
        gm.enabled = false
        ctx.output('GM 模式已关闭（gmOnly 命令已禁用；输入 gm.enable 恢复）')
      },
    },
  },
]

/**
 * 注册全部内置 GM 命令（幂等）：
 * HMR 场景下模块重载重复调用 → 同 id 覆盖语义保证不重复（GMRegistry.register
 * 对同 id set 覆盖），项目命令 id 路径式天然不冲突。
 */
export function registerBuiltinGMCommands(): void {
  for (const { id, def } of BUILTIN_COMMANDS) {
    GMRegistry.register(id, def)
  }
  logger.info(`[GM] 内置命令已注册: ${BUILTIN_COMMANDS.map((c) => c.def.name).join(', ')}`)
}
