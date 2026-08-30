import { describe, expect, it } from 'vitest'
import { join, resolve, sep } from 'node:path'
import { memoryDir, memoryEntrypointPath, memoryFilePath } from '../src/paths.js'
import { MEMORY_DIR_SEGMENT, MEMORY_ENTRYPOINT } from '../src/memoryTypes.js'

describe('paths - 记忆目录与文件路径解析', () => {
  const projectRoot = '/home/user/project'

  describe('memoryDir', () => {
    it('返回项目根下的记忆目录绝对路径', () => {
      const result = memoryDir(projectRoot)
      expect(result).toBe(resolve(join(projectRoot, MEMORY_DIR_SEGMENT)))
    })

    it('支持 Windows 风格路径', () => {
      const result = memoryDir('C:\\Users\\test\\project')
      expect(result).toContain('project')
      // Windows 路径分隔符是 \
      expect(result).toContain(MEMORY_DIR_SEGMENT.replace(/\//g, sep))
    })
  })

  describe('memoryEntrypointPath', () => {
    it('返回 MEMORY.md 的绝对路径', () => {
      const result = memoryEntrypointPath(projectRoot)
      // 路径分隔符可能是 / 或 \
      expect(result).toContain(MEMORY_DIR_SEGMENT.replace(/\//g, sep))
      expect(result).toContain(MEMORY_ENTRYPOINT)
    })
  })

  describe('memoryFilePath', () => {
    it('返回指定记忆文件的绝对路径', () => {
      const result = memoryFilePath(projectRoot, 'user_role.md')
      // 路径分隔符可能是 / 或 \
      expect(result).toContain(MEMORY_DIR_SEGMENT.replace(/\//g, sep))
      expect(result).toContain('user_role.md')
    })

    it('接受不带 .md 后缀的文件名', () => {
      const result = memoryFilePath(projectRoot, 'user_role')
      expect(result).toContain('user_role') // sanitizePathKey 不加 .md
    })

    it('拒绝路径穿越攻击', () => {
      expect(() => memoryFilePath(projectRoot, '../escape.md')).toThrow()
      expect(() => memoryFilePath(projectRoot, '../../etc/passwd')).toThrow()
    })

    it('拒绝 null 字节注入', () => {
      expect(() => memoryFilePath(projectRoot, 'file\0.md')).toThrow()
    })
  })
})
