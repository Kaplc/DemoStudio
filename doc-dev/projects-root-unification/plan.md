# 工程单根化迁移方案（src/projects → projects/）

> **一句话定位**：把 `src/projects/` 下三个内置工程（fish / demo2d / arena）迁到仓库根 `projects/`，退役"内置+外部"双轨机制，`src/` 不再存放任何工程，全引擎单根 `projects/`。
> **前置结论**：外部轨（`import.meta.glob('/projects/*/register.ts')` 自动发现）已由 warm-current / hoi4 / hello 三工程全链路验证可用，本次迁移本质 = **git mv + 每工程 3~4 处小改 + 双轨机制退役清理**，不引入任何新机制。

---

## 1. 现状盘点

### 1.1 迁移对象

| 工程 | ProjectModule.name | 特有迁移点 |
|---|---|---|
| `src/projects/fish` | ClashMaster | 配置表 basePath、存档路径常量、`data/save.json` 实体存档 |
| `src/projects/demo2d` | Demo2D | 无（仅通用两点） |
| `src/projects/arena` | Arena | 无（仅通用两点） |

**留在 src 的**：`src/projects/registry.ts` —— 它是注册中心（`ProjectModule` 契约 + glob 收集），不是工程。外部工程已通过 `'../../src/projects/registry'` 导入类型，原样保留，`src/editor/index.ts`、`EditorInitializer.ts`、`editorStore.ts` 三个消费方零改动。

### 1.2 已确认的免疫项（不用改）

| 免疫项 | 原因 |
|---|---|
| 三工程的资产注册 `import.meta.glob('./**/*.scene.json')` 等 | 相对模式，整体搬家 key 不变 |
| `import { ... } from '@/engine'` | vite alias 全仓生效，warm/hoi4 同款已验证 |
| 工程内 GM 命令 glob `./gameplay/gm/*.gm.ts` | 相对模式 |
| 预览层磁盘路径→资产 key 截取 | 以 `/asset/` 为锚点，不关心前缀是哪条根 |
| `tsconfig.json` include | 已含 `"projects"` |
| `vite.config.ts` | 无任何 `src/projects` 特判 |
| `read-json-file` / `write-json-file` IPC | 本就按仓库根相对路径解析，不感知工程根 |
| e2e spec 的工程选择 | 走工程卡 name（ClashMaster 等），folder 搬家无感 |

---

## 2. 实施步骤（建议拆 2 个 commit，便于整体 revert）

### Commit ①：纯搬移（零代码改动）

```bash
git mv src/projects/fish    projects/fish
git mv src/projects/demo2d  projects/demo2d
git mv src/projects/arena   projects/arena
```

- `fish/data/save.json` 虽被 gitignore，但 `git mv` 目录是文件系统重命名，未跟踪文件随目录物理迁移，**旧存档无缝续用**。
- 迁移前 `ls src/projects/*/data` 确认没有其他未跟踪产物（截图/导出）遗漏。

### Commit ②：路径单根化（全部改点）

#### A. 工程内适配（搬过去的三个工程）

| # | 文件 | 改法 |
|---|---|---|
| 1 | 三个 `project.json` | `main` / `defaultScene` 前缀 `src/projects/<folder>/...` → `projects/<folder>/...`（`main` 无运行时消费方，纯元数据，但保持一致） |
| 2 | 三个 `register.ts` | `import type { ProjectModule } from '../registry'` → `'../../src/projects/registry'`（对齐 warm/hoi4 现行写法） |
| 3 | `fish/FishConfigLoader.ts` init() 尾部 | `this.registerGlob(configGlob.configModules, configGlob.tableModules, 'projects/fish/asset/config')` —— 显式传参保持自文档化（配合下一行缺省值翻转后，漏传也已无害） |
| 4 | `src/engine/tools/ConfigRegistry.ts:139` | **缺省 basePath 翻转**：`` `src/projects/${projectName}/asset/config` `` → `` `projects/${projectName}/asset/config` ``。单根后缺省值即正确值，未来新工程漏传 basePath 不再全表 404（§3 测试 C1 锁定） |
| 5 | `fish/gameplay/common/FishSaveAdapter.ts:42` | `FISH_SAVE_FILE = 'projects/fish/data/save.json'`（存档实体已随目录迁移） |
| 6 | engine 相关注释 | `SaveSlotComponent.ts` / `ConfigLoaderBase.ts` / `ConfigRegistry.ts` / `SceneAsset.ts` / `BlueprintRegistry.ts` / `DataTable.ts` 头注释里的 src/projects 示例顺手改（§3 守卫测试 A1 会拦注释残留） |

#### B. registry.ts 单根化

- 删 `demo2d/fish/arena` 三个静态 import，`ALL_PROJECTS` 改空数组字面量，只保留 glob 收集循环。
- "外部覆盖内置同名"分支退化为重名兜底（保留 warn + 覆盖语义，零成本）。
- `ProjectModule` 类型、全部导出函数签名不动。

#### C. Electron 侧

| 文件 | 改法 |
|---|---|
| `electron/projectRoots.ts` | `PROJECT_ROOTS = ['projects']`；`resolveProjectRoots` / `projectRootFor` / `isProjectAssetRel` 全是数组遍历，逻辑不动，注释更新 |
| `electron/main.ts` | discover / list / watch 全走 projectRoots 纯函数，自动单根；`create-project` 已落 projects/ 不动；模板与注释文案更新 |

#### D. 前端

| 文件 | 改法 |
|---|---|
| `src/components/AssetBrowser.tsx` | `projectAssetRoot` 删 source 分支，恒 `projects/${folder}` |
| `src/stores/projectStore.ts` | `DEFAULT_PROJECTS` 两条 `defaultScene` 改 projects/ 前缀 |
| `source` 字段处置 | **建议一次性删除**：`editorStore.Project.source`、`mockProjectScan.DiscoveredProject.source`、`main.ts` 赋值、`projectMerge.mergeProjects` 双参退化为按 folder 去重。改动面约 6 文件，换掉长期双轨歧义。保守替代=保留字段恒 external，不推荐 |
| `src/editor/MockElectronAPI.ts` | glob 数组删 `'../projects/...'` 前缀，只留 `'../../projects/...'` |
| `src/editor/mockPath.ts` | `normalizeGlobPath` 删 `../`→`src/` 分支，只留 `../../projects/` 剥前缀（纯函数模块，重建单测锁） |
| `src/editor/mockProjectScan.ts` | key 正则本就双兼容，收窄注释即可 |
| 文案类 | `CodeLintEngine.ts` 日志文案、`ConsoleCommands.ts` ui.compile 示例、各预览管理器（UI/Blueprint/Scene PreviewManager）与 `BlueprintEditor.tsx` 注释更新 |

#### E. 工具链 / 脚本

| 文件 | 改法 |
|---|---|
| `scripts/ui-compiler-main.ts:116` | prefix 判断删 `src/projects/` 分支 |
| `scripts/ui-compiler-smoke.ts` | 两处 `src/projects/fish/asset/blueprints/ui` → `projects/fish/...` |
| `scripts/ui-snapshot.mjs` | 同上 |
| `scripts/bp-compile-all.mjs:27` | `roots = ['projects']` |
| `scripts/tmp-verify-assets.js` | tmp 脚本，批量替换或直接删除 |
| `editor/mcp-server.mjs` | ui_compile / ui_compile_html / bp_compile 三工具的描述与参数文案改 projects/ 前缀。**mcp-server 是常驻进程，改完须重启 MCP server 才生效** |
| `demostudio.config.json` | projects 数组里 `src/projects/snake` 条目指向不存在的目录（陈旧），删除（无运行时消费方） |

#### F. e2e / tests / 配置

| 文件 | 改法 |
|---|---|
| `tests/bpSourceGuard.test.ts:18` | `ASSET_PATH = 'projects/fake/...'` —— **必改**：isProjectAssetRel 收窄后 src/projects 前缀不再合法 |
| `tests/e2e/fish/widget-save-region.spec.ts:31-32` | 两常量改 projects/fish/... |
| `tests/e2e/ui-golden-capture.mjs:23` | `UI_DIR` 改 projects/fish/... |
| `e2e/framework/projects.ts` | 注释与 description 文案更新（folder id / cardName 不变，spec 零改动） |
| `.gitignore:53-54` | `src/projects/*/data/*` 两条 → `projects/*/data/*` + `!projects/*/data/.gitkeep` |
| `harness/ds-instructions/src/config.ts` | DEFAULT_MAPPINGS 删 `src/projects` 条目（`projects` 条目已在） |
| 新增 3 个单测 + e2e 用例 | 全量代码见 §3 测试用例设计（projectRoots / mockProjectBridge / projectsRootGuard）；**新测试文件须 `git add -f`**（.gitignore:156 `tests/*`） |

#### G. 文档与 AI 注入面

| 文件 | 改法 |
|---|---|
| `doc/dev/external_project_roots.md` | 顶部加"双轨已单根化退役"横幅，指向本文档；正文保留作历史 |
| `.github/instructions/projects.instructions.md` | applyTo 删 `src/projects/**`；正文 `src/projects/{name}` 示例全改；"内置案例轨道"段落改写 |
| `doc/README.md` §4、`doc/system_overview.md`、`AGENTS.md` | 目录地图与标题条目更新 |
| `.zcode/skills/skl-create-*-asset/SKILL.md` 等 7 处 | 示例路径 grep 更新 |
| 本文档 | 实施后补 §实施记录 |
| `.dsh/` 记忆、auto-memory | 历史记录不回改，触及即修 |

---

## 3. 测试用例设计（新增 3 个单测文件 + e2e 用例，代码全文化）

> **落地时机与纪律**
> - 三个单测随 **Commit ② 同 commit 落地**——终态锁断言的是迁移后的世界，先行落盘必红；同 commit 落地则落地即绿。
> - **新测试文件须 `git add -f`**（.gitignore:156 `tests/*`）。
> - 引擎级 vitest 坑（memory 已知）：涉及 `ConfigRegistry` 的用例须先 `import '@/engine'` barrel；jsdom 下 `readJson` 无 electronAPI 时静默返回 null，fire-and-forget 无未处理拒绝，单测安全。
> - 夹具纪律（external_project_roots.md §10.1 血泪教训）：临时目录只建在 `os.tmpdir()` 下自己的 mkdtemp 基目录内，清理只删该基目录，**绝不触碰真实仓库目录**。
> - 设计取舍：不逐文件断言各处前缀（AssetBrowser 组件级导入重、运行时链路归 e2e），而是用 **守卫测试"残留清零"** 兜底——迁移漏改任何一处源码字面量，A1 都会拦下并列出 文件：行。

### 3.1 `tests/projectRoots.test.ts` — electron/projectRoots 单根行为锁

```ts
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
```

### 3.2 `tests/mockProjectBridge.test.ts` — 浏览器 Mock 桥三纯函数

```ts
/**
 * Mock 桥三纯函数单测 — doc-dev/projects-root-unification 方案 §3.2
 *
 * normalizeGlobPath（mockPath）：glob key → IPC 相对路径，双前缀收窄为单前缀终态。
 * scanProjectsFrom（mockProjectScan）：Mock 工程发现，source 字段随双轨退役删除。
 * mergeProjects（projectMerge）：双参合流退化为单参按 folder 去重。
 * 三者均为纯函数模块（无 vite / engine 依赖），直接实例级断言。
 */
import { describe, it, expect } from 'vitest'
import { normalizeGlobPath } from '../src/editor/mockPath'
import { scanProjectsFrom } from '../src/editor/mockProjectScan'
import { mergeProjects } from '../src/stores/projectMerge'

describe('A. normalizeGlobPath 单前缀翻译', () => {
  it('A1: 外部根 key 剥两层上跳', () => {
    expect(normalizeGlobPath('../../projects/foo/project.json')).toBe('projects/foo/project.json')
    expect(normalizeGlobPath('../../projects/fish/asset/blueprints/ui/x.widget.html'))
      .toBe('projects/fish/asset/blueprints/ui/x.widget.html')
  })
  it('A2: Windows 反斜杠 key 先归一正斜杠再剥前缀', () => {
    expect(normalizeGlobPath('..\\..\\projects\\warm-current\\asset\\a.widget.json'))
      .toBe('projects/warm-current/asset/a.widget.json')
  })
  it('A3: 已是仓库根相对形态时幂等', () => {
    expect(normalizeGlobPath('projects/x/y.json')).toBe('projects/x/y.json')
  })
  it('A4: 旧内置前缀 ../projects/** 不再翻译成 src/**（内置轨退役锁）', () => {
    expect(normalizeGlobPath('../projects/fish/project.json')).toBe('../projects/fish/project.json')
  })
})

describe('B. scanProjectsFrom Mock 工程发现', () => {
  it('B1: 单前缀 key 提取 folder 与元数据', () => {
    const projects = scanProjectsFrom([
      ['../../projects/fish/project.json',
       { name: 'ClashMaster', defaultScene: 'projects/fish/asset/fish_menu.scene.json' }],
    ])
    expect(projects).toHaveLength(1)
    expect(projects[0].folder).toBe('fish')
    expect(projects[0].name).toBe('ClashMaster')
    expect(projects[0].defaultScene).toBe('projects/fish/asset/fish_menu.scene.json')
  })
  it('B2: source 字段退役（双轨合流不再存在）', () => {
    const projects = scanProjectsFrom([['../../projects/hello/project.json', {}]])
    expect('source' in projects[0]).toBe(false)
  })
  it('B3: 旧内置形态 key（src/projects/**）不被识别', () => {
    expect(scanProjectsFrom([['src/projects/fish/project.json', { name: 'X' }]])).toHaveLength(0)
  })
  it('B4: 坏条目跳过不影响其他工程（与主进程容错语义一致）', () => {
    const projects = scanProjectsFrom([
      ['../../projects/bad/project.json', null],
      ['../../projects/good/project.json', { name: 'Good' }],
    ])
    expect(projects.map(p => p.folder)).toEqual(['good'])
  })
  it('B5: 缺省字段兜底（version=1.0.0、tags=[]）', () => {
    const [p] = scanProjectsFrom([['../../projects/empty/project.json', {}]])
    expect(p.version).toBe('1.0.0')
    expect(p.tags).toEqual([])
  })
})

describe('C. mergeProjects 单参去重', () => {
  it('C1: folder 重复保留首个，顺序稳定', () => {
    const merged = mergeProjects([
      { name: 'A', folder: 'a' },
      { name: 'B', folder: 'b' },
      { name: 'A2', folder: 'a' },
    ])
    expect(merged.map(p => p.folder)).toEqual(['a', 'b'])
    expect(merged[0].name).toBe('A')
  })
  it('C2: 空列表安全', () => {
    expect(mergeProjects([])).toEqual([])
  })
})
```

### 3.3 `tests/projectsRootGuard.test.ts` — 迁移兜底守卫（方案 §4.11 兜底 grep 的测试化）

```ts
/**
 * 工程根迁移兜底守卫 — doc-dev/projects-root-unification 方案 §3.3
 *
 * 把方案验证计划里的人工兜底 grep 固化为测试：仓库代码区 'src/projects' 字面量必须清零。
 * 豁免（迁移后的合法残留）：
 *   - 含 src/projects/registry 的行 —— registry.ts 保留在 src/projects/registry，
 *     各外部工程 register.ts / main.ts 模板 import 它是合法路径；
 *   - 行为锁测试文件自身（内含否定性断言字面量）。
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
/** 合法残留：registry 模块路径（import 行与提及它的注释行） */
const REGISTRY_PATH_RE = /src\/projects\/registry/
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
  it('A1: 六源码区 + 根配置，除 registry 路径行外零命中', () => {
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
        if (line.includes('src/projects') && !REGISTRY_PATH_RE.test(line)) {
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
```

### 3.4 e2e 用例（playwright，tests/e2e/playwright.config.ts 入口）

| # | 用例 | 性质 | 断言点 |
|---|---|---|---|
| E1 | 既有 `e2e/fish/smoke.spec.ts` + `e2e/warm/` 全套回归 | **零新增**，迁移后必跑 | fish smoke 走通 = 新根上工厂注册 / 资产注册 / GM 桥全链路健康（这是最强的一条迁移回归）；warm 保持基线 6 失败对照，勿判新 |
| E2 | 新增 `e2e/home/project_cards.spec.ts` 工程卡全量点验 | 新增（可选但推荐） | 编辑器主页六张工程卡可见：Demo2D / ClashMaster / Arena / WarmCurrent / Hoi4 / Hello —— 单根发现双保险 |

E2 骨架（实施时按 `e2e/framework/fixtures` 实况校准主页定位方式；框架现有 `game` 夹具面向进游戏，主页断言走 page 级选择器）：

```ts
// e2e/home/project_cards.spec.ts — 单根迁移后工程卡全量可见
import { test, expect } from '../framework/fixtures'

const EXPECTED_CARDS = ['Demo2D', 'ClashMaster', 'Arena', 'WarmCurrent', 'Hoi4', 'Hello']

test('工程卡全量可见（单根发现）', async ({ page }) => {
  // 打开编辑器主页（不进游戏），逐卡断言
  for (const name of EXPECTED_CARDS) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  }
})
```

---

## 4. 验证计划

1. `npx tsc --noEmit` 全绿（projects 已在 include）。
2. `npx vitest run` 全绿：新增三文件（projectRoots / mockProjectBridge / projectsRootGuard）+ 既有套件（bpSourceGuard 等）。
3. **删 `node_modules/.vite` 缓存或 `--force` 起 dev**（glob eager 重新收集 + 清旧模块图），整页刷新。
4. Electron 手动链路：工程卡 6 工程全可见（Demo2D / ClashMaster / Arena / WarmCurrent / Hoi4 / Hello）→ 逐个打开 → 资产浏览器列资产 → 蓝图/UI 编辑保存 → 游戏启动。
5. fish 专项：GM 面板看 `[ConfigRegistry] registerGlob(fish @ projects/fish/asset/config)` 日志、配置表实际生效（兵种/建筑等级）、**旧存档读回**（save.json 续用）。
6. 浏览器 Mock 模式（vite 直开）：工程发现 + 资产列表不 404（normalizeGlobPath 单前缀翻译正确）——历史最易漏盲区，§3.2 单测已锁翻译规则，此处验真实 glob key 形态。
7. `npm run smoke:ui` 过（ui-compiler-smoke 指向新路径）。
8. e2e：E1 既有 fish smoke + warm 全套（基线 6 失败对照，勿判新）；有条件加跑 E2 工程卡点验。
9. `run_asset_lint` 全量 0 error。
10. `create-project` 新建工程仍落 `projects/`、重启后被发现。
11. **兜底 grep 已固化为 §3.3 守卫测试 A1**（`npx vitest run tests/projectsRootGuard.test.ts` 即人工 grep 的等价自动化；md/doc 历史文档仍按 §2.G 人工清理，不设门槛）。

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| fish 配置 basePath 漏传 | 列为高危必改项；验证计划第 5 条专门盯 |
| Mock 模式 glob 前缀漏改 | 验证第 6 条专项；normalizeGlobPath 建单测锁 |
| bpSourceGuard 假路径炸 lint | 收窄 isProjectAssetRel 后必改，tsc/vitest 直接暴露 |
| vite 模块图缓存持旧路径 | 迁移后删 `.vite` 缓存 / --force 一次 |
| 用户本机 src/projects/*/data 下未跟踪产物 | 迁移前 ls 确认一并带走 |
| 并行会话共写工作区（Edit staleness 坑） | 迁移 commit 期间避免其他会话动 src/projects |
| 回滚 | 两 commit 一起 `git revert` 即完整回到双轨 |

## 6. 工作量

改点约 25 文件，绝大多数为常量/注释/文案；真实逻辑改动约 9 处（registry 静态轨删除、PROJECT_ROOTS、AssetBrowser 前缀、Mock glob/path、ui-compiler prefix、gitignore、source 字段退役、fish basePath、ConfigRegistry 缺省翻转）。另新增 3 个单测文件约 260 行 + 1 个可选 e2e spec。预计半天含验证。

---

## 7. 实施记录（2026-09-17 已完成）

**Commit ① 纯搬移**：`git mv` 三工程完成，`fish/data/save.json` 旧存档随目录物理迁移。坑：dev server（vite watcher）持有 `src/projects` 目录句柄导致 `git mv` Permission denied——先停 `npm run electron:dev` 进程树再搬移，全部改完后重启 dev（本次迁移本来就要删 `.vite` 缓存重启）。

**Commit ② 路径单根化**：方案 §2 A~G 全部落地，另加方案外的必要项：

| 项 | 说明 |
|---|---|
| A 组 | 3×project.json 前缀、3×register.ts import `'../../src/projects/registry'`、FishConfigLoader 显式 basePath、FishSaveAdapter 常量、ConfigRegistry 缺省翻转 + engine 6 文件注释 |
| B 组 | registry.ts 删 3 个静态 import，`ALL_PROJECTS = []` 纯 glob 收集，覆盖分支退化为重名兜底 |
| C 组 | projectRoots.ts `PROJECT_ROOTS = ['projects']`；main.ts 注释/模板文案（模板 `import ... from '../../src/projects/registry'` 为合法残留，registry 仍在 src） |
| D 组 | AssetBrowser 恒 projects/ 前缀；**source 字段全链退役**（editorStore.Project / mockProjectScan / electron.d.ts / main.ts discover 赋值 / projectMerge 双参退化单参去重）；MockElectronAPI glob 数组收窄单前缀（readTextFile 的 key 翻转同步改为 `projects/` → `../../projects/`）；mockPath 删 `../`→`src/` 分支；codeLint/各 PreviewManager/windowApi 等 15 文件文案批量替换 |
| E 组 | ui-compiler-main prefix 收窄、bp-compile-all `roots = ['projects']`、ui-compiler-smoke / ui-snapshot 路径、**tmp-verify-assets.js 直接删除**（一次性脚本）、mcp-server.mjs 三工具文案、demostudio.config.json 删陈旧 Snake 条目 |
| F 组 | bpSourceGuard ASSET_PATH、widget-save-region / ui-golden-capture 路径常量、e2e framework 注释、.gitignore 删旧两条、**ds-instructions DEFAULT_MAPPINGS 删 src/projects 条目**（连带 mapping.test.ts 3 处 + lifecycle.test.ts 1 处同步改） |
| 新测试 | §3.1/3.2/3.3 三个单测落地（26 例）+ e2e `home/project_cards.spec.ts`；已 `git add -f`（.gitignore:154 `tests/*`） |
| G 组 | external_project_roots.md 顶部退役横幅；projects.instructions.md applyTo/标题/模板路径全改；doc/README.md §4 标题；system_overview.md §1/§5.1/§6/§7/§9 全面改写（项目清单 6 个单根口径、registry 表格、统计命令）；**doc/ 下 61 个 md 批量替换路径引用**（保护 `src/projects/registry` 真实路径，链接不断）；五套 skills 目录（.dsh/.github/.cursor/.zcode/.agent）批量替换 |

**方案偏差/特情**：
- 方案 §2.G 的 `AGENTS.md` 在仓库根不存在（仅 harness/dsh-source 下有，属 DSH 源码库），跳过。
- `tests/externalRoots.test.ts` 实际不存在（mockProjectScan/mockPath/projectMerge 注释里的引用是过时的），由 §3.2 新测试替代，注释已同步指向新测试。
- MockElectronAPI 头注释改路径时踩了"`*/` 字面量终止块注释"坑（main.ts create-project 模板注释里预警过的同一坑），tsc 立即暴露，`*\/` 转义修复。
- e2e/README.md 与 doc/harness/dsh_instructions_prd_revised.md FR-1 行顺手同步。

**验证结果**：
- `npx tsc --noEmit` 全绿；`tests/projectRoots + mockProjectBridge + projectsRootGuard` 26/26 通过（含守卫 A1 六源码区残留清零）。
- `npm run smoke:ui` 全过；`npm run bp:all` 3/3（全部来自 projects/ 单根）。
- vitest 全量：602 通过 / 12 失败（warmSupplyChain 等 4 文件）。经 git diff + 依赖闭包核对判定为**既有基线失败，与迁移无关**：① warm 三文件（11 例）依赖的 projects/warm-current/gameplay/** 本次零改动（git diff 仅 ConfigLoader 注释 2 行），且测试不调 registerGlob、测试环境（无 electronAPI）下 ConfigRegistry 新旧缺省 basePath 同样加载不到表，行为同构；② imageLightbox（1 例）依赖 agent 面板组件（MessageBubble/ToolCard），迁移零触碰。
- 实机验证（dev server 重启后）：vite :5173 正常出编辑器页面（eager glob 收集 6 工程 registry 未炸）；CDP 直连页面调 `discoverProjectsScan` 返回全部 6 工程（Arena/Demo2D/ClashMaster/Hello/Hoi4/WarmCurrent），defaultScene 全部 `projects/` 前缀——§4 验证第 4 条的工程发现双保险通过。
- 事故与恢复（环境层，与迁移代码无关）：验证过程中用 git worktree + junction node_modules 做基线对照，`git worktree remove --force` 跟随 junction 把主仓 node_modules 整个删空；已 `npm ci` 全量重建（822 packages，vitest 3.2.7 复跑结果与事故前逐位一致）。连带影响：项目 node_modules 里的 harness 插件 junction（@demostudio/ds-*）一并丢失，已手动重建 7 个（patch 配置在用户级 ~/.dsh 未受影响）；`.vite` 缓存已清、dev server 已按 §4 第 3 条重启。
- Electron 手动链路深层（打开工程跑游戏 / fish 存档读回 / 浏览器 Mock 模式 / create-project）：需交互验证，见 §4 第 4~6、10 条清单。

### 7.1 追加：registry 最终搬移，src/projects 彻底删除（2026-09-17 同日）

方案原决定"registry.ts 保留在 src/projects"（§1.1），实施后用户裁定 `src/projects` 目录不再保留。追加执行：

- `git mv src/projects/registry.ts` → **`src/editor/projects/registry.ts`**（编辑器侧注册中心归属 editor 层），空目录 `src/projects/` 删除
- registry.ts 内部 `../engine` → `../../engine`；src 消费方 3 处更新（`editor/index.ts` 与 `EditorInitializer.ts` 改 `./projects/registry`、`stores/editorStore.ts` 惰性 import 改 `../editor/projects/registry`）
- 6×`register.ts` + main.ts create-project 模板：import 与注释 `'../../src/projects/registry'` → `'../../src/editor/projects/registry'`（相对深度不变）
- 守卫测试收紧：删除 `REGISTRY_PATH_RE` 豁免——代码区 `src/projects` 字面量从此**零残留零豁免**
- 文档：10 个 md 的 registry 链接同步；projects/README.md 重写为单根口径；fish devdocs README 路径更新
- 验证：tsc 全绿；vitest 全量 602/12 与搬移前逐位一致（零回归）；CDP 实机——编辑器页面动态 import `/src/editor/projects/registry.ts` 成功（4 导出齐全）、`discoverProjectsScan` 6 工程全发现
- 本方案文档 §1~§6 为迁移前现状快照，其中的 `src/projects/registry` 表述按历史保留，registry 最终位置以本节为准
