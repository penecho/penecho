const assert=require('node:assert/strict')
const test=require('node:test')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')

function prompt({instruction='',id='solve',language='en',selection=true}={}) {
  const source=fs.readFileSync(path.resolve(__dirname,'../src/client/app/assist-agent.js'),'utf8'),
    tasks=source.slice(source.indexOf('  const ASSIST_AGENT_TASKS'),source.indexOf('  function assistAgentCard')),
    fn=source.slice(source.indexOf('  function assistAgentTaskPrompt'),source.indexOf('  async function assistAgentRun')),
    context={PenEchoFinishDrawing:require('../src/shared/finish-drawing.js'),PenEchoIllustrationStyle:require('../src/shared/illustration-style.js'),state:{language},target:{box:{x:10,y:20,w:400,h:300},...(selection?{selection:{regionOnly:true}}:{})},
      captured:{source:selection?'masked lasso selection':'suggestion ink region',box:{x:10,y:20,w:400,h:300},recent:null,dirty:null,viewport:{x:0,y:0,w:1000,h:800}},instruction,id}
  vm.createContext(context)
  vm.runInContext(tasks+fn+'\nresult=assistAgentTaskPrompt(instruction||ASSIST_AGENT_TASKS[id],target,captured,{customInstruction:instruction});',context)
  return context.result
}

test('custom descriptive lasso request overrides a Solve action without automatic solving or animation',()=>{
  const text=prompt({instruction:'套索区域的内容是',id:'solve',language:'en'})
  assert.match(text,/套索区域的内容是/)
  assert.doesNotMatch(text,/Solve or evaluate every|Complete missing values|including each unsolved problem for Solve|For animation, verify/)
  assert.match(text,/custom instruction.*(?:precedence|overrides)|explicit.*instruction.*(?:precedence|overrides)/i)
  assert.match(text,/major visible|all major|every major/i)
  assert.match(text,/handwriting/i)
})

test('language follows explicit request, substantive custom instruction, target content, then UI fallback',()=>{
  for(const instruction of ['套索区域的内容是','请用英语描述所选内容','Describe the selected content in Chinese.']) {
    const text=prompt({instruction,id:'solve',language:instruction.startsWith('Describe')?'zh':'en'})
    assert.match(text,/explicit.*language/i)
    assert.match(text,/custom.*instruction.*language|language.*custom.*instruction/i)
    assert.match(text,/target.*language|language.*target/i)
    assert.match(text,/UI.*fallback|fallback.*UI/i)
    assert.doesNotMatch(text,/Keep visible text in (?:Chinese|English), unless/)
  }
  assert.match(prompt({instruction:'',id:'solve',language:'zh'}),/Solve or evaluate every unsolved problem/)
})

test('masked scope and analytical claims are grounded in visible evidence',()=>{
  const text=prompt({instruction:'套索区域的内容是'})
  assert.match(text,/excluded pixels are not input/)
  assert.match(text,/source.*(?:visible|masked)|(?:visible|masked).*source/i)
  assert.match(text,/units/i)
  assert.match(text,/time horizons/i)
  assert.match(text,/assumptions/i)
  assert.match(text,/causal/i)
  assert.match(text,/arithmetic/i)
  assert.match(text,/sourcePlacement evidence/)
})

test('ordinary Answer keeps the existing natural greeting behavior',()=>{
  const text=prompt({id:'answer',selection:false})
  assert.match(text,/Reply naturally to greetings/)
  assert.match(text,/unless the user requests transcription/)
})

test('Explain sends its text-or-Widget policy with the scoped Agent task',()=>{
  for(const selection of [false,true]) {
    const text=prompt({id:'explain',selection})
    assert.match(text,/purely textual[\s\S]*native text and math notation without a Widget/)
    assert.match(text,/source or explanation involves a figure, diagram, chart[\s\S]*Widget combining the relevant graphics/)
    assert.match(text,/Mathematical notation alone is not a graphic/)
    assert.match(text,/takes precedence over general native-first or Visual Explorer defaults/)
    assert.match(text,/independently of the executor selected by PenEchoLLM according to task complexity/)
    assert.match(text,/penecho_edit_canvas with action create_text/)
    assert.match(text,/For graphics use penecho_present_widget/)
    assert.match(text,/Preserve the original source/)
  }
})
