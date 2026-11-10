'use strict';
const { snapshot, scenarios } = require('./widget-presentation.cjs');
const { workflowHtml } = require('../../src/workflow/schema.js');
const { architectureHtml } = require('../../src/architecture/schema.js');
const workflow = require('./diagrams/workflow/wf-07-onboarding-groups.json');
const html = `<!doctype html><html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;font:18px/1.6 system-ui}
main{padding:24px}h1{font-size:28px;margin:0 0 16px}.fixed{width:320px;height:1100px;border:1px solid #9aa;background:#eef6f4;position:relative}
.anchor{position:absolute;top:700px;left:20px}input,button{font:inherit}footer{padding:24px;background:#dae8f5}
</style><main><h1>字号不变 · 原始高度 1100</h1><input aria-label="保留输入" value="输入保持"><p>窄内容保持 320px，多出来的宽度留白。</p><section class="fixed"><span class="anchor">固定坐标 y = 700px</span></section></main><footer>固定页面末尾</footer></html>`;
function fixtures() {
 const fixed=snapshot('原生视口 · 高度1100', {html,contentW:900,contentH:1100,h:1100},101);
 const scaled=snapshot('原生视口 · 入场75%', {html,contentW:1200,contentH:1100,w:900,h:825},102);
 const chart=snapshot('原生视口 · 长流程图', {html:workflowHtml(workflow),contentW:1200,contentH:1600,w:1200,h:1600},103);
 const architecture=snapshot('滚动验收 · 架构图',{html:architectureHtml(require('./diagrams/architecture/mcp.json')),contentW:1200,contentH:1100,w:1200,h:1100},104);
 const bodyScroll=snapshot('滚动验收 · Body 页面滚动',{html:html.replace('main{padding:24px}','html,body{height:100%}body{overflow:auto}main{padding:24px}'),contentW:900,contentH:1100,w:900,h:1100},105);
 return [fixed,scaled,chart,architecture,bodyScroll,...scenarios.map((s,i)=>snapshot(s.name,{...s,...(s.contentH?{w:s.contentW,h:s.contentH}:{})},110+i))];
}
module.exports={fixtures};
