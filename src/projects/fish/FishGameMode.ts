/**
 * FishGameMode — 捕鱼规则
 * 正交相机、鱼群生成（加权随机 + 难度递增）、网×鱼碰撞捕获、
 * 金币经济（开炮消耗 / 捕鱼获得 / 归零 Game Over）、Boss 定时。
 */
import * as THREE from 'three'
import { GameMode, CameraComponent, gizmos, logger } from '@/engine'
import { FishCannon } from './FishCannon'
import { FishPawn } from './FishPawn'
import { FishBullet } from './FishBullet'
import { FishNet } from './FishNet'
import { FishCoinFly } from './FishCoinFly'
import { FishPlayerController } from './FishPlayerController'
import { FishObjectPools } from './FishObjectPools'
import { makeRingTexture } from './textures'
import {
  FISH_TYPES, CAMERA_ORTHO_SIZE, AREA_W, AREA_H,
  INITIAL_COINS, BOSS_INTERVAL,
} from './types'
import type { FishType } from './types'

// Gizmos 复用临时对象
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

const BOSS_TYPE = FISH_TYPES.find((f) => f.boss)!

// 捕获扩散光环纹理单例
let _ringTex: THREE.Texture | null = null
function ringTex(): THREE.Texture {
  if (!_ringTex) _ringTex = makeRingTexture('rgba(255,225,130,0.9)')
  return _ringTex
}

export class FishGameMode extends GameMode {
  /** 游戏相机（正交） */
  public gameCamera: CameraComponent

  /** 金币 */
  coins = INITIAL_COINS
  bossActive = false
  bossPawn: FishPawn | null = null

  /** 对象池 */
  readonly pools = new FishObjectPools()

  /** 鱼群生成计时 */
  private schoolTimer = 0
  /** 普通鱼散兵生成计时 */
  private singleTimer = 0

  private bossTimer = 0
  private bubbleTimer = 0
  private elapsed = 0

  constructor() {
    super()
    this.gameCamera = new CameraComponent(this, 'GameCamera', 'orthographic')
    this.gameCamera.SetOrtho(CAMERA_ORTHO_SIZE, 0.1, 200)
    this.gameCamera.priority = 10
    this.addComponent(this.gameCamera)
  }

  override InitGame() {
    super.InitGame()
    this.coins = INITIAL_COINS
    this.bossActive = false
    this.bossPawn = null
    this.schoolTimer = 0
    this.singleTimer = 1.5  // 游戏开始后先来一波普通鱼
    this.bossTimer = 0
    this.bubbleTimer = 0
    this.elapsed = 0

    // 重置对象池（隐藏所有对象）并初始化（注入到新 World）
    this.pools.releaseAll()
    if (this.world) this.pools.init(this.world)

    // 注册正交相机：沿 +Z 朝 -Z 看
    this.cameraManager.RegisterCamera(this.gameCamera)
    const cam = this.gameCamera.camera
    cam.position.set(0, 0, 20)
    cam.lookAt(0, 0, 0)
    this.gameCamera.SyncToActor()
  }

  override SpawnPlayer() {
    const controller = new FishPlayerController()
    const pawn = new FishCannon()
    return { controller, pawn }
  }

  // ─── 金币钱包（FishCannon 通过 CoinWallet 接口访问）───
  spendCoins(n: number) {
    this.coins = Math.max(0, this.coins - n)
  }
  addCoins(n: number) {
    this.coins += n
  }

  // ─── 主 Tick ───
  override Tick(dt: number) {
    super.Tick(dt)
    if (!this.world?.running) return
    if (this.gameState.phase !== 'playing') return

    this.elapsed += dt

    // ─── 鱼群（成群结队，间隔较长）───
    this.schoolTimer -= dt
    if (this.schoolTimer <= 0) {
      this.spawnFishSchool(this.pickFishType(true))
      const interval = Math.max(2.0, 5.0 - this.elapsed * 0.025)
      this.schoolTimer = interval * (0.6 + Math.random() * 0.8)
    }

    // ─── 普通鱼散兵（单条或两三条，间隔较短）───
    this.singleTimer -= dt
    if (this.singleTimer <= 0) {
      this.spawnSingleFish(this.pickFishType(false))
      const interval = Math.max(0.6, 1.8 - this.elapsed * 0.015)
      this.singleTimer = interval * (0.5 + Math.random() * 1.0)
    }

    // Boss 定时（在场时不计时，死后重新计时）
    if (!this.bossActive) {
      this.bossTimer += dt
      if (this.bossTimer >= BOSS_INTERVAL) {
        this.bossTimer = 0
        this.spawnBoss()
      }
    }

    // 氛围气泡（从对象池获取）
    this.bubbleTimer -= dt
    if (this.bubbleTimer <= 0) {
      const x = (Math.random() * 2 - 1) * AREA_W
      this.pools.acquireBubble(x, -AREA_H)
      this.bubbleTimer = 0.5 + Math.random() * 0.9
    }

    this.handleCollisions()
    this.cleanupFish()

    // 金币耗尽 → Game Over
    if (this.coins <= 0) {
      logger.info('[Fish] 金币耗尽，Game Over')
      this.gameState.setPhase('gameover')
    }
  }

  /** 加权随机选鱼种
   *  @param forSchool true=鱼群(偏爱群居性小鱼)，false=散兵(普通加权) */
  private pickFishType(forSchool: boolean): FishType {
    const pool = FISH_TYPES.filter((f) => !f.boss && f.weight > 0)
    let weights: number[]
    if (forSchool) {
      // 鱼群：偏爱群居性小鱼（guppy、dart、angel），权重偏向 schoolSize 大的
      weights = pool.map((f) => {
        const schoolBonus = (f.schoolSize[0] + f.schoolSize[1]) / 2
        return f.weight * (2 + schoolBonus * 0.3) * (1 + Math.min(1, f.score / 20))
      })
    } else {
      // 散兵：纯加权随机（随时间高级鱼权重提升）
      const boost = Math.min(2.5, 1 + this.elapsed / 60)
      weights = pool.map((f) => f.weight * (1 + (boost - 1) * Math.min(1, f.score / 6)))
    }
    let total = 0
    for (const w of weights) total += w
    let r = Math.random() * total
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r <= 0) return pool[i]
    }
    return pool[0]
  }

  /** 生成一群鱼（从随机一侧边缘成群游出） */
  private spawnFishSchool(type: FishType) {
    const fromLeft = Math.random() < 0.5
    const edgeX = fromLeft ? -AREA_W - 1 : AREA_W + 1
    // 随机鱼群大小
    const count = type.schoolSize[0] + Math.floor(Math.random() * (type.schoolSize[1] - type.schoolSize[0] + 1))
    // 鱼群中心 Y
    const centerY = -AREA_H + 2.5 + Math.random() * (AREA_H * 2 - 5)
    // 垂直散布范围（随鱼种体型增大而增大）
    const spread = Math.max(1.5, type.size[1] * 1.8)

    for (let i = 0; i < count; i++) {
      // 错开鱼的出生 X（前后错开，群游效果）
      const offsetX = (Math.random() - 0.5) * type.size[0] * 3
      // 垂直均匀分布 + 随机微调
      const yOffset = (i / (count - 1 || 1) - 0.5) * spread + (Math.random() - 0.5) * 0.6
      const fish = new FishPawn(type, fromLeft)
      fish.spawnAt(edgeX + offsetX, centerY + yOffset)
      // 给每个鱼微调游动速度和相位，产生错落感
      fish.setSpeedVariation(0.85 + Math.random() * 0.3)
      this.world?.SpawnActor(fish)
    }
  }

  /** 生成单条普通鱼（散兵） */
  private spawnSingleFish(type: FishType) {
    const fromLeft = Math.random() < 0.5
    const edgeX = fromLeft ? -AREA_W - 1 : AREA_W + 1
    const y = -AREA_H + 2 + Math.random() * (AREA_H * 2 - 4)
    const fish = new FishPawn(type, fromLeft)
    fish.spawnAt(edgeX, y)
    this.world?.SpawnActor(fish)
  }

  /** 生成 Boss（中央高度，记录引用供 HUD 血条） */
  private spawnBoss() {
    const fromLeft = Math.random() < 0.5
    const fish = new FishPawn(BOSS_TYPE, fromLeft)
    fish.spawnAt(fromLeft ? -AREA_W - 1 : AREA_W + 1, 0)
    this.bossPawn = fish
    this.bossActive = true
    this.world?.SpawnActor(fish)
    logger.info('[Fish] Boss 出现！')
  }

  /** 子弹碰鱼→张网；张开的网→范围捕获 */
  private handleCollisions() {
    const world = this.world
    if (!world) return
    const fishes = world.FindActors(FishPawn)
    if (fishes.length === 0) return

    // 1) 子弹击中鱼 → 释放子弹 + 张开网（均从对象池）
    for (const bullet of world.FindActors(FishBullet)) {
      if (!bullet.active || bullet.detonated) continue
      for (const fish of fishes) {
        if (fish.captured) continue
        const dx = fish.position.x - bullet.position.x
        const dy = fish.position.y - bullet.position.y
        const r = fish.config.radius + bullet.radius
        if (dx * dx + dy * dy < r * r) {
          // 在子弹位置张开网
          bullet.detonated = true
          this.pools.acquireNet({
            pos: bullet.position,
            radius: bullet.netRadius,
            power: bullet.power,
            captureBonus: bullet.captureBonus,
          })
          bullet.pool?.release(bullet)
          break
        }
      }
    }

    // 2) 已张开的网 → 对范围内鱼各判定一次（捕获）
    for (const net of world.FindActors(FishNet)) {
      if (!net.expanded || net.consumed) continue
      net.consumed = true
      for (const fish of fishes) {
        if (fish.captured) continue
        const dx = fish.position.x - net.position.x
        const dy = fish.position.y - net.position.y
        const r = fish.config.radius + net.radius
        if (dx * dx + dy * dy < r * r) {
          if (fish.TakeHit(net.power, net.captureBonus)) {
            this.captureFish(fish)
          }
        }
      }
    }
  }

  /** 捕获：加分 / 加金币 / 特效 / 销毁 */
  private captureFish(fish: FishPawn) {
    this.gameState.addScore(fish.config.score)
    this.addCoins(fish.config.score)
    // 捕获扩散光环（从对象池获取）
    this.pools.acquireFlash({
      pos: new THREE.Vector3(fish.position.x, fish.position.y, 0.4),
      size: fish.config.radius * 2,
      texture: ringTex(),
      ttl: 0.4,
      grow: 5,
      opacity: 0.9,
    })
    this.world?.SpawnActor(new FishCoinFly(fish.position.x, fish.position.y, fish.config.boss ? 12 : 5))
    logger.info(`[Fish] 捕获 ${fish.config.name} +${fish.config.score} 金币`)
    if (fish.config.boss) { this.bossActive = false; this.bossPawn = null }
    fish.destroy()
  }

  /** 出界鱼销毁 */
  private cleanupFish() {
    const world = this.world
    if (!world) return
    for (const fish of world.FindActors(FishPawn)) {
      if (Math.abs(fish.position.x) > AREA_W + 4) {
        if (fish.config.boss) { this.bossActive = false; this.bossPawn = null }
        fish.destroy()
      }
    }
  }

  // ─── Gizmos：海域边界（Boss 在场变红）───
  override OnDrawGizmos() {
    gizmos.color = this.bossActive ? 0xff5555 : 0x4488cc
    const b = AREA_W
    const h = AREA_H
    const corners: Array<[number, number]> = [[-b, -h], [b, -h], [b, h], [-b, h]]
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i]
      const [x2, y2] = corners[(i + 1) % 4]
      _a.set(x1, y1, 0)
      _b.set(x2, y2, 0)
      gizmos.DrawLine(_a, _b)
    }
  }
}
