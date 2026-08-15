/**
 * ClashMaster — 程序化纹理（CanvasTexture）
 * 全部美术资源用 canvas 绘制，不依赖外部图片。鱼默认朝右。
 * 精致化：渐变身体 + 鳞片 + 多鳍 + 眼睛高光；含海底/气泡/闪光/光环等氛围与特效纹理。
 */
import * as THREE from 'three'
import type { FishArt } from './types'

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function toTexture(c: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** hex 颜色调亮(amt>0)/调暗(amt<0)，返回 rgb() */
function shade(hex: string, amt: number): string {
  const s = hex.replace('#', '')
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

const FISH_COLORS: Record<FishArt, { body: string; belly: string; fin: string; eye: string }> = {
  small:  { body: '#ffb74d', belly: '#ffe0b2', fin: '#fb8c00', eye: '#222' },
  medium: { body: '#4dd0e1', belly: '#b2ebf2', fin: '#00acc1', eye: '#222' },
  large:  { body: '#7986cb', belly: '#c5cae9', fin: '#5c6bc0', eye: '#222' },
  fast:   { body: '#e57373', belly: '#ffcdd2', fin: '#ef5350', eye: '#222' },
  rare:   { body: '#ba68c8', belly: '#e1bee7', fin: '#9c27b0', eye: '#4a148c' },
  boss_shark:  { body: '#90a4ae', belly: '#cfd8dc', fin: '#455a64', eye: '#b71c1c' },
  boss_kraken: { body: '#7b1fa2', belly: '#ce93d8', fin: '#4a148c', eye: '#ffeb3b' },
  boss_dragon: { body: '#e53935', belly: '#ffcdd2', fin: '#b71c1c', eye: '#ffd600' },
  boss_whale:  { body: '#1565c0', belly: '#90caf9', fin: '#0d47a1', eye: '#ffffff' },
  boss_crab:   { body: '#d84315', belly: '#ffab91', fin: '#bf360c', eye: '#1a237e' },
  puffer: { body: '#a5d6a7', belly: '#c8e6c9', fin: '#66bb6a', eye: '#1b5e20' },
  eel:    { body: '#5c6bc0', belly: '#9fa8da', fin: '#3949ab', eye: '#1a237e' },
  clown:  { body: '#ff8a65', belly: '#ffccbc', fin: '#ff5722', eye: '#222' },
  manta:  { body: '#4a148c', belly: '#7b1fa2', fin: '#6a1b9a', eye: '#0d0221' },
}

/** 多层眼睛（眼白 + 虹膜 + 瞳孔 + 高光） */
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, col: { eye: string }) {
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = col.eye
  ctx.beginPath(); ctx.arc(x + 1, y, 5.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#000000'
  ctx.beginPath(); ctx.arc(x + 2, y, 2.6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath(); ctx.arc(x - 2.5, y - 3, 2.2, 0, Math.PI * 2); ctx.fill()
}

/** 画一条朝右的精致鱼（双叶尾鳍 / 渐变身体 / 鳞片 / 背腹鳍 / 侧线 / 眼 / 嘴） */
export function makeFishTexture(art: FishArt): THREE.Texture {
  const [c, ctx] = makeCanvas(192, 128)
  const col = FISH_COLORS[art]
  const cy = 66
  const bx = 104 // 鱼身中心

  // 尾鳍（左，双叶分叉）
  ctx.fillStyle = col.fin
  ctx.beginPath()
  ctx.moveTo(52, cy)
  ctx.quadraticCurveTo(22, cy - 36, 6, cy - 28)
  ctx.quadraticCurveTo(26, cy, 6, cy + 28)
  ctx.quadraticCurveTo(22, cy + 36, 52, cy)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = shade(col.body, -0.1)
  ctx.beginPath(); ctx.ellipse(52, cy, 9, 17, 0, 0, Math.PI * 2); ctx.fill()

  // 身体（背深腹浅线性渐变）
  const grad = ctx.createLinearGradient(0, cy - 32, 0, cy + 32)
  grad.addColorStop(0, shade(col.body, -0.18))
  grad.addColorStop(0.5, col.body)
  grad.addColorStop(1, col.belly)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(bx, cy, 58, 30, 0, 0, Math.PI * 2)
  ctx.fill()

  // 鳞片纹理（小弧线网格）
  ctx.strokeStyle = shade(col.body, -0.28)
  ctx.lineWidth = 1.2
  for (let row = 0; row < 4; row++) {
    const yy = cy - 16 + row * 11
    for (let i = 0; i < 7; i++) {
      const xx = bx - 42 + i * 13 + (row % 2) * 6
      ctx.beginPath()
      ctx.arc(xx, yy, 6, Math.PI * 1.12, Math.PI * 1.88)
      ctx.stroke()
    }
  }

  // 背鳍
  ctx.fillStyle = col.fin
  ctx.beginPath()
  ctx.moveTo(bx - 22, cy - 28)
  ctx.quadraticCurveTo(bx, cy - 54, bx + 26, cy - 26)
  ctx.lineTo(bx + 18, cy - 22)
  ctx.quadraticCurveTo(bx, cy - 38, bx - 14, cy - 22)
  ctx.closePath()
  ctx.fill()

  // 腹鳍
  ctx.beginPath()
  ctx.moveTo(bx - 8, cy + 22)
  ctx.quadraticCurveTo(bx + 2, cy + 44, bx + 18, cy + 24)
  ctx.closePath()
  ctx.fill()

  // 侧线高光
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx - 38, cy + 2)
  ctx.quadraticCurveTo(bx, cy + 9, bx + 38, cy - 2)
  ctx.stroke()

  // 眼睛 + 嘴
  drawEye(ctx, bx + 38, cy - 10, col)
  ctx.strokeStyle = shade(col.body, -0.35)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx + 50, cy + 6)
  ctx.quadraticCurveTo(bx + 58, cy + 4, bx + 60, cy + 9)
  ctx.stroke()

  // art 特定装饰
  if (art === 'rare') {
    const rg = ctx.createRadialGradient(bx, cy, 16, bx, cy, 78)
    rg.addColorStop(0, 'rgba(240,200,255,0)')
    rg.addColorStop(0.7, 'rgba(240,200,255,0.18)')
    rg.addColorStop(1, 'rgba(240,200,255,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, 192, 128)
  }
  if (art === 'boss_shark') {
    // 鲨鱼利牙
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.moveTo(bx + 34 + i * 5, cy + 11)
      ctx.lineTo(bx + 36 + i * 5, cy + 19)
      ctx.lineTo(bx + 38 + i * 5, cy + 11)
      ctx.closePath()
      ctx.fill()
    }
    // 背鳍缺口
    ctx.fillStyle = shade(col.body, -0.25)
    ctx.beginPath()
    ctx.moveTo(bx - 6, cy - 28)
    ctx.lineTo(bx + 2, cy - 34)
    ctx.lineTo(bx + 10, cy - 26)
    ctx.closePath()
    ctx.fill()
  }
  if (art === 'boss_kraken') {
    // 克拉肯：圆头 + 多条触手
    ctx.fillStyle = shade(col.body, -0.1)
    ctx.beginPath()
    ctx.ellipse(bx - 4, cy, 28, 26, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = col.fin
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    for (let i = 0; i < 6; i++) {
      const len = 18 + Math.random() * 14
      ctx.beginPath()
      ctx.moveTo(bx - 12, cy + 8 + (i - 2.5) * 4)
      ctx.quadraticCurveTo(bx - 20, cy + (i - 2.5) * 8 + len * 0.5, bx - 28, cy + (i - 2.5) * 6 + len)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,235,59,0.3)'
    for (let i = 0; i < 5; i++) {
      ctx.beginPath()
      ctx.arc(bx - 22 + (i - 2) * 6, cy + 4 + (i % 2) * 12, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#ffeb3b'
    ctx.beginPath(); ctx.arc(bx + 14, cy - 14, 6, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bx + 14, cy + 14, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000'
    ctx.beginPath(); ctx.arc(bx + 15, cy - 13, 2.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bx + 15, cy + 15, 2.5, 0, Math.PI * 2); ctx.fill()
  }
  if (art === 'boss_dragon') {
    // 海龙：长蛇身 + 背鳍
    ctx.strokeStyle = col.body
    ctx.lineWidth = 20
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(bx - 48, cy + 4)
    ctx.quadraticCurveTo(bx - 18, cy - 22, bx + 8, cy + 2)
    ctx.quadraticCurveTo(bx + 30, cy + 22, bx + 54, cy - 2)
    ctx.stroke()
    ctx.strokeStyle = col.belly
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(bx - 44, cy + 8)
    ctx.quadraticCurveTo(bx - 16, cy - 12, bx + 8, cy + 6)
    ctx.quadraticCurveTo(bx + 28, cy + 22, bx + 50, cy + 2)
    ctx.stroke()
    ctx.fillStyle = col.fin
    for (let i = 0; i < 5; i++) {
      const fx = bx - 28 + i * 16
      const fy = cy - 14 + Math.sin(i * 1.8) * 6
      ctx.beginPath()
      ctx.moveTo(fx, fy)
      ctx.lineTo(fx + 4, fy - 14 - (i % 2) * 6)
      ctx.lineTo(fx + 8, fy)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillStyle = col.eye
    ctx.beginPath(); ctx.ellipse(bx + 44, cy - 8, 4, 8, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000'
    ctx.beginPath(); ctx.ellipse(bx + 44, cy - 8, 2, 6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = col.fin
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx + 48, cy + 6)
    ctx.quadraticCurveTo(bx + 56, cy + 18, bx + 64, cy + 10)
    ctx.stroke()
  }
  if (art === 'boss_whale') {
    // 巨鲸：庞大椭圆体 + 尾鳍
    ctx.fillStyle = col.body
    ctx.beginPath()
    ctx.ellipse(bx, cy, 44, 28, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = col.belly
    ctx.beginPath()
    ctx.ellipse(bx - 4, cy + 6, 30, 16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = col.fin
    ctx.beginPath()
    ctx.moveTo(bx - 40, cy)
    ctx.lineTo(bx - 62, cy - 22)
    ctx.lineTo(bx - 62, cy + 22)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(bx + 34, cy - 10, 5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = col.eye
    ctx.beginPath(); ctx.arc(bx + 35, cy - 9, 3, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(180,230,255,0.5)'
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(bx - 4 + i * 6, cy - 26)
      ctx.quadraticCurveTo(bx - 6 + i * 10, cy - 38, bx + 2 + i * 6, cy - 44)
      ctx.stroke()
    }
    ctx.strokeStyle = shade(col.body, -0.3)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx + 22, cy + 10)
    ctx.quadraticCurveTo(bx + 36, cy + 14, bx + 44, cy + 8)
    ctx.stroke()
  }
  if (art === 'boss_crab') {
    // 巨蟹王：宽甲壳 + 巨螯
    ctx.fillStyle = col.body
    ctx.beginPath()
    ctx.ellipse(bx, cy, 34, 24, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = shade(col.body, -0.25)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(bx, cy, 34, 24, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(bx, cy, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx, cy - 22)
    ctx.lineTo(bx, cy + 22)
    ctx.stroke()
    ctx.fillStyle = col.fin
    ctx.beginPath()
    ctx.arc(bx + 44, cy - 10, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = shade(col.fin, -0.2)
    ctx.beginPath()
    ctx.arc(bx + 44, cy + 10, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = col.body
    ctx.beginPath()
    ctx.moveTo(bx + 58, cy - 14)
    ctx.lineTo(bx + 66, cy - 10)
    ctx.lineTo(bx + 66, cy - 18)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(bx + 58, cy + 14)
    ctx.lineTo(bx + 66, cy + 10)
    ctx.lineTo(bx + 66, cy + 18)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = col.fin
    ctx.lineWidth = 3
    for (let i = 0; i < 3; i++) {
      const side = (i % 2 === 0) ? 1 : -1
      ctx.beginPath()
      ctx.moveTo(bx - 24, cy - 8 + i * 12)
      ctx.lineTo(bx - 40, cy - 8 + i * 14 + side * 6)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(bx + 16, cy - 2 + i * 8)
      ctx.lineTo(bx + 32, cy - 2 + i * 12 + side * 4)
      ctx.stroke()
    }
    ctx.fillStyle = col.eye
    ctx.beginPath(); ctx.arc(bx + 12, cy - 18, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bx + 20, cy - 18, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000'
    ctx.beginPath(); ctx.arc(bx + 12, cy - 18, 1.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bx + 20, cy - 18, 1.5, 0, Math.PI * 2); ctx.fill()
  }
  if (art === 'puffer') {
    // 河豚：圆滚滚身体 + 小刺
    ctx.strokeStyle = shade(col.body, -0.3)
    ctx.lineWidth = 1.5
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      const sx = bx + Math.cos(angle) * 32
      const sy = cy + Math.sin(angle) * 18
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + Math.cos(angle) * 6, sy + Math.sin(angle) * 6)
      ctx.stroke()
    }
    // 圆眼（河豚特色大眼）
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(bx + 36, cy - 12, 10, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = col.eye
    ctx.beginPath(); ctx.arc(bx + 38, cy - 11, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000'
    ctx.beginPath(); ctx.arc(bx + 39, cy - 10, 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(bx + 35, cy - 15, 2, 0, Math.PI * 2); ctx.fill()
    // 小嘴
    ctx.strokeStyle = shade(col.body, -0.4)
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(bx + 52, cy + 4, 4, 0, Math.PI); ctx.stroke()
  }
  if (art === 'eel') {
    // 电鳗：闪电纹
    ctx.strokeStyle = 'rgba(255,235,59,0.6)'
    ctx.lineWidth = 2
    for (let i = 0; i < 5; i++) {
      const lx = bx - 30 + i * 14
      ctx.beginPath()
      ctx.moveTo(lx, cy - 12 + (i % 2) * 6)
      ctx.lineTo(lx + 6, cy + 8 - (i % 2) * 6)
      ctx.lineTo(lx + 12, cy - 4 + (i % 2) * 6)
      ctx.stroke()
    }
    // 亮黄眼睛
    ctx.fillStyle = '#ffeb3b'
    ctx.beginPath(); ctx.arc(bx + 42, cy - 8, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = col.eye
    ctx.beginPath(); ctx.arc(bx + 43, cy - 7, 2, 0, Math.PI * 2); ctx.fill()
  }
  if (art === 'clown') {
    // 小丑鱼：白色斑纹
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.beginPath()
    ctx.ellipse(bx - 14, cy, 8, 20, -0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(bx + 18, cy, 6, 18, 0.1, 0, Math.PI * 2)
    ctx.fill()
    // 黑色眼线
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(bx + 38, cy - 10, 9, 0, Math.PI * 2); ctx.stroke()
  }
  if (art === 'manta') {
    // 魔鬼鱼：宽体流线 + 腹部纹理
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.beginPath()
    ctx.ellipse(bx - 6, cy + 6, 24, 12, 0, 0, Math.PI * 2)
    ctx.fill()
    // 翼尖高光
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(bx - 52, cy - 18)
    ctx.quadraticCurveTo(bx - 60, cy, bx - 52, cy + 18)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx + 52, cy - 18)
    ctx.quadraticCurveTo(bx + 60, cy, bx + 52, cy + 18)
    ctx.stroke()
    // 细长尾刺
    ctx.strokeStyle = shade(col.body, -0.3)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(bx - 54, cy)
    ctx.quadraticCurveTo(bx - 70, cy - 4, bx - 80, cy)
    ctx.stroke()
  }

  return toTexture(c)
}

/** 金属质感炮台（渐变底座 + 渐变炮管 + 等级宝石） */
export function makeCannonTexture(level: number): THREE.Texture {
  const [c, ctx] = makeCanvas(96, 96)
  const gems = ['#66bb6a', '#42a5f5', '#ab47bc', '#ff7043', '#ffd600']
  const gem = gems[Math.min(level - 1, gems.length - 1)]
  // 底座（金属渐变）
  const base = ctx.createRadialGradient(40, 56, 6, 48, 64, 38)
  base.addColorStop(0, '#78909c')
  base.addColorStop(1, '#37474f')
  ctx.fillStyle = base
  ctx.beginPath(); ctx.arc(48, 64, 34, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#263238'
  ctx.beginPath(); ctx.arc(48, 64, 24, 0, Math.PI * 2); ctx.fill()
  // 炮管（金属渐变 + 高光）
  const barrel = ctx.createLinearGradient(38, 0, 58, 0)
  barrel.addColorStop(0, '#37474f')
  barrel.addColorStop(0.4, '#90a4ae')
  barrel.addColorStop(0.6, '#cfd8dc')
  barrel.addColorStop(1, '#455a64')
  ctx.fillStyle = barrel
  ctx.fillRect(39, 6, 18, 58)
  ctx.fillStyle = '#1c2429'
  ctx.fillRect(36, 2, 24, 10) // 炮口
  // 等级宝石
  ctx.fillStyle = gem
  ctx.beginPath(); ctx.arc(48, 68, 5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.beginPath(); ctx.arc(46, 66, 1.8, 0, Math.PI * 2); ctx.fill()
  return toTexture(c)
}

/** 圆形网（径向同心圆 + 放射线，网边缘散开效果） */
export function makeNetTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128)
  const cx = 64, cy = 64, r = 60

  // 半透明底色（从中心淡蓝到透明边缘）
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  bg.addColorStop(0, 'rgba(180,230,255,0.30)')
  bg.addColorStop(0.5, 'rgba(160,220,255,0.12)')
  bg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = bg
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()

  // 放射线（从中心向外散射）
  ctx.strokeStyle = 'rgba(200,235,255,0.7)'
  ctx.lineWidth = 1.5
  const rays = 12
  for (let i = 0; i < rays; i++) {
    const angle = (Math.PI * 2 / rays) * i
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    ctx.stroke()
  }

  // 同心圆环（模拟网格散开）
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0]
  for (const k of rings) {
    ctx.strokeStyle = k > 0.8
      ? 'rgba(150,210,255,0.3)'
      : `rgba(${200 + Math.round(55 * (1 - k))},${230 + Math.round(25 * (1 - k))},255,${0.5 + 0.3 * (1 - k)})`
    ctx.lineWidth = k > 0.8 ? 1 : 2
    ctx.beginPath()
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 外圈发光边缘（网张开的边界）
  const edge = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r)
  edge.addColorStop(0, 'rgba(200,235,255,0)')
  edge.addColorStop(0.6, 'rgba(200,235,255,0.2)')
  edge.addColorStop(1, 'rgba(120,200,255,0.5)')
  ctx.fillStyle = edge
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()

  // 外圈线
  ctx.strokeStyle = 'rgba(100,190,255,0.8)'
  ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()

  return toTexture(c)
}

/** 金币（径向渐变 + 高光 + $ 符号） */
export function makeCoinTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(32, 32)
  const g = ctx.createRadialGradient(12, 12, 2, 16, 16, 15)
  g.addColorStop(0, '#fff59d')
  g.addColorStop(0.5, '#ffd700')
  g.addColorStop(1, '#b8860b')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#b8860b'
  ctx.beginPath(); ctx.arc(16, 16, 9, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff9c4'
  ctx.beginPath(); ctx.arc(11, 11, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#8d6e0a'
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('$', 16, 17)
  return toTexture(c)
}

/** 海底背景（垂直水深渐变 + 斜射光柱） */
export function makeSeabedTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(512, 320)
  const g = ctx.createLinearGradient(0, 0, 0, 320)
  g.addColorStop(0, '#0e5688')
  g.addColorStop(0.45, '#0a3a66')
  g.addColorStop(1, '#06223f')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 320)
  // 光柱
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 110
    const lg = ctx.createLinearGradient(x, 0, x + 50, 320)
    lg.addColorStop(0, 'rgba(170,225,255,0.14)')
    lg.addColorStop(1, 'rgba(170,225,255,0)')
    ctx.fillStyle = lg
    ctx.beginPath()
    ctx.moveTo(x - 8, 0); ctx.lineTo(x + 36, 0); ctx.lineTo(x + 70, 320); ctx.lineTo(x - 34, 320)
    ctx.closePath(); ctx.fill()
  }
  return toTexture(c)
}

/** 气泡（半透明圆 + 高光） */
export function makeBubbleTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(32, 32)
  ctx.strokeStyle = 'rgba(200,240,255,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = 'rgba(200,240,255,0.12)'
  ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath(); ctx.arc(11, 11, 3, 0, Math.PI * 2); ctx.fill()
  return toTexture(c)
}

/** 径向闪光（炮口闪光，中心亮 → 边缘透明） */
export function makeFlashTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,250,210,0.95)')
  g.addColorStop(0.4, 'rgba(255,213,79,0.6)')
  g.addColorStop(1, 'rgba(255,213,79,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64)
  return toTexture(c)
}

/** 飞行炮弹（亮光球，中心白 → 边缘透明） */
export function makeBulletTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(32, 32)
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,235,150,0.95)')
  g.addColorStop(0.7, 'rgba(255,180,60,0.4)')
  g.addColorStop(1, 'rgba(255,180,60,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32)
  return toTexture(c)
}

/** 发光环（捕获扩散光环）color 传 rgba 字符串 */
export function makeRingTexture(color: string): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128)
  const g = ctx.createRadialGradient(64, 64, 18, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.72, 'rgba(255,255,255,0)')
  g.addColorStop(0.82, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
  return toTexture(c)
}
