/**
 * 主窗口诊断脚本 —— 验证 agent-log IPC 转发是否到达
 * 
 * 在主窗口的 DevTools Console 中粘贴执行
 */

console.log('=== 主窗口 Agent 日志接收诊断 ===')

// 检查 onAgentLog 是否可用
const hasOnAgentLog = typeof window.electronAPI?.onAgentLog === 'function'
console.log(`[诊断] onAgentLog 可用 = ${hasOnAgentLog}`)

if (!hasOnAgentLog) {
  console.error('[诊断] onAgentLog 不可用！preload.ts 改动未生效')
} else {
  console.log('[诊断] 正在监听 agent-log 事件...')
  console.log('[诊断] 请在 Agent 窗口发送一条消息（或在 Agent 窗口 DevTools 跑诊断脚本）')
  
  const cleanup = window.electronAPI.onAgentLog((level: string, message: string) => {
    console.log(`[诊断] ✅ 收到 Agent 日志! level=${level}, message="${message}"`)
  })
  
  // 30 秒后自动停止
  setTimeout(() => {
    cleanup()
    console.log('[诊断] 监听已停止（30秒超时）')
  }, 30_000)
}

// 检查 Console 面板的 addConsoleOutput
console.log('[诊断] 检查 Console.tsx 的 onAgentLog useEffect 是否已注册...')
console.log('[诊断] （这个需要看 Console 组件是否已挂载 —— 如果 Console 面板可见则已挂载）')

console.log('=== 诊断完成 ===')
