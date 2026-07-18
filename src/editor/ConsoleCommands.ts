/**
 * ConsoleCommands — 编辑器控制台命令处理
 *
 * 从 Console.tsx 中剥离的命令执行逻辑，包含所有内置控制台命令的定义和分发。
 */
import type { GameState } from '../stores/editorStore'

/** 控制台命令处理函数的上下文 */
export interface ConsoleCommandContext {
  /** 向控制台输出文本 */
  output: (text: string) => void
  /** 清空控制台 */
  clear: () => void
  /** 当前游戏状态 */
  gameState: GameState
  /** 启动游戏 */
  launchGame: () => void
  /** 停止游戏 */
  stopGame: () => void
}

/** 注册的命令表 */
const commandRegistry = new Map<string, (args: string[], ctx: ConsoleCommandContext) => void>()

/**
 * 注册一个控制台命令
 * @param name 命令名称（小写）
 * @param handler 处理函数
 */
export function registerCommand(
  name: string,
  handler: (args: string[], ctx: ConsoleCommandContext) => void,
): void {
  commandRegistry.set(name.toLowerCase(), handler)
}

/**
 * 执行控制台命令
 * @param input 原始用户输入
 * @param ctx 执行上下文
 */
export function executeCommand(input: string, ctx: ConsoleCommandContext): void {
  const parts = input.split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1)

  const handler = commandRegistry.get(command)
  if (handler) {
    handler(args, ctx)
  } else {
    ctx.output(`未知命令: ${command}。输入 help 查看可用命令。`)
  }
}

// ─── 内置命令注册 ───

registerCommand('help', (_args, ctx) => {
  ctx.output('可用命令:')
  ctx.output('  help           - 显示此帮助')
  ctx.output('  clear          - 清空控制台')
  ctx.output('  echo <text>    - 输出文字')
  ctx.output('  status         - 显示编辑器状态')
  ctx.output('  start_game     - 启动游戏')
  ctx.output('  stop_game      - 停止游戏')
  ctx.output('  toggle_game    - 切换游戏运行状态')
  ctx.output('')
  ctx.output(`当前游戏状态: ${ctx.gameState.running ? '🎮 运行中' : '⏹ 已停止'}`)
  ctx.output('  Ctrl+Enter - 启动/停止 | Shift+F5 - 停止')
})

registerCommand('clear', (_args, ctx) => {
  ctx.clear()
})

registerCommand('echo', (args, ctx) => {
  ctx.output(args.join(' '))
})

registerCommand('status', (_args, ctx) => {
  ctx.output('DemoStudio Editor v4.0.0')
  ctx.output('Engine: Three.js + Electron + React')
  ctx.output(
    `游戏状态: ${ctx.gameState.running ? '🎮 运行中 (分数: ' + ctx.gameState.score + ')' : '⏹ 已停止'}`,
  )
})

registerCommand('start_game', (_args, ctx) => {
  if (ctx.gameState.running) {
    ctx.output('⚠ 游戏已在运行中')
  } else {
    ctx.launchGame()
  }
})

registerCommand('stop_game', (_args, ctx) => {
  if (!ctx.gameState.running) {
    ctx.output('⚠ 游戏未在运行')
  } else {
    ctx.stopGame()
  }
})

registerCommand('toggle_game', (_args, ctx) => {
  if (ctx.gameState.running) {
    ctx.stopGame()
  } else {
    ctx.launchGame()
  }
})
