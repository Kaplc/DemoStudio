// earth 蓝图 TS 源（doc-dev/bp-ts-compile 试点迁移；语义等价于原手写 earth.blueprint.json）
// 源码管辖：修改请编辑本文件后执行 bp_compile（npm run bp -- projects/warm-current/asset/blueprints/stars/earth.blueprint.ts）
import { defineBlueprint, comp, transform } from '@/editor/asset/bpCompiler/dsl'
import { STAR_DEFS } from './starDefs'

export default defineBlueprint({
  build: () => {
    const d = STAR_DEFS.earth
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
        ...(d.atmosphere ? [comp('AtmosphereComponent', d.atmosphere)] : []),
        ...(d.clouds ?? []).map((c) => comp('CloudLayerComponent', { ...c })),
      ],
      children: [],
    }
  },
})
