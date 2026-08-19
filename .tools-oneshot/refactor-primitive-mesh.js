// 一次性脚本：把 .blueprint.json / .scene.json 中
//   { "baseClass": "PrimitiveMeshComponent", "properties": { "geometry": "box|sphere|plane", ... } }
// 替换为对应的 BoxMeshComponent / SphereMeshComponent / PlaneMeshComponent
// 同时移除 properties.geometry（已被 baseClass 取代）。

const fs = require('fs')
const path = require('path')

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue
    const p = path.join(dir, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (f.endsWith('.json')) out.push(p)
  }
  return out
}

const root = process.argv[2] || '.'
const files = walk(root).filter((f) => fs.readFileSync(f, 'utf8').includes('PrimitiveMeshComponent'))
console.log('affected:', files.length)

const geoToClass = { box: 'BoxMeshComponent', sphere: 'SphereMeshComponent', plane: 'PlaneMeshComponent' }

let totalReplaced = 0
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8')
  // 匹配一个独立组件对象:
  //   {
  //     "baseClass": "PrimitiveMeshComponent",
  //     ...properties...  // 包含 "geometry": "<type>"
  //   }
  // 用正则——简单粗暴、JSON 结构稳定（BlueprintComponentDef）
  const re = /\{\s*"baseClass":\s*"PrimitiveMeshComponent",\s*"properties":\s*\{\s*"geometry":\s*"(box|sphere|plane)"([\s\S]*?)\}\s*\}/g
  const newContent = raw.replace(re, (m, geoType, rest) => {
    const cls = geoToClass[geoType]
    totalReplaced++
    return `{\n            "baseClass": "${cls}",\n            "properties": {${rest}\n            }\n          }`
  })
  if (newContent !== raw) {
    fs.writeFileSync(f, newContent, 'utf8')
    console.log('updated:', f)
  }
}
console.log('total replaced:', totalReplaced)
