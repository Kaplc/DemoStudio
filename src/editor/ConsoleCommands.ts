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
  ctx.output('  ui.compile <widget路径>    - 编译 .widget.html 源 → widget.json')
  ctx.output('  ui.decompile <widget路径>  - 反编译 widget.json → .widget.html 源')
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
  ctx.output('DemoStudio Editor v0.1.0')
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

// ─── UI 源格式编译/反编译调试命令（devdoc/ui-html-source-format）───

registerCommand('ui.compile', (args, ctx) => {
  const asset = args[0]
  if (!asset) {
    ctx.output('用法: ui.compile <widget资产路径>（如 src/projects/fish/asset/blueprints/ui/toast.widget.json）')
    return
  }
  void (async () => {
    const { compileUiSourceToAsset } = await import('./asset/uiSourceActions')
    const r = await compileUiSourceToAsset(asset)
    if (r.ok) {
      ctx.output(`✅ 编译成功: ${r.assetPath}（assetLint 零错误）`)
    } else {
      ctx.output(`❌ 编译失败: ${asset}`)
      for (const e of r.errors) ctx.output(`  行 ${e.line}: ${e.message}`)
      for (const i of r.lintIssues) ctx.output(`  [lint/${i.severity}] [${i.nodePath}] ${i.message} (${i.rule})`)
    }
  })()
})

registerCommand('ui.decompile', (args, ctx) => {
  const asset = args[0]
  if (!asset) {
    ctx.output('用法: ui.decompile <widget资产路径>（反编译结果写入同名 .widget.html）')
    return
  }
  void (async () => {
    const { decompileWidgetJson } = await import('./asset/uiCompiler')
    const { sourcePathOf } = await import('./asset/uiSourceSync')
    const api = window.electronAPI
    const r = api?.readJsonFile
      ? await api.readJsonFile(asset)
      : { success: false, error: 'electronAPI 不可用' }
    if (!r.success) {
      ctx.output(`❌ 读取失败: ${r.error}`)
      return
    }
    const d = decompileWidgetJson(r.data)
    if (!d.ok || !d.html) {
      ctx.output(`❌ 反编译失败: ${d.warnings.join('; ')}`)
      return
    }
    const srcPath = sourcePathOf(asset)
    const w = api?.writeTextFile
      ? await api.writeTextFile(srcPath, d.html)
      : { success: false, error: 'electronAPI 不可用' }
    if (!w.success) {
      ctx.output(`❌ 写入失败: ${'error' in w ? w.error : '未知错误'}`)
      return
    }
    ctx.output(`✅ 反编译成功: ${asset} → ${srcPath}`)
    for (const warn of d.warnings) ctx.output(`  ⚠ ${warn}`)
  })()
})
