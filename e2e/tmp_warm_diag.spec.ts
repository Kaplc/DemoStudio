/**
 * warm Dim 父链诊断（临时脚本，诊断完删除）
 */
import { expect, test, type Page } from '@playwright/test'

async function waitGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const b = (window as unknown as { __warmCurrent?: { ready: () => boolean } }).__warmCurrent
    return !!b && b.ready()
  }, { timeout: 60_000 })
}

test('Dim 父链', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('div, button').filter({ hasText: /^WarmCurrent/ }).last()
  await card.click()
  await page.getByRole('button', { name: '打开工程' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '打开工程' })).toBeHidden({ timeout: 30_000 })
  await page.locator('button', { hasText: '▶' }).first().click()

  await page.waitForFunction(() => {
    const ai = (window as unknown as { __ai?: { emit: (e: string, p?: unknown) => unknown } }).__ai
    if (!ai) return false
    const r = ai.emit('ai.clickActor', { name: 'Btn_new' }) as { results?: Array<{ ok?: boolean, error?: string }> }
    const first = r?.results?.[0]
    return !!first?.ok || first?.error !== '游戏未运行'
  }, { timeout: 60_000, polling: 500 })
  await waitGameReady(page)

  const chain = await page.evaluate(`(() => {
    const mode = window.__warmCurrent.mode()
    const findRec = (a, name) => {
      if (a.root.name === name) return a
      for (const c of a.getChildren()) { const h = findRec(c, name); if (h) return h }
      return null
    }
    let root = null
    mode.world.ui._uiActors.forEach(v => { const a = (v && v.actor) ? v.actor : v; if (a.root && a.root.name === 'WarmCurrentReserveInfo') root = a })
    const dim = findRec(root, 'Dim')
    const out = { rootVisible: root.root.visible, chain: [] }
    let o = dim.root
    while (o) {
      out.chain.push({ name: o.name || '(unnamed)', visible: o.visible, type: o.type })
      o = o.parent
    }
    // hitTest 视角：Dim 的 mesh 目标
    const cc = dim.components.find(c => c.getHitCenterWorld !== undefined)
    out.hasClickable = !!cc
    out.center = cc ? !!cc.getHitCenterWorld() : null
    return out
  })()`) as Record<string, unknown>
  console.log('CHAIN', JSON.stringify(chain, null, 2))
})
