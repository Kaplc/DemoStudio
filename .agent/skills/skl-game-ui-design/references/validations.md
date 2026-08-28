# 游戏 UI 设计 - 校验规则

## 硬编码屏幕位置

### **Id**
hardcoded-screen-position
### **严重级别**
error
### **类型**
regex
### **Pattern**
position:\s*(absolute|fixed)[^}]*(left|right|top|bottom):\s*0(px)?[^}]*(left|right|top|bottom):\s*0(px)?
### **消息**
UI 元素定位在屏幕正角落。可能因过扫描在电视上被裁切。
### **修复方法**
实现安全区边距（5-10%）并允许用户在设置中调整
### **适用于**
  - *.css
  - *.scss
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - position: absolute; left: 0; top: 0;
    - position: fixed; right: 0px; bottom: 0px;
  #### **不应匹配**
    - position: absolute; left: 5%; top: 5%;
    - position: relative; left: 0;

## 字号过小

### **Id**
small-font-size
### **严重级别**
error
### **类型**
regex
### **Pattern**
font-?[Ss]ize[:\s=]+["']?([0-9]|1[0-3])(px|pt|rem)?["']?
### **消息**
字号小于 14px。对游戏 UI 来说太小，尤其是在电视和掌机上。
### **修复方法**
次要文字最小 14px，正文 16-18px，重要信息 24px+
### **适用于**
  - *.css
  - *.scss
  - *.tsx
  - *.jsx
  - *.cs
  - *.gd
### **测试用例**
  #### **应匹配**
    - font-size: 12px
    - fontSize: 10
    - fontSize="11px"
  #### **不应匹配**
    - font-size: 16px
    - fontSize: 24
    - font-size: 14px

## 硬编码按键提示

### **Id**
hardcoded-button-prompt
### **严重级别**
error
### **类型**
regex
### **Pattern**
["'](Press|Hit|Tap|Push)\s+(A|B|X|Y|Start|Select|Space|Enter|LB|RB|LT|RT|L1|R1|L2|R2)["']
### **消息**
硬编码的按键提示。无法适配手柄类型或按键重绑定。
### **修复方法**
使用输入动作名，动态解析为当前绑定/手柄图标
### **适用于**
  - *.cs
  - *.gd
  - *.tsx
  - *.jsx
  - *.json
### **测试用例**
  #### **应匹配**
    - "Press A to continue"
    - 'Hit Space to jump'
    - "Tap X"
  #### **不应匹配**
    - GetActionPrompt("jump")
    - Press {jumpButton} to continue

## 触控目标过小

### **Id**
small-touch-target
### **严重级别**
error
### **类型**
regex
### **Pattern**
(width|height|size)[:\s=]+["']?([0-3][0-9]|[0-9])(px|dp|pt)?["']?(?!\d)
### **消息**
元素小于 44px。对于可靠的触控或手柄选择来说太小。
### **修复方法**
最小触控目标：44x44pt（Apple）、48x48dp（Google）。视觉必须更小时扩大命中区域。
### **适用于**
  - *.css
  - *.scss
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - width: 24px
    - height: 32px
    - size: 16
  #### **不应匹配**
    - width: 48px
    - height: 100px
    - size: 300

## 仅用颜色传达信息

### **Id**
color-only-meaning
### **严重级别**
warning
### **类型**
regex
### **Pattern**
(enemy|hostile|danger|warning|error).*color:\s*(red|#[fF][0-9a-fA-F]{2}[0-9a-fA-F]{2})|color:\s*(red|green).*!(icon|shape|text)
### **消息**
颜色似乎是唯一指示。色盲玩家可能无法区分。
### **修复方法**
为所有颜色编码的信息添加形状、图标或文字后备
### **适用于**
  - *.css
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - enemy: { color: red }
    - color: red; // danger indicator
  #### **不应匹配**
    - enemy: { color: red, icon: skull }

## HUD 文字无阴影/描边

### **Id**
no-text-shadow-outline
### **严重级别**
warning
### **类型**
regex
### **Pattern**
class.*["'].*hud.*["'][^}]*(?!text-shadow|outline|stroke)
### **消息**
HUD 文字元素没有阴影或描边。在多变背景上可能无法阅读。
### **修复方法**
为所有 HUD 文字添加 2px 对比色描边或投影
### **适用于**
  - *.css
  - *.scss

## 缺少手柄导航设置

### **Id**
missing-controller-navigation
### **严重级别**
warning
### **类型**
regex
### **Pattern**
<(button|Button|a)[^>]+(?!.*navigation|.*selectable|.*focusable)[^>]*>
### **消息**
交互元素可能不支持手柄导航。
### **修复方法**
确保元素可聚焦，并显式配置到相邻元素的导航
### **适用于**
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - <button onClick={click}>Submit</button>
  #### **不应匹配**
    - <Button navigation={nav} onClick={click}>Submit</Button>

## 动画时长过长

### **Id**
long-animation-duration
### **严重级别**
warning
### **类型**
regex
### **Pattern**
animation-?[Dd]uration[:\s=]+["']?([5-9][0-9]{2}|[1-9][0-9]{3,})(ms)?["']?|animation-?[Dd]uration[:\s=]+["']?([1-9])(s)["']?
### **消息**
动画超过 500ms。可能引起敏感玩家的动效不适。
### **修复方法**
UI 动画控制在 300ms 以内。设置中提供减少动效选项。
### **适用于**
  - *.css
  - *.scss
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - animation-duration: 1s
    - animationDuration: 800ms
    - animation-duration: 1500
  #### **不应匹配**
    - animation-duration: 200ms
    - animationDuration: 300

## 固定像素尺寸

### **Id**
fixed-pixel-dimensions
### **严重级别**
warning
### **类型**
regex
### **Pattern**
(width|height):\s*[0-9]{3,4}px(?!\s*\/\*.*scale|.*responsive)
### **消息**
大尺寸固定像素。可能无法在不同分辨率下正确缩放。
### **修复方法**
使用百分比、视口单位，或相对参考分辨率缩放
### **适用于**
  - *.css
  - *.scss
### **测试用例**
  #### **应匹配**
    - width: 1920px
    - height: 1080px
  #### **不应匹配**
    - width: 100%
    - height: 50vh

## 过度 Z-Index

### **Id**
z-index-war
### **严重级别**
warning
### **类型**
regex
### **Pattern**
z-?[Ii]ndex[:\s=]+["']?[0-9]{4,}["']?
### **消息**
Z-index 超过 1000。表明分层系统有问题。
### **修复方法**
建立 z-index 刻度：下拉 100、模态 200、提示框 300、通知 400
### **适用于**
  - *.css
  - *.scss
  - *.tsx
  - *.jsx
### **测试用例**
  #### **应匹配**
    - z-index: 9999
    - zIndex: 10000
  #### **不应匹配**
    - z-index: 100
    - zIndex: 500

## 魔法数字定位

### **Id**
magic-number-positions
### **严重级别**
info
### **类型**
regex
### **Pattern**
(margin|padding|top|left|right|bottom):\s*[0-9]{2,}px(?!\s*\/\*)
### **消息**
硬编码的像素位置。考虑使用间距刻度或设计令牌。
### **修复方法**
使用间距刻度（8px、16px、24px、32px）或 CSS 变量保持一致性
### **适用于**
  - *.css
  - *.scss
### **测试用例**
  #### **应匹配**
    - margin: 17px
    - padding-left: 23px
  #### **不应匹配**
    - margin: var(--space-md)
    - padding: 16px

## 缺少悬停状态

### **Id**
missing-hover-state
### **严重级别**
warning
### **类型**
regex
### **Pattern**
<[Bb]utton[^>]*className=["'][^"']*["'][^>]*>(?![^<]*:hover)
### **消息**
按钮没有悬停状态指示。可能让玩家困惑是否可交互。
### **修复方法**
添加带视觉变化的悬停状态（背景、边框、缩放）
### **适用于**
  - *.tsx
  - *.jsx

## 缺少键盘焦点指示

### **Id**
missing-focus-visible
### **严重级别**
warning
### **类型**
regex
### **Pattern**
(outline:\s*none|outline:\s*0)(?![^}]*:focus-visible)
### **消息**
移除了 outline 但没有 focus-visible 替代方案。键盘/手柄用户看不到焦点。
### **修复方法**
添加带可见指示（outline、ring、glow）的 :focus-visible 样式
### **适用于**
  - *.css
  - *.scss
### **测试用例**
  #### **应匹配**
    - outline: none;
    - outline: 0;
  #### **不应匹配**
    - outline: none; } .btn:focus-visible { outline: 2px solid blue; }

## Unity Canvas 无缩放器

### **Id**
unity-canvas-no-scaler
### **严重级别**
warning
### **类型**
regex
### **Pattern**
Canvas[^}]*(?!CanvasScaler|ScaleWithScreenSize)
### **消息**
Unity Canvas 可能没有针对不同分辨率的正确缩放。
### **修复方法**
添加 CanvasScaler，模式设为 Scale With Screen Size，参考 1920x1080
### **适用于**
  - *.cs
  - *.unity

## Godot 控件固定尺寸

### **Id**
godot-control-fixed-size
### **严重级别**
warning
### **类型**
regex
### **Pattern**
custom_minimum_size\s*=\s*Vector2\s*\(\s*[0-9]{3,}
### **消息**
Godot Control 节点上设置了过大的固定最小尺寸。可能无法正确缩放。
### **修复方法**
使用锚点、增长方向和尺寸标志实现响应式 UI
### **适用于**
  - *.tscn
  - *.tres
  - *.gd

## 缺少减少动效检查

### **Id**
no-reduced-motion-check
### **严重级别**
info
### **类型**
regex
### **Pattern**
@keyframes|animation:|transition:[^}]*[5-9][0-9]{2}ms
### **消息**
定义了动画但没有检查 prefers-reduced-motion。
### **修复方法**
添加 @media (prefers-reduced-motion: reduce) 禁用/减少动画
### **适用于**
  - *.css
  - *.scss

## 硬编码分辨率引用

### **Id**
hardcoded-resolution
### **严重级别**
warning
### **类型**
regex
### **Pattern**
(1920|1080|2560|1440|3840|2160)[^0-9].*resolution|screenWidth.*=.*1920|screenHeight.*=.*1080
### **消息**
硬编码的分辨率值。应使用动态屏幕尺寸。
### **修复方法**
使用 Screen.width/height 或带缩放的参考分辨率
### **适用于**
  - *.cs
  - *.gd
  - *.tsx
### **测试用例**
  #### **应匹配**
    - const screenWidth = 1920;
    - if (resolution.x == 1920)
  #### **不应匹配**
    - referenceResolution = new Vector2(1920, 1080);

## 静态按钮文字而非本地化

### **Id**
static-button-text
### **严重级别**
info
### **类型**
regex
### **Pattern**
>["']?(OK|Cancel|Yes|No|Continue|Back|Exit|Quit|Save|Load)["']?<
### **消息**
静态按钮文字。请考虑本地化支持。
### **修复方法**
使用本地化键：GetLocalizedString("ui_ok") 或等价方案
### **适用于**
  - *.tsx
  - *.jsx
  - *.xml

## 提示框无延迟

### **Id**
tooltip-no-delay
### **严重级别**
info
### **类型**
regex
### **Pattern**
(onMouseEnter|onHover|@mouse_entered)[^}]*show.*[Tt]ooltip(?![^}]*delay|setTimeout|timer)
### **消息**
提示框在悬停时立即出现。正常导航中可能闪烁。
### **修复方法**
显示提示框前添加 300-500ms 延迟
### **适用于**
  - *.tsx
  - *.jsx
  - *.cs
  - *.gd

## Unity Find 查找 UI 元素

### **Id**
unity-find-ui-element
### **严重级别**
warning
### **类型**
regex
### **Pattern**
GameObject\.Find\s*\([^)]*("Canvas"|"Button"|"Text"|"Image"|"Panel"|UI)
### **消息**
用 Find 定位 UI 元素。请在 Awake 中缓存引用或使用 SerializeField。
### **修复方法**
使用 [SerializeField] private Button _button; 并在 Inspector 中赋值
### **适用于**
  - *.cs

## Unity UI 未考虑 Raycast

### **Id**
unity-ui-raycast-target
### **严重级别**
info
### **类型**
regex
### **Pattern**
Image[^}]*(?!raycastTarget\s*=\s*false)
### **消息**
Image 组件默认 raycastTarget=true。请在装饰性图片上禁用。
### **修复方法**
在非交互图片上设置 raycastTarget=false 以提升性能
### **适用于**
  - *.cs

## Godot UI 信号发出但未连接

### **Id**
godot-signal-not-connected
### **严重级别**
info
### **类型**
regex
### **Pattern**
\.emit\s*\([^)]*\)(?![^}]*\.connect)
### **消息**
信号被发出但同一文件中看不到连接。请确保信号已连接。
### **修复方法**
在 _ready() 中或通过编辑器连接信号
### **适用于**
  - *.gd