/**
 * 记忆目录与文件路径解析。
 * 记忆目录固定为 `<项目根>/.dsh/memory/`（随 git 跟踪）；
 * 所有相对 key 在进入文件系统前先过 security 层。
 *
 * @module paths
 */

import { join, resolve } from 'node:path'
import { MEMORY_DIR_SEGMENT, MEMORY_ENTRYPOINT } from './memoryTypes.js'
import { sanitizePathKey } from './security.js'

/** 项目根下的记忆目录绝对路径。 */
export function memoryDir(projectRoot: string): string {
  return resolve(join(projectRoot, MEMORY_DIR_SEGMENT))
}

/** 记忆索引（MEMORY.md）绝对路径。 */
export function memoryEntrypointPath(projectRoot: string): string {
  return join(memoryDir(projectRoot), MEMORY_ENTRYPOINT)
}

/** 记忆名（已含 .md）在记忆目录下的绝对路径。 */
export function memoryFilePath(projectRoot: string, fileName: string): string {
  return join(memoryDir(projectRoot), sanitizePathKey(fileName))
}
