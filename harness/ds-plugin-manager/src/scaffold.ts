/**
 * scaffold.ts — DSH 插件脚手架生成
 *
 * 功能：
 * - 生成 package.json / tsconfig.json / src/index.ts
 * - 模板化，支持自定义描述和配置
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ScaffoldOptions {
  /** 插件目录（绝对路径） */
  pluginDir: string
  /** npm 包名（如 @demostudio/dsh-xxx） */
  packageName: string
  /** 描述 */
  description: string
  /** 插件注册名（如 my-plugin） */
  pluginName: string
  /** 需要 inject 的服务列表 */
  inject?: string[]
}

export interface ScaffoldResult {
  files: string[]
  pluginDir: string
}

/**
 * 生成插件脚手架文件
 */
export function createScaffold(options: ScaffoldOptions): ScaffoldResult {
  const { pluginDir, packageName, description, pluginName, inject = ['tools'] } = options
  const files: string[] = []

  // 确保目录存在
  fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true })

  // package.json
  const pkgJson = {
    name: packageName,
    version: '0.1.0',
    description,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      watch: 'tsc --watch',
    },
    keywords: ['demostudio', 'dsh', 'agent', 'tools'],
    license: 'MIT',
    dependencies: {},
    devDependencies: {
      typescript: '^5.6.3',
    },
  }
  writeJson(path.join(pluginDir, 'package.json'), pkgJson)
  files.push('package.json')

  // tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      lib: ['ES2022'],
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
    },
    include: ['src/**/*.ts'],
    exclude: ['node_modules', 'dist'],
  }
  writeJson(path.join(pluginDir, 'tsconfig.json'), tsConfig)
  files.push('tsconfig.json')

  // src/index.ts
  const injectStr = JSON.stringify(inject)
  const indexContent = `/**
 * ${description}
 */

export const name = '${packageName}'

/** 本插件访问的 Cordis 服务 */
export const inject = ${injectStr}

interface DSHContext {
${inject.map((s) => `  ${s}?: any`).join('\n')}
  effect?(fn: () => void): void
}

export function apply(ctx: DSHContext): void {
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => registerTools(ctx))
  } else {
    registerTools(ctx)
  }
}

function registerTools(ctx: DSHContext): void {
${inject.includes('tools') ? `  const tools = ctx.tools
  if (!tools || typeof tools.register !== 'function') return

  // TODO: 在此注册工具
  // tools.register(myTool)` : `  // TODO: 在此实现插件逻辑`}
}
`
  fs.writeFileSync(path.join(pluginDir, 'src', 'index.ts'), indexContent, 'utf-8')
  files.push('src/index.ts')

  return { files, pluginDir }
}

/**
 * 更新已存在插件的 src/index.ts（追加工具注册）
 */
export function appendToolRegistration(
  pluginDir: string,
  toolRegistration: string,
): void {
  const indexPath = path.join(pluginDir, 'src', 'index.ts')
  if (!fs.existsSync(indexPath)) return

  let content = fs.readFileSync(indexPath, 'utf-8')

  // 在 registerTools 函数体内追加
  const marker = '// TODO: 在此注册工具'
  if (content.includes(marker)) {
    content = content.replace(marker, toolRegistration)
  } else {
    // 找到 registerTools 函数的最后一个 } 前插入
    const lastBrace = content.lastIndexOf('}')
    if (lastBrace > 0) {
      content = content.slice(0, lastBrace) + '\n  ' + toolRegistration + '\n' + content.slice(lastBrace)
    }
  }

  fs.writeFileSync(indexPath, content, 'utf-8')
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}
