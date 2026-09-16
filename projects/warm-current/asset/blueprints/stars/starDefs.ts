/**
 * starDefs — 星体共享参数表（doc-dev/bp-ts-compile 试点迁移：earth / mars / jupiter）
 *
 * TS 源编译的核心价值实证：表驱动参数一处改三份生效（跨文件共享常量 + 编译期可计算）。
 * 纯数据模块，只可被 .blueprint.ts 源 import；禁止 import 引擎运行时（方案 §4.1）。
 */

/** 云层参数（CloudLayerComponent） */
export interface CloudDef {
  name: string
  texture: string
  altitude: number
  spin: number
  uvDrift: number
  opacity: number
}

/** 单个星体的构造参数 */
export interface StarDef {
  /** 蓝图显示名（= 根 name） */
  actorName: string
  /** baseClass（ActorRegistry key） */
  actorClass: string
  /** 球体网格组件名 */
  meshName: string
  radius: number
  segments: [number, number]
  color: string
  texture: string
  /** 附加网格属性（如 earth 的 opacity/visible；缺省无附加键） */
  meshExtras?: Record<string, unknown>
  /** 大气壳参数（缺省不挂 AtmosphereComponent） */
  atmosphere?: Record<string, unknown>
  /** 云层参数（缺省不挂 CloudLayerComponent） */
  clouds?: CloudDef[]
}

export const STAR_DEFS: Record<'earth' | 'mars' | 'jupiter', StarDef> = {
  earth: {
    actorName: 'EarthActor',
    actorClass: 'EarthActor',
    meshName: 'EarthMesh',
    radius: 38,
    segments: [48, 32],
    color: '#ffffff',
    texture: 'asset/textures/earth.jpg',
    meshExtras: { opacity: 1, visible: true },
    atmosphere: {
      color: '#5cc0ff',
      intensity: 1,
      power: 6,
      shellScale: 1.01,
      haloScale: 1.4,
      haloIntensity: 0.35,
    },
    clouds: [
      {
        name: 'CloudLow',
        texture: 'asset/textures/earth_clouds.png',
        altitude: 1.015,
        spin: -0.0049,
        uvDrift: 0.0001,
        opacity: 0.62,
      },
      {
        name: 'CloudHigh',
        texture: 'asset/textures/earth_clouds.png',
        altitude: 1.05,
        spin: -0.0056,
        uvDrift: 0.00025,
        opacity: 0.3,
      },
    ],
  },
  mars: {
    actorName: 'MarsActor',
    actorClass: 'MarsActor',
    meshName: 'MarsMesh',
    radius: 34,
    segments: [48, 32],
    color: '#ffffff',
    texture: 'asset/textures/mars.jpg',
  },
  jupiter: {
    actorName: 'JupiterActor',
    actorClass: 'JupiterActor',
    meshName: 'JupiterMesh',
    radius: 46,
    segments: [48, 32],
    color: '#ffffff',
    texture: 'asset/textures/jupiter.jpg',
  },
}
