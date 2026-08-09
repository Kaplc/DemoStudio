/**
 * UIScriptComponent — UI 资产「挂载脚本」组件（兼容别名）
 *
 * 继承通用 ScriptComponent（引擎 script/ 目录，Unity MonoBehaviour 挂载点），
 * 仅供 UI widget 资产使用：数据格式与行为完全一致，仅保留历史命名。
 *
 * 数据配置：
 *   { baseClass: 'UIScriptComponent', properties: { script: 'gameplay/base/BaseHud', args?: {...} } }
 *
 * 脚本 id 由项目 asset/index.ts 的 import.meta.glob 自动扫描注册（见 ScriptRegistry）。
 */
import { ScriptComponent } from '../script/ScriptComponent'
import type { Actor } from '../entity/Actor'

export class UIScriptComponent extends ScriptComponent {
  constructor(owner: Actor, name = 'UIScriptComponent') {
    super(owner, name)
  }
}
