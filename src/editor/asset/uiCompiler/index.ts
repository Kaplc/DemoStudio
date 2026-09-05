/**
 * uiCompiler/index — UI 资产 HTML 源格式 统一入口（方案：devdoc/ui-html-source-format）
 *
 * 编译：compileWidgetHtml(html, options?) → widget.json（含 sourceHash + warnings）
 * （完整原生 HTML 映射：级联/继承/静态布局求解；options.resolveInclude 提供外部样式读取）
 * 反编译：decompileWidgetJson(json) → .widget.html（规范形）
 * 产物校验：lintWidgetDoc（assetLint 桥接，零 error 才算编译成功）
 */
export { compileWidgetHtml } from './compile'
export type { CompileResult, CompileError, CompileWarning, CompileOptions } from './compile'
export { decompileWidgetJson } from './decompile'
export type { DecompileResult } from './decompile'
export { patchWidgetHtmlInPlace } from './patch'
export type { PatchResult } from './patch'
export { lintWidgetDoc } from './lintAdapter'
export type { WidgetLintResult } from './lintAdapter'
export { FULLSCREEN_CANVAS_WIDTH, FULLSCREEN_CANVAS_HEIGHT } from './widgetMapping'
