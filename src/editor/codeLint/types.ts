/**
 * codeLint/types — 代码扫描检查器共享类型定义
 *
 * - CodeIssue：检查器产出的单条违规，file/line/col/rule/message 组成去重指纹
 * - CheckerContext：检查器运行时上下文（当前工程子目录名）
 * - CodeFileEntry：CodeSource.list 返回的源码文件（ok 时含 text，失败时含 error）
 */

/** 单条代码违规。file::line::col::rule::message 组成去重指纹。无 severity（一律按 error 输出）。 */
export interface CodeIssue {
  /** 源码文件相对路径（如 src/projects/fish/gameplay/foo.ts） */
  file: string
  /** 行号（1 起） */
  line: number
  /** 列号（1 起） */
  col: number
  /** 人类可读的违规描述 */
  message: string
  /** 规则 id（注册 checker 时的 kind） */
  rule: string
}

/** 检查器运行时上下文。 */
export interface CheckerContext {
  /** 当前工程子目录名（对应 src/projects/<folder>，如 'fish'） */
  projectFolder: string
}

/** CodeSource.list 返回的源码文件：读成功含 text；失败含 error（跳过校验，记一条 read 错误）。 */
export type CodeFileEntry =
  | { path: string; text: string }
  | { path: string; error: string }
