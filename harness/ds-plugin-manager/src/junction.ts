/**
 * junction.ts — Windows Junction 创建与校验
 *
 * 功能：
 * - 扫描 ~/.dsh/profiles/{web,headless}/
 * - 为每个 profile 创建 node_modules/@demostudio/<pkg> junction
 * - 校验已存在 junction 的目标是否正确
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export interface JunctionResult {
  profile: string
  action: 'created' | 'skipped' | 'removed' | 'error'
  path: string
  error?: string
}

/**
 * 剥离 @scope/ 前缀：pkgName 只允许是裸包名（如 ds-editor-tools），
 * 传入完整包名（@demostudio/ds-editor-tools）时自动剥掉 scope，
 * 防止拼出 node_modules/@demostudio/@demostudio/<pkg> 嵌套错位。
 */
function stripScope(pkgName: string): string {
  return pkgName.startsWith('@') ? pkgName.split('/')[1] ?? pkgName : pkgName
}

/**
 * 确保 junction 存在且指向正确目标（幂等）
 */
function ensureJunctionForProfile(
  pluginDir: string,
  pkgName: string,
  profilesDir: string,
  profile: string,
): JunctionResult {
  const safeName = stripScope(pkgName)
  const junctionPath = path.join(profilesDir, profile, 'node_modules', '@demostudio', safeName)
  const sourcePath = path.resolve(pluginDir)

  // 已存在 → 检查目标是否正确
  if (fs.existsSync(junctionPath)) {
    try {
      const stat = fs.lstatSync(junctionPath)
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        // 读取 junction 目标
        const target = fs.readlinkSync(junctionPath)
        const normalizedTarget = path.resolve(target)
        const normalizedSource = path.resolve(sourcePath)
        if (normalizedTarget === normalizedSource || normalizedTarget === sourcePath) {
          return { profile, action: 'skipped', path: junctionPath }
        }
        // 目标不对 → 删除重建
        fs.rmSync(junctionPath, { recursive: true, force: true })
      }
    } catch {
      // 无法读取 → 删除重建
      fs.rmSync(junctionPath, { recursive: true, force: true })
    }
  }

  // 确保父目录存在
  const parentDir = path.dirname(junctionPath)
  fs.mkdirSync(parentDir, { recursive: true })

  // 创建 junction（PowerShell）
  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `New-Item -ItemType Junction -Path "${junctionPath}" -Target "${sourcePath}" | Out-Null`,
    ], { stdio: 'pipe', timeout: 10_000 })
    return { profile, action: 'created', path: junctionPath }
  } catch (err) {
    return { profile, action: 'error', path: junctionPath, error: String(err) }
  }
}

/**
 * 为插件在所有 profile 下创建 junction（web + headless）
 */
export function ensureJunctions(
  pluginDir: string,
  pkgName: string,
  dshHome: string,
): JunctionResult[] {
  const profilesDir = path.join(dshHome, 'profiles')
  const results: JunctionResult[] = []

  for (const profile of ['web', 'headless']) {
    const profileDir = path.join(profilesDir, profile)
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true })
    }
    results.push(ensureJunctionForProfile(pluginDir, pkgName, profilesDir, profile))
  }

  return results
}

/**
 * 移除 junction
 */
export function removeJunctions(
  pkgName: string,
  dshHome: string,
): JunctionResult[] {
  const profilesDir = path.join(dshHome, 'profiles')
  const results: JunctionResult[] = []
  const safeName = stripScope(pkgName)

  for (const profile of ['web', 'headless']) {
    const junctionPath = path.join(profilesDir, profile, 'node_modules', '@demostudio', safeName)
    if (fs.existsSync(junctionPath)) {
      try {
        fs.rmSync(junctionPath, { recursive: true, force: true })
        results.push({ profile, action: 'removed', path: junctionPath })
      } catch (err) {
        results.push({ profile, action: 'error', path: junctionPath, error: String(err) })
      }
    }
  }

  return results
}
