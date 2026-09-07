/**
 * Vite 资产模块声明（hoi4 工程内使用 png 资产 URL 导入）
 */
declare module '*.png' {
  const src: string
  export default src
}

/** map.geo.json 经 ?url 导入（4.9MB，禁用 resolveJsonModule 字面量推断） */
declare module '*.geo.json?url' {
  const src: string
  export default src
}
