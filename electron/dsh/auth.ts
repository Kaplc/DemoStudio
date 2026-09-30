/**
 * DSH web 鉴权桥（0.1.7+ 强制 cookie；0.1.1 无鉴权）
 *
 * 鉴权方式 = GET 启动 URL（?token=…）换 30 天 HttpOnly cookie（dsh-auth-<key>=v1.…）。
 * token 每次 spawn 都变、打印在 dsh-agent.log 的 `dsh web:` 行；cookie 跨内核重启有效
 * （鉴权密钥持久在 home）。Host 头必须 127.0.0.1（node fetch 自动满足）。
 *
 * 是否启用由当前活跃适配器的 capabilities.authRequired 决定（lifecycle 选中适配器时同步），
 * 未启用时 dshAuthHeaders 返回空、ensureDshAuthCookie 直通 null——适配器回退 0.1.1 时零分支。
 */

import fs from 'fs'
import path from 'path'
import { dshCtx } from './context'

let _dshAuthCookie: string | null = null
let _authRequired = true

/** lifecycle 选中适配器时同步鉴权模式（authRequired=false 时本模块全部直通） */
export function setDshAuthRequired(required: boolean): void {
  if (_authRequired !== required) {
    console.log(`[DSH-auth] 鉴权模式切换: ${_authRequired ? '强制 cookie' : '无鉴权'} → ${required ? '强制 cookie' : '无鉴权'}`)
  }
  _authRequired = required
  if (!required) _dshAuthCookie = null
}

function readDshLaunchUrl(): string | null {
  try {
    const text = fs.readFileSync(path.join(dshCtx().logDir, 'dsh-agent.log'), 'utf8')
    return /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(text)?.[1] ?? null
  } catch { return null }
}

/** 确保持有鉴权 cookie；无鉴权模式恒返回 null（调用方无需判空分流） */
export async function ensureDshAuthCookie(): Promise<string | null> {
  if (!_authRequired) return null
  if (_dshAuthCookie) return _dshAuthCookie
  const url = readDshLaunchUrl()
  if (!url) return null // token 未打印（内核未起/刚截断日志），探测循环稍后重试
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    if (res.status === 303) {
      const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie')
      if (setCookie) {
        _dshAuthCookie = setCookie.split(';')[0]
        console.log('[DSH-auth] 已换取鉴权 cookie')
      }
    }
  } catch { /* 换取失败不致命，下轮探测重试 */ }
  return _dshAuthCookie
}

/** 出站请求附鉴权头；无鉴权模式返回 {} */
export function dshAuthHeaders(): Record<string, string> {
  if (!_authRequired) return {}
  return _dshAuthCookie ? { cookie: _dshAuthCookie } : {}
}

/** 丢弃当前 cookie（401/token 轮换时由探测与 RPC 代理调用） */
export function resetDshAuthCookie(): void {
  _dshAuthCookie = null
}

/** 仅测试用：清空模块状态 */
export function __resetDshAuthForTest(): void {
  _dshAuthCookie = null
  _authRequired = true
}
