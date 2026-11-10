#!/usr/bin/env node
// Read-only, metadata-only audit. Never prints prompts, tool arguments, images,
// provider URLs, user identifiers, or hidden reasoning text.
const fs=require('node:fs'),path=require('node:path')
const seconds=(start,end)=>Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))?Math.max(0,(Date.parse(end)-Date.parse(start))/1000):null
const round=value=>value==null?null:Math.round(value*1000)/1000
function summarize(trace){
  const agent=trace.kind==='canvas-conversation-turn',steps=agent?trace.steps||[]:trace.attempts||[]
  const completed=steps.filter(s=>s.startedAt&&s.completedAt),stepSeconds=completed.reduce((n,s)=>n+(seconds(s.startedAt,s.completedAt)||0),0)
  const wall=seconds(trace.startedAt,trace.completedAt),events=trace.events||[]
  const calls=events.filter(e=>e.type==='tool/call'),names={}
  for(const call of calls){const name=call.data?.name||'unknown';names[name]=(names[name]||0)+1}
  const native=events.some(e=>e.data?.engine==='codex-native')
  const errors=events.filter(e=>e.type==='tool/result'&&(e.data?.error||e.data?.message?.content?.some(c=>c.type==='tool-result'&&c.isError))).length
  const outputs=steps.map(s=>{const r=s.response||{},u=r.usage||r.upstream?.usage||{};return u.last?.outputTokens??u.outputTokens??u.output_tokens??null})
  const rawModel=trace.connection?.model||steps[0]?.outbound?.model||null
  return {kind:agent?'agent':'canvas-auto',startedAt:trace.startedAt,status:trace.status,
    model:typeof rawModel==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(rawModel)?'configured-model':rawModel,engine:native?'codex-native':'harness',
    wallSeconds:round(wall),completedSteps:completed.length,steps:steps.length,
    modelStepSeconds:round(stepSeconds),outsideCompletedStepsSeconds:wall==null?null:round(Math.max(0,wall-stepSeconds)),
    outputTokens:!native&&outputs.some(n=>n!==null)?outputs.reduce((sum,n)=>sum+(n||0),0):null,
    toolCalls:calls.length,tools:names,toolErrors:errors,retries:events.filter(e=>e.type==='llm/retry').length,
    slowestSteps:completed.map(s=>({step:s.step??s.attempt,seconds:round(seconds(s.startedAt,s.completedAt))})).sort((a,b)=>b.seconds-a.seconds).slice(0,3)}
}
function audit(root,limit=40){
  const rows=[]
  for(const entry of fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name))){
    const filename=path.join(root,entry.name,'trace.json')
    if(!fs.existsSync(filename))continue
    const trace=JSON.parse(fs.readFileSync(filename,'utf8'))
    if(trace.kind!=='canvas-conversation-turn')continue
    rows.push(summarize(trace));if(rows.length>=limit)break
  }
  const complete=rows.filter(r=>r.status==='completed'&&r.wallSeconds!==null)
  return {note:'Model-step time includes upstream wait, generation and retries; native steps can also include tools. Incomplete-step time is not attributed to tools. Output counts use per-step last usage, never cumulative session totals.',
    count:rows.length,completed:complete.length,completedWallSeconds:round(complete.reduce((n,r)=>n+r.wallSeconds,0)),
    completedModelStepSeconds:round(complete.reduce((n,r)=>n+r.modelStepSeconds,0)),rows}
}
if(require.main===module){
  const root=process.argv[2],limit=Number(process.argv[3]||40)
  if(!root||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Usage: node scripts/audit-canvas-agent-performance.cjs <requests-directory> [1..100]')
  process.stdout.write(JSON.stringify(audit(root,limit),null,2)+'\n')
}
module.exports={summarize,audit}
