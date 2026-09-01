/**
 * ua — 浏览器 UA 默认样式表移植（CSS Cascading and Inheritance 的 origin=0 层）
 *
 * 让原生 HTML 标签按浏览器直觉渲染：<h1> 大字加粗、<p>/<ul> 有边距、
 * <b>/<strong> 加粗、<i>/<em> 斜体、<small> 缩小、<li> 带标记等。
 * 作者样式表（origin=1）与 inline style 按级联规则覆盖此处默认值。
 *
 * 与浏览器的偏差（有意为之，见 devdoc 完整映射文档 §偏差）：
 *  - body margin 8px 保留（忠实浏览器）；widget 自绘根不经过 body 不受影响
 *  - 字体族不设 monospace（引擎无等宽字体资源，code/pre 用默认字体 + 警告）
 */
export const UA_STYLESHEET = `
html, body {
  display: block;
}
body {
  margin: 8px;
}
div, p, section, article, header, footer, main, nav, aside, figure, figcaption,
address, blockquote, dd, dl, dt, fieldset, form, h1, h2, h3, h4, h5, h6,
hr, ol, ul, li, table, thead, tbody, tfoot, tr, td, th, caption, pre {
  display: block;
}
span, a, b, strong, i, em, u, s, small, mark, code, kbd, samp, cite, q,
dfn, abbr, time, var, del, ins, sub, sup, label, output, big {
  display: inline;
}
h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; }
h2 { font-size: 1.5em; font-weight: bold; margin: 0.75em 0; }
h3 { font-size: 1.17em; font-weight: bold; margin: 0.83em 0; }
h4 { font-size: 1em; font-weight: bold; margin: 1.12em 0; }
h5 { font-size: 0.83em; font-weight: bold; margin: 1.5em 0; }
h6 { font-size: 0.67em; font-weight: bold; margin: 1.67em 0; }
p { margin: 1em 0; }
blockquote { margin: 1em 40px; }
ul, ol { margin: 1em 0; padding-left: 40px; }
li { display: list-item; }
dd { margin-left: 40px; }
dl { margin: 1em 0; }
figure { margin: 1em 40px; }
pre { margin: 1em 0; white-space: pre; font-size: 0.92em; }
hr {
  display: block;
  margin: 0.5em auto;
  border: 1px inset #808080;
  height: 0;
}
b, strong { font-weight: bold; }
i, em, cite, var, dfn { font-style: italic; }
small { font-size: 0.83em; }
big { font-size: 1.17em; }
s, del, strike { text-decoration: line-through; }
u, ins { text-decoration: underline; }
sub { font-size: 0.83em; }
sup { font-size: 0.83em; }
code, kbd, samp { font-size: 0.92em; }
mark { background-color: #ffff00; }
a { color: #0000ee; }
table { margin: 1em 0; }
caption { text-align: center; }
th { font-weight: bold; text-align: center; }
button, input, textarea, select {
  font-size: 13.33px;
}
button {
  display: inline-block;
  text-align: center;
}
center { display: block; text-align: center; }
`
