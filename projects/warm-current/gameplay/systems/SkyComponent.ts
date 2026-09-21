/**
 * SkyComponent — 星空全景天空装配组件（GameMode 上的组件位；2026-09-20 自 WarmCurrentGameMode 下沉）
 *
 * 职责（原 WarmCurrentGameMode.applySkyTexture 逻辑原样迁入）：
 *  - SSS 银河全景 equirect → scene.background 天空盒渲染；
 *  - Image 异步解码后经 SceneComponent.setBackgroundTexture 上屏（引擎统一设置 mapping/colorSpace）；
 *  - 加载失败静默保持纯黑背景（2026-09-07 拍板的兜底口径；2026-09-14 起为唯一兜底——
 *    程序化星空瓦片已整体移除）；
 *  - 登记 LoadingSettle 供 loading 面板等待（对齐 Earth 海洋粗糙度贴图惯例；
 *    id 带序号防重入提前 settle）；
 *  - 无 DOM 环境（单测）直接返回。
 */
import * as THREE from 'three'
import { BObjectComponent, LoadingSettle, logger } from '@/engine'
import { skyTextureUrl } from '../map/starTextures'
import type { WarmCurrentGameMode } from '../base/WarmCurrentGameMode'

/** 天空全景 LoadingSettle 任务序号（多局/重入保证任务 id 唯一，对齐 starTextures 惯例） */
let skySettleSeq = 0

export class SkyComponent extends BObjectComponent<WarmCurrentGameMode> {
  /** 当前装配的天空背景纹理（替换/EndPlay 时 dispose，防同 World 多局累积泄漏） */
  private skyTex: THREE.Texture | null = null

  constructor(owner: WarmCurrentGameMode) {
    super(owner)
    this.name = 'SkyComponent'
  }

  /** 装配银河全景天空（InitGame 调用；World 未就绪时告警跳过） */
  apply(): void {
    const url = skyTextureUrl()
    if (!url || typeof Image === 'undefined') return
    const world = this.owner.world
    if (!world) {
      logger.warn('[WarmSky] 银河全景天空跳过：InitGame 阶段 World 未就绪')
      return
    }
    const finishSettle = LoadingSettle.task('scene-enter', `warm-sky-panorama#${++skySettleSeq}`)
    const img = new Image()
    img.onload = () => {
      try {
        // 旧天空纹理（上一局装配的）先行释放，再挂新纹理
        this.dispose()
        const tex = new THREE.Texture(img)
        tex.needsUpdate = true
        this.skyTex = tex
        world.sceneComp.setBackgroundTexture(tex)
        logger.info('[WarmSky] 银河全景天空装配完成（SSS equirect → scene.background）')
      } catch (err) {
        logger.warn(`[WarmSky] 银河全景天空装配失败（保持纯黑兜底）: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        finishSettle()
      }
    }
    img.onerror = () => {
      logger.warn('[WarmSky] 银河全景贴图加载失败，保持纯黑兜底')
      finishSettle()
    }
    img.src = url
  }

  /** 释放当前天空纹理（EndPlay / 换局重装前调用） */
  dispose(): void {
    this.skyTex?.dispose()
    this.skyTex = null
  }

  override EndPlay(): void {
    // 天空背景纹理由本组件持引用装配（不在 factory 追踪体系），EndPlay 统一释放
    this.dispose()
    super.EndPlay()
  }
}
