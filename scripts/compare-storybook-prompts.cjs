'use strict';
// Replay a recorded illustration through its original hosted model, then render
// the untouched returned HTML. Credentials remain in memory and are never saved.
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('=');
  return [value.slice(2, index), value.slice(index + 1)];
}));
const tracePath = path.resolve(args.trace), output = path.resolve(args.output);
const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
const prompts = JSON.parse(fs.readFileSync(args.prompts, 'utf8'));
const variant = args.variant;
let policy = prompts[variant];
if (variant === 'canonical') {
  const vm = require('node:vm'), source = fs.readFileSync(path.resolve(__dirname, '../src/server/main.js'), 'utf8');
  const map = source.match(/const SUGGESTION_FOCUS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  policy = vm.runInNewContext(`(${map[1]})`, {
    FINISH_DRAWING:require('../src/shared/finish-drawing.js'),
    SKETCH_PUPPET:require('../src/shared/sketch-puppet.js'),
    NOTE_CARD:require('../public/note-card.js'),
  }).vivid[1];
}
if (!policy) throw new Error('Unknown comparison variant.');
fs.mkdirSync(output, { recursive:true });

async function main() {
  const original = trace.attempts[0].outbound, body = structuredClone(original.body);
  const account = JSON.parse(fs.readFileSync(args.session, 'utf8'));
  const endpoint = new URL(original.endpoint);
  if (endpoint.origin !== account.origin || !account.accountToken) throw new Error('Replay must use the original signed-in destination.');
  const inputImage = args.image ? path.resolve(args.image) : path.join(path.dirname(tracePath), trace.image.file);
  const metadata = await sharp(inputImage).metadata();
  const imageBytes = await sharp(inputImage).png().toBuffer();
  fs.writeFileSync(path.join(output, 'input.png'), imageBytes);
  const wrapper = 'Return exactly one html_widget command with pluginId general, containing a complete responsive HTML document and one inline SVG illustration. Keep html and body transparent; the requested scene background belongs inside the illustration. No visible text, labels, cards, borders, controls, animation, external assets or network requests. Place the new illustration in nearby free space without changing or covering the source. Choose a balanced panel aspect ratio with room for the background; do not inherit an excessively narrow source crop as the scene aspect ratio.';
  for (const message of body.messages) for (const content of message.content || []) {
    if (content.type === 'image') content.source = { type:'base64', media_type:'image/png', data:imageBytes.toString('base64') };
    if (content.type === 'text') {
      const input = JSON.parse(content.text);
      input.actionMeaning = variant === 'canonical'
        ? `${trace.modelInput.actionMeaning.split(' Suggestion chosen by the user: ')[0]} Suggestion chosen by the user: ${policy}`
        : `${policy} ${wrapper}`;
      if (args.image) {
        input.imageSize = { w:metadata.width, h:metadata.height };
        input.sourceRect = { x:1000, y:1000, w:metadata.width, h:metadata.height };
        input.captureRect = { ...input.sourceRect };
        input.visibleRect = { x:500, y:500, w:3000, h:2200 };
        input.latestInput = { globalRect:{ ...input.sourceRect }, imageRect:{ x:0, y:0, w:metadata.width, h:metadata.height } };
        input.imageScale = 1;
        input.hotspotGrid = { columns:8, rows:8, order:'oldest-to-newest', hotspots:[] };
        input.widgetGeometry = { minW:120, minH:120, maxW:1500, maxH:1100 };
        input.focusInset = null; input.selectionContext = null; input.typedInput = null;
      }
      content.text = JSON.stringify(input);
    }
  }
  body.stream = false;
  const started = Date.now();
  console.log(JSON.stringify({ variant, phase:'requesting', model:body.model }));
  const response = await fetch(endpoint, {
    method:'POST', signal:AbortSignal.timeout(240000),
    headers:{ 'content-type':'application/json', 'anthropic-version':'2023-06-01', 'x-api-key':account.accountToken, authorization:`Bearer ${account.accountToken}` },
    body:JSON.stringify(body),
  });
  const provider = await response.json();
  if (!response.ok) throw new Error(`Hosted replay failed: HTTP ${response.status}; ${JSON.stringify(provider).slice(0,250)}`);
  const text = (provider.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  fs.writeFileSync(path.join(output, 'raw-response.txt'), text);
  const result = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  const commands = result.commands || [], command = commands.find(item => item.tool === 'html_widget' && item.html);
  if (!command || commands.length !== 1) throw new Error('Replay did not return exactly one HTML illustration.');
  fs.writeFileSync(path.join(output, 'illustration.html'), command.html);
  const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ headless:true });
  const errors = [], blockedResources = [];
  try {
    const page = await browser.newPage({ viewport:{ width:720, height:540 }, deviceScaleFactor:1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { blockedResources.push(route.request().url()); return route.abort(); });
    await page.setContent(command.html, { waitUntil:'load' });
    await page.screenshot({ path:path.join(output, 'render-720.png') });
    const rendered = await page.evaluate(() => ({ svg:document.querySelectorAll('svg').length, visibleText:document.body.innerText.trim(), width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight }));
    await page.setViewportSize({ width:390, height:300 });
    await page.screenshot({ path:path.join(output, 'render-390.png') });
    const report = { variant, policy, wrapper:variant === 'canonical' ? null : wrapper, originalTrace:tracePath, sourceImage:inputImage, model:body.model, endpoint: `${endpoint.origin}${endpoint.pathname}`, elapsedMs:Date.now()-started, usage:provider.usage, command:{ tool:command.tool, pluginId:command.pluginId, title:command.title, w:command.w, h:command.h }, rendered, errors, blockedResources };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ variant, phase:'rendered', output, elapsedMs:report.elapsedMs, errors, blockedResources:blockedResources.length }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
