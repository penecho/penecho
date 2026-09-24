"use strict";

// Browser acceptance fixtures. Import through the normal Canvas Library API;
// the widgets exercise the shipped host and parent, without browser injection.
const page = (style, body, script = "") => `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#243246;font:18px/1.7 system-ui}main{padding:24px}h1{font-size:28px;margin:0 0 16px}button,input{font:inherit;padding:8px 12px}button{cursor:pointer}footer{padding:24px;background:#d8eee4} ${style}</style>${body}${script ? `<script>${script}</script>` : ""}</html>`;
const scenarios = [
  {
    name: "验收 1 · 正常长文档与异步内容",
    html: page("article{height:2400px;background:linear-gradient(#e1e8f1,#f7f8fa)}#extra{background:#eadff5}",
      '<main><h1>正常长文档 · 高度与内容保持一致</h1><button id="grow">延迟添加 600px 内容</button> <button id="shrink">移除新增内容</button><p>输入状态：<input aria-label="测试输入" value="保持这段输入"></p><article>正文开始 · 向下滚动验证末尾</article><div id="extra"></div></main><footer id="end">文档末尾 · 应能完整滚动到这里</footer>',
      'document.getElementById("grow").onclick=()=>setTimeout(()=>{const extra=document.getElementById("extra");extra.style.height="600px";extra.textContent="异步内容已加载 · 新增 600px"},300);document.getElementById("shrink").onclick=()=>{const extra=document.getElementById("extra");extra.style.height="0";extra.textContent=""}'),
  },
  {
    name: "验收 2 · 嵌套滚动与输入控件",
    html: page(".panel{height:420px;overflow:auto;border:1px solid #bbc5d1}.content{height:1800px;background:linear-gradient(#e3edf7,#fff)}textarea{width:100%;height:90px;font:inherit}",
      '<main><h1>嵌套滚动区</h1><textarea aria-label="独立输入滚动区">第一行\n第二行\n第三行\n第四行\n第五行\n第六行</textarea><section class="panel"><div class="content">正常最大化时展开内容区，输入控件保留自己的滚动。</div><footer id="end">嵌套内容末尾</footer></section></main>'),
  },
  {
    name: "验收 3 · 高度循环增长",
    html: page("#extent{position:absolute;left:0;top:0;width:100%;height:200vh;background:linear-gradient(#e4eaf3,#e4f2e9);z-index:-1}footer{position:absolute;top:calc(200vh - 90px);left:0;right:0}",
      '<div id="extent"></div><main><h1>高度循环测试 · 200vh</h1><p>恢复原始布局后，iframe 应保持 600px，内部可以滚动至末尾。</p><input aria-label="循环测试输入" value="交互状态应保留"></main><footer id="end">循环样例末尾 · 原始内部滚动可达</footer>'),
  },
  {
    name: "验收 4 · 宽高同时循环增长",
    html: page("#extent{position:absolute;left:0;top:0;width:200vw;height:200vh;background:linear-gradient(120deg,#e4eaf3,#e4f2e9);z-index:-1}footer{position:absolute;top:calc(200vh - 90px);left:0}",
      '<div id="extent"></div><main><h1>宽高循环测试 · 200vw × 200vh</h1><p>恢复原始布局后，iframe 应保持 900 × 600，滚动由 widget 自己处理。</p></main><footer id="end">宽高循环样例末尾</footer>'),
  },
];

function snapshot(name, widget, index = 0) {
  const now = Date.now();
  return {version:1,id:`${now}-height-browser-${index}`,createdAt:now,updatedAt:now,name,theme:"studio",
    view:{scale:1,panX:-9600,panY:-9600,navigationLocked:false,region:{x:9600,y:9600,w:1200,h:800}},
    animations:[],textBoxes:[],images:[],tiles:[],
    preview:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    widgets:[{id:"widget-1",pluginId:"general",widgetType:"html_widget",refreshSeconds:0,title:name,x:9700,y:9680,w:900,h:600,contentW:900,contentH:600,...widget}]};
}
module.exports = {scenarios,snapshot};
