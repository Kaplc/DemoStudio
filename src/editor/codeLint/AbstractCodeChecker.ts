/**
 * codeLint/AbstractCodeChecker — 代码规则检查器基类
 *
 * 子类只需声明 kind 并实现 check(sourceFile, ctx)：
 * 用 ts.forEachChild 遍历轻量语法树（createSourceFile 产物，不建 Program、不做 typecheck），
 * 命中违规时返回 CodeIssue（行/列由 node.getStart(sourceFile) + getLineAndCharacterOfPosition 推导）。
 *
 * 新增规则：extends 本类 + 在 checkers/ barrel 加一行 import（模块末尾 registerCodeChecker 自注册）。
 */
import type * as ts from 'typescript'
import type { CodeIssue, CheckerContext } from './types'

export abstract class AbstractCodeChecker {
  /** 派发键（与注册时的 kind 一致）。 */
  abstract readonly kind: string

  /** 主入口：对单个源文件执行规则检查，返回违规列表。 */
  abstract check(sourceFile: ts.SourceFile, ctx: CheckerContext): CodeIssue[]

  /** 便捷工具：node 起始位置 → 1 起的行列号。 */
  protected posOf(node: ts.Node, sourceFile: ts.SourceFile): { line: number; col: number } {
    const pos = node.getStart(sourceFile)
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos)
    return { line: line + 1, col: character + 1 }
  }
}
