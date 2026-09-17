/**
 * 工程根迁移兜底守卫 — doc-dev/projects-root-unification 方案 §3.3
 *
 * 把方案验证计划里的人工兜底 grep 固化为测试：仓库代码区 'src/projects' 字面量必须清零。
 * （2026-09-17 追加：registry.ts 已迁至 src/editor/projects/registry.ts，src/projects 目录
 * 彻底删除——原"src/projects/registry 路径行豁免"随之作废，现零残留零豁免。）
 * 豁免：行为锁测试文件自身（内含否定性断言字面量）。
 * md/doc 历史文档不扫（§2.G 人工清理，不设自动化门槛）。
 * 另锁：project.json 前缀、ConfigRegistry 缺省 basePath 翻转、fish 两处高危路径常量。
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import '@/engine'
import { ConfigRegistry } from '@/engine'

const REPO = process.cwd()
const SCAN_DIRS = ['src', 'electron', 'scripts', 'e2e', 'tests', 'projects']
const ROOT_FILES = ['demostudio.config.json']
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.json', '.html'])
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vite', 'dist', 'dist-electron',
  '.dsh', 'test-results', 'playwright-report',
])
/** 行为锁文件自身：内含否定性断言字面量，豁免扫描 */
const LOCK_FILES = new Set([
  'tests/projectRoots.test.ts',
  'tests/mockProjectBridge.test.ts',
  'tests/projectsRootGuard.test.ts',
])

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectFiles(path.join(dir, entry.name), out)
      continue
    }
    if (EXTS.has(path.extname(entry.name))) out.push(path.join(dir, entry.name))
  }
  return out
}

describe('A. 全仓代码区 src/projects 残留清零', () => {
  it('A1: 六源码区 + 根配置，零命中零豁免（registry 已迁 src/editor/projects）', () => {
    const files = [
      ...SCAN_DIRS.flatMap(d => collectFiles(path.join(REPO, d))),
      ...ROOT_FILES.map(f => path.join(REPO, f)),
    ]
    const hits: string[] = []
    for (const file of files) {
      const rel = path.relative(REPO, file).replace(/\\/g, '/')
      if (LOCK_FILES.has(rel)) continue
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (line.includes('src/projects')) {
          hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
        }
      })
    }
    expect(hits, `以下位置残留 src/projects（迁移未清干净）：\n${hits.join('\n')}`).toEqual([])
  })
})

describe('B. projects/*/project.json 路径字段前缀', () => {
  it('B1: main / defaultScene（若存在）必须以 projects/ 开头', () => {
    const root = path.join(REPO, 'projects')
    const folders = fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    expect(folders.length, '外部根至少应有一个工程').toBeGreaterThan(0)
    for (const f of folders) {
      const jsonPath = path.join(root, f.name, 'project.json')
      if (!fs.existsSync(jsonPath)) continue
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>
      for (const field of ['main', 'defaultScene'] as const) {
        const v = json[field]
        if (typeof v === 'string' && v.length > 0) {
          expect(v.startsWith('projects/'),
            `${f.name}/project.json.${field} = "${v}" 应以 projects/ 开头`).toBe(true)
        }
      }
    }
  })
})

describe('C. 配置表与存档高危路径锁', () => {
  afterEach(() => { ConfigRegistry.clear() })

  it('C1: registerGlob 不传 basePath 时缺省指向 projects/<name>/asset/config（缺省值翻转锁）', () => {
    ConfigRegistry.registerGlob('guardprobe', { configModules: { './a.config.json': {} } })
    const paths = (ConfigRegistry as unknown as { configPaths: Map<string, string> }).configPaths
    expect(paths.get('guardprobe.a')).toBe('projects/guardprobe/asset/config/a.config.json')
  })

  it('C2: fish 配置表显式 basePath 源码锁（自文档化，不依赖缺省值）', () => {
    const src = fs.readFileSync(path.join(REPO, 'projects/fish/FishConfigLoader.ts'), 'utf-8')
    expect(src).toContain("'projects/fish/asset/config'")
  })

  it('C3: fish 存档路径常量源码锁（旧存档续用的前提）', () => {
    const src = fs.readFileSync(path.join(REPO, 'projects/fish/gameplay/common/FishSaveAdapter.ts'), 'utf-8')
    expect(src).toContain("'projects/fish/data/save.json'")
  })
})
