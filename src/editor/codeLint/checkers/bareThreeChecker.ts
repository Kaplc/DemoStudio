/**
 * codeLint/checkers/bareThreeChecker — 项目代码裸 new THREE 几何体/网格/材质检测
 *
 * 检测 NewExpression：expression 为 PropertyAccessExpression 且其 expression 是 Identifier 'THREE'
 * （仅直链 `new THREE.Xxx`），且 Xxx 命中黑名单（见下）。
 *
 * 规则依据：projects.instructions.md §程序化生成规则 —— 项目代码禁止直接调用
 * `new THREE.Mesh()` / `new THREE.BoxGeometry()` / `new THREE.SphereGeometry()` /
 * `new THREE.PlaneGeometry()` / `new THREE.MeshBasicMaterial()` 等构造函数**创建几何体**，
 * 程序化生成的基础图元必须走 World 工厂（createBoxMesh/createSphereMesh/createPlaneMesh/...）。
 *
 * 命中黑名单（几何体/网格/材质类族）：Mesh、*Geometry、*Material。
 * 豁免数学工具类（不属于"创建几何体"，World 工厂无对应方法，引擎自身也大量使用）：
 *   Vector2/3/4、Color、Plane、Ray、Raycaster、Matrix4、Quaternion、Euler、Box3、Sphere、
 *   CanvasTexture、Texture、TextureLoader、Group、Scene、Camera、Light、Sprite 等。
 *
 * 已知边界（按需求约定）：
 * - 不追踪别名导入：import * as T from 'three'; new T.Mesh 不报
 * - 不追踪解构/局部变量：const { Mesh } = THREE; new Mesh 不报
 * - 注释/字符串中的 new THREE.Xxx 天然规避（AST 只走真实表达式节点）
 */
import * as ts from 'typescript'
import { AbstractCodeChecker } from '../AbstractCodeChecker'
import { registerCodeChecker } from '../CodeCheckerRegistry'
import type { CodeIssue, CheckerContext } from '../types'

/** 黑名单：几何体/网格/材质（规则原文列举类族）。CanvasTexture/Vector3/Color 等数学与纹理类豁免。 */
const BANNED_THREE_CTOR_RE = /^(Mesh|\w*Geometry|\w*Material)$/

const MESSAGE = '项目代码禁止裸 new THREE.<几何体/网格/材质>，程序化生成请走 World 工厂或引擎组件'

class BareThreeChecker extends AbstractCodeChecker {
  readonly kind = 'bareThree'

  check(sourceFile: ts.SourceFile, _ctx: CheckerContext): CodeIssue[] {
    const issues: CodeIssue[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const expr = node.expression
        if (
          ts.isPropertyAccessExpression(expr) &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === 'THREE' &&
          BANNED_THREE_CTOR_RE.test(expr.name.text)
        ) {
          const { line, col } = this.posOf(expr.expression, sourceFile)
          issues.push({ file: sourceFile.fileName, line, col, message: MESSAGE, rule: this.kind })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return issues
  }
}

registerCodeChecker('bareThree', BareThreeChecker)
