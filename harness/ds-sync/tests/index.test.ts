import { describe, expect, it } from 'vitest'
import { name, inject } from '../src/index.js'

describe('ds-sync 插件入口', () => {
  it('导出正确的插件名', () => {
    expect(name).toBe('@demostudio/ds-sync')
  })

  it('声明空 inject（不访问任何服务）', () => {
    expect(inject).toEqual([])
  })
})
