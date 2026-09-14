import { compileWidgetHtml } from '../src/editor/asset/uiCompiler/index'
const bb = compileWidgetHtml(`<widget name="BB" canvas="800x600"><style>
    .grid { width: 530px; height: 208px; display: flex; flex-direction: row; flex-wrap: wrap; gap: 14px; }
    .cell { width: 258px; height: 60px; box-sizing: border-box; padding: 0px 12px; border: 1px solid #235066; background-color: #0d2434; }
  </style><div class="grid"><div class="cell"><text>a</text></div><div class="cell"><text>b</text></div></div></widget>`)
const find = (n: any, name: string): any => {
  if (n.name === name) return n
  for (const c of n.children ?? []) { const r = find(c, name); if (r) return r }
  return null
}
const g = find((bb as any).doc, 'grid')
console.log(JSON.stringify(g, null, 1).slice(0, 3000))
