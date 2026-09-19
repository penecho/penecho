const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const models=JSON.parse(fs.readFileSync('test/fixtures/diagrams/regression/original-models.json','utf8'));
test('all original architecture and workflow fixtures preserve semantics and route clear of nodes and labels',async()=>{
  const ELK=require('elkjs/lib/elk.bundled.js'),{layoutArchitecture}=await import('../src/architecture/layout.mjs'),{layoutWorkflow}=await import('../src/workflow/layout.mjs');
  for(const kind of ['architecture','workflow'])for(const [i,data]of models[kind].entries()) {
    const original=structuredClone(data),layout=await (kind==='architecture'?layoutArchitecture:layoutWorkflow)(data,new ELK(),undefined,{width:1280});
    assert.deepEqual(layout.issues,[],`${kind} ${i+1}`);
    assert.deepEqual(layout.data,original);assert.deepEqual(data,original);
    assert.deepEqual(layout.nodes.map(n=>n.id).sort(),data.nodes.map(n=>n.id).sort());
    assert.equal(layout.edges.length,data.edges.length);
    assert.deepEqual([...new Set(layout.groups.map(g=>g.id))].sort(),(data.groups||[]).map(g=>g.id).sort());
    if(data.direction)assert.equal(layout.mode,data.direction.toLowerCase());
    if(kind==='workflow'){
      const axis=layout.mode==='right'?'x':'y',nodes=new Map(layout.nodes.map(n=>[n.id,n]));
      for(const e of layout.edges)if(e.kind!=='loop')assert.ok(nodes.get(e.from)[axis]<nodes.get(e.to)[axis],`C${i+1}: forward edge ${e.from} → ${e.to}`);
    }
    for(const edge of layout.edges){
      const source=layout.nodes.find(n=>n.id===edge.from),target=layout.nodes.find(n=>n.id===edge.to);
      const near=(p,n)=>p[0]>=n.x-1&&p[0]<=n.x+n.width+1&&p[1]>=n.y-1&&p[1]<=n.y+n.height+1;
      assert.ok(near(edge.sections[0][0],source),`${kind}${i+1}: source ${edge.id}`);
      assert.ok(near(edge.sections.at(-1).at(-1),target),`${kind}${i+1}: target ${edge.id}`);
    }
  }
});
test('all original sequence fixtures preserve every participant, message and fragment across widths',async()=>{
  const {layoutSequence}=await import('../src/sequence/layout.mjs');
  for(const data of models.sequence)for(const width of [640,1280]){
    const original=structuredClone(data),layout=layoutSequence(data,undefined,{width});
    assert.deepEqual(data,original);assert.deepEqual(layout.data,original);
    assert.deepEqual(layout.participants.map(p=>p.id),data.participants.map(p=>p.id));
    assert.equal(layout.messages.length,data.messages.length);
    assert.equal(layout.fragments.length,(data.fragments||[]).length);
    let previous=layout.lifelineTop;
    for(const message of layout.messages){
      assert.ok(message.labelY>previous);previous=message.bottom+message.noteLines.length*17;
      for(let i=1;i<message.points.length;i++)assert.ok(message.points[i][0]===message.points[i-1][0]||message.points[i][1]===message.points[i-1][1]);
      for(const [x,y]of message.points)assert.ok(x>=0&&x<=layout.width&&y>layout.lifelineTop&&y<layout.height);
    }
  }
});
