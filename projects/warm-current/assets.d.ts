/**
 * Vite 资产模块声明（warm-current 工程内使用 jpg 资产 URL 导入）
 * SSS 天体贴图（asset/textures/*.jpg）经 import 得到打包后 URL 字符串。
 */
declare module '*.jpg' {
  const src: string
  export default src
}
