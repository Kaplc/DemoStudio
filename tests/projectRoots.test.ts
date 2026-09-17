/**
 * projectRoots 单根行为锁 — doc-dev/projects-root-unification 方案 §3.1
 *
 * 锁定迁移终态：PROJECT_ROOTS 单根 ['projects']，内置轨 src/projects 全面退役。
 * 纯函数模块测试，不拉引擎 barrel。
 */
import { describe, it, expect, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  PROJECT_ROOTS,
  appRootFromMainDir,
  resolveProjectRoot,
  resolveProjectRoots,
  projectRootFor,
  relativeRootFor,
  isProjectAssetRel,
} from '../electron/projectRoots'

// 临时夹具基目录：自包含，afterAll 整体清理（只删自己创建的这一级）
const FIXTURE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-roots-test-'))
afterAll(() => { fs.rmSync(FIXTURE_BASE, { recursive: true, force: true }) })

/** 造一个独立 appRoot；withProjects 时建 projects/<folders> 目录树 */
function makeAppRoot(withProjects: boolean, folders: string[] = []): string {
  const appRoot = path.join(FIXTURE_BASE, `app-${Math.random().toString(36).slice(2)}`)
  if (withProjects) {
    for (const f of folders) fs.mkdirSync(path.join(appRoot, 'projects', f), { recursive: true })
  }
  return appRoot
}

describe('A. PROJECT_ROOTS 单根定标', () => {
  it('A1: 根常量只有外部根 projects/（内置轨退役锁）', () => {
    expect(PROJECT_ROOTS).toEqual(['projects'])
  })
})

describe('B. 根解析纯函数', () => {
  it('B1: resolveProjectRoot — 真实根返回绝对路径，缺失返回 null', () => {
    const appRoot = makeAppRoot(true, ['fish'])
    expect(resolveProjectRoot(appRoot, 'projects')).toBe(path.join(appRoot, 'projects'))
    expect(resolveProjectRoot(makeAppRoot(false), 'projects')).toBeNull()
  })

  it('B2: resolveProjectRoots — 只收集真实存在的根', () => {
    const withRoot = makeAppRoot(true, ['fish'])
    expect(resolveProjectRoots(withRoot)).toEqual([path.join(withRoot, 'projects')])
    expect(resolveProjectRoots(makeAppRoot(false))).toEqual([])
  })

  it('B3: projectRootFor — 按 folder 命中所在根', () => {
    const appRoot = makeAppRoot(true, ['fish'])
    expect(projectRootFor(appRoot, 'fish')).toBe('projects')
    expect(projectRootFor(appRoot, 'not-exist')).toBeNull()
  })

  it('B4: relativeRootFor — 根内返回正斜杠相对路径，越界返回 null', () => {
    const appRoot = makeAppRoot(false)
    expect(relativeRootFor(appRoot, path.join(appRoot, 'projects/fish/a.json')))
      .toBe('projects/fish/a.json')
    expect(relativeRootFor(appRoot, path.join(appRoot, '..'))).toBeNull()
  })

  it('B5: appRootFromMainDir — 由 dist-electron 上跳一级', () => {
    expect(appRootFromMainDir(path.join('repo', 'dist-electron'))).toBe('repo')
  })
})

describe('C. isProjectAssetRel 资产路径校验', () => {
  it('C1: 接受 projects/<folder>/asset/ 三层以上路径', () => {
    expect(isProjectAssetRel('projects/fish/asset/a.blueprint.json')).toBe(true)
    expect(isProjectAssetRel('projects/warm-current/asset/blueprints/ui/x.widget.json')).toBe(true)
  })
  it('C2: 拒绝内置轨前缀 src/projects/**（退役锁）', () => {
    expect(isProjectAssetRel('src/projects/fish/asset/a.blueprint.json')).toBe(false)
  })
  it('C3: 第二段必须是 asset；data/、gameplay/ 等不属资产', () => {
    expect(isProjectAssetRel('projects/fish/data/save.json')).toBe(false)
    expect(isProjectAssetRel('projects/fish/gameplay/x.ts')).toBe(false)
  })
  it('C4: 段数不足 / 无根前缀 / 逃逸路径拒绝', () => {
    expect(isProjectAssetRel('projects/fish/asset')).toBe(false)
    expect(isProjectAssetRel('asset/a.json')).toBe(false)
    expect(isProjectAssetRel('../projects/fish/asset/a.json')).toBe(false)
  })
})
