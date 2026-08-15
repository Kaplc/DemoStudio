/**
 * CapsuleMeshComponent — 胶囊体网格组件（继承 MeshComponent）
 *
 * 蓝图资产声明模型胶囊体（兵种等角色）专用组件，与 MeshComponent 同族：
 * 持有一个 CapsuleGeometry 网格挂到 owner.root，随 Actor 生命周期自动释放。
 *
 * 注册：registerBuiltinComponents.ts 注册进 ComponentRegistry，
 * 蓝图组件声明为 { baseClass: 'CapsuleMeshComponent', properties: { radius, length, color, name? } }。
 * 几何体中心在胶囊体中心，贴地偏移由蓝图 TransformComponent 控制
 * （position.y = radius + length/2 使胶囊底部贴地 y=0）。
 *
 * 用法（蓝图资产 components 数组）：
 *   { "baseClass": "CapsuleMeshComponent", "properties": { "radius": 0.4, "length": 0.3, "color": "#e53935" } }
 */
import * as THREE from 'three'
import { MeshComponent } from './MeshComponent'
import type { Actor } from '../entity/Actor'

export class CapsuleMeshComponent extends MeshComponent {
  constructor(
    owner: Actor,
    radius: number,
    length: number,
    color: number | string,
    name = 'CapsuleMeshComponent',
  ) {
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0, length), 4, 12)
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) })
    super(owner, new THREE.Mesh(geo, mat), name)
  }
}
