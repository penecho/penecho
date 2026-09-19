import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContent, styles } from '../../../src/architecture/render.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
function diagram(name) {
  const layout = JSON.parse(fs.readFileSync(path.join(dir, `${name}.layout.json`)));
  const content = renderContent(layout, `compare-${name}`)
    .replace(/<nav\b[\s\S]*?<\/nav>/g, '')
    .replaceAll('tabindex="0" role="button"', 'role="img"')
    .replaceAll('cursor:pointer;color:', 'color:');
  return `<section data-routing-map style="--pa-map-width:${layout.width}px;--pa-map-min:${Math.ceil(layout.width * .9)}px">${content}</section>`;
}
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PenEcho 架构图 · 连线路径对照</title>
<style>${styles.replaceAll('data-penecho-architecture', 'data-routing-map')}
body{margin:0;padding:24px;background:#f7f8fa;color:#243246;font:15px/1.65 system-ui,sans-serif}
main{max-width:1500px;margin:auto}h1{font-size:25px;margin:0 0 8px}p{margin:8px 0 18px}table{border-collapse:collapse;width:100%;margin:18px 0 24px}th,td{text-align:left;border-bottom:1px solid #dce2ea;padding:10px}summary{cursor:pointer;font-weight:650;padding:16px 0}details{margin-top:12px}.pa-tools{display:none!important}
</style></head><body><main>
<h1>连线绕远，来自折行布局</h1>
<p>同一份 JSON：18 个节点、21 条边、6 个分组。下方是正式布局器输出的实验对照，未修改原画布。实验采用同一套文字测量；实际浏览器的具体尺寸会有差异。</p>
<table><thead><tr><th>方案</th><th>连线总长</th><th>拐点</th><th>布局宽 × 高</th></tr></thead><tbody>
<tr><td>当前自动策略（可用宽 1450）</td><td>39,492</td><td>144</td><td>1709 × 2068</td></tr>
<tr><td>纵向布局 + 标题预留空间</td><td>16,614（−58%）</td><td>42（−71%）</td><td>2023 × 1858</td></tr>
</tbody></table>
<p>代价是图更宽约 18%，仍可在图内横向滚动。纵向方案保留所有关系；实验只把分组标题预留高度增至 96，以避免标题与连线碰撞。它是修复方向验证，尚未写入正式布局规则。</p>
<details open><summary>实验：纵向布局，主链路从上向下</summary>${diagram('down-clear-title')}</details>
<details><summary>对照：当前自动策略，横向折行</summary>${diagram('auto-1450')}</details>
</main></body></html>`;
fs.writeFileSync(path.join(dir, 'comparison.html'), html);
console.log(JSON.stringify({ file: path.join(dir, 'comparison.html'), bytes: Buffer.byteLength(html) }));
