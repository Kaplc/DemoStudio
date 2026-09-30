/**
 * DSH 内核版本纯工具
 *
 * 运行内核 = 全局 npm 安装的 @deepseek-ai/dsh（见 main.ts getDshCliPath）。
 * 本模块提供版本号归一化、语义化比较、切换目标校验三个纯函数，
 * 供 dsh-list-versions / dsh-check-update / dsh-switch-version 三个 IPC 处理器使用。
 *
 * 背景：npm 版本号（如 0.1.7-rc.2）与本地源码仓 git tag（dsh-v0.1.2-alpha.1）
 * 命名不一致，展示层比较前必须归一化。
 */

/** 归一化版本串：去掉 dsh- / v 前缀与首尾空白（"dsh-v0.1.2" → "0.1.2"） */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^(?:dsh-)?v?/i, '').trim()
}

interface ParsedVersion {
  core: [number, number, number]
  pre: string[] | null
}

/** 解析 x.y.z[-pre][+build]；不合法返回 null（build 段不参与比较） */
function parseVersion(v: string): ParsedVersion | null {
  const s = normalizeVersion(v).split('+')[0]
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!m) return null
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : null,
  }
}

/**
 * 语义化比较：a<b 返回 -1，相等返回 0，a>b 返回 1。
 * 规则：核心段逐位数值比较；无预发布段 > 有预发布段（1.0.0 > 1.0.0-rc.1）；
 * 预发布段逐标识符比较，数字按数值、字母按 ASCII、数字标识符 < 字母标识符
 * （0.1.7-rc.2 > 0.1.7-rc.1 > 0.1.7-alpha.2）。
 * 任一侧不可解析返回 null，调用方自行决定兜底行为（不误报更新）。
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (!pa.pre && !pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1   // 前缀短的一方更小（1.0.0-rc < 1.0.0-rc.1）
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1             // 数字标识符 < 字母标识符
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * 校验切换目标是否为安全的 npm 版本串（仅允许 0.0.0 / 0.0.0-rc.1 形态）。
 * 该值会拼进 shell 命令，白名单校验是防注入的第一道闸。
 */
export function isValidUpdateTarget(target: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(normalizeVersion(target))
}
