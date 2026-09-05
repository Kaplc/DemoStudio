// 临时验证脚本：检查资产 JSON 合法 + 无 MeshComponent 残留（用后即删）
const fs = require('fs')
const files = [
  'src/projects/demo2d/demo2d.scene.json',
  'src/projects/fish/asset/blueprints/beach_house_parts.scene.json',
  'src/projects/fish/asset/blueprints/beach_house.blueprint.json',
  'src/projects/fish/asset/blueprints/foundation.blueprint.json',
  'src/projects/fish/asset/fish_level1.scene.json',
  'src/projects/fish/asset/fish_level2.scene.json',
  'src/projects/fish/asset/fish_level3.scene.json',
  'src/projects/fish/asset/fish.scene.json',
]
let bad = 0
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  if (s.charCodeAt(0) === 0xfeff) { console.log('BOM', f); bad++; continue }
  try {
    JSON.parse(s)
    if (s.includes('"MeshComponent"')) { console.log('MeshComponent残留', f); bad++ }
    else console.log('OK', f)
  } catch (e) { console.log('FAIL', f, e.message); bad++ }
}
console.log(bad === 0 ? 'ALL OK' : 'ERRORS: ' + bad)
