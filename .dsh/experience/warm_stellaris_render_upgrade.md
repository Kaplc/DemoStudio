---
name: warm_stellaris_render_upgrade
task_type: feature/rendering
outcome: success
date: 2026-09-12
prefix: src/engine || projects/warm-current || e2e/warm
---
## Summary

（四轮更新）warm 星图对齐《群星》观感：引擎 opt-in EffectComposer + 光照纪律（ambient 0.12/掠射主光/同向补光）+ 4k RGBA 云图柔化管线（灰度×alpha）+ 轴倾角 + 云独立自转（enableTick），共修 5 个根因（bloom 阈值炸白穹 / 点光悬钉扎行星极点 / RGBA alphaMap 全实心 / 俯视正对极轴 / Actor 默认不进 Tick 循环）。

## Lessons

1) EffectComposer 三件套：自定义 RT 必须 HalfFloatType + samples:4；OutputPass 按 renderer.toneMapping 统一 tonemap；UI 叠加在 UICamera.render 里临时置回 NoToneMapping 防二次洗灰。2) 相机委托每帧变 → renderPass.camera 热替换；resize 同步 composer.setSize。3) 灯光：点光别挂会被视图组隐藏的组；行星系视角聚焦行星钉在太阳位 → 点光重定位掠射位 + 功率压低且与定向主光同向（异向双光出双 terminator 互相冲淡）；ambient 低是暗面可读的前提。4) 特写白穹定位法：变量隔离截图（逐个隐藏云/大气/关 bloom）一步定位；根因 = bloom 阈值 0.62 低于受光云亮度 ~0.6 → 阈值只留真高亮源 0.85。bloom 参数与画面内容亮度联动。5) 云图 alphaMap 大坑：RGBA 图（RGB 全白、形状在 alpha）alphaMap 读绿通道=全 255 实心白球；柔化管线密度用 灰度×alpha 乘积通吃两类云图；alphaMap 就绪前隐藏壳防白闪。6) 极区俯视构图：球极轴=世界 Y、俯视相机正对极轴 → 特写永远看极区云带；StarActor root 23° 轴倾角解决。7) 【Actor Tick 大坑】Actor 默认 _bTickEnabled=false 不进 World Tick 循环——组件 Tick（如 CloudLayer 自转）永不执行且无任何告警，"调参数没效果"先查 enableTick；回归锁用 stepTicks 断言 rotation.y/offset 增量 >0。8) 云独立自转语义：本体 spin 1.0，云层 0.35/0.55 才读作独立滑行（1.25/1.5 近同速读作锁定）。9) 海洋 roughnessMap：albedo 蓝主导像素分类派生，粗糙度别低于 0.4。10) 预览视口独立渲染器+无 Tick：游戏侧动态在预览里全看不到，用户拿预览对比先说清。11) headless 开 bloom ~2fps：时序断言按真实 dt 帧放宽。12) playwright CLI --reporter=list 覆盖 json reporter；并行会话未提交改动（tooltip 线）的 vitest 基线红别误修。

## Effective Path

src/engine/rendering/CloudLayerComponent.ts || projects/warm-current/gameplay/map
