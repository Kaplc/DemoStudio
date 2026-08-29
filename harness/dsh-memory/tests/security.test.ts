import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertSafeWritePath, PathTraversalError, realpathDeepestExisting, sanitizePathKey } from '../src/security.js'

let dir: string
async function scratch(): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), 'dsh-mem-sec-'))
  return dir
}

afterAll(async () => {
  if (dir !== undefined) {
    await import('node:fs/promises').then(fs => fs.rm(dir!, { recursive: true, force: true }))
  }
})

describe('sanitizePathKey（字符串层，各拒绝用例）', () => {
  it('合法文件名原样返回', () => {
    expect(sanitizePathKey('user_role.md')).toBe('user_role.md')
    expect(sanitizePathKey('sub/notes.md')).toBe('sub/notes.md')
  })
  it('拒绝 null 字节', () => {
    expect(() => sanitizePathKey('a\0b.md')).toThrow(PathTraversalError)
  })
  it('拒绝 URL 编码穿越 %2e%2e%2f', () => {
    expect(() => sanitizePathKey('%2e%2e%2fetc%2fpasswd')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('a%2F%2E%2E%2Fb')).toThrow(PathTraversalError)
  })
  it('拒绝 Unicode 规范化攻击（NFKC 全角 ．．／）', () => {
    expect(() => sanitizePathKey('．．／escape.md')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('file．md')).not.toThrow()
  })
  it('拒绝反斜杠', () => {
    expect(() => sanitizePathKey('..\\windows\\system32')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('a\\b.md')).toThrow(PathTraversalError)
  })
  it('拒绝绝对路径（POSIX / 盘符 / UNC）', () => {
    expect(() => sanitizePathKey('/etc/passwd')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('C:/Windows')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('C:\\Windows')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('//server/share')).toThrow(PathTraversalError)
  })
  it('拒绝 .. 段', () => {
    expect(() => sanitizePathKey('../escape.md')).toThrow(PathTraversalError)
    expect(() => sanitizePathKey('a/../../b')).toThrow(PathTraversalError)
  })
})

describe('realpathDeepestExisting + assertSafeWritePath（文件系统层）', () => {
  it('目标不存在但祖先存在：realpath 祖先并拼回尾部', async () => {
    const root = await scratch()
    const resolved = await realpathDeepestExisting(join(root, 'not-yet-created.md'))
    expect(resolved.startsWith(await realOf(root))).toBe(true)
  })

  it('写入路径在目录内：放行', async () => {
    const root = await scratch()
    await expect(assertSafeWritePath(root, 'ok.md')).resolves.toContain('ok.md')
  })

  it('符号链接逃逸：目录内的链接指向外部 → 拒绝', async () => {
    const root = await scratch()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-mem-out-'))
    const secret = join(outside, 'secret.txt')
    await writeFile(secret, 'outside', 'utf8')
    try {
      await symlink(secret, join(root, 'escape.md'))
    } catch {
      // Windows 无开发者模式/特权时无法建符号链接：环境不支持则跳过该用例
      return
    }
    await expect(assertSafeWritePath(root, 'escape.md')).rejects.toThrow()
  })

  it('目录内的子目录链接逃逸 → 拒绝', async () => {
    const root = await scratch()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-mem-out2-'))
    try {
      await symlink(outside, join(root, 'sub'))
    } catch {
      return
    }
    await expect(assertSafeWritePath(root, 'sub/evil.md')).rejects.toThrow()
  })

  it('悬空符号链接 → 拒绝', async () => {
    const root = await scratch()
    try {
      await symlink(join(root, 'no-such-target-anywhere'), join(root, 'dangling.md'))
    } catch {
      return
    }
    await expect(assertSafeWritePath(root, 'dangling.md')).rejects.toThrow()
  })

  it('根目录不存在：字符串层校验通过即放行（首写场景）', async () => {
    const root = join(await scratch(), 'not-created-yet')
    await expect(assertSafeWritePath(root, 'first.md')).resolves.toContain('first.md')
    await expect(assertSafeWritePath(root, '../escape.md')).rejects.toThrow(PathTraversalError)
  })
})

async function realOf(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(path)
}

describe('安全层组合（store 实际入口）', () => {
  it('mkdir 前先建目录再写不会绕过校验', async () => {
    const root = join(await scratch(), 'nested', 'memory')
    await mkdir(root, { recursive: true })
    await expect(assertSafeWritePath(root, 'deep.md')).resolves.toContain('deep.md')
  })
})
