/**
 * planetNames — 星图天体中文名共享表
 *
 * （2026-09-20 自 WarmCurrentGameMode 提取为共享模块：视图/命中/VM 等多处组件
 *  都要展示天体名，原 GameMode 私有常量改为模块级共享，避免组件反向依赖 GameMode。）
 * 资源星名走 stars 表，表外天体此处兜底；月球/木卫二/火星以表为准。
 */
export const PLANET_NAMES: Record<string, string> = {
  earth: '地球', mercury: '水星', venus: '金星',
  jupiter: '木星', saturn: '土星', uranus: '天王星', neptune: '海王星',
}
