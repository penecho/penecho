  // Bounded MCP content preparation. Native text/image records share Canvas history and capture.
  // Authoring pixels remain raster pixels; only the placed frame enters world space.
  function mcpPrimitiveWorldBox(box, worldPerPixel, origin = {x:0,y:0}) {
    return {x:origin.x+box.x*worldPerPixel,y:origin.y+box.y*worldPerPixel,w:box.w*worldPerPixel,h:box.h*worldPerPixel};
  }
  function mcpPrimitiveLayout(items) {
    const nodes=new Map(),result=[],occupied=[];
    for(const item of items.filter(item=>!['line','arrow','path'].includes(item.type))){
      const w=item.width||260,h=item.height||100;
      let x=item.x,y=item.y;
      if(x===undefined){
        x=24;y=24;
        for(let attempt=0;attempt<256;attempt++){
          const hit=occupied.find(b=>intersection({x:x-16,y:y-16,w:w+32,h:h+32},b));
          if(!hit)break;
          x=hit.x+hit.w+48;if(x+w>1000){x=24;y=Math.max(y+148,hit.y+hit.h+48);}
        }
      }
      const box={x,y,w,h},entry={...item,box};nodes.set(item.id,entry);result.push(entry);occupied.push(box);
    }
    for(const item of items.filter(item=>['line','arrow','path'].includes(item.type))){
      let points=item.points;
      if(item.from){
        const a=nodes.get(item.from)?.box,b=nodes.get(item.to)?.box;
        if(!a||!b)throw Error('Connector endpoints must reference nodes in this drawing.');
        const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2,dx=bx-ax,dy=by-ay;
        if(!dx&&!dy)throw Error('Connector endpoints overlap. Move the nodes apart.');
        const edge=(box,dx,dy)=>{const scale=1/Math.max(Math.abs(dx)/(box.w/2),Math.abs(dy)/(box.h/2));return {x:box.x+box.w/2+dx*scale,y:box.y+box.h/2+dy*scale};};
        points=[edge(a,dx,dy),edge(b,-dx,-dy)];
      }
      if(!points||points.length<2)throw Error('A path needs at least two points.');
      const left=Math.min(...points.map(p=>p.x))-20,top=Math.min(...points.map(p=>p.y))-20,
        w=Math.max(80,Math.max(...points.map(p=>p.x))-left+20),h=Math.max(80,Math.max(...points.map(p=>p.y))-top+20);
      result.push({...item,points,box:{x:left,y:top,w,h}});
    }
    let bounds=null;
    for(const item of result)bounds=unionDirtyBounds(bounds,item.box);
    if(!bounds||bounds.w>3600||bounds.h>3600||result.reduce((sum,item)=>sum+item.box.w*item.box.h,0)>8_000_000)throw Error('Drawing is too large. Split it into smaller artifacts.');
    return {items:result,bounds};
  }
  function mcpPrimitiveRaster(item) {
    const {box}=item,canvas=offscreen(Math.ceil(Math.max(80,box.w)),Math.ceil(Math.max(80,box.h))),q=canvas.getContext('2d'),pad=8;
    q.strokeStyle=item.color||state.inkColor||'#375b68';q.fillStyle=item.fill||'transparent';q.lineWidth=item.strokeWidth||2;q.lineCap=q.lineJoin='round';q.beginPath();
    if(item.type==='rect')q.rect(pad,pad,box.w-pad*2,box.h-pad*2);
    else if(item.type==='ellipse')q.ellipse(box.w/2,box.h/2,Math.max(1,box.w/2-pad),Math.max(1,box.h/2-pad),0,0,Math.PI*2);
    else {
      item.points.forEach((p,i)=>q[i?'lineTo':'moveTo'](p.x-box.x,p.y-box.y));
      if(item.type==='arrow'){
        const b=item.points.at(-1),a=item.points.at(-2),angle=Math.atan2(b.y-a.y,b.x-a.x),length=12+(item.strokeWidth||2);
        for(const offset of [-.5,.5]){q.moveTo(b.x-box.x,b.y-box.y);q.lineTo(b.x-box.x-length*Math.cos(angle+offset),b.y-box.y-length*Math.sin(angle+offset));}
      }
    }
    if(['rect','ellipse'].includes(item.type))q.fill();q.stroke();
    if(item.text){
      const font=item.fontSize||18,lineHeight=font*1.4,maxWidth=box.w-32,lines=[];let line='';
      q.font=`${font}px system-ui, sans-serif`;q.fillStyle=item.color||state.inkColor||'#375b68';q.textAlign='center';q.textBaseline='middle';
      for(const char of item.text){if(char==='\n'||(line&&q.measureText(line+char).width>maxWidth)){lines.push(line);line=char==='\n'?'':char;}else line+=char;}lines.push(line);
      if(lines.length*lineHeight>box.h-24)throw Error('Node label is too long. Increase its height or shorten the text.');
      lines.forEach((text,index)=>q.fillText(text,box.w/2,box.h/2+(index-(lines.length-1)/2)*lineHeight));
    }
    return canvas;
  }
  function mcpPlotView(args) {
    const evaluate=compileExpression(args.expression);
    if(args.xMin===undefined)args={...args,...plotView(evaluate)};
    const values=[];
    for(let i=0;i<=480;i++){const y=evaluate(args.xMin+(args.xMax-args.xMin)*i/480);if(Number.isFinite(y))values.push(y);}
    if(!values.length)throw Error('The function has no finite samples in this domain.');
    let yMin=args.yMin,yMax=args.yMax;
    if(yMin===undefined){values.sort((a,b)=>a-b);yMin=values[Math.floor((values.length-1)*.02)];yMax=values[Math.ceil((values.length-1)*.98)];const pad=Math.max(1e-6,(yMax-yMin)*.12,Math.abs(yMin)*.01);yMin-=pad;yMax+=pad;}
    if(!Number.isFinite(yMax-yMin)||yMax<=yMin)throw Error('Function range is too large to draw. Specify a smaller domain or range.');
    return {xMin:args.xMin,xMax:args.xMax,yMin,yMax};
  }
  async function mcpPresentPrimitives(session,args,kind,execution) {
    canvasAgentMutationIdle(execution);
    const revision=state.userRevision,previous=session.artifacts.get(args.artifactId),textExecution=execution?.kind==="mcp"?{...execution,nextTextBoxId:state.nextTextBoxId}:execution;
    if(previous&&previous.kind!==kind)throw Error('This artifact belongs to a different tool. Use a new artifactId.');
    // An artifact keeps its original mapping even when the user later zooms.
    const worldPerPixel=previous?(previous.worldPerPixel||1):1/(Number.isFinite(state.scale)&&state.scale>0?state.scale:1);
    const old=new Map(previous?.elements||[]);
    for(const value of old.values())if(!canvasAgentObject(value.objectId))throw Error('An object in this artifact was removed. Use a new artifactId.');
    const prepared=[];let scene;
    if(kind==='plot'){
      const view=mcpPlotView(args),made=await plotObjectImage({expression:args.expression,title:args.title,w:args.width||900,h:args.height||600,color:args.color||state.inkColor||'#375b68',...(view?{_mcpView:view}:{})});
      canvasAgentAssertToolExecution(execution);
      prepared.push({id:'plot',kind:'image',image:made.image,blob:made.blob,box:{x:0,y:0,w:made.logicalWidth,h:made.logicalHeight},plotExpression:args.expression});
      scene={bounds:prepared[0].box};
    }else{
      const items=[];
      for(const input of args.items){
        let item={...input};
        const former=old.get(item.id),object=former&&canvasAgentObject(former.objectId),source=JSON.stringify(input);
        if(item.type==='text'){
          const record=former?.source===source&&object?.kind==='text'&&object.item.text===input.text?{...object.item}:await renderedTextBoxRecord({text:item.text,x:0,y:0,fontSize:item.fontSize||20,maxWidth:item.width||260,fontFamily:state.aiFont,color:item.color||state.inkColor||'#375b68'},undefined,textExecution);
          canvasAgentAssertToolExecution(execution);
          if(!record)throw Error('Text could not be rendered.');item={...item,width:record.w,height:record.h,record,source};
        }else if(['rect','ellipse'].includes(item.type))item={...item,width:Math.max(80,item.width||260),height:Math.max(80,item.height||100)};
        if(object&&!['line','arrow','path'].includes(item.type)){
          if((item.type==='text')!==(object.kind==='text'))throw Error('Changing a text object into a shape requires a new element id.');
          item.x=(object.item.x-previous.origin.x)/worldPerPixel;item.y=(object.item.y-previous.origin.y)/worldPerPixel;
          item.width=object.item.w/worldPerPixel;item.height=object.item.h/worldPerPixel;
        }
        items.push(item);
      }
      scene=mcpPrimitiveLayout(items);
      for(const item of scene.items){
        if(item.type==='text')prepared.push({id:item.id,kind:'text',record:item.record,box:item.box,source:item.source});
        else {
          const renderKey=JSON.stringify({type:item.type,text:item.text,font:item.fontSize,color:item.color||state.inkColor,fill:item.fill,stroke:item.strokeWidth,w:item.box.w,h:item.box.h,points:item.points?.map(p=>({x:p.x-item.box.x,y:p.y-item.box.y}))}),former=old.get(item.id),object=former&&canvasAgentObject(former.objectId),reuse=former?.renderKey===renderKey&&object?.kind==='image';
          const image=reuse?object.item.image:mcpPrimitiveRaster(item),blob=reuse?object.item.blob:await canvasBlob(image,undefined,undefined,execution);
          canvasAgentAssertToolExecution(execution);
          prepared.push({id:item.id,kind:'image',image,blob,box:item.box,preserveFrame:!item.from,renderKey});
        }
      }
    }
    canvasAgentAssertRevision(revision);canvasAgentMutationIdle(execution);
    const worldBounds=mcpPrimitiveWorldBox(scene.bounds,worldPerPixel),plan=previous?null:mcpPlanPlacement(worldBounds.w,worldBounds.h,session,mcpPresentation(args,previous)),origin=previous?.origin||{x:plan.placement.x-worldBounds.x,y:plan.placement.y-worldBounds.y},elements=new Map(),records=[];
    for(const item of prepared){
      const former=old.get(item.id),object=former&&canvasAgentObject(former.objectId),box=mcpPrimitiveWorldBox(item.box,worldPerPixel,origin);
      if(object&&(kind==='plot'||item.preserveFrame))Object.assign(box,canvasAgentBox(object));
      if(box.x<0||box.y<0||box.x+box.w>SIZE||box.y+box.h>SIZE)throw Error('This drawing extends beyond the Canvas. Move it inward or split the content.');
      const record=item.kind==='text'?{...item.record,...box,...(object?{id:object.item.id}:{})}:imageRecord({...box,...(object?{id:object.item.id}:{}),image:item.image,blob:item.blob,naturalW:item.image.width,naturalH:item.image.height,sourceName:args.title,...(item.plotExpression?{plotExpression:item.plotExpression}:{})});
      if(!record)throw Error('Canvas rejected the drawing geometry.');records.push({kind:item.kind,record,object});elements.set(item.id,{objectId:record.id,kind:item.kind,...(item.source?{source:item.source}:{}),...(item.renderKey?{renderKey:item.renderKey}:{})});
    }
    const removed=new Set([...old].filter(([id])=>!elements.has(id)).map(([,value])=>value.objectId));
    for(const [kind,key,max] of [['text','textBoxes',MAX_VISIBLE_TEXT_BOXES],['image','images',MAX_VISIBLE_IMAGES]])if(state[key].filter(item=>!removed.has(item.id)).length+records.filter(item=>item.kind===kind&&!item.object).length>max)throw Error('Canvas object limit reached. Remove unused objects before drawing.');
    // Prepare fully before one synchronous history transaction; never mark AI output as user feedback.
    if(textExecution?.kind==="mcp")state.nextTextBoxId=Math.max(state.nextTextBoxId,textExecution.nextTextBoxId);
    save();state.textBoxHistoryBefore=textBoxHistoryState();state.imageHistoryBefore=imageHistoryState();
    for(const key of ['textBoxes','images'])state[key]=state[key].filter(item=>!removed.has(item.id));
    for(const item of records){if(item.object)Object.assign(item.object.item,item.record);else state[item.kind==='text'?'textBoxes':'images'].push(item.record);}
    // Match normal new-text creation: opaque native shapes must not cover labels.
    // Existing artifacts retain the user's later foreground choice.
    if(!previous&&records.some(item=>item.kind==='text'))setCanvasObjectFrontKind('text-box');
    const objectIds=records.map(item=>item.record.id);session.artifacts.set(args.artifactId,{kind,title:args.title,objectId:objectIds[0],objectIds,origin,worldPerPixel,presentation:mcpPresentation(args,previous),elements:[...elements]});
    if(plan)session.layout=plan.layout;
    state.userRevision++;save();requestRender();canvasAgentSyncState();
    const presentation=mcpPresentation(args,previous);
    for(const item of records.filter(item=>!item.object||presentation.attention==='request'))mcpQueueView(session,item.record,presentation);
    return {artifactId:args.artifactId,objectId:objectIds[0],objectIds,kind,revision:state.userRevision,feedbackCursor:mcpRuntime.feedbackSequence};
  }
