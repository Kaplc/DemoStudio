// 冒烟：按内核方式加载 dist 并注册，验证编译后的参数 schema（LLM 400 type:null 回归）
const mod = await import('../dist/index.js')
const registered = []
const ctx = { tools: { register: t => registered.push(t) }, effect: fn => fn() }
mod.apply(ctx)
console.log('registered:', registered.length)
let fail = 0
for (const t of registered) {
  const p = t.parameters
  const ok = p && p.type === 'object' && typeof p.properties === 'object'
  if (!ok) fail++
  console.log(ok ? 'PASS' : 'FAIL', t.name, '=> root.type =', p?.type, '| required =', JSON.stringify(p?.required ?? []))
}
const { validateArgs } = await import('@deepseek-ai/dsh-tools')
const emit = registered.find(t => t.name === 'emit_ai_event')
// validateArgs 要的是 DSL 参数表（编译前的 properties.map），从编译产物取回
const dslSpec = emit.parameters.properties
console.log('validateArgs ok-case:', JSON.stringify(validateArgs(dslSpec, { event: 'ai.getHUD', payload: {} })))
console.log('validateArgs bad-case(缺 event):', JSON.stringify(validateArgs(dslSpec, { payload: {} })))
process.exit(fail === 0 ? 0 : 1)
