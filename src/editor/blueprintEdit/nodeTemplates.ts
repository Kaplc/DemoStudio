/**
 * nodeTemplates — 大纲右键「创建」菜单的预定义节点/控件模板
 *
 * 数据源（硬编码）：按预览类型分组显示
 *  - NODE3D_TEMPLATES：3D 节点组（bp: 3D 蓝图预览 + sp: 场景预览）
 *  - UI_TEMPLATES：UI 控件组（仅 bp: widget 预览）
 *
 * 每个模板 = baseClass + 默认组件组合（与资产检查器 assetLint 的 schema 对齐，零 lint 错误）。
 * 创建时调用方负责生成唯一 name（模板 baseName + 序号，同父范围查重）。
 * 组件默认值遵循「组件优先」约定：位置只写在 TransformComponent/UITransformComponent 组件。
 */
import type { BlueprintComponentDef, BlueprintChildDef } from '../../engine'

export interface NodeTemplate {
  /** 菜单项显示名 */
  label: string
  /** 节点名基名（唯一名 = baseName + 序号，如 Text_2） */
  baseName: string
  /** 子节点 baseClass（ActorRegistry 类型） */
  baseClass: string
  /** 默认组件（含变换组件；位置由变换组件承载） */
  components: BlueprintComponentDef[]
  /** 默认子节点（模板控件可带视觉子节点，如按钮的 Frame 背景） */
  children?: BlueprintChildDef[]
}

// ─── 3D 节点组（bp: 3D 蓝图 + sp: 场景预览共用） ───

export const NODE3D_TEMPLATES: NodeTemplate[] = [
  {
    label: '空 Actor',
    baseName: 'Empty',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ],
  },
  {
    label: '立方体',
    baseName: 'Box',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'BoxMeshComponent',
        properties: {
          size: [1, 1, 1],
          color: '#ffffff',
        },
      },
    ],
  },
  {
    label: '球体',
    baseName: 'Sphere',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'SphereMeshComponent',
        properties: {
          radius: 0.5,
          color: '#ffffff',
        },
      },
    ],
  },
  {
    label: '平面',
    baseName: 'Plane',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'PlaneMeshComponent',
        properties: {
          size: [2, 2],
          color: '#ffffff',
        },
      },
    ],
  },
  {
    label: '精灵 Sprite',
    baseName: 'Sprite',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'SpriteComponent',
        properties: {
          width: 1,
          height: 1,
          color: '#ffffff',
        },
      },
    ],
  },
  {
    label: '点光源',
    baseName: 'Light',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'LightComponent',
        properties: {
          type: 'point',
          color: '#ffffff',
          intensity: 1,
        },
      },
    ],
  },
  {
    label: '相机',
    baseName: 'Camera',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'TransformComponent',
        properties: {
          position: [0, 0, 5],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      {
        baseClass: 'CameraComponent',
        properties: {
          mode: 'perspective',
          fov: 60,
          near: 0.1,
          far: 100,
        },
      },
    ],
  },
]

// ─── UI 控件组（仅 bp: widget 预览） ───

export const UI_TEMPLATES: NodeTemplate[] = [
  {
    label: '文本 Text',
    baseName: 'Text',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'UITransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          worldWidth: 2,
          worldHeight: 0.4,
          anchor: 'center',
          anchorOffset: [0, 0],
        },
      },
      {
        baseClass: 'CanvasUIComponent',
        properties: {
          markerOnly: true,
          zOrder: 0,
        },
      },
      {
        baseClass: 'UITextComponent',
        properties: {
          text: '文本',
          fontSize: 32,
          color: '#ffffff',
          align: 'center',
          width: 400,
          height: 80,
          zOrder: 1,
          shadowColor: 'rgba(0,0,0,0.4)',
          shadowBlur: 4,
        },
      },
    ],
  },
  {
    label: '按钮 Button',
    baseName: 'Button',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'UITransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          worldWidth: 2,
          worldHeight: 0.5,
          anchor: 'center',
          anchorOffset: [0, 0],
        },
      },
      {
        baseClass: 'CanvasUIComponent',
        properties: {
          markerOnly: true,
          zOrder: 0,
        },
      },
      {
        baseClass: 'UIButtonComponent',
        properties: {
          pressScale: 0.9,
        },
      },
    ],
    // 视觉背景拆到子节点 Frame（按钮节点只挂交互组件，避免与运行时点击层同节点）
    children: [
      {
        name: 'Frame',
        baseClass: 'Actor',
        components: [
          {
            baseClass: 'UITransformComponent',
            properties: {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
              worldWidth: 2,
              worldHeight: 0.5,
              anchor: 'center',
              anchorOffset: [0, 0],
            },
          },
          {
            baseClass: 'CanvasUIComponent',
            properties: {
              markerOnly: true,
              zOrder: 0,
            },
          },
          {
            baseClass: 'UIImageComponent',
            properties: {
              color: '#4a6fa5',
              radius: 8,
              opacity: 1,
              width: 400,
              height: 100,
              zOrder: 1,
            },
          },
        ],
      },
    ],
  },
  {
    label: '图片 Image',
    baseName: 'Image',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'UITransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          worldWidth: 2,
          worldHeight: 1,
          anchor: 'center',
          anchorOffset: [0, 0],
        },
      },
      {
        baseClass: 'CanvasUIComponent',
        properties: {
          markerOnly: true,
          zOrder: 0,
        },
      },
      {
        baseClass: 'UIImageComponent',
        properties: {
          color: '#888888',
          radius: 4,
          opacity: 1,
          width: 400,
          height: 200,
          zOrder: 1,
        },
      },
    ],
  },
  {
    label: '面板 Panel',
    baseName: 'Panel',
    baseClass: 'Actor',
    components: [
      {
        baseClass: 'UITransformComponent',
        properties: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          worldWidth: 3,
          worldHeight: 2,
          anchor: 'center',
          anchorOffset: [0, 0],
        },
      },
      {
        baseClass: 'CanvasUIComponent',
        properties: {
          markerOnly: true,
          zOrder: 0,
        },
      },
      {
        baseClass: 'UIImageComponent',
        properties: {
          color: '#2a2a3a',
          radius: 12,
          opacity: 1,
          width: 600,
          height: 400,
          zOrder: 1,
        },
      },
    ],
  },
]

/** 深拷贝模板组件（创建时注入唯一名，避免多实例共享同一引用） */
export function cloneTemplateComponents(tpl: NodeTemplate): BlueprintComponentDef[] {
  return JSON.parse(JSON.stringify(tpl.components)) as BlueprintComponentDef[]
}

/** 生成同父范围内唯一名：baseName 已存在时追加 _2/_3… 序号 */
export function uniqueNodeName(baseName: string, siblingNames: Array<string | undefined>): string {
  const used = new Set(siblingNames.filter((n): n is string => typeof n === 'string' && !!n))
  if (!used.has(baseName)) return baseName
  let i = 2
  while (used.has(`${baseName}_${i}`)) i++
  return `${baseName}_${i}`
}

/** 全资产最大子节点 id + 1（蓝图子节点 id 全资产唯一，创建时分配） */
export function nextChildId(children: BlueprintChildDef[] | undefined): number {
  let max = 0
  const walk = (arr: BlueprintChildDef[] | undefined) => {
    if (!arr) return
    for (const c of arr) {
      if (typeof c.id === 'number' && c.id > max) max = c.id
      walk(c.children)
    }
  }
  walk(children)
  return max + 1
}

/** 克隆子树后重分配子节点 id（全资产唯一），并清除组件 id（可选字段，避免与源树冲突） */
export function reassignChildIds(child: BlueprintChildDef, next: () => number): void {
  child.id = next()
  for (const comp of child.components ?? []) delete comp.id
  for (const c of child.children ?? []) {
    reassignChildIds(c, next)
  }
}
