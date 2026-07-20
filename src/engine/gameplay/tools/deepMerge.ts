/**
 * deepMerge — PropertyPatch 深合并工具
 *
 * 用于 Blueprint 系统的属性覆盖合并（实例覆盖、继承链合并）。
 * 仅处理 JSON 可序列化数据（颜色用 "#rrggbb"，向量用 number[]），不涉及 three.js 对象。
 *
 * 合并规则：
 *   - patch[key] === null          → delete target[key]（标记删除语义）
 *   - 双方均为普通对象（非数组）     → 递归合并
 *   - 否则（基本类型 / 数组 / 类型不匹配）→ 整体替换（克隆，避免共享引用）
 *
 * key 不编码点路径（如 'material.opacity'）：嵌套用对象表达（{ material:{ opacity:0.5 } }），
 * 利于编辑器 UI 渲染与继承链递归合并。
 */

/** 属性补丁：仅 JSON 可序列化的键值对 */
export type PropertyPatch = Record<string, any>

/** 判断是否为普通对象（非 null、非数组） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 深克隆一个补丁值。
 * 优先使用 structuredClone（现代浏览器 / Node 17+），回退到 JSON 方式。
 */
export function clonePatch<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // 回退（值为纯 JSON 可序列化数据时不会失败）
    }
  }
  return JSON.parse(JSON.stringify(value))
}

/**
 * 将 patch 深合并到 target（原地修改 target 并返回）。
 *
 * @see 规则见文件头部注释
 */
export function mergePatch(target: PropertyPatch, patch: PropertyPatch): PropertyPatch {
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    if (value === null) {
      delete target[key]
      continue
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergePatch(target[key] as PropertyPatch, value as PropertyPatch)
    } else {
      target[key] = clonePatch(value)
    }
  }
  return target
}

/** 创建一个空补丁对象（语义占位，等价 {}） */
export function emptyPatch(): PropertyPatch {
  return {}
}
