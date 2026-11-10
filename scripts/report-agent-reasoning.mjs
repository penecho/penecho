// Summarize observed API responses and independent checks without imputing
// missing usage, treating character counts as tokens, or hiding failed samples.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'docs/verification/agent-reasoning-20261002');
const folders=(await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name);
const records=[];
for(const cohort of folders){
 const directory=join(root,cohort),names=await readdir(directory);
 let manifest={};try{manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));}catch{}
 let validation={samples:[]};
 try{validation=JSON.parse(await readFile(join(directory,'validation.json'),'utf8'));}catch{}
 for(const file of names.filter(n=>/^(deepseek|glm)-.*-r\d+\.json$/.test(n))){
  const sample=JSON.parse(await readFile(join(directory,file),'utf8'));
  const checked=validation.samples.find(s=>s.id===sample.id);
  const exactThinking=sample.model==='deepseek'&&sample.steps.every(s=>Number.isFinite(s.rawUsage?.completion_tokens_details?.reasoning_tokens));
  const extraGuidance=manifest.controls?.guidanceMode==='always-full'&&sample.calls.some(c=>c.name==='penecho_get_guidance'&&['general-html','math-2d','physics-2d','math-3d','scene'].includes(c.arguments?.id)&&c.arguments?.detail!=='full');
  const ambiguousFixture=sample.case==='calculation';
  records.push({cohort,id:sample.id,model:sample.model,case:sample.case,variant:sample.variant,repeat:sample.repeat,seconds:sample.ms/1000,firstMutationSeconds:sample.firstMutationMs===undefined?null:sample.firstMutationMs/1000,outputTokens:sample.outputTokens,reasoningTokens:exactThinking?sample.steps.reduce((n,s)=>n+s.rawUsage.completion_tokens_details.reasoning_tokens,0):null,reasoningCharacters:sample.reasoningChars,usageComplete:!['timeout','provider_error'].includes(sample.termination),termination:sample.termination,passed:checked?.passed??null,failedChecks:checked?.checks.filter(c=>!c.passed).map(c=>c.name)??[],tools:sample.calls.length,toolErrors:sample.toolErrors.length,pixelCaptures:sample.calls.filter(c=>c.pixelCapture).length,scopePreserved:sample.scopePreserved,extraGuidance,ambiguousFixture,harnessLimited:extraGuidance||sample.toolErrors.some(e=>/outside this isolated fixture|requires a complete HTML widget/.test(e.error?.message||''))});
 }
}
records.sort((a,b)=>a.cohort.localeCompare(b.cohort)||a.model.localeCompare(b.model)||a.case.localeCompare(b.case)||a.repeat-b.repeat||a.variant.localeCompare(b.variant));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;};
const groups=[];
for(const cohort of folders)for(const model of ['deepseek','glm'])for(const variant of ['baseline','scoped','draft','budget','strict']){
 const rows=records.filter(r=>r.cohort===cohort&&r.model===model&&r.variant===variant);
 if(!rows.length)continue;
 groups.push({cohort,model,variant,n:rows.length,passed:rows.filter(r=>r.passed===true).length,failed:rows.filter(r=>r.passed===false).length,unchecked:rows.filter(r=>r.passed===null).length,completed:rows.filter(r=>r.termination==='completed').length,medianSeconds:median(rows.map(r=>r.seconds)),medianOutputTokens:median(rows.map(r=>r.outputTokens)),incompleteUsage:rows.filter(r=>!r.usageComplete).length});
}
const paired=[];
for(const r of records.filter(r=>r.variant!=='baseline'&&r.case!=='image-probe')){
 const baseline=records.find(b=>b.cohort===r.cohort&&b.model===r.model&&b.case===r.case&&b.repeat===r.repeat&&b.variant==='baseline');
 if(!baseline)continue;
  paired.push({cohort:r.cohort,model:r.model,case:r.case,repeat:r.repeat,variant:r.variant,bothPassed:r.passed===true&&baseline.passed===true,harnessComparable:!r.harnessLimited&&!baseline.harnessLimited&&!r.ambiguousFixture,baselinePassed:baseline.passed,candidatePassed:r.passed,secondsRatio:r.seconds/baseline.seconds,outputRatio:r.usageComplete&&baseline.usageComplete?r.outputTokens/baseline.outputTokens:null,reasoningRatio:r.usageComplete&&baseline.usageComplete&&r.reasoningTokens!==null&&baseline.reasoningTokens?r.reasoningTokens/baseline.reasoningTokens:null});
}
await writeFile(join(root,'summary.json'),JSON.stringify({createdAt:new Date().toISOString(),records,groups,paired},null,2)+'\n');
const lines=['# Canvas Agent real API reasoning experiments','',`Generated: ${new Date().toISOString()}`,'','All durations are complete tool-using turns, including API wait, isolated tool execution and final answer. A first reasoning delta is not a usable result. DeepSeek reasoning token counts come from provider usage. GLM supplies total output tokens and reasoning character counts, without a separate reasoning token count. Incomplete usage totals are lower bounds.','', '| Cohort | Model | Case | Variant | Time (s) | First write (s) | Output tokens | Reasoning tokens | Reasoning chars | Quality | Termination |','| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |'];
for(const r of records)lines.push(`| ${r.cohort} | ${r.model} | ${r.case} r${r.repeat} | ${r.variant} | ${r.seconds.toFixed(2)} | ${r.firstMutationSeconds?.toFixed(2)??'—'} | ${r.usageComplete?'':'≥ '}${r.outputTokens} | ${r.reasoningTokens===null?'unavailable':(r.usageComplete?'':'≥ ')+r.reasoningTokens} | ${r.usageComplete?'':'≥ '}${r.reasoningCharacters} | ${r.passed===null?'unchecked':r.passed?'pass':'FAIL'} | ${r.termination} |`);
lines.push('','## Paired observations','','Ratios below compare the same task, model, cohort and repeat. Ratios below 1 mean fewer seconds or tokens. Failed quality checks remain visible; a fast failed result does not satisfy the goal. Only pairs with both passing quality and comparable fixtures can support a latency observation.','', '| Cohort | Model | Case | Variant | Both pass | Comparable | Time ratio | Output ratio | Reasoning token ratio |','| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |');
for(const p of paired)lines.push(`| ${p.cohort} | ${p.model} | ${p.case} r${p.repeat} | ${p.variant} | ${p.bothPassed} | ${p.harnessComparable} | ${p.secondsRatio.toFixed(3)} | ${p.outputRatio?.toFixed(3)??'unknown'} | ${p.reasoningRatio?.toFixed(3)??'unknown'} |`);
lines.push('','## Harness limitations','','Native draw and specialized creation tools are not implemented by this source/HTML fixture harness. A sample marked harnessLimited contains artificial fallback overhead and must not support a latency recommendation. Early cohorts also returned full guidance for brief requests; affected samples are excluded from latency conclusions. Initial pilot captures had no pixels; the exploratory screen cohort was stopped to correct that limitation. Subsequent cohorts use actual Chromium pixels on capture requests.','');
for(const r of records.filter(r=>r.harnessLimited))lines.push(`- ${r.cohort}/${r.id}: unsupported fixture operation or extra full guidance; retain quality results but exclude from latency conclusions.`);
lines.push('','The calculation fixture says “再对折后金额”, which can also be read as an additional 50% discount. Its fixed expected amount checks are retained as raw observations, but all these samples are excluded from quality-equivalence and latency conclusions. Neither reading establishes a model quality regression.','', '## Independent check failures','');
for(const r of records.filter(r=>r.passed===false))lines.push(`- ${r.cohort}/${r.id}: ${r.failedChecks.join('; ')}.`);
await writeFile(join(root,'MEASUREMENTS.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({samples:records.length,checked:records.filter(r=>r.passed!==null).length,passed:records.filter(r=>r.passed===true).length,output:join(root,'MEASUREMENTS.md')}));
