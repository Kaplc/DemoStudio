/**
 * DSH 内核定位：全局 npm 安装包是运行内核唯一来源（harness/dsh-source 仅为源码参考仓）
 * 从 main.ts 原样搬迁（2026-10-01 适配层抽取，零行为变更）
 */

import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

/** 全局 npm 安装的 @deepseek-ai/dsh 包目录候选（npm root -g 优先，where npm.cmd 推导兜底） */
export function getGlobalDshPackageDirs(): string[] {
  const dirs: string[] = []
  try {
    const globalDir = execSync('npm root -g', { encoding: 'utf-8' }).trim()
    if (globalDir) dirs.push(path.join(globalDir, '@deepseek-ai', 'dsh'))
  } catch {
    // npm 可能因 node 不在 PATH 无法运行，继续尝试其他来源
  }
  // 回退：where npm.cmd 推导全局 node_modules（npm shim 目录 + node_modules）
  try {
    const where = execSync(process.platform === 'win32' ? 'where npm.cmd' : 'which npm', {
      encoding: 'utf-8', timeout: 5000,
    }).trim().split('\n')[0]
    if (where) {
      dirs.push(path.join(path.dirname(where), 'node_modules', '@deepseek-ai', 'dsh'))
    }
  } catch { /* ignore */ }
  return dirs
}

/** 优先全局 npm 安装的 DSH CLI（lib/bin.js） */
export function getDshCliPath(): string {
  const cli = getGlobalDshPackageDirs()
    .map((dir) => path.join(dir, 'lib', 'bin.js'))
    .find((p) => fs.existsSync(p))
  if (cli) console.log(`[DSH] 使用 DSH CLI: ${cli}`)
  return cli || ''
}

/** 读取全局安装 DSH 的实际版本（即运行内核版本；读 package.json，零进程开销） */
export function getInstalledDshVersion(): string {
  for (const dir of getGlobalDshPackageDirs()) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { version?: string }
      if (typeof pkg.version === 'string' && pkg.version) {
        console.log(`[DSH] 运行内核版本: ${pkg.version} (${dir})`)
        return pkg.version
      }
    } catch { /* 目录不存在或 package.json 损坏，试下一个候选 */ }
  }
  console.warn('[DSH] 未找到全局安装的 @deepseek-ai/dsh，无法确定运行内核版本')
  return ''
}

/**
 * 获取系统 Node.js 路径
 * DSH 要求 Node.js ^22.19.0 || >=24.0.0，而 Electron 内置的 Node.js 版本较低
 * 因此需要使用系统安装的 Node.js 来启动 DSH
 */
export function getSystemNodePath(): string {
  // 候选来源：where/which 结果 + Windows 注册表 InstallPath（Node 安装器写入，可能不在 PATH 中）
  const candidates: string[] = []
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
    // Windows 的 where 命令可能返回多行，每行都是候选
    candidates.push(...result.split('\n').map((l) => l.trim()).filter(Boolean))
  } catch {
    // where/which 未找到，继续尝试注册表
  }
  if (process.platform === 'win32') {
    for (const key of [
      'HKLM\\SOFTWARE\\Node.js',
      'HKLM\\SOFTWARE\\WOW6432Node\\Node.js',
      'HKCU\\SOFTWARE\\Node.js',
    ]) {
      try {
        const reg = execSync(`reg query "${key}" /v InstallPath`, { encoding: 'utf-8', timeout: 5000 })
        const m = reg.match(/InstallPath\s+REG_SZ\s+(.+)/)
        if (m) candidates.push(path.join(m[1].trim().replace(/\\$/, ''), 'node.exe'))
      } catch {
        // 注册表键不存在，继续下一个
      }
    }
  }
  const nodePath = candidates.find((p) => fs.existsSync(p))
  if (nodePath) {
    console.log(`[DSH] 使用系统 Node.js: ${nodePath}`)
    return nodePath
  }
  console.warn('[DSH] 无法找到系统 Node.js，将使用 Electron 内置 Node.js（可能版本不兼容）')
  return process.execPath
}
