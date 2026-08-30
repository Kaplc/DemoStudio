/**
 * projectRoot — 从插件真实物理路径定位 DemoStudio 项目根目录
 *
 * 不依赖 process.cwd()（DSH 运行时 CWD 不可靠），
 * 改用 import.meta.url 得到编译后文件的真实路径，向上遍历。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const _filename = fileURLToPath(import.meta.url)
const _dirname = path.dirname(_filename)

/**
 * 从当前文件的真实物理路径出发，向上查找项目根目录。
 * 策略：找包含 harness/ds-plugin-manager/package.json 的目录。
 */
function findProjectRoot(): string {
  let dir = _dirname
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'harness', 'ds-plugin-manager', 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 最后兜底：硬编码相对位置（本文件在 harness/ds-plugin-manager/src/ → 项目根 2 级上）
  return path.resolve(_dirname, '..', '..', '..')
}

export const PROJECT_ROOT = findProjectRoot()
