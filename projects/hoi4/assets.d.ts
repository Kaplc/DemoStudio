/**
 * Vite 资产模块声明（hoi4 工程内使用 png 资产 URL 导入）
 */
declare module '*.png' {
  const src: string
  export default src
}
