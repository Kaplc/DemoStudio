/**
 * warm-current 纯玩家输入链路 e2e（回归锁：2026-09-13 输入模拟三件套）
 *
 * 锁定的引擎行为（都是当次修复/新增，防回退）：
 *  1. ai.mouseClick = 完整按下+释放序列。旧版只按不抬：
 *     - BindMouseButton('released') 订阅者（星图结算/全息轻点）永不触发
 *     - button=2 时 CameraRig.rightDragging 卡 true → 之后每次 mouse_move 都平移相机
 *     正向断言用 HUD 暂停按钮：动作生效（Label 暂停→继续，按下结算）+ 按钮态回
 *     normal（handleRelease 已分发）；回归断言用"右键 click 后大位移 mouse_move 不平移"。
 *  2. ai.mouseDrag button 参数：button=2 右键拖拽（2026-09-15 聚焦环绕改版后 = 绕聚焦天体
 *     环绕：相机位移、注视距离不变、地球恒居画面中心；左键拖拽不动相机——左键留地图交互）。
 *  3. ai.projectScreenPos 世界→屏幕投影查询：actor 命中 / worldPos / 相机界外
 *     （inFront=false）/ 未知 actor / 缺参 全分支。投影 → mouseClick 组成纯玩家点击链。
 *
 * 坐标系约定：mouseClick/projectScreenPos 用页面像素坐标（PhySys 视口 rect 基）；
 * HUD 节点 position/worldSize 是 UI 画布 1920×1080 px 语义，经 contain 变换取屏幕坐标。
 *
 * 前置：dev server 已在 :5173 运行（npm run dev）；跑法 npm run test:e2e:warm。
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../framework/fixtures'
import { mouseClick, mouseDrag, mouseMove, projectScreenPos } from '../framework/ai'
import type { HUDNode } from '../framework/types'

test.use({ project: 'warm' })

const UI_CANVAS_W = 1920
const UI_CANVAS_H = 1080

/** 等暖流星图调试桥就绪（菜单场景没有它，必须先进星图） */
async function waitWarmMap(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
      return !!b && b.ready()
    },
    undefined,
    { timeout: 60_000, polling: 500 },
  )
}

/** 冻结仿真（确定性：天体公转/计时器停走；相机云台照常 Tick，平移断言不受影响） */
async function freezeSim(page: Page): Promise<void> {
  await page.evaluate(`(() => { window.__warmCurrent.mode().togglePause() })()`)
}

/** 游戏视口 canvas rect（mouseClick/projectScreenPos 的页面像素坐标系基准） */
interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

async function canvasRect(page: Page): Promise<ViewportRect> {
  const rect = (await page.evaluate(`(() => {
    const list = [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 100 && b.height > 100)
      .sort((a, b) => b.width * b.height - a.width * a.height)
    if (!list.length) return null
    const b = list[0]
    return { left: b.left, top: b.top, width: b.width, height: b.height }
  })()`)) as ViewportRect | null
  if (!rect) throw new Error('[e2e] 未找到游戏视口 canvas（视口未渲染？）')
  return rect
}

/** UI 画布 1920×1080（contain 适配）→ 页面屏幕坐标 */
function canvasToScreen(rect: ViewportRect, cx: number, cy: number): { x: number, y: number } {
  const scale = Math.min(rect.width / UI_CANVAS_W, rect.height / UI_CANVAS_H)
  const offX = rect.left + (rect.width - UI_CANVAS_W * scale) / 2
  const offY = rect.top + (rect.height - UI_CANVAS_H * scale) / 2
  return { x: offX + cx * scale, y: offY + cy * scale }
}

/**
 * HUD 双根镜像去重：同一 widget 树经 UIManager 双根可达（"/HUD/..." 镜像 + "/WarmCurrentHud/..." 本尊），
 * 只留非 /HUD/ 前缀的一份，平铺返回。
 */
function flatGameHud(roots: HUDNode[]): HUDNode[] {
  const out: HUDNode[] = []
  const walk = (n: HUDNode): void => {
    if (n.path.startsWith('/HUD/')) return
    out.push(n)
    for (const c of n.children) walk(c)
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * HUD 节点的画布绝对坐标（画布 1920×1080，中心原点 +y 向上）：
 * getHUD 的 position 是相对父节点的局部坐标，沿祖先链累加得绝对值。
 * 返回画布坐标（top-left 原点 +y 向下，可直接进 contain 换算）。
 */
function hudCanvasCenter(roots: HUDNode[], name: string): { x: number, y: number, node: HUDNode } {
  const found: Array<{ x: number, y: number, node: HUDNode }> = []
  const walk = (n: HUDNode, ax: number, ay: number): void => {
    if (n.path.startsWith('/HUD/')) return
    const cx = ax + (n.position?.[0] ?? 0)
    const cy = ay + (n.position?.[1] ?? 0)
    if (n.name === name && found.length === 0) {
      found.push({ x: UI_CANVAS_W / 2 + cx, y: UI_CANVAS_H / 2 - cy, node: n })
    }
    for (const c of n.children) walk(c, cx, cy)
  }
  for (const r of roots) walk(r, 0, 0)
  if (found.length === 0) throw new Error(`[e2e] HUD 中未找到节点: ${name}`)
  return found[0]
}

test.describe('warm-current 纯玩家输入链路（mouseClick 完整释放 / mouseDrag 右键 / projectScreenPos）', () => {
  test.beforeEach(async ({ game, page }) => {
    // 主菜单 → 星图（玩家路径：点 Btn_new）
    const click = await game.clickActor({ name: 'Btn_new' })
    expect(click.ok, '点 Btn_new 应进星图（主菜单按钮）').toBe(true)
    await waitWarmMap(page)
  })

  test('projectScreenPos 全分支：actor 命中/确定性/worldPos/相机界外/未知 actor/缺参', async ({ page }) => {
    await freezeSim(page)

    // ── actor 命中：EarthActor 在取景中心，投影成功且在前界（Actor 名 = 类名，getState 同口径） ──
    const earth = await projectScreenPos(page, { actor: 'EarthActor' })
    expect(earth.ok, `actor 命中应 ok：${earth.error ?? ''}`).toBe(true)
    expect(earth.inFront, '取景中心天体应在前界内').toBe(true)
    expect(earth.actor).toBe('EarthActor')
    expect(earth.world, '应回显世界坐标').toBeTruthy()
    expect(Number.isFinite(earth.screenX) && Number.isFinite(earth.screenY), '屏幕坐标应为有限数').toBe(true)

    // ── 确定性：仿真冻结 + 相机静止 → 连续两次投影一致（< 0.5px） ──
    const earth2 = await projectScreenPos(page, { actor: 'EarthActor' })
    expect(earth2.ok, `二次投影应 ok：${earth2.error ?? ''}`).toBe(true)
    expect(Math.abs(earth2.screenX! - earth.screenX!), '投影应确定性（冻结后无漂移）').toBeLessThan(0.5)
    expect(Math.abs(earth2.screenY! - earth.screenY!)).toBeLessThan(0.5)

    // ── worldPos：世界原点投影成功 ──
    const origin = await projectScreenPos(page, { worldPos: [0, 0, 0] })
    expect(origin.ok, `worldPos 投影应 ok：${origin.error ?? ''}`).toBe(true)
    expect(origin.inFront).toBe(true)

    // ── 相机界外：相机上空 10 万码的点在相机背后 → inFront=false（坐标不可信） ──
    const behind = await projectScreenPos(page, { worldPos: [0, 99999, 0] })
    expect(behind.ok).toBe(true)
    expect(behind.inFront, '相机背后的点应判界外').toBe(false)

    // ── 未知 actor：可读报错 ──
    const unknown = await projectScreenPos(page, { actor: 'NoSuchStar' })
    expect(unknown.ok).toBe(false)
    expect(unknown.error ?? '', '报错应包含查不到的名字').toContain('NoSuchStar')

    // ── 缺参：actor/worldPos 都缺 → 拒绝 ──
    const missing = await projectScreenPos(page, {})
    expect(missing.ok).toBe(false)
    expect(missing.error ?? '').toContain('actor')
  })

  test('mouseClick 完整点击：暂停按钮动作生效 + 按钮态回 normal（释放分发正向锁）', async ({ game, page }) => {
    // 开局不冻结：暂停动作本身就是被测行为（fresh game 默认运行中，Label=暂停）
    const btn = hudCanvasCenter(await game.hud(), 'Btn_pause')
    expect(btn.node.position && btn.node.worldSize, 'Btn_pause 应上报 position/worldSize').toBeTruthy()

    const rect = await canvasRect(page)
    const pt = canvasToScreen(rect, btn.x, btn.y)
    const labelCount = (t: string): Promise<number> =>
      game.findHUD((n) => n.text === t).then((ns) => ns.filter((n) => !n.path.startsWith('/HUD/')).length)

    // 点击前：未暂停
    expect(await labelCount('暂停')).toBe(1)

    // 完整点击一次 → 暂停生效（Label 暂停→继续；动作在按下结算）
    const res = await mouseClick(page, { screenX: pt.x, screenY: pt.y })
    expect(res.ok, `mouseClick 应 ok：${res.error ?? ''}`).toBe(true)
    expect(res.button).toBe(0)
    await game.waitHUD((n) => n.text === '继续' && !n.path.startsWith('/HUD/'), 10_000)

    // 释放分发正向锁：按钮必须回到 normal（旧版只按不抬 → 卡 pressed）
    const after = flatGameHud(await game.hud()).find((n) => n.name === 'Btn_pause')
    expect(after?.buttonState, '完整点击后按钮应回 normal（handleRelease 已分发）').toBe('normal')

    // 再点一次恢复运行态（顺带验证重复点击；间隔已超 500ms 点击冷却）
    await mouseClick(page, { screenX: pt.x, screenY: pt.y })
    await game.waitHUD((n) => n.text === '暂停' && !n.path.startsWith('/HUD/'), 10_000)
  })

  test('mouseDrag：右键拖拽环绕聚焦天体（地球居中·距离不变）；左键拖拽不动相机；右键轻点不卡滞（回归锁）', async ({ game, page }) => {
    await freezeSim(page)
    const p0 = await projectScreenPos(page, { actor: 'EarthActor' })
    expect(p0.ok && p0.inFront).toBeTruthy()

    // 相机状态探针（聚焦环绕断言用：位置 + 与注视点距离；2026-09-15 聚焦环绕改版）
    const camProbe = (): Promise<{ cx: number, cy: number, cz: number, dist: number }> =>
      page.evaluate(`(() => {
        const m = window.__warmCurrent.mode()
        const c = m.cameraActor.camera.position
        const t = m.cameraActor.rig.target
        return { cx: c.x, cy: c.y, cz: c.z, dist: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z) }
      })()`)

    // ── 右键拖拽 300px = 绕地球环绕（2026-09-15 聚焦环绕改版，取代旧右键平移）：
    //    相机位移显著、注视距离严格不变、地球保持画面中心（区别于平移的"整体滑动"） ──
    const cam0 = await camProbe()
    const drag = await mouseDrag(page, {
      startX: p0.screenX! + 150,
      startY: p0.screenY! + 80,
      endX: p0.screenX! - 150,
      endY: p0.screenY! + 80,
      button: 2,
      steps: 10,
      stepDelayMs: 16,
    })
    expect(drag.ok, `右键拖拽应 ok：${drag.error ?? ''}`).toBe(true)
    expect(drag.button).toBe(2)
    expect(drag.async).toBe(true)

    // 等拖拽步进完成 + 相机停稳（headless 下 stepDelay 定时器可能被节流到 1s/步，放宽到 12s）
    let cur = await projectScreenPos(page, { actor: 'EarthActor' })
    let stable = 0
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline && stable < 2) {
      await page.waitForTimeout(250)
      const next = await projectScreenPos(page, { actor: 'EarthActor' })
      stable = Math.abs(next.screenX! - cur.screenX!) < 1 && Math.abs(next.screenY! - cur.screenY!) < 1 ? stable + 1 : 0
      cur = next
    }
    const cam1 = await camProbe()
    expect(
      Math.hypot(cam1.cx - cam0.cx, cam1.cz - cam0.cz),
      '右键拖拽后相机位置应显著移动（环绕生效）',
    ).toBeGreaterThan(100)
    expect(
      Math.abs(cam1.dist - cam0.dist),
      '环绕不应改变注视距离（聚焦天体恒定，区别于平移/缩放）',
    ).toBeLessThan(5)
    expect(
      Math.abs(cur.screenX! - p0.screenX!),
      '环绕时地球应保持画面中心（聚焦语义，屏幕位移≈0）',
    ).toBeLessThan(20)
    expect(Math.abs(cur.screenY! - p0.screenY!)).toBeLessThan(20)

    // ── 左键拖拽回归锁：聚焦默认视角左键留地图交互（leftOrbitEnabled=false），
    //    相机完全不动（既不平移也不环绕；耀斑框选/拖线交互不受相机层侵吞） ──
    const camBase = await camProbe()
    const base = await projectScreenPos(page, { actor: 'EarthActor' })
    await mouseDrag(page, {
      startX: base.screenX! + 150,
      startY: base.screenY! + 80,
      endX: base.screenX! - 150,
      endY: base.screenY! + 80,
      button: 0,
      steps: 10,
    })
    // 等左键拖拽步进走完再测（期间即使有残留移动，左键也不动相机）
    const leftDeadline = Date.now() + 12_000
    let afterLeft = await projectScreenPos(page, { actor: 'EarthActor' })
    while (Date.now() < leftDeadline) {
      await page.waitForTimeout(400)
      const next = await projectScreenPos(page, { actor: 'EarthActor' })
      const settled = Math.abs(next.screenX! - afterLeft.screenX!) < 1 && Math.abs(next.screenY! - afterLeft.screenY!) < 1
      afterLeft = next
      if (settled) break
    }
    const camAfterLeft = await camProbe()
    expect(
      Math.hypot(camAfterLeft.cx - camBase.cx, camAfterLeft.cz - camBase.cz),
      '左键拖拽不应移动相机（左键环绕已让位地图交互）',
    ).toBeLessThan(1)
    expect(
      Math.abs(afterLeft.screenX! - base.screenX!),
      '左键拖拽地球应保持画面中心',
    ).toBeLessThan(30)

    // ── 右键轻点不卡滞（旧版 bug 回归锁）：click button=2 后大位移 mouse_move，
    //    相机几乎不动（旧版 rightDragging 卡 true → 移动即平移；环绕态同口径收口） ──
    const p2 = await projectScreenPos(page, { actor: 'EarthActor' })
    const cam2 = await camProbe()
    const click2 = await mouseClick(page, { screenX: p2.screenX! + 180, screenY: p2.screenY! + 120, button: 2 })
    expect(click2.ok).toBe(true)
    await mouseMove(page, { screenX: p2.screenX! - 180, screenY: p2.screenY! - 120 })
    await page.waitForTimeout(500)
    const p3 = await projectScreenPos(page, { actor: 'EarthActor' })
    const cam3 = await camProbe()
    expect(
      Math.abs(p3.screenX! - p2.screenX!),
      '右键 click + mouse_move 不应移动相机（rightDragging 已被释放收口）',
    ).toBeLessThan(25)
    expect(Math.abs(p3.screenY! - p2.screenY!)).toBeLessThan(25)
    expect(
      Math.hypot(cam3.cx - cam2.cx, cam3.cz - cam2.cz),
      '右键轻点 + mouse_move 相机位置不应漂移',
    ).toBeLessThan(25)
  })

  test('输入事件参数校验：mouseClick/mouseDrag 缺参应拒绝（引擎层分支）', async ({ page }) => {
    // 直接 emit 事件绕过 DSH 工具 schema，专测引擎处理器自身的参数校验分支
    const badClick = await mouseClick(page, { screenX: 100 })
    expect(badClick.ok).toBe(false)
    expect(badClick.error ?? '').toContain('screenY')

    const badDrag = await mouseDrag(page, { startX: 0, startY: 0, endX: 10 })
    expect(badDrag.ok).toBe(false)
    expect(badDrag.error ?? '').toContain('endY')
  })
})
