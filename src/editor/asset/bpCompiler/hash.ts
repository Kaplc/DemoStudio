/**
 * hash — 蓝图 TS 源内容指纹（sourceHash）
 *
 * 实现复用 uiCompiler 的 fnv1a（加 export 复用，不复制）：
 * 与 widget 产物同格式同值（`fnv1a-xxxxxxxx`），
 * 编辑器/运行时据此判定"编译产物、源码管辖"（doc-dev/bp-ts-compile 方案 §8）。
 */
export { fnv1a as sourceHashOf } from '../uiCompiler/compile'
