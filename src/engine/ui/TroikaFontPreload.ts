/**
 * TroikaFontPreload — troika 字体预热（编辑器启动即触发，早于工程选择）
 *
 * 首个含文本的 UI 面板打开时，troika 走完整冷启动链路：
 * worker 首次创建 → 思源黑体 woff（~1.5MB/个）XHR 下载 → Typr 解析 → 逐字形 SDF 生成，
 * 表现为第一个面板的文字明显延迟出现。troika 在 worker 内按"字体绝对 URL"缓存解析结果
 * （parsedFonts），字形 SDF 缓存在共享图集（glyphsByFont）——官方 preloadFont API 走与
 * Text.sync() 同一条 getTextRenderInfo 链路，预热后首个面板的 sync() 直接命中缓存。
 *
 * ⚠️ 缓存键 = 字体绝对 URL：预热与 UITextComponent 必须共用同一个 resolveTroikaFontURL，
 * 两处各写一份 URL 推导会让预热静默失效。
 */
import { configureTextBuilder, preloadFont } from 'troika-three-text'
// 思源黑体（简体中文子集）——troika 只接受字体文件 URL，且不支持 woff2（用 woff）
import notoSansSC400Url from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff?url'
import notoSansSC700Url from '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff?url'

/**
 * 解析 troika 字体 URL：
 *  - fontFamily 为 URL（http/https/data:/blob:/绝对路径）→ 直接用
 *  - 否则（CSS 字体名 / 未设置）→ 用内置思源黑体（支持中文；bold 用 700 变体）
 * troika 的 font 属性只接受字体文件 URL（XHR 加载），不支持 CSS font-family 名。
 */
export function resolveTroikaFontURL(family: string | undefined, bold: boolean): string {
  if (family && /^(https?:|data:|blob:|\/)/.test(family)) return family
  return bold ? notoSansSC700Url : notoSansSC400Url
}

/**
 * 预热字符集：ASCII 可打印区 + UI 面板常用汉字。
 * 字形 SDF 逐个生成进共享图集，冷启动时逐字形开销累积可观；这里把高频字形提前生成，
 * 与字体解析缓存一起让首个面板近乎即时渲染。字符集不求全覆盖（生僻字仍会按需生成）。
 */
const WARMUP_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '确认取消开始暂停设置返回保存删除关闭新建打开项目场景游戏运行停止输入完成是与否全部搜索' +
  '等级经验金币生命魔法攻击防御速度力量敏捷智力体力金钱购买出售使用装备技能任务地图菜单' +
  '状态系统帮助警告错误成功失败提示信息欢迎你好玩家名称分数时间目标结果胜利第一二三四五六' +
  '七八九十百千万年月日时分秒当前最高最低平均队伍物品战斗加载存档新继续上下一步左右大小'

let started = false

/**
 * 异步预热 troika 字体（fire-and-forget，幂等）。
 * 在 App 启动（loading 阶段、未选择工程）调用一次即可；不阻塞启动流程。
 */
export function preloadTroikaFonts(): void {
  if (started) return
  started = true

  // unicode fallback 数据走本地缓存代理（vite.config 的 /__unicode_fonts 中间件，
  // 首次从 CDN 下载后永久本地）。必须首个字体请求前设置，之后调用会被 troika 忽略；
  // UIText 自身也在实例上设了同一 URL，此处兜底预热路径的 fallback 请求同样命中代理。
  configureTextBuilder({ unicodeFontsURL: `${location.origin}/__unicode_fonts` })

  for (const font of [notoSansSC400Url, notoSansSC700Url]) {
    const weight = font === notoSansSC700Url ? 700 : 400
    const t0 = performance.now()
    preloadFont({ font, characters: WARMUP_CHARS }, () => {
      console.debug(`[TroikaFontPreload] 思源黑体 ${weight} 预热完成（${Math.round(performance.now() - t0)}ms）`)
    })
  }
}
