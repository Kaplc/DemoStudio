# DemoStudio Preset 同步机制文档

## 概述

本文档记录了 DemoStudio 项目中自定义 Agent Preset 的同步机制、流程和原理。

---

## 1. 背景知识

### 1.1 什么是 Agent Preset？

Agent Preset 是 DeepSeek Harness (DSH) 中的一个核心概念，它定义了一个 Agent 的完整配置，包括：

- **Persona**: Agent 的身份和行为特征
- **Tools**: 可用的工具集
- **Skills**: 技能目录
- **Plan Mode**: 计划模式配置
- **Compaction**: 上下文压缩策略
- **Delegation**: 子代理和工作流配置

### 1.2 Preset 的存储位置

DSH 从多个位置发现 presets：

| 位置 | 说明 | 权限 |
|------|------|------|
| `<dsh-source>/apps/cli/config/agent-presets/` | 系统预设（standard, cordis, minimal, code） | 只读 |
| `$DSH_HOME/.agent-presets/` | 用户自定义 presets | 可写 |
| 配置的 `roots` 目录 | 通过配置添加的额外目录 | 取决于配置 |

### 1.3 Preset 目录结构

```
<preset-name>/
├── agent.cordis.yml    # 必需 - Cordis 组合配置文件
├── preset.yml          # 可选 - 元数据（名称、描述、排序）
└── skills/             # 可选 - 技能目录
```

---

## 2. DemoStudio 的问题与解决方案

### 2.1 问题描述

在 DemoStudio 项目中，我们希望：

1. 将自定义 presets 存放在项目本地目录 `E:\DemoStudio\.dsh\presets\`
2. 这些 presets 能够被 DSH 自动发现并加载
3. 无需复制到系统目录（避免权限问题）

### 2.2 权限问题

系统目录 `$DSH_HOME/.agent-presets/` 有严格的权限限制：

```
C:\Users\Kaplc\.dsh\.agent-presets
├── CodexSandboxUsers: ReadAndExecute (仅读取)
├── SYSTEM: FullControl
├── Administrators: FullControl
└── Kaplc: FullControl (但进程权限受限)
```

即使用户有 FullControl 权限，由于 DSH 进程运行在受限的沙箱环境中，无法直接写入该目录。

### 2.3 解决方案：补丁文件机制

DSH 提供了 `--patch` 参数，允许在启动时应用额外的配置补丁。我们利用这个机制：

1. 创建补丁文件，将本地目录添加为额外的 preset 根目录
2. 启动时通过 `--patch` 参数应用补丁
3. DSH 自动从配置的 roots 中发现 presets

---

## 3. 实现细节

### 3.1 补丁文件

**文件路径**: `E:\DemoStudio\.dsh\profiles\cordis.patch.yml`

```yaml
# DemoStudio 自定义配置补丁
# 将本地 .dsh\presets 目录添加为额外的 preset 根目录

- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
    roots:
      - path: "E:\\DemoStudio\\.dsh\\presets"
        trust: user
```

#### 配置说明

| 字段 | 说明 |
|------|------|
| `id` | 插件标识，必须与目标插件匹配 |
| `name` | 插件的 npm 包名 |
| `config.default` | 默认使用的 preset id |
| `config.roots` | 额外的 preset 根目录列表 |
| `config.roots[].path` | 目录路径（Windows 使用双反斜杠） |
| `config.roots[].trust` | 信任级别：`system` 或 `user` |

### 3.2 启动脚本

**文件路径**: `E:\DemoStudio\dsh-source.bat`

关键代码段：

```batch
REM ─── 配置本地 Presets 目录 ───
set "LOCAL_PRESETS=%~dp0.dsh\presets"
set "PATCH_FILE=%~dp0.dsh\profiles\cordis.patch.yml"

if exist "%LOCAL_PRESETS%" (
    REM 检查补丁文件是否存在，不存在则创建
    if not exist "%PATCH_FILE%" (
        echo       创建配置补丁文件...
        if not exist "%~dp0.dsh\profiles" mkdir "%~dp0.dsh\profiles"
        (
            echo # DemoStudio 自定义配置补丁
            echo - id: agent-presets
            echo   name: '@deepseek-ai/dsh-agent-presets'
            echo   config:
            echo     default: standard
            echo     roots:
            echo       - path: "E:\DemoStudio\.dsh\presets"
            echo         trust: user
        ) > "%PATCH_FILE%"
    )
    echo       [OK] 本地 presets 将通过补丁文件加载
)

REM ─── 启动 DSH ───
if exist "%LOCAL_PRESETS%" if exist "%PATCH_FILE%" (
    echo [Launch] 应用本地 presets 补丁...
    pnpm dsh web --patch "%PATCH_FILE%"
) else (
    pnpm dsh web
)
```

### 3.3 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    DSH 启动流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 检查本地 presets 目录是否存在                             │
│     └── E:\DemoStudio\.dsh\presets\                         │
│                                                             │
│  2. 检查补丁文件是否存在                                      │
│     └── E:\DemoStudio\.dsh\profiles\cordis.patch.yml        │
│     └── 不存在则自动创建                                     │
│                                                             │
│  3. 启动 DSH 并应用补丁                                      │
│     └── pnpm dsh web --patch cordis.patch.yml               │
│                                                             │
│  4. DSH 加载配置                                            │
│     └── 解析补丁文件                                         │
│     └── 将本地目录添加到 roots 列表                           │
│                                                             │
│  5. Preset 发现                                             │
│     └── 扫描系统预设目录                                      │
│     └── 扫描用户预设目录                                      │
│     └── 扫描配置的 roots 目录 ← 新增                         │
│                                                             │
│  6. Web UI 显示可用 presets                                  │
│     └── 包括本地的 game-editor                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 源码分析

### 4.1 AgentPresets 服务

**文件**: `packages/preset/agent-presets/src/index.ts`

```typescript
export class AgentPresets extends Service {
  static Config = z.object({
    default: z.string().required(),
    roots: z.array(z.object({
      path: z.string().required(),
      trust: z.union(['system', 'user'] as const).default('user'),
    })).default([]),
    includeUserRoot: z.boolean().default(true),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')

    // 解析 roots：配置的 roots + 用户根目录
    this.resolvedRoots = config.includeUserRoot
      ? [...config.roots, { path: dshHomePath(USER_PRESET_DIR), trust: 'user' }]
      : [...config.roots]
  }
}
```

### 4.2 Preset 发现机制

**文件**: `packages/preset/agent-presets/src/discovery.ts`

```typescript
export const USER_PRESET_DIR = '.agent-presets'

export async function discoverPresets(roots: readonly PresetRoot[]): Promise<AgentPreset[]> {
  const byId = new Map<string, AgentPreset>()

  // 按顺序扫描每个 root
  for (const root of roots) {
    for (const preset of await scanRoot(root)) {
      // 第一个 root 优先（同 id 时）
      if (byId.has(preset.id)) continue
      byId.set(preset.id, preset)
    }
  }

  return [...byId.values()]
}

export async function scanRoot(root: PresetRoot): Promise<AgentPreset[]> {
  const dir = resolve(expandHomePath(root.path))
  const children = await readdir(dir, { withFileTypes: true })

  const found: AgentPreset[] = []
  for (const child of children) {
    // 只处理符合 ID 格式的目录
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue

    const directory = join(dir, child.name)
    const path = join(directory, COMPOSITION_FILE)

    // 检查组合文件是否存在
    const broken = await isFile(path)
      ? await compositionProblem(path)
      : `the composition file ${COMPOSITION_FILE} is missing`

    const metadata = await readPresetMetadata(directory)
    found.push({
      id: child.name,
      trust: root.trust,
      path,
      ...metadata,
      ...broken === undefined ? {} : { broken },
    })
  }

  return found.sort(/* ... */)
}
```

### 4.3 补丁文件应用

**文件**: `packages/boot/app-boot/src/profile.ts`

DSH 启动时会按顺序应用配置层：

1. **Bundle 层**: 每个 bundle 的 `cordis.patch.yml`
2. **Profile 层**: profile 的 `cordis.patch.yml`
3. **用户层**: `$DSH_HOME/cordis.patch.yml`
4. **Overlay 层**: `--patch` 参数指定的文件

我们使用的是第 4 层（overlay），这是最后应用的层，可以覆盖所有前面的配置。

---

## 5. 使用指南

### 5.1 创建新的自定义 Preset

```bash
# 1. 创建 preset 目录
mkdir E:\DemoStudio\.dsh\presets\my-preset

# 2. 创建组合配置文件
# 编辑 E:\DemoStudio\.dsh\presets\my-preset\agent.cordis.yml

# 3. 创建元数据文件（可选）
# 编辑 E:\DemoStudio\.dsh\presets\my-preset\preset.yml
```

### 5.2 Preset 模板

#### agent.cordis.yml

```yaml
# 我的自定义 Agent Preset

# ── identity ────────────────────────────────────────────────────────────────

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a specialized assistant powered by the {{model}} model.
      Your working directory is {{cwd}}.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

# ── shell ───────────────────────────────────────────────────────────────────

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

# ── filesystem ──────────────────────────────────────────────────────────────

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'

# ── 添加更多工具和配置... ───────────────────────────────────────────────────
```

#### preset.yml

```yaml
name: 我的自定义 Agent
description: 一个用于特定任务的自定义 Agent
order: 10
```

### 5.3 验证 Preset

运行 `dsh-source.bat` 后，preset 会自动加载。可以在 Web UI 的 preset 选择器中查看。

---

## 6. 故障排除

### 6.1 Preset 未显示

**检查清单**:

1. ✅ preset 目录在 `E:\DemoStudio\.dsh\presets\` 下
2. ✅ 目录名符合 PRESET_ID 格式（小写字母、数字、连字符）
3. ✅ 包含 `agent.cordis.yml` 文件
4. ✅ `agent.cordis.yml` 是有效的 YAML
5. ✅ 补丁文件存在且格式正确
6. ✅ 启动时使用了 `--patch` 参数

### 6.2 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `preset not found` | preset 目录不存在或格式错误 | 检查目录名和文件 |
| `composition is not valid YAML` | YAML 语法错误 | 使用 YAML 验证工具检查 |
| `the composition file is missing` | 缺少 agent.cordis.yml | 创建该文件 |

### 6.3 调试命令

```bash
# 验证 YAML 语法
node -e "const yaml = require('js-yaml'); console.log(yaml.load(require('fs').readFileSync('agent.cordis.yml', 'utf8')))"

# 查看 DSH 配置
pnpm dsh web --dump-config --patch .dsh\profiles\cordis.patch.yml
```

---

## 7. 扩展阅读

- [DSH 官方文档](https://github.com/deepseek-ai/deepseek-harness)
- [Cordis 插件系统](https://github.com/cordiverse/cordis)
- [Agent Presets 源码](packages/preset/agent-presets/)

---

## 8. 更新日志

### 2026-01

- 初始版本
- 实现基于补丁文件的 preset 同步机制
- 创建 `game-editor` preset 示例
- 编写本文档

---

## 附录 A: 文件结构

```
E:\DemoStudio\
├── dsh-source.bat                    # 启动脚本
├── doc\
│   └── harness\
│       └── preset-sync-mechanism.md  # 本文档
├── .dsh\
│   ├── profiles\
│   │   └── cordis.patch.yml          # 配置补丁
│   └── presets\
│       └── game-editor\
│           ├── agent.cordis.yml      # 组合配置
│           └── preset.yml            # 元数据
└── harness\
    └── dsh-source\                   # DSH 源码
```

## 附录 B: 配置优先级

DSH 配置的优先级（从低到高）：

1. **系统默认**: DSH 内置的默认配置
2. **Bundle 层**: 每个 bundle 的 `cordis.patch.yml`
3. **Profile 层**: profile 的 `cordis.patch.yml`
4. **用户层**: `$DSH_HOME/cordis.patch.yml`
5. **Overlay 层**: `--patch` 参数指定的文件 ← 我们使用这一层

这意味着我们的补丁文件可以覆盖所有前面的配置，确保本地 presets 被正确加载。
