// Synthetic examples and pre-rendered exports for older Canvas builds.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {layoutSequence} from '../../../src/sequence/layout.mjs';
import {renderContent,styles} from '../../../src/sequence/render.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const fixtures={
  payment:{version:1,title:'支付授权与重试',description:'合成业务示例 · 正常支付与失败分支；loop 片段表达重试范围。',
    domains:[{id:'user',label:'用户端',color:'blue'},{id:'service',label:'业务服务',color:'orange'},{id:'bank',label:'外部支付',color:'purple'}],
    participants:[{id:'app',label:'收银台',subtitle:'用户确认支付',domain:'user',type:'frontend'},{id:'order',label:'订单服务',subtitle:'校验与订单状态',domain:'service'},{id:'pay',label:'支付网关',subtitle:'幂等与重试控制',domain:'service'},{id:'bank',label:'银行授权服务',subtitle:'外部授权接口',domain:'bank',type:'external'}],
    messages:[{id:'submit',from:'app',to:'order',label:'提交订单与幂等键'},{id:'verify',from:'order',to:'order',label:'校验金额与订单状态'},{id:'charge',from:'order',to:'pay',label:'请求支付授权'},{id:'auth',from:'pay',to:'bank',label:'提交授权请求'},{id:'retry',from:'bank',to:'pay',label:'暂时不可用 / 恢复后成功',kind:'return',note:'最多 3 次；成功后提前结束循环。'},{id:'ok',from:'pay',to:'order',label:'授权成功',kind:'return'},{id:'confirmed',from:'order',to:'app',label:'订单已支付',kind:'return'},{id:'fail',from:'pay',to:'order',label:'授权失败',kind:'return'},{id:'failed',from:'order',to:'app',label:'提示重新选择支付方式',kind:'return'}],
    fragments:[{kind:'loop',label:'暂时不可用时重试，最多 3 次',from:'auth',to:'retry'},{kind:'alt',label:'授权成功',from:'ok',to:'failed',branches:[{from:'fail',label:'授权失败'}]}],
    activations:[{participant:'order',from:'submit',to:'failed'},{participant:'pay',from:'charge',to:'fail'}],
    details:[{title:'用户端',domain:'user',items:['同一笔支付复用幂等键，避免重复下单。']},{title:'业务服务',domain:'service',items:['自调用表示内部校验；虚线表示返回。','alt 的两个分支互斥，不表示先成功再失败。']},{title:'外部支付',domain:'bank',items:['示意性重试策略，不代表任何真实银行接口规范。']}],
    notes:['合成示例。时序图按逻辑先后阅读，垂直距离不代表耗时。']},
  async:{version:1,title:'异步报告生成',description:'合成业务示例 · 提交后立即返回，后台分支独立执行，再汇合通知。',
    domains:[{id:'client',label:'用户端',color:'blue'},{id:'api',label:'应用服务',color:'teal'},{id:'background',label:'后台任务',color:'purple'},{id:'data',label:'数据存储',color:'green'}],
    participants:[{id:'client',label:'分析工作台',domain:'client',type:'frontend'},{id:'api',label:'报告 API',domain:'api'},{id:'queue',label:'任务队列',domain:'background',type:'messagebus'},{id:'worker',label:'报告生成器',domain:'background'},{id:'store',label:'对象存储与通知',domain:'data',type:'database'}],
    messages:[{id:'submit',from:'client',to:'api',label:'提交报告生成请求'},{id:'publish',from:'api',to:'queue',label:'发布任务',kind:'async'},{id:'accepted',from:'api',to:'client',label:'202 Accepted · 任务 ID',kind:'return'},{id:'dispatch',from:'queue',to:'worker',label:'分派任务',kind:'async'},{id:'compute',from:'worker',to:'worker',label:'汇总统计数据'},{id:'assets',from:'worker',to:'store',label:'读取报告素材'},{id:'read',from:'store',to:'worker',label:'返回素材',kind:'return'},{id:'save',from:'worker',to:'store',label:'合并内容并保存报告'},{id:'saved',from:'store',to:'worker',label:'报告 URL',kind:'return'},{id:'notify',from:'worker',to:'api',label:'发送完成事件',kind:'async'},{id:'deliver',from:'api',to:'client',label:'推送报告就绪通知',kind:'async'}],
    fragments:[{kind:'par',label:'计算分支',from:'compute',to:'read',branches:[{from:'assets',label:'素材分支（与计算并行）'}]}],
    activations:[{participant:'worker',from:'dispatch',to:'notify'}],
    details:[{title:'用户端',domain:'client',items:['提交后即可继续操作；任务完成后收到通知。']},{title:'应用服务',domain:'api',items:['任务接收与最终完成是两个不同事件。']},{title:'后台任务',domain:'background',items:['空心箭头表示异步消息；par 中的分支可并行执行。']},{title:'数据存储',domain:'data',items:['只有所需分支全部完成后，才合并和保存报告。']}],
    notes:['合成示例。par 内上下排列的是并行分支，不代表分支之间的执行先后。']}
};
for (const [name,data] of Object.entries(fixtures)) fs.writeFileSync(path.join(dir,`${name}.semantic.json`),JSON.stringify(data,null,2)+'\n');
const interactions=(await build({stdin:{contents:"import {bindInteractions} from './src/architecture/interactions.mjs'; for(const root of document.querySelectorAll('[data-penecho-sequence]'))bindInteractions(root,JSON.parse(root.querySelector('script[type=\"application/json\"]').textContent));",resolveDir:process.cwd()},bundle:true,format:'iife',platform:'browser',minify:true,write:false})).outputFiles[0].text;
for (const name of ['mcp','payment','async']) {
  const data=JSON.parse(fs.readFileSync(path.join(dir,`${name}.semantic.json`)));
  const layout=layoutSequence(data,undefined,{width:1230});
  const json=JSON.stringify(data).replaceAll('<','\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#f5f7fa;font-family:Arial,sans-serif}body{padding:16px}${styles}</style></head><body><section data-penecho-sequence style="--pa-map-width:${layout.width}px;--pa-map-min:${layout.width}px"><script type="application/json" data-preview-source>${json}</script>${renderContent(layout,`sequence-${name}`)}</section><script>${interactions}</script></body></html>`;
  fs.writeFileSync(path.join(dir,`${name}.preview.html`),html);
  console.log(name,JSON.stringify({width:layout.width,height:layout.height,layoutMs:+layout.layoutMs.toFixed(2),jsonBytes:Buffer.byteLength(json),htmlBytes:Buffer.byteLength(html)}));
}
