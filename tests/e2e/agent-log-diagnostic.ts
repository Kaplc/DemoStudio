/**
 * Agent 窗口日志转发诊断脚本
 * 
 * 使用方法：在 Agent 窗口的 DevTools Console 中粘贴执行
 * 
 * 检查项：
 * 1. isAgentWindow 检测是否正确
 * 2. forwardAgentLog 是否存在于 electronAPI
 * 3. onAgentLog 是否存在于主窗口 electronAPI
 * 4. 实际调用 forwardAgentLog 后主窗口 Console 面板是否收到
 */

console.log('=== Agent 窗口日志转发诊断 ===')

// 1. 检查 URL 是否包含 agentWindow=1
const isAgentWindow = window.location?.search?.includes('agentWindow=1')
console.log(`[诊断] window.location.search = "${window.location.search}"`)
console.log(`[诊断] isAgentWindow = ${isAgentWindow}`)

// 2. 检查 electronAPI 是否存在
console.log(`[诊断] window.electronAPI 存在 = ${!!window.electronAPI}`)

// 3. 检查 forwardAgentLog 是否可用
const hasForward = typeof window.electronAPI?.forwardAgentLog === 'function'
console.log(`[诊断] forwardAgentLog 可用 = ${hasForward}`)

// 4. 检查 onAgentLog 是否可用（仅主窗口有）
const hasOnAgentLog = typeof window.electronAPI?.onAgentLog === 'function'
console.log(`[诊断] onAgentLog 可用 = ${hasOnAgentLog}（仅主窗口应为 true）`)

// 5. 检查 Logger 单例状态
// @ts-ignore - 诊断用
const loggerModule = (window as any).__logger_debug

// 6. 实际发送一条测试日志
if (hasForward) {
  console.log('[诊断] 正在发送测试日志...')
  window.electronAPI.forwardAgentLog('info', '[诊断测试] 这是一条从 Agent 窗口发送的测试日志')
  console.log('[诊断] 已发送。请切换到主窗口查看 Console 面板是否出现 "[Agent] [诊断测试] ..."')
} else {
  console.error('[诊断] forwardAgentLog 不可用！preload.ts 的改动可能未生效，请确认已重启 Electron')
}

// 7. 测试 console-message（文件写入）
console.log('[诊断] 正在测试 console-message 文件写入...')
console.info('[诊断测试] 这条 console.info 应该被 console-message 监听捕获并写入 console_*.log')
console.log('[诊断] 已发送。请检查 logs/ 目录下最新的 console_*.log 文件是否包含 "[AGENT:INFO]" 行')

console.log('=== 诊断完成 ===')
