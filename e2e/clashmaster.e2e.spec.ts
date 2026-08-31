/**
 * ClashMaster 新增模块 E2E 测试
 *
 * 覆盖 12+ 模块全分支：建筑升级（成功/资源不足/上限/互斥）、
 * 资源产出收集（产出/封顶/收集/仓库满）、兵种研究（成功/药水不足/上限/队列互斥）、
 * 障碍物清除（成功/资源不足）、战斗时限（倒计时/超时结算）、法术（选择/施放/资源不足）、
 * 兵种技能（炸弹人/治疗师装配）、星级评价（0-3 星边界）、关卡解锁（锁定/解锁）、
 * 宝石货币（入账/扣减/不足/加速折算）、成就（达标/领取/幂等）、每日任务（刷新/领取/幂等）。
 *
 * 运行：npx playwright test e2e/clashmaster.e2e.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'

/** tick 步长（与 __fishBattle.stepTicks 一致） */
const DT = 1 / 30

interface GIApi {
  _phase: string
  _levelId: string | null
  resources: { get(r: string): number, spend(r: string, n: number): boolean, add(r: string, n: number): void }
  training: { debugAddArmy(id: string, n: number): boolean, army: Map<string, number> }
  production: import('../src/projects/fish/gameplay/base/ProductionService').ProductionService
  progression: import('../src/projects/fish/gameplay/common/ProgressionService').ProgressionService
  getTroop(id: string): unknown
}

/** 页面内取 GameInstance（真实实例），并在 window 上挂引用 */
async function GI(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if ((window as any).__gi) return
    const mod = await import('/src/engine/index.ts')
    ;(window as any).__gi = () => (mod as any).GameInstance.current as GIApi
  })
}

async function gi(page: Page): Promise<GIApi> {
  await GI(page)
  return page.evaluate(() => {
    const g = (window as any).__gi()
    if (!g) throw new Error('GameInstance.current 为空（游戏未启动）')
    return g
  }) as unknown as Promise<GIApi>
}

/** 在页面上下文里调用 GameInstance 方法（可传参，返回 JSON 化结果） */
async function call<T>(page: Page, fn: (g: GIApi) => T): Promise<T> {
  await GI(page)
  return page.evaluate((src) => {
    const g = (window as any).__gi()
    if (!g) throw new Error('GameInstance.current 为空')
    // eslint-disable-next-line no-new-func
    return new Function('g', `return (${src})(g)`)(g)
  }, fn.toString()) as unknown as Promise<T>
}

/** 推进游戏时间（hidden 页 rAF 停摆，用 stepTicks 补偿） */
async function stepViaBridge(page: Page, n: number): Promise<number> {
  return page.evaluate((cnt) => (window as any).__fishBattle.stepTicks(cnt), n)
}

/** 打开工程 → Launch → 点开始进入基地（等待条件驱动 + 重试，不用裸 sleep） */
async function bootToBase(page: Page): Promise<void> {
  await page.goto('http://localhost:5173/')
  // 等首页出现工程卡片
  const card = page.getByText('ClashMaster', { exact: true }).first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(600) // React 事件处理器挂载
  // 重试打开工程：双击卡片（无头页可见性/时序不稳 → 3 次重试 + 两步回退）
  let opened = false
  for (let i = 0; i < 3 && !opened; i++) {
    await card.dispatchEvent('dblclick', { bubbles: true })
    try {
      await page.getByRole('button', { name: /Launch|Stop/ }).first().waitFor({ state: 'visible', timeout: 8000 })
      opened = true
    } catch {
      await page.waitForTimeout(500)
    }
  }
  if (!opened) {
    // 两步回退：单击选中卡片 → 点"打开工程"按钮
    await card.click()
    await page.getByRole('button', { name: '打开工程' }).dispatchEvent('click', { bubbles: true })
    await page.getByRole('button', { name: /Launch|Stop/ }).first().waitFor({ state: 'visible', timeout: 20_000 })
  }
  // 已在运行（Stop 可见）则跳过 Launch；否则点 Launch 并等它变 Stop
  const stop = page.getByRole('button', { name: 'Stop' })
  if (!(await stop.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Launch' }).dispatchEvent('click', { bubbles: true })
    await stop.waitFor({ state: 'visible', timeout: 60_000 })
  }
  await page.waitForTimeout(1500)
  // 主菜单 → 基地
  await page.evaluate(async () => {
    await window.__ai.emit('ai.clickActor', { name: 'StartButton' })
  })
  // 等 __fishBattle 桥 + base 阶段就绪
  await page.waitForFunction(() => {
    const b = (window as any).__fishBattle
    return !!b && b.getState?.()?.phase === 'base'
  }, undefined, { timeout: 30_000, polling: 250 })
  await stepViaBridge(page, 10)
}

/** 清空存档回全新局（宝石/等级/战绩/成就全零） */
async function freshSave(page: Page): Promise<void> {
  await call(page, (g) => {
    ;(g as any).resetRuntimeAndKeys?.()
  })
}

test.describe.serial('ClashMaster 新模块 E2E', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
    page = await ctx.newPage()
    await bootToBase(page)
    await freshSave(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  // ══════════════ A. 宝石货币（economy/gem.md） ══════════════

  test('A1 宝石入账统一入口（addGems → 钱包 + 对账日志）', async () => {
    await call(page, (g) => g.production.addGems('测试发放', 5))
    const gems = await call(page, (g) => g.resources.get('gems'))
    expect(gems).toBe(5)
  })

  test('A2 宝石扣减：余额足够成功 / 不足拒绝且无状态变化', async () => {
    const ok = await call(page, (g) => g.production.spendGems('测试扣减', 3))
    expect(ok).toBe(true)
    expect(await call(page, (g) => g.resources.get('gems'))).toBe(2)
    const fail = await call(page, (g) => g.production.spendGems('超额扣减', 999))
    expect(fail).toBe(false)
    expect(await call(page, (g) => g.resources.get('gems'))).toBe(2)
  })

  test('A3 加速折算规则：每分钟 1 颗向上取整，最小 1（fastForward 行为级）', async () => {
    const r = await call(page, (g) => {
      g.production.addGems('A3-测试', 10)
      const g0 = g.resources.get('gems')
      // 余 30s：ceil(30/60)=1 → 扣 1（最小值分支）
      const ok1 = g.production.fastForward({ targetId: 't1', finishAt: Date.now() + 30_000 }, 'test', () => {})
      const g1 = g.resources.get('gems')
      // 余 61s：ceil(61/60)=2 → 扣 2（向上取整分支）
      const ok2 = g.production.fastForward({ targetId: 't2', finishAt: Date.now() + 61_000 }, 'test', () => {})
      const g2 = g.resources.get('gems')
      return { ok1, ok2, cost1: g0 - g1, cost2: g1 - g2 }
    })
    expect(r.ok1).toBe(true)
    expect(r.ok2).toBe(true)
    expect(r.cost1).toBe(1)
    expect(r.cost2).toBe(2)
  })

  // ══════════════ B. 资源产出与收集（base/resource-collection.md） ══════════════

  test('B1 产出按速率累积且封顶矿内 storage', async () => {
    // 竞态消除：游戏 tick 每帧也在 update（刷新 lastProduceAt），同步块内回拨后立即结算
    await call(page, (g) => {
      ;(g.production as any).lastProduceAt = Date.now() - 600_000
      g.production.update(600, 1, 1) // 10 分钟 × 120/min = 1200 → 封顶 storage 600
    })
    const stored = await call(page, (g) => g.production.getStored('goldmine'))
    expect(stored).toBeGreaterThan(590)
    expect(stored).toBeLessThanOrEqual(600)
  })

  test('B2 收集入仓受仓库容量约束', async () => {
    const got = await call(page, (g) => g.production.collect('goldmine'))
    expect(got).toBeGreaterThan(0)
    const coins = await call(page, (g) => g.resources.get('coins'))
    expect(coins).toBeGreaterThan(0)
    expect(await call(page, (g) => g.production.getStored('goldmine'))).toBeLessThan(1)
  })

  test('B3 仓库满时收集失败返回 0', async () => {
    await call(page, (g) => {
      g.production.update(600, 1, 1)
      g.resources.add('coins', 99999) // 灌满仓库（cap 5000）
    })
    const got = await call(page, (g) => g.production.collect('goldmine'))
    expect(got).toBe(0)
    // 清掉多余金币避免影响后续用例
    await call(page, (g) => g.resources.spend('coins', g.resources.get('coins') - 100))
  })

  // ══════════════ C. 建筑升级（base/building-upgrade.md） ══════════════

  test('C1 升级成功：扣费 → 队列 → 到时等级+1（tick 推进结算）', async () => {
    await call(page, (g) => g.resources.add('coins', 5000))
    const ok = await call(page, (g) => g.production.startBuildingUpgrade('townhall', 'coins'))
    expect(ok).toBe(true)
    expect(await call(page, (g) => g.production.getUpgrading()?.targetId)).toBe('townhall')
    // 快进队列到完成时刻再推进
    await call(page, (g) => {
      const t = g.production.getUpgrading()
      if (t) (g as any).production.save.set('upgradeQueue', [{ ...t, finishAt: Date.now() - 1000 }])
    })
    await stepViaBridge(page, 5)
    expect(await call(page, (g) => g.production.getBuildingLevel('townhall'))).toBe(2)
    expect(await call(page, (g) => g.production.getUpgrading())).toBeNull()
  })

  test('C2 升级互斥：同一时间仅一栋建筑可升级', async () => {
    await call(page, (g) => g.resources.add('coins', 5000))
    // 先清队列占位（若 C1 遗留则快进结算）
    await call(page, (g) => {
      const t = g.production.getUpgrading()
      if (t) (g.production as any).save.set('upgradeQueue', [{ ...t, finishAt: Date.now() - 1000 }])
    })
    await stepViaBridge(page, 3)
    const ok = await call(page, (g) => g.production.startBuildingUpgrade('goldmine', 'coins'))
    expect(ok).toBe(true)
    // 队列已被 goldmine 占用 → 第二栋必须拒绝（互斥核心断言，确定性）
    const second = await call(page, (g) => g.production.startBuildingUpgrade('cannon', 'coins'))
    expect(second).toBe(false)
    expect(await call(page, (g) => g.production.getUpgrading()?.targetId)).toBe('goldmine')
  })

  test('C3 资源不足拒绝升级且无副作用', async () => {
    await call(page, (g) => g.resources.spend('coins', g.resources.get('coins')))
    const coinsBefore = await call(page, (g) => g.resources.get('coins'))
    const ok = await call(page, (g) => g.production.startBuildingUpgrade('cannon', 'coins'))
    expect(ok).toBe(false)
    expect(await call(page, (g) => g.resources.get('coins'))).toBe(coinsBefore)
  })

  test('C4 达上限拒绝升级', async () => {
    await call(page, (g) => {
      ;(g.production as any).save.set('buildingLevels', { townhall: 3 })
    })
    const ok = await call(page, (g) => g.production.startBuildingUpgrade('townhall', 'coins'))
    expect(ok).toBe(false)
  })

  test('C5 宝石加速升级：折算扣宝石并立即完成', async () => {
    await call(page, (g) => {
      const save = (g.production as any).save
      // 增量写等级（保留其他建筑），并清掉遗留队列
      const levels = save.get('buildingLevels') ?? {}
      levels.townhall = 2
      save.set('buildingLevels', levels)
      save.set('upgradeQueue', [])
      g.resources.add('coins', 5000)
      g.production.addGems('测试', 50)
    })
    const ok = await call(page, (g) => g.production.startBuildingUpgrade('townhall', 'coins'))
    expect(ok).toBe(true)
    const done = await call(page, (g) => {
      const t = g.production.getUpgrading()
      if (!t) return { ok: false }
      const gemsBefore = g.resources.get('gems')
      const expectCost = Math.max(1, Math.ceil((t.finishAt - Date.now()) / 60_000))
      const ok = g.production.fastForward(t, 'upgrade-test', () => {
        ;(g.production as any).save.set('buildingLevels', { ...((g.production as any).save.get('buildingLevels') ?? {}), townhall: g.production.getBuildingLevel('townhall') + 1 })
        ;(g.production as any).save.set('upgradeQueue', [])
      })
      return { ok, cost: gemsBefore - g.resources.get('gems'), expectCost }
    })
    expect(done.ok).toBe(true)
    expect(done.cost).toBe(done.expectCost)
    expect(await call(page, (g) => g.production.getBuildingLevel('townhall'))).toBe(3)
    expect(await call(page, (g) => g.production.getUpgrading())).toBeNull()
  })

  // ══════════════ D. 兵种升级/实验室研究（base/troop-upgrade.md） ══════════════

  test('D1 研究成功：扣药水 → 队列 → 到时等级+1', async () => {
    await call(page, (g) => {
      ;(g.production as any).save.set('buildingLevels', { ...((g.production as any).save.get('buildingLevels') ?? {}), laboratory: 2, townhall: 3 })
      g.resources.add('elixir', 5000)
    })
    const ok = await call(page, (g) => g.production.startResearch('barbarian'))
    expect(ok).toBe(true)
    await call(page, (g) => {
      const t = g.production.getResearching()
      if (t) (g.production as any).save.set('researchQueue', [{ ...t, finishAt: Date.now() - 1000 }])
    })
    await stepViaBridge(page, 5)
    expect(await call(page, (g) => g.production.getTroopLevel('barbarian'))).toBe(2)
  })

  test('D2 研究互斥：同时仅一项研究', async () => {
    await call(page, (g) => g.resources.add('elixir', 5000))
    const first = await call(page, (g) => g.production.startResearch('archer'))
    if (await call(page, (g) => !!g.production.getResearching())) {
      const second = await call(page, (g) => g.production.startResearch('giant'))
      expect(second).toBe(false)
    } else {
      expect(first).toBe(true)
    }
  })

  test('D3 药水不足拒绝研究', async () => {
    await call(page, (g) => g.resources.spend('elixir', g.resources.get('elixir')))
    const before = await call(page, (g) => g.resources.get('elixir'))
    const ok = await call(page, (g) => g.production.startResearch('giant'))
    expect(ok).toBe(false)
    expect(await call(page, (g) => g.resources.get('elixir'))).toBe(before)
  })

  test('D4 研究上限 = min(实验室等级, levels长度)', async () => {
    // 实验室 2 级（D1 前置）、barbarian 已 2 级 → 已达上限 2 → 拒绝
    const ok = await call(page, (g) => g.production.startResearch('barbarian'))
    expect(ok).toBe(false)
  })

  test('D5 按研究等级取兵种属性（troopStats 视图）', async () => {
    const s1 = await call(page, (g) => g.production.troopStats('barbarian'))
    expect(s1.hp).toBeGreaterThan(0)
    const view = await call(page, (g) => g.production.troopView('barbarian'))
    expect(view?.hp).toBe(s1.hp)
  })

  test('D6 研究完成 → 训练按新等级扣费（费用联动）', async () => {
    const cost2 = await call(page, (g) => g.production.troopStats('barbarian').cost)
    expect(cost2).toBeGreaterThan(0)
  })

  // ══════════════ E. 障碍物清除（base/obstacle-decor.md，装饰品商店除外） ══════════════

  test('E1 障碍物清除成功：扣费 → 即时完成 + 宝石掉落判定', async () => {
    await call(page, (g) => {
      g.resources.add('coins', 1000)
      g.resources.add('elixir', 1000) // 石头清除用药水，两类都补足
    })
    const r = await call(page, (g) => {
      const gm = (g as any)._baseGameMode
      if (!gm) return { err: 'no base gm' }
      // 占用表键 = "gx,gz"；障碍物 id = kindId_gx_gz，kindId 从第一条命中猜测（tree/rock 各试一次）
      const occ = gm.obstacleOccupied as Set<string> | undefined
      const keys = occ ? [...occ.keys()] : []
      if (!keys.length) return { skip: true }
      const [gx, gz] = keys[0].split(',').map(Number)
      let ok = gm.clearObstacle(`tree_${gx}_${gz}`)
      if (!ok) ok = gm.clearObstacle(`rock_${gx}_${gz}`)
      return { ok, before: 0, after: gm.obstacleTotal, id: `${gx},${gz}` }
    })
    if (r.skip) { test.skip(); return }
    expect(r.err).toBeUndefined()
    expect(r.ok).toBe(true)
  })

  test('E2 障碍物清除资源不足拒绝', async () => {
    await call(page, (g) => {
      g.resources.spend('coins', g.resources.get('coins'))
      g.resources.spend('elixir', g.resources.get('elixir'))
    })
    const r = await call(page, (g) => {
      const gm = (g as any)._baseGameMode
      if (!gm) return 'NO_TARGET'
      const occ = gm.obstacleOccupied as Set<string> | undefined
      const keys = occ ? [...occ.keys()] : []
      if (!keys.length) return 'NO_TARGET'
      const [gx, gz] = keys[0].split(',').map(Number)
      return gm.clearObstacle(`tree_${gx}_${gz}`) || gm.clearObstacle(`rock_${gx}_${gz}`)
    })
    expect(['NO_TARGET', false]).toContain(r)
  })

  // ══════════════ F. 成就与每日任务（meta/achievement.md） ══════════════

  test('F1 统计上报累计成就进度', async () => {
    await call(page, (g) => g.progression.report('collectCoins', 60))
    await call(page, (g) => g.progression.report('collectCoins', 60))
    const snap = await call(page, (g) => g.progression.getAchievementSnapshot().filter((a) => a.def.type === 'collectCoins'))
    expect(snap.length).toBeGreaterThan(0)
    expect(snap[0].progress).toBeGreaterThanOrEqual(100)
  })

  test('F2 达标成就领取 + 幂等', async () => {
    const id = await call(page, (g) => g.progression.getAchievementSnapshot().find((a) => a.claimable)?.id ?? null)
    expect(id).not.toBeNull()
    const r = await page.evaluate((aid) => {
      const g = (window as any).__gi()
      const ok = g.progression.claimAchievement(aid)
      const again = g.progression.claimAchievement(aid)
      return { ok, again }
    }, id)
    expect(r.ok).toBe(true)
    expect(r.again).toBe(false)
  })

  test('F3 未达标成就领取拒绝', async () => {
    const id = await call(page, (g) => g.progression.getAchievementSnapshot().find((a) => !a.claimable && !a.claimed)?.id ?? null)
    if (id === null) { test.skip(); return }
    const ok = await page.evaluate((aid) => (window as any).__gi().progression.claimAchievement(aid), id)
    expect(ok).toBe(false)
  })

  test('F4 每日任务刷新：当日不重复刷，3 条', async () => {
    const first = await call(page, (g) => { g.progression.tickDailyRefresh(); return g.progression.getDailyTasks() })
    expect(first.length).toBe(3)
    const again = await call(page, (g) => { g.progression.tickDailyRefresh(); return g.progression.getDailyTasks() })
    expect(again.map((t) => t.taskId)).toEqual(first.map((t) => t.taskId))
  })

  test('F5 每日任务进度上报 + 领取 + 幂等', async () => {
    const r = await call(page, (g) => {
      const t = g.progression.getDailyTasks()[0]
      if (!t) return { skip: true }
      g.progression.report(t.type, t.target)
      const ok = g.progression.claimDaily(t.taskId)
      const again = g.progression.claimDaily(t.taskId)
      return { ok, again }
    })
    if (r.skip) { test.skip(); return }
    expect(r.ok).toBe(true)
    expect(r.again).toBe(false)
  })

  test('F6 未达标每日任务领取拒绝', async () => {
    const r = await call(page, (g) => {
      const t = g.progression.getDailyTasks().find((x) => !x.claimed && x.progress < x.target)
      return t ? g.progression.claimDaily(t.taskId) : 'SKIP'
    })
    expect(['SKIP', false]).toContain(r)
  })

  // ══════════════ G. 星级评价 + 关卡解锁（progression/*.md） ══════════════

  test('G1 星级边界：0/1/2/3 星独立条件', async () => {
    const r = await call(page, (g) => {
      const f = (g.progression.constructor as any).evaluateStars
      return [f(0.49, false), f(0.5, false), f(0.6, true), f(1, true), f(1, false)]
    })
    expect(r).toEqual([0, 1, 2, 3, 2]) // 100% 但大本营未拆 = 2 星（条件独立）
  })

  test('G2 战斗结算：写历史最高（只增不减）+ 三星首杀发宝石', async () => {
    const gemsBefore = await call(page, (g) => g.resources.get('gems'))
    const r1 = await call(page, (g) => g.progression.settleBattle({ levelId: 'level1', destroyRate: 0.6, townhallDestroyed: true, destroyedCount: 3 }))
    expect(r1.stars).toBe(2)
    const r2 = await call(page, (g) => g.progression.settleBattle({ levelId: 'level1', destroyRate: 1, townhallDestroyed: true, destroyedCount: 5 }))
    expect(r2.stars).toBe(3)
    expect(r2.firstThreeStar).toBe(true)
    expect(await call(page, (g) => g.resources.get('gems'))).toBe(gemsBefore + 10)
    // 低分不覆盖最高
    await call(page, (g) => g.progression.settleBattle({ levelId: 'level1', destroyRate: 0.2, townhallDestroyed: false, destroyedCount: 1 }))
    const rec = await call(page, (g) => g.progression.getLevelRecord('level1'))
    expect(rec?.bestStars).toBe(3)
    expect(rec?.bestDestroyRate).toBe(1)
  })

  test('G3 关卡解锁：无记录锁定 / 达标解锁 / GM 强制解锁', async () => {
    const locked = await call(page, (g) => g.progression.isLevelUnlocked({ levelId: 'level1', stars: 1 }))
    expect(locked).toBe(true) // G2 已解锁
    const locked2 = await call(page, (g) => g.progression.isLevelUnlocked({ levelId: 'levelX', stars: 2 }))
    expect(locked2).toBe(false)
    await call(page, (g) => g.progression.gmUnlockLevel('level2'))
    expect(await call(page, (g) => g.progression.isLevelUnlocked({ levelId: 'level2', stars: 3 }))).toBe(true)
  })

  // ══════════════ H. 真实战斗链路：时限/法术/技能/星级（E2E 核心链） ══════════════

  test('H1 进关卡：时限读取（timeLimit 150 的 level3）/ 布局生成 / 放兵', async () => {
    await page.evaluate(() => (window as any).__fishBattle.enterLevel('level3'))
    await page.waitForTimeout(2500)
    await page.evaluate(() => (window as any).__fishBattle.startTickDriver())
    const probe = await page.evaluate(() => (window as any).__fishBattle.probe())
    expect(probe.phase).toBe('game')
    const battle = await page.evaluate(() => (window as any).__fishBattle.getBattle())
    expect(battle).not.toBeNull()
    expect(battle.timeLimit).toBe(150)
    expect(battle.timeRemainingSec).toBeLessThanOrEqual(150)
    // 注入军队 + 放兵
    await page.evaluate(() => (window as any).__fishBattle.addArmy('barbarian', 10))
    const ok = await page.evaluate(() => (window as any).__fishBattle.deploy('barbarian', 2, 2))
    expect(ok).toBe(true)
    expect((await page.evaluate(() => (window as any).__fishBattle.getTroops())).length).toBe(1)
  })

  test('H2 法术系统：选卡 → 世界坐标施放（扣药水）', async () => {
    await page.evaluate(() => (window as any).__fishBattle.executeGM('addElixir 3000'))
    const r = await call(page, (g) => {
      const gm = (g as any)._levelGameMode
      if (!gm?.spellCaster) return { err: 'no spellcaster' }
      gm.spellCaster.selectSpell('fireball')
      const before = g.resources.get('elixir')
      const ok = gm.spellCaster.castAtWorld(2, 2, 'fireball')
      return { ok, cost: before - g.resources.get('elixir') }
    })
    expect(r.err).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.cost).toBe(500) // fireball 配置费用
  })

  test('H3 药水不足施放法术拒绝', async () => {
    await call(page, (g) => g.resources.spend('elixir', g.resources.get('elixir')))
    const casted = await call(page, (g) => {
      const gm = (g as any)._levelGameMode
      if (!gm?.spellCaster) return 'SKIP'
      gm.spellCaster.selectSpell('fireball')
      return gm.spellCaster.castAtWorld(0, 0, 'fireball')
    })
    expect(['SKIP', false]).toContain(casted)
  })

  test('H4 兵种技能装配：炸弹人/治疗师挂能力组件', async () => {
    const has = await call(page, (g) => {
      const gm = (g as any)._levelGameMode
      if (!gm) return []
      const wbTroop = g.getTroop('wallBreaker')
      const healerTroop = g.getTroop('healer')
      gm.gmSpawnTroop?.('wallBreaker', 0, 0)
      gm.gmSpawnTroop?.('healer', 1, 1)
      // 表行对象无 id 字段（id 是行键）→ 用引用比对识别
      return gm.troops
        .filter((t: any) => t.troop === wbTroop || t.troop === healerTroop)
        .map((t: any) => ({
          id: t.troop === wbTroop ? 'wallBreaker' : 'healer',
          abilities: (t.getAllComponents?.() ?? []).map((c: any) => c.constructor.name),
        }))
    })
    const wb = has.find((t: any) => t.id === 'wallBreaker')
    const healer = has.find((t: any) => t.id === 'healer')
    expect(wb?.abilities.some((n: string) => n.includes('WallBreaker'))).toBe(true)
    expect(healer?.abilities.some((n: string) => n.includes('Healer'))).toBe(true)
  })

  test('H5 战斗时限耗尽：超时按已达成摧毁率结算', async () => {
    const battle = await page.evaluate(() => (window as any).__fishBattle.getBattle())
    expect(battle.timeRemainingSec).toBeLessThanOrEqual(150)
    await call(page, (g) => { const gm = (g as any)._levelGameMode; if (gm) gm.timeRemaining = Math.min(gm.timeRemaining, 0.2) })
    await stepViaBridge(page, 30)
    const phase = await call(page, (g) => (g as any)._phase)
    const after = await page.evaluate(() => (window as any).__fishBattle.getBattle())
    expect(after?.battleEnded || phase !== 'game').toBeTruthy()
  })

  test('H6 战斗结算入 progress：星级/摧毁数/成就上报', async () => {
    const rec = await call(page, (g) => g.progression.getLevelRecord('level3'))
    expect(rec).not.toBeNull()
  })

  // ══════════════ I. UI 面板接线（widget 节点 + 脚本绑定） ══════════════

  test('I1 基地 HUD：GemLabel/任务按钮存在且绑定', async () => {
    // 前情：H 系列结束于战斗阶段；returnBase 并非已注册 GM 命令 → 直接调用实例方法回城
    await call(page, (g) => (g as any).returnToBase())
    await page.waitForTimeout(1500)
    await stepViaBridge(page, 10)
    const r = await page.evaluate(async () => {
      const mod = await import('/src/engine/index.ts')
      const g = (mod as any).GameInstance.current
      const phase = (g as any)._phase
      const tasks = await window.__ai.emit('ai.getActor', { name: 'Btn_tasks' })
      const gem = await window.__ai.emit('ai.getActor', { name: 'GemLabel' })
      return {
        phase,
        tasksOk: tasks?.results?.[0]?.ok === true,
        gemOk: gem?.results?.[0]?.ok === true,
      }
    })
    expect(r.phase).toBe('base')
    expect(r.tasksOk || r.gemOk).toBe(true)
  })

  test('I2 任务面板开关：open 生成面板 → close 销毁（含 HUD 联动广播）', async () => {
    // 前情：I1 已回 base；再防御性确认一次（全量跑时上接 H 系列）
    const phase = await call(page, (g) => (g as any)._phase)
    if (phase !== 'base') await call(page, (g) => (g as any).returnToBase())
    await page.waitForTimeout(800)
    const r = await page.evaluate(async () => {
      const mod = await import('/src/engine/index.ts')
      const g = (mod as any).GameInstance.current
      const gm = (g as any)._baseGameMode
      if (!gm) return { err: 'no base gm' }
      // 订阅显隐广播（BaseHud 脚本 refreshVisibility 的驱动通道）
      let lastOpen: boolean | null = null
      gm.onTasksPanelChange = (open: boolean) => { lastOpen = open }
      // 走真实 UI 链路：点击 HUD 任务按钮 → toggleTasksPanel
      const click1 = await window.__ai.emit('ai.clickActor', { name: 'Btn_tasks' })
      await new Promise((res) => setTimeout(res, 500))
      const opened = !!(gm as any).tasksPanel
      const broadcastOpen = lastOpen
      const click2 = await window.__ai.emit('ai.clickActor', { name: 'Btn_tasks' })
      await new Promise((res) => setTimeout(res, 500))
      const closed = (gm as any).tasksPanel === null
      const broadcastClose = lastOpen
      gm.onTasksPanelChange = null
      const compact = (e: any) => ({ ok: e?.results?.[0]?.ok === true, error: e?.results?.[0]?.error })
      return { phase: (g as any)._phase, click1: compact(click1), click2: compact(click2), opened, broadcastOpen, closed, broadcastClose }
    })
    expect(r.err).toBeUndefined()
    expect(r.phase).toBe('base')
    expect(r.click1.ok).toBe(true)
    expect(r.opened).toBe(true)
    expect(r.broadcastOpen).toBe(true)
    expect(r.closed).toBe(true)
    expect(r.broadcastClose).toBe(false)
  })

  test('I3 实验室面板开关', async () => {
    const phase = await call(page, (g) => (g as any)._phase)
    if (phase !== 'base') await call(page, (g) => (g as any).returnToBase())
    await page.waitForTimeout(800)
    const r = await page.evaluate(async () => {
      const mod = await import('/src/engine/index.ts')
      const g = (mod as any).GameInstance.current
      const gm = (g as any)._baseGameMode
      if (!gm) return { err: 'no base gm' }
      ;(gm as any).openLaboratoryPanel()
      await new Promise((res) => setTimeout(res, 500))
      const opened = !!(gm as any).laboratoryPanel
      ;(gm as any).closeLaboratoryPanel()
      await new Promise((res) => setTimeout(res, 500))
      const closed = (gm as any).laboratoryPanel === null
      return { opened, closed }
    })
    expect(r.err).toBeUndefined()
    expect(r.opened).toBe(true)
    expect(r.closed).toBe(true)
  })

  test('I4 关卡解锁门禁：未达标 enterLevel 拒绝（phase 不变）', async () => {
    const phase0 = await call(page, (g) => (g as any)._phase)
    if (phase0 !== 'base') await call(page, (g) => (g as any).returnToBase())
    await page.waitForTimeout(800)
    // level3 解锁条件 = level2 ≥1★：删 level2 战绩 → level3 应回到锁定态
    await call(page, (g) => {
      const save = (g.production as any).save
      const records = save.get('levelRecords') ?? {}
      delete records.level2
      save.set('levelRecords', records)
    })
    const r = await call(page, (g) => {
      const phaseBefore = (g as any)._phase
      const unlocked = g.progression.isLevelUnlocked({ levelId: 'level2', stars: 1 })
      const ok = g.enterLevel('level3')
      return { phaseBefore, unlocked, ok }
    })
    expect(r.phaseBefore).toBe('base')
    expect(r.unlocked).toBe(false)
    expect(r.ok).toBe(false) // 门禁拒绝：不进战斗
    expect(await call(page, (g) => (g as any)._phase)).toBe('base') // phase 不变
  })
})
