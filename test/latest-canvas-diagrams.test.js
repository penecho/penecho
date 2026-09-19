const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixtures=JSON.parse(fs.readFileSync('testcase/mcp-diagram-regression/r2/latest-readback.json','utf8')).map(item=>({...item,widths:[640,1280]}));
for(const item of JSON.parse(fs.readFileSync('testcase/mcp-diagram-regression/r3/sources.json','utf8'))){
  const match=item.html.match(/<script[^>]*data-(architecture|sequence|workflow)-source[^>]*>([\s\S]*?)<\/script>/i);
  fixtures.push({kind:item.kind,title:item.title,model:JSON.parse(match[2]),widths:[640,1960]});
}

test('latest MCP Canvas samples preserve semantics and valid geometry at narrow and wide widths',async()=>{
  const ELK=require('elkjs/lib/elk.bundled.js');
  const {layoutArchitecture}=await import('../src/architecture/layout.mjs');
  const {layoutWorkflow}=await import('../src/workflow/layout.mjs');
  const {layoutSequence}=await import('../src/sequence/layout.mjs');
  for(const {kind,title,model,widths} of fixtures)for(const width of widths){
    assert.ok(model,`${title}: source exists`);
    const original=structuredClone(model);
    const layout=kind==='sequence'?layoutSequence(model,undefined,{width}):await (kind==='architecture'?layoutArchitecture:layoutWorkflow)(model,new ELK(),undefined,{width});
    assert.deepEqual(model,original,`${title}: immutable source`);
    assert.deepEqual(layout.data,original,`${title}: preserved semantics`);
    assert.ok(layout.width>0&&layout.height>0&&Number.isFinite(layout.width+layout.height),title);
    if(kind==='sequence'){
      assert.deepEqual(layout.participants.map(p=>p.id),model.participants.map(p=>p.id),title);
      assert.equal(layout.messages.length,model.messages.length,title);
      assert.equal(layout.fragments.length,(model.fragments||[]).length,title);
    }else{
      assert.deepEqual(layout.issues,[],`${title} at ${width}px`);
      assert.deepEqual(layout.nodes.map(n=>n.id).sort(),model.nodes.map(n=>n.id).sort(),title);
      assert.equal(layout.edges.length,model.edges.length,title);
      if(model.direction)assert.equal(layout.mode,model.direction.toLowerCase(),title);
    }
  }
});
