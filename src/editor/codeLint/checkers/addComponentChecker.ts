/**
 * codeLint/checkers/addComponentChecker — addComponent 旧写法检测
 *
 * 检测 CallExpression：callee 为 PropertyAccessExpression 且 name 为 'addComponent'，
 * 且第一个参数是 NewExpression（即 addComponent(new Xxx(...)) 实例版旧写法）。
 *
 * 规则依据：AObject/BObject 的 addComponent 已支持类版（addComponent(Xxx, ...args)，
 * 内部自动 new，owner 自动传入），实例版保留仅为兼容旧写法。
 * 只做语法匹配，不做类型解析（不追踪 this 指向、不建 Program）。
 */
import * as ts from 'typescript'
import { AbstractCodeChecker } from '../AbstractCodeChecker'
import { registerCodeChecker } from '../CodeCheckerRegistry'
import type { CodeIssue, CheckerContext } from '../types'

const MESSAGE = 'addComponent 旧写法：addComponent(new Xxx(...))，请改为 addComponent(Xxx, ...)'

class AddComponentChecker extends AbstractCodeChecker {
  readonly kind = 'addComponent'

  check(sourceFile: ts.SourceFile, _ctx: CheckerContext): CodeIssue[] {
    const issues: CodeIssue[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'addComponent') {
          const firstArg = node.arguments[0]
          if (firstArg && ts.isNewExpression(firstArg)) {
            const { line, col } = this.posOf(firstArg, sourceFile)
            issues.push({ file: sourceFile.fileName, line, col, message: MESSAGE, rule: this.kind })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return issues
  }
}

registerCodeChecker('addComponent', AddComponentChecker)
