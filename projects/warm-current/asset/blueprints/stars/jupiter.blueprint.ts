// jupiter 蓝图 TS 源（doc-dev/bp-ts-compile 试点迁移；语义等价于原手写 jupiter.blueprint.json）
import { defineBlueprint, comp, transform } from '@/editor/asset/bpCompiler/dsl'
import { STAR_DEFS } from './starDefs'

export default defineBlueprint({
  build: () => {
    const d = STAR_DEFS.jupiter
    return {
      name: d.actorName,
      baseClass: d.actorClass,
      components: [
        transform([0, 0, 0]),
        comp('SphereMeshComponent', {
          radius: d.radius,
          segments: d.segments,
          color: d.color,
          texture: d.texture,
          name: d.meshName,
          ...d.meshExtras,
        }),
      ],
      children: [],
    }
  },
})
