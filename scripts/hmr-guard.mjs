#!/usr/bin/env node
/**
 * HMR Guard — 控制 Vite HMR 的暂停/恢复
 *
 * 用法：
 *   node scripts/hmr-guard.mjs pause              # 暂停 HMR，开始收集变更
 *   node scripts/hmr-guard.mjs flush              # 恢复 HMR 并触发收集的变更（重启）
 *   node scripts/hmr-guard.mjs resume             # 恢复 HMR 但丢弃变更（不重启）
 *   node scripts/hmr-guard.mjs status             # 查询状态
 *
 * Agent 集成：
 *   AgentService 在回合开始时自动 pause，回合结束时自动 flush（有引擎变更）或 resume（无变更）。
 *   此脚本仅供手动调试或特殊场景使用。
 */

const VITE_PORT = process.env.VITE_PORT || '5173'
const HMR_URL = `http://127.0.0.1:${VITE_PORT}/__hmr`

async function pause() {
  const res = await fetch(`${HMR_URL}/pause`, { method: 'POST' })
  const data = await res.json()
  console.log(`[HMR Guard] 已暂停，开始收集变更`)
  return data
}

async function flush() {
  const res = await fetch(`${HMR_URL}/flush`, { method: 'POST' })
  const data = await res.json()
  if (data.flushed) {
    console.log(`[HMR Guard] 已刷新，页面将重启（${data.changedFiles?.length || 0} 个文件变更）`)
  } else {
    console.log('[HMR Guard] 已恢复，无文件变更')
  }
  return data
}

async function resume() {
  const res = await fetch(`${HMR_URL}/resume`, { method: 'POST' })
  const data = await res.json()
  console.log('[HMR Guard] 已恢复（丢弃变更）')
  return data
}

async function status() {
  const res = await fetch(`${HMR_URL}/status`)
  const data = await res.json()
  console.log(`[HMR Guard] 状态: ${data.paused ? '已暂停' : '运行中'}`)
  if (data.pendingFiles?.length) {
    console.log(`  待处理文件: ${data.pendingFiles.join(', ')}`)
    console.log(`  含引擎文件: ${data.hasEngineChanges ? '是' : '否'}`)
  }
  return data
}

// 主入口
const [,, action] = process.argv

try {
  switch (action) {
    case 'pause':
      await pause()
      break
    case 'flush':
      await flush()
      break
    case 'resume':
      await resume()
      break
    case 'status':
      await status()
      break
    default:
      console.log(`用法:
  hmr-guard.mjs pause    暂停 HMR，开始收集变更
  hmr-guard.mjs flush    恢复 HMR 并触发变更（重启）
  hmr-guard.mjs resume   恢复 HMR 但丢弃变更（不重启）
  hmr-guard.mjs status   查询状态`)
      break
  }
} catch (err) {
  console.error(`[HMR Guard] 无法连接 Vite (${HMR_URL}): ${err.message}`)
  process.exit(1)
}
