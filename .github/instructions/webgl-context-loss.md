# WebGL 上下文丢失处理规范（所有 renderer 必须遵守）

## 背景
编辑器有 5 个独立的 THREE.WebGLRenderer：
- `src/editor/UIPreviewManager.ts`（widget 预览）
- `src/editor/BlueprintPreviewManager.ts`（蓝图预览）
- `src/editor/ScenePreviewManager.ts`（场景预览）
- `src/engine/scene/GameSceneManager.ts`（Game 视口）
- `src/engine/scene/PreviewSceneManager.ts`（Scene 视口）

浏览器 GPU 重置/内存不足时会丢失 WebGL 上下文，此时对失效上下文调用
`renderer.render()` 会触发 `texSubImage2D: Can't upload a texture from a lost WebGL context` 报错。

## 标准处理模式（5 个类都已实现，新增 renderer 必须照抄）
1. 字段：`contextLost`、`_onContextLost`、`_onContextRestored`
2. 构造：`webglcontextlost` → `preventDefault()` + `contextLost=true` + `stop()`；
   `webglcontextrestored` → `restoreAllTextures()` + `contextLost=false` + `start()`
3. 渲染循环：`if (this.contextLost) { 继续 rAF; return }` 跳过渲染
4. `restoreAllTextures()`：遍历场景材质把 `needsUpdate=true` 强制重传纹理
5. `dispose()`：移除事件监听再 `forceContextLoss() + dispose()`

## 测试方法
浏览器控制台：
```js
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
gl.getExtension('WEBGL_lose_context').loseContext()
```
触发后应看到 `[Xxx] WebGL 上下文丢失，已暂停渲染` 日志且无 texSubImage2D 报错。
