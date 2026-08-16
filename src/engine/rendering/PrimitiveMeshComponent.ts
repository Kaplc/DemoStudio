/**
 * PrimitiveMeshComponent — 基础几何网格组件（MeshComponent 的具体派生）
 *
 * MeshComponent 是基类（abstract），不允许直接挂载——资产 baseClass 声明
 * 'MeshComponent' 会被 assetLint 报错、ComponentRegistry 未注册而创建失败。
 * 资产声明基础几何网格（box/sphere/plane 参数化）必须用本组件：
 *
 *   { "baseClass": "PrimitiveMeshComponent", "properties": { "geometry": "box", "size": [1,1,1], "color": "#ffffff" } }
 *
 * 与 CapsuleMeshComponent（胶囊体）并列，同属 MeshComponent 家族；
 * 一个 Actor 只能挂载一个 mesh（组合网格请拆子 Actor）。
 */
import { MeshComponent } from './MeshComponent'
import type { Actor } from '../entity/Actor'

export class PrimitiveMeshComponent extends MeshComponent {
  constructor(owner: Actor, mesh: ConstructorParameters<typeof MeshComponent>[1], name = 'PrimitiveMeshComponent') {
    super(owner, mesh, name)
  }
}
