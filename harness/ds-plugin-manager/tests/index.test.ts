import { describe, expect, it } from 'vitest'
import { name, inject } from '../src/index.js'

describe('ds-plugin-manager 插件入口', () => {
  it('导出正确的插件名', () => {
    expect(name).toBe('@demostudio/ds-plugin-manager')
  })

  it('声明 inject = ["tools"]', () => {
    expect(inject).toEqual(['tools'])
  })
})
