/**
 * DemoStudio MCP — CDP 浏览器操控模块
 *
 * 通过 Chrome DevTools Protocol 连接 Electron 编辑器（默认 9222 端口），
 * 提供 DOM 点击/输入/读取/悬停、JS 执行、导航、等待、滚动、截图、多 Tab 管理等工具。
 *
 * 用法（在 mcp-server.mjs 中）:
 *   import { cdpTools, handleCdpTool } from './mcp-cdp.mjs'
 *   // 注册工具: tools.push(...cdpTools)
 *   // 调用: if (handleCdpTool(name, args)) return handleCdpTool(name, args)
 */

import http from 'http'
import WebSocket from 'ws'

// ─── CDP 连接管理 ───

let _browserWS = null      // Browser-level WebSocket
let _targets = new Map()   // targetId → { ws, url, title }
let _defaultCtxId = null

/**
 * 获取 CDP HTTP 端点
 */
function getCdpHttpBase(port = 9222) {
  return `http://127.0.0.1:${port}`
}

/**
 * HTTP fetch 封装
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    }).on('error', reject)
  })
}

/**
 * 连接 Browser WebSocket（用于 Target 域操作）
 */
async function ensureBrowserWS(port = 9222) {
  if (_browserWS && _browserWS.readyState === WebSocket.OPEN) return _browserWS
  const info = await httpGet(`${getCdpHttpBase(port)}/json/version`)
  const wsUrl = info.webSocketDebuggerUrl
  if (!wsUrl) throw new Error('无法获取 CDP browser WebSocket URL，编辑器可能未启动或 CDP 端口不可用')

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false })
    ws.on('open', () => {
      _browserWS = ws
      resolve(ws)
    })
    ws.on('error', reject)
    ws.on('close', () => { _browserWS = null })
  })
}

let _msgId = 0
function nextId() { return ++_msgId }

/**
 * 发送 CDP 命令并等待结果
 */
function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const timeout = setTimeout(() => reject(new Error(`CDP 超时: ${method} (${id})`)), 15000)

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.id === id) {
          clearTimeout(timeout)
          ws.removeListener('message', handler)
          if (msg.error) reject(new Error(`CDP 错误: ${msg.error.message}`))
          else resolve(msg.result)
        }
      } catch { /* ignore non-JSON */ }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * 获取所有可操控的 target 列表（Page 类型）
 */
async function listTargets(port = 9222) {
  const targets = await httpGet(`${getCdpHttpBase(port)}/json/list`)
  return targets.filter(t => t.type === 'page' || t.type === 'iframe')
}

/**
 * 获取或创建页面级 WebSocket 连接
 */
async function ensurePageWS(targetId, port = 9222) {
  const existing = _targets.get(targetId)
  if (existing && existing.ws.readyState === WebSocket.OPEN) return existing

  const targets = await listTargets(port)
  const target = targetId
    ? targets.find(t => t.id === targetId)
    : targets.find(t => t.type === 'page')

  if (!target) throw new Error('找不到可操控的页面 target')

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false })
    ws.on('open', () => {
      const info = { ws, url: target.url, title: target.title, id: target.id }
      _targets.set(target.id, info)
      resolve(info)
    })
    ws.on('error', reject)
    ws.on('close', () => { _targets.delete(target.id) })
  })
}

/**
 * 获取页面连接（带自动发现）
 */
async function getPageConnection(targetId, port = 9222) {
  try {
    if (targetId) {
      const existing = _targets.get(targetId)
      if (existing && existing.ws.readyState === WebSocket.OPEN) return existing
    }
    return await ensurePageWS(targetId, port)
  } catch {
    // 尝试重新发现
    return await ensurePageWS(null, port)
  }
}

// ─── 工具定义 ───

export const cdpTools = [
  {
    name: 'cdp_click',
    description:
      '通过 CDP 在编辑器页面中点击 DOM 元素。支持 CSS 选择器、文本匹配、XPath。' +
      '示例：selector=".btn-start"、selector="text=启动"、selector="//button[@class=\'ok\']"',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS / text= / role= / XPath 选择器' },
        targetId: { type: 'string', description: '目标 tab 的 targetId（缺省=第一个页面）' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cdp_type',
    description: '在编辑器页面的输入框中输入文字。支持 fill（清空后填入）和 type（逐字符）模式。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '输入框 CSS 选择器' },
        text: { type: 'string', description: '要输入的文字' },
        mode: { type: 'string', enum: ['fill', 'type', 'press'], description: '输入模式，默认 fill' },
        key: { type: 'string', description: '按键名（仅 press 模式，如 Enter/Escape）' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cdp_read',
    description: '读取编辑器页面中 DOM 元素的文本内容、属性值或输入框值。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        mode: { type: 'string', enum: ['text', 'attr', 'value'], description: '读取模式，默认 text' },
        attribute: { type: 'string', description: '属性名（仅 attr 模式）' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cdp_hover',
    description: '将鼠标悬停在编辑器页面的 DOM 元素上（触发 hover/tooltip 等效果）。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cdp_evaluate',
    description: '在编辑器页面中执行 JavaScript 表达式并返回结果。可用于读取全局变量、触发自定义逻辑等。',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要执行的 JS 表达式' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'cdp_navigate',
    description: '让编辑器页面导航到指定 URL（或刷新当前页面）。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL（省略则刷新当前页面）' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
    },
  },
  {
    name: 'cdp_wait',
    description: '等待页面中某个条件满足（元素出现/消失、文本包含指定内容、超时等）。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '等待该 CSS 选择器出现' },
        text: { type: 'string', description: '等待页面包含该文本' },
        timeoutMs: { type: 'number', description: '超时毫秒数，默认 5000' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
    },
  },
  {
    name: 'cdp_scroll',
    description: '在编辑器页面中滚动指定元素或整个页面。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '滚动目标 CSS 选择器（省略则滚动整个页面）' },
        deltaY: { type: 'number', description: 'Y 方向滚动量（正=下，负=上）' },
        deltaX: { type: 'number', description: 'X 方向滚动量' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
    },
  },
  {
    name: 'cdp_screenshot',
    description: '截取编辑器页面的屏幕截图，返回 Base64 编码的 PNG 图片。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '截取该元素（省略则截全屏）' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
    },
  },
  {
    name: 'cdp_list_tabs',
    description: '列出 CDP 可操控的所有浏览器 tab（含 targetId、URL、标题），用于选择操作目标。',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'CDP 端口，默认 9222' },
      },
    },
  },
  {
    name: 'cdp_mouse_click',
    description: '通过 CDP Input.dispatchMouseEvent 在页面指定坐标处模拟鼠标点击（适用于 canvas/无 DOM 元素的场景）。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '页面 X 坐标' },
        y: { type: 'number', description: '页面 Y 坐标' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'cdp_mouse_move',
    description: '通过 CDP 在页面指定坐标处模拟鼠标移动。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '页面 X 坐标' },
        y: { type: 'number', description: '页面 Y 坐标' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'cdp_key_press',
    description: '通过 CDP 在页面中模拟键盘按键。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '按键名，如 Enter/Escape/ArrowUp/Space' },
        targetId: { type: 'string', description: '目标 tab 的 targetId' },
      },
      required: ['key'],
    },
  },
]

// ─── 辅助：在页面上下文中执行代码 ───

const EVALHelper = `
(function() {
  // 通用选择器 → 元素
  function findEl(sel) {
    if (!sel) return null;
    // text= 前缀：按文本内容查找
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5);
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        if (walk.currentNode.textContent.trim().includes(txt)) return walk.currentNode.parentElement;
      }
      return null;
    }
    // XPath
    if (sel.startsWith('//') || sel.startsWith('./')) {
      const r = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    }
    // CSS 选择器
    return document.querySelector(sel);
  }
  window.__mcp_findEl = findEl;
})()
`

async function injectHelper(ws) {
  await sendCdp(ws, 'Runtime.evaluate', { expression: EVALHelper, returnByValue: true })
}

// ─── 工具处理 ───

function wrapResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function wrapError(msg) {
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: msg }, null, 2) }] }
}

/**
 * 处理 CDP 工具调用
 * @returns {object|null} MCP content result，非 CDP 工具返回 null
 */
export async function handleCdpTool(name, args = {}) {
  const port = args.port || 9222
  const targetId = args.targetId || null

  try {
    switch (name) {
      // ─── Tab 管理 ───
      case 'cdp_list_tabs': {
        const targets = await listTargets(port)
        const tabs = targets.map(t => ({
          id: t.id,
          type: t.type,
          title: t.title,
          url: t.url,
        }))
        return wrapResult({ status: 'ok', tabs, count: tabs.length })
      }

      // ─── DOM 点击 ───
      case 'cdp_click': {
        const conn = await getPageConnection(targetId, port)
        await injectHelper(conn.ws)

        // 计算元素中心坐标
        const evalResult = await sendCdp(conn.ws, 'Runtime.evaluate', {
          expression: `(function() {
            const el = window.__mcp_findEl(${JSON.stringify(args.selector)});
            if (!el) return JSON.stringify({ error: '元素未找到: ' + ${JSON.stringify(args.selector)} });
            const r = el.getBoundingClientRect();
            return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, tag: el.tagName, text: el.textContent?.slice(0,50) });
          })()`,
          returnByValue: true,
        })
        const info = JSON.parse(evalResult.result.value)
        if (info.error) return wrapError(info.error)

        // 模拟鼠标点击
        await sendCdp(conn.ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y })
        await sendCdp(conn.ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 })
        await sendCdp(conn.ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 })

        return wrapResult({ status: 'ok', clicked: { x: info.x, y: info.y, tag: info.tag, text: info.text } })
      }

      // ─── 输入文字 ───
      case 'cdp_type': {
        const conn = await getPageConnection(targetId, port)
        await injectHelper(conn.ws)
        const selector = args.selector || ''
        const text = args.text || ''
        const mode = args.mode || 'fill'

        if (mode === 'press') {
          const key = args.key || ''
          const keyMap = {
            'Enter': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
            'Escape': { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
            'Tab': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
            'Backspace': { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
            'Delete': { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
            'Space': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
            'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
            'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
            'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
            'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
          }
          const ki = keyMap[key] || { key, code: key }
          if (selector) {
            // 先 focus 元素
            await sendCdp(conn.ws, 'Runtime.evaluate', {
              expression: `window.__mcp_findEl(${JSON.stringify(selector)})?.focus()`,
              returnByValue: true,
            })
          }
          await sendCdp(conn.ws, 'Input.dispatchKeyEvent', { ...ki, type: 'keyDown' })
          await sendCdp(conn.ws, 'Input.dispatchKeyEvent', { ...ki, type: 'keyUp' })
          return wrapResult({ status: 'ok', action: 'press', key })
        }

        // 先 focus + 可能清空
        if (selector) {
          await sendCdp(conn.ws, 'Runtime.evaluate', {
            expression: `(function() {
              const el = window.__mcp_findEl(${JSON.stringify(selector)});
              if (!el) return 'not_found';
              el.focus();
              if (${JSON.stringify(mode)} === 'fill') {
                el.value = '';
                el.dispatchEvent(new Event('input', {bubbles: true}));
              }
              return 'ok';
            })()`,
            returnByValue: true,
          })
        }

        // 逐字符输入（对 React/Vue 等框架更兼容）
        for (const char of text) {
          await sendCdp(conn.ws, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            text: char,
            key: char,
            code: `Key${char.toUpperCase()}`,
          })
          await sendCdp(conn.ws, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: char,
            code: `Key${char.toUpperCase()}`,
          })
        }

        return wrapResult({ status: 'ok', action: 'type', text, mode })
      }

      // ─── 读取元素 ───
      case 'cdp_read': {
        const conn = await getPageConnection(targetId, port)
        await injectHelper(conn.ws)
        const selector = args.selector || ''
        const mode = args.mode || 'text'
        const attribute = args.attribute || ''

        let expression
        if (mode === 'value') {
          expression = `(function() {
            const el = window.__mcp_findEl(${JSON.stringify(selector)});
            if (!el) return JSON.stringify({ error: '元素未找到' });
            return JSON.stringify({ value: el.value, tagName: el.tagName });
          })()`
        } else if (mode === 'attr') {
          expression = `(function() {
            const el = window.__mcp_findEl(${JSON.stringify(selector)});
            if (!el) return JSON.stringify({ error: '元素未找到' });
            return JSON.stringify({ attr: ${JSON.stringify(attribute)}, value: el.getAttribute(${JSON.stringify(attribute)}) });
          })()`
        } else {
          expression = `(function() {
            const el = window.__mcp_findEl(${JSON.stringify(selector)});
            if (!el) return JSON.stringify({ error: '元素未找到' });
            return JSON.stringify({ text: el.textContent, innerText: el.innerText, tagName: el.tagName });
          })()`
        }

        const result = await sendCdp(conn.ws, 'Runtime.evaluate', { expression, returnByValue: true })
        const parsed = JSON.parse(result.result.value)
        if (parsed.error) return wrapError(parsed.error)
        return wrapResult({ status: 'ok', ...parsed })
      }

      // ─── 悬停 ───
      case 'cdp_hover': {
        const conn = await getPageConnection(targetId, port)
        await injectHelper(conn.ws)
        const evalResult = await sendCdp(conn.ws, 'Runtime.evaluate', {
          expression: `(function() {
            const el = window.__mcp_findEl(${JSON.stringify(args.selector)});
            if (!el) return JSON.stringify({ error: '元素未找到' });
            const r = el.getBoundingClientRect();
            return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
          })()`,
          returnByValue: true,
        })
        const pos = JSON.parse(evalResult.result.value)
        if (pos.error) return wrapError(pos.error)

        await sendCdp(conn.ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y })
        return wrapResult({ status: 'ok', hovered: { x: pos.x, y: pos.y } })
      }

      // ─── 执行 JS ───
      case 'cdp_evaluate': {
        const conn = await getPageConnection(targetId, port)
        const result = await sendCdp(conn.ws, 'Runtime.evaluate', {
          expression: args.expression || '',
          returnByValue: true,
          awaitPromise: true,
        })
        return wrapResult({ status: 'ok', result: result.result?.value ?? result.result, exceptionDetails: result.exceptionDetails })
      }

      // ─── 导航 ───
      case 'cdp_navigate': {
        const conn = await getPageConnection(targetId, port)
        if (args.url) {
          await sendCdp(conn.ws, 'Page.navigate', { url: args.url })
        } else {
          await sendCdp(conn.ws, 'Page.reload', {})
        }
        return wrapResult({ status: 'ok', url: args.url || '(reload)' })
      }

      // ─── 等待 ───
      case 'cdp_wait': {
        const conn = await getPageConnection(targetId, port)
        await injectHelper(conn.ws)
        const timeout = args.timeoutMs || 5000
        const start = Date.now()

        while (Date.now() - start < timeout) {
          let expression
          if (args.selector) {
            expression = `!!window.__mcp_findEl(${JSON.stringify(args.selector)})`
          } else if (args.text) {
            expression = `document.body.textContent.includes(${JSON.stringify(args.text)})`
          } else {
            return wrapError('需要 selector 或 text 参数')
          }

          const result = await sendCdp(conn.ws, 'Runtime.evaluate', { expression, returnByValue: true })
          if (result.result.value === true) {
            return wrapResult({ status: 'ok', waited: Date.now() - start + 'ms' })
          }
          await new Promise(r => setTimeout(r, 200))
        }
        return wrapError(`等待超时 (${timeout}ms): ${args.selector || args.text}`)
      }

      // ─── 滚动 ───
      case 'cdp_scroll': {
        const conn = await getPageConnection(targetId, port)
        const dy = args.deltaY || 0
        const dx = args.deltaX || 0

        if (args.selector) {
          await injectHelper(conn.ws)
          await sendCdp(conn.ws, 'Runtime.evaluate', {
            expression: `(function() {
              const el = window.__mcp_findEl(${JSON.stringify(args.selector)});
              if (el) el.scrollBy(${dx}, ${dy});
            })()`,
            returnByValue: true,
          })
        } else {
          // 用 Input.dispatchMouseEvent 模拟滚轮
          await sendCdp(conn.ws, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: 500, y: 400,
            deltaX: dx,
            deltaY: dy,
          })
        }
        return wrapResult({ status: 'ok', scrolled: { deltaY: dy, deltaX: dx, selector: args.selector || '(page)' } })
      }

      // ─── 截图 ───
      case 'cdp_screenshot': {
        const conn = await getPageConnection(targetId, port)
        let params = { format: 'png' }

        if (args.selector) {
          await injectHelper(conn.ws)
          const evalResult = await sendCdp(conn.ws, 'Runtime.evaluate', {
            expression: `(function() {
              const el = window.__mcp_findEl(${JSON.stringify(args.selector)});
              if (!el) return JSON.stringify({ error: '元素未找到' });
              const r = el.getBoundingClientRect();
              return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
            })()`,
            returnByValue: true,
          })
          const rect = JSON.parse(evalResult.result.value)
          if (rect.error) return wrapError(rect.error)
          params.clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 }
        }

        const screenshot = await sendCdp(conn.ws, 'Page.captureScreenshot', params)
        return wrapResult({ status: 'ok', data: screenshot.data, encoding: 'base64/png' })
      }

      default:
        return null // 非 CDP 工具
    }
  } catch (err) {
    return wrapError(err.message)
  }
}
