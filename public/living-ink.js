"use strict";
(function(root, factory) {
  const model = typeof module === "object" && module.exports ? require("./living-ink-model.js") : root.PENECHO_LIVING_INK_MODEL;
  const api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_LIVING_INK = api;
})(typeof globalThis === "object" ? globalThis : this, function(M) {
  const STYLE = `html body{font-size:14px!important;background:#faf9f5!important}textarea{font:inherit;border:1px solid #d9ded5;border-radius:8px;padding:8px;resize:vertical;max-width:100%}.formula input{width:280px}.context input[type=number]{width:65px}.export-tools{margin-top:12px}.presenting .head,.presenting nav,.presenting .tools,.presenting aside,.presenting .help,.presenting .export-tools,.presenting .status{display:none!important}.presenting #slide-list,.presenting #slide-up,.presenting #slide-delete,.presenting #slide-notes,.presenting #export-pptx{display:none}.presenting #slide-title{border:0;background:transparent;font-size:20px;pointer-events:none}.presenting .workspace{grid-template-columns:1fr}.presenting .paper svg{max-height:calc(100vh - 160px)}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#faf9f5;color:#303b39;font:14px/1.45 system-ui,-apple-system,sans-serif}body{padding:18px}button,select,input{font:inherit;color:inherit}button,select,input[type=text]{border:1px solid #d9ded5;background:#fffefa;border-radius:8px;padding:7px 11px}button{cursor:pointer;white-space:nowrap}button:hover{background:#edf2e9}button:disabled{opacity:.38;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #278679;outline-offset:2px}button[aria-pressed=true],button.primary{background:#234f48;color:#fff;border-color:#234f48}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.head h1{font-size:20px;letter-spacing:-.6px;margin:0}.head small{color:#718079;font-size:12px}.row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}nav{margin:12px 0}nav button{border-color:transparent;background:transparent}.tools{padding:10px 0;border-top:1px solid #e3e6de}.context{padding:10px 12px;background:#f0f3eb;border-radius:10px;min-height:48px;margin-bottom:12px}.context label{display:flex;align-items:center;gap:6px}.context input[type=range]{width:100px;accent-color:#356b60}.context output{min-width:34px;font-variant-numeric:tabular-nums}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 218px;gap:14px}.paper{border:1px solid #dce2d6;border-radius:12px;overflow:hidden;background:#fffefa}.paper svg{display:block;width:100%;height:360px;min-height:280px;touch-action:none;user-select:none}.paper svg[data-tool=draw]{cursor:crosshair}aside{background:#f0f3eb;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:9px;font-size:12px}aside h2{font-size:13px;margin:0}aside select,aside input{width:100%;min-width:0}aside select[multiple]{height:114px;background:#fffefa;padding:4px}aside label{display:block}aside label span{display:block;margin-bottom:3px;color:#617369}.facts{font-variant-numeric:tabular-nums;white-space:pre-line;min-height:56px;padding-top:8px;border-top:1px solid #dce2d6;color:#3b6558}.help{color:#6a786f;font-size:12px;margin:10px 0 0;min-height:35px}.status{display:flex;gap:12px;justify-content:space-between;border-top:1px solid #e1e5da;margin-top:12px;padding-top:10px;font-size:12px;color:#617369}.status [role=status]{color:#235c4e}.empty{fill:#87958a;font-size:17px}.object{cursor:grab}.object:active{cursor:grabbing}.vertex{cursor:crosshair}.muted{opacity:.32}svg text{pointer-events:none;font-family:system-ui}svg .hit{pointer-events:all}input[type=range]{accent-color:#356b60}.warning{color:#9a6324}.hidden,[hidden]{display:none!important}@media(max-width:760px){body{padding:10px}.workspace{grid-template-columns:minmax(0,1fr)}aside{display:grid;grid-template-columns:1fr 1fr;gap:8px}aside select[multiple]{height:90px}.paper svg{min-height:240px}.head{align-items:flex-start}.head .row{max-width:55%}.tools button{padding:6px 9px}}`;
  function mount(M, initial, language) {
    const $ = id => document.getElementById(id), zh = language === "zh", L = (en,cn) => zh?cn:en;
    const escape = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    let scene=M.validate(initial), selected=[], tool="select", multi=false, drag=null, time=0, playing=false, playFrame=0, previousTime=0, wireRun=false, run=null, pointT=.5, showInk=false, history=[], future=[], revision=0, slideIndex=0, presenting=false, mathResult=scene.math.result||"", mathWorker=null, mathTimer=0, mathRequest=0;
    const labels={objects:L("Objects","对象"),geometry:L("Geometry","几何"),math:L("Math & charts","数学作图"),slides:L("Slides","演示"),physics:L("Physics","物理"),wireframe:L("Prototype","原型"),flow:L("Flow","流程")};
    const kindLabels={triangle:L("Triangle","三角形"),rectangle:L("Rectangle","矩形"),polygon:L("Polygon","多边形"),circle:L("Circle","圆"),ellipse:L("Ellipse","椭圆"),line:L("Line","线段"),ink:L("Ink","笔迹")};
    const roleLabels={node:L("Step","步骤"),start:L("Start","起点"),branch:L("Yes / no branch","条件分支"),screen:L("Screen","页面"),button:L("Button","按钮"),toggle:L("Toggle","开关"),slider:L("Slider","滑条")};
    const physicsLabels={incline:L("Incline + block","斜面与滑块"),pendulum:L("Pendulum","单摆"),spring:L("Two-body spring","双物体弹簧"),lever:L("Lever","杠杆")};
    const demos={blank:L("Blank sketch","空白手绘"),objects:L("Triangle + rectangle","三角形 + 矩形"),geometry:L("Live geometry","动态几何"),math:L("Functions & parameters","函数与参数"),data:L("Daily data chart","日常数据图"),slides:L("Three-slide lesson","三页讲解演示"),...physicsLabels,wireframe:L("Two-screen prototype","双页面原型"),flow:L("Conditional flow","条件流程"),tree:L("Breadth-first tree","树的广度遍历")};
    const button=(id,label,extra="")=>`<button type="button" id="${id}" ${extra}>${label}</button>`;
    const options=(values,current)=>Object.entries(values).map(([v,l])=>`<option value="${escape(v)}" ${v===current?"selected":""}>${escape(l)}</option>`).join("");
    document.body.innerHTML=`<header class="head"><div><h1>${L("Ink Lab","手绘实验室")}</h1><small>${L("Draw objects. Give them behavior.","画出对象，让它们动起来。")}</small></div><div class="row"><select id="demo" aria-label="${L("Example","示例")}">${options(demos,"objects")}</select>${button("load",L("Load example","载入示例"))}</div></header><nav id="modes" class="row" aria-label="${L("Workspace","工作区")}">${Object.entries(labels).map(([id,l])=>button("mode-"+id,l,`data-mode="${id}" aria-pressed="false"`)).join("")}</nav><div class="tools row">${button("select",L("Move","移动"))}${button("draw",L("Draw","画笔"))}${button("recognize",L("Recognize strokes","识别笔画"),"class=primary")}${button("multi",L("Multi-select","多选"))}${button("group",L("Group","组合"))}${button("ungroup",L("Ungroup","拆组"))}${button("connect",L("Connect →","连接 →"))}${button("disconnect",L("Disconnect","断开"))}${button("delete",L("Delete","删除"))}${button("undo",L("Undo","撤销"))}${button("redo",L("Redo","重做"))}</div><div id="context" class="context row"></div><div class="workspace"><div class="paper"><svg id="stage" viewBox="0 0 900 500" role="group" aria-label="${L("Interactive sketch","可交互手绘场景")}"></svg></div><aside><h2 id="count"></h2><select id="objects" multiple aria-label="${L("Objects (select multiple to group or connect)","对象列表（可多选后组合或连接）")}"></select><label><span>${L("Label","名称")}</span><input id="label" type="text" maxlength="60"></label><label id="role-field"><span>${L("Behavior","行为")}</span><select id="role">${options(roleLabels,"node")}</select></label><label id="target-field"><span>${L("Navigate to","跳转页面")}</span><select id="target"></select></label><label id="edge-field"><span>${L("Connection label (yes / no for branches)","连线标签（条件分支用 yes / no）")}</span><input id="edge-label" type="text" maxlength="24" placeholder="yes / no"></label><div id="facts" class="facts"></div></aside></div><p id="help" class="help"></p><footer class="status"><span id="status" role="status" aria-live="polite"></span><span id="saved">${L("Local simulation · saved with this Canvas","本地运行 · 随当前画布保存")}</span></footer>`;
    const svg=$('stage');
    const exports=document.createElement("div");exports.className="row export-tools";
    exports.innerHTML=button("capture-slide",L("Add scene to slides","将场景加入演示"))+button("export-svg","SVG")+button("export-png","PNG")+button("export-html",L("Export webpage Demo","导出网页 Demo"));
    document.querySelector(".status").before(exports);
    const notice = value => {$('status').textContent=value;};
    const name = e => e?.label || (e?kindLabels[e.kind]+" "+e.id.slice(1):"");
    function persist() {
      document.getElementById("penecho-ink-data")?.remove();
      const script=document.createElement("script");script.id="penecho-ink-data";script.type="application/json";script.textContent=JSON.stringify(scene);document.body.append(script);
      parent.postMessage({type:"penecho-living-ink-change",document:scene,revision:++revision},"*");
      if(parent===window)$("saved").textContent=L("Export the webpage to keep your changes","导出网页以保留修改");
    }
    function stop(){playing=false;cancelAnimationFrame(playFrame);playFrame=0;previousTime=0;}
    function transact(action, message="") {
      const before=M.clone(scene);
      try {action();scene=M.validate(scene);if(JSON.stringify(before)!==JSON.stringify(scene)){history.push(before);if(history.length>40)history.shift();future=[];persist();}if(message)notice(message);}
      catch(error){scene=before;notice(L("Cannot apply: ","未能应用：")+error.message);}
      render();
    }
    function replace(next){stop();mathRequest++;mathWorker?.terminate();clearTimeout(mathTimer);mathResult=next.math.result||"";transact(()=>{next.slides=next.mode!=="slides"&&scene.slides.length?scene.slides:next.slides;scene=next;selected=[];run=null;time=0;wireRun=false;tool="select";},L("Example ready. Edits can be undone.","示例已载入，可撤销替换。"));}
    function mainSelected(){return scene.entities.find(e=>e.id===selected[0]);}
    function controlRange(id,label,value,min,max,step,unit="") {return `<label>${label}<input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output id="${id}-value">${value}${unit}</output></label>`;}
    function renderContext() {
      const e=mainSelected();let html="";
      if(scene.mode==="math")html=mathControls();
      if(scene.mode==="slides")html=slideControls();
      if(scene.mode==="objects")html=`${button("ink",L("Original strokes","原始笔画"),`aria-pressed="${showInk}"`)}<span>${L("Select two objects in order, then connect. Shift-click adds to the selection.","按顺序选择两个对象后连接；Shift 点击可多选。")}</span>`;
      if(scene.mode==="geometry")html=`${button("right",L("Right angle at B","锁定 B 点直角"),`aria-pressed="${e?.rightAngle===true}" ${e?.kind!=="triangle"?"disabled":""}`)}${button("mirror",L("Mirror copy","镜像副本"),!e?"disabled":"")}${controlRange("edgepoint",L("Point on first edge","首边上的点"),pointT,0,1,.01)}`;
      if(scene.mode==="physics") {
        const p=scene.physics;
        html=`<select id="experiment" aria-label="${L("Experiment","实验类型")}">${options(physicsLabels,p.kind)}</select>${button("bind",L("Bind objects","绑定对象"))}${button("play",playing?L("Pause","暂停"):L("Run","运行"),"class=primary")}${button("reset",L("Reset","复位"))}`;
        if(p.kind==="incline")html+=controlRange("angle",L("Angle","倾角"),p.angle,0,70,1,"°")+controlRange("friction",L("Friction","摩擦系数"),p.friction,0,1,.01);
        if(p.kind==="pendulum")html+=controlRange("length",L("Length (m)","摆长（m）"),p.length,.5,5,.1)+controlRange("amplitude",L("Amplitude","振幅"),p.amplitude,0,60,1,"°");
        if(p.kind==="spring")html+=controlRange("stiffness",L("Spring k (N/m)","劲度 k（N/m）"),p.stiffness,1,30,1);
        if(["spring","lever"].includes(p.kind))html+=controlRange("mass",L("Left mass (kg)","左侧质量（kg）"),p.mass,.1,10,.1)+controlRange("mass2",L("Right mass (kg)","右侧质量（kg）"),p.mass2,.1,10,.1);
      }
      if(scene.mode==="wireframe")html=`${button("wire-run",wireRun?L("Edit sketch","编辑草图"):L("Run prototype","运行原型"),"class=primary")}${button("home",L("First screen","返回首页"))}<span>${wireRun?L("Click buttons and toggles; drag sliders.","点击按钮和开关，拖动滑条。"):L("Assign screens and controls in the inspector. Link a button to a screen.","在右侧指定页面和控件。将按钮连接到页面即可跳转。")}</span>`;
      if(scene.mode==="flow")html=`${button("step",L("Step","单步"),"class=primary")}${button("flow-play",playing?L("Pause","暂停"):L("Play","播放"))}${button("flow-reset",L("Reset","复位"))}<label>${L("Condition","条件")}<select id="branch"><option value="yes" ${scene.flow.branch?"selected":""}>yes</option><option value="no" ${!scene.flow.branch?"selected":""}>no</option></select></label><select id="traversal" aria-label="${L("Traversal","遍历方式")}">${options({path:L("Follow connections","沿连线执行"),breadth:L("Breadth-first queue","广度优先队列")},scene.flow.traversal)}</select>`;
      $('context').innerHTML=html;
      bindDailyControls();
      const on=(id,fn)=>$(id)?.addEventListener("click",fn);
      on("ink",()=>{showInk=!showInk;render();});
      on("right",()=>transact(()=>{e.rightAngle=!e.rightAngle;if(e.rightAngle)M.moveVertex(e,2,e.points[2]);}));
      on("mirror",()=>transact(()=>{const copy=M.mirror(scene,e.id);selected=[e.id,copy.id];}));
      $('edgepoint')?.addEventListener("input",event=>{pointT=Number(event.target.value);$('edgepoint-value').textContent=pointT;renderStage();});
      $('experiment')?.addEventListener("change",event=>{stop();time=0;transact(()=>{scene.physics.kind=event.target.value;scene.physics.bindings=[];});});
      on("bind",()=>transact(()=>{if(!M.bindPhysics(scene,selected))throw Error(L("Required: incline = triangle + rectangle; pendulum = line + circle; spring = two objects; lever = triangle + two objects.","所需对象：斜面＝三角形＋矩形；单摆＝线段＋圆；弹簧＝两个物体；杠杆＝三角形＋两个物体。"));time=0;},L("Objects bound to this experiment.","已将对象绑定到实验。")));
      on("play",()=>{if(!validPhysics()){notice(L("Bind suitable objects first.","请先绑定所需对象。"));return;}if(playing)stop();else start();renderContext();});
      on("reset",()=>{stop();time=0;render();});
      for(const key of ["angle","friction","mass","mass2","length","amplitude","stiffness"]) {
        const input=$(key);if(!input)continue;
        input.addEventListener("input",()=>{$(key+"-value").textContent=input.value;});
        input.addEventListener("change",()=>{stop();time=0;transact(()=>scene.physics[key]=Number(input.value));});
      }
      on("wire-run",()=>{wireRun=!wireRun;tool="select";selected=[];if(wireRun)transact(()=>M.assignParents(scene));else render();});
      on("home",()=>transact(()=>scene.activeScreen=scene.entities.find(e=>e.role==="screen")?.id||""));
      on("step",stepFlow);on("flow-reset",()=>{stop();run=M.flowStart(scene);render();});
      on("flow-play",()=>{if(playing)stop();else{if(!run||run.done)run=M.flowStart(scene);start();}renderContext();});
      $('branch')?.addEventListener("change",event=>{stop();run=null;transact(()=>scene.flow.branch=event.target.value==="yes");});
      $('traversal')?.addEventListener("change",event=>{stop();run=null;transact(()=>scene.flow.traversal=event.target.value);});
    }
    function mathControls() {
      const m=scene.math;
      let html=`<select id="plot-source" aria-label="${L("Plot source","作图来源")}">${options({functions:L("Functions","函数"),data:L("Data","数据")},m.source)}</select>`;
      if(m.source==="functions")html+=`<label class="formula">y = <input id="expression" type="text" maxlength="480" value="${escape(m.expression)}" aria-label="${L("Expressions, separated by semicolons","函数表达式，以分号分隔")}"></label>${button("plot",L("Plot","作图"),"class=primary")}<select id="math-action" aria-label="${L("Math operation","数学操作")}">${options({derivative:L("Derivative in x","对 x 求导"),integral:L("Antiderivative","不定积分"),solve:L("Solve for x","求解 x"),simplify:L("Expand / simplify","展开 / 化简"),evaluate:L("Evaluate","计算数值")},m.action)}</select>${button("calculate",L("Calculate first expression","计算第一条公式"))}<div class="row">${["a","b","c"].map(k=>controlRange("param-"+k,k,m[k],-5,5,.1)).join("")}<label>x <input id="xmin" type="number" min="-100" max="99" step="1" value="${m.min}" aria-label="x min">—<input id="xmax" type="number" min="-99" max="100" step="1" value="${m.max}" aria-label="x max"></label></div>`;
      else html+=`<textarea id="data-input" rows="3" maxlength="2000" aria-label="${L("Data: one label,value per row","数据：每行 名称,数值")}">${escape(m.data)}</textarea><select id="chart-kind" aria-label="${L("Chart type","图表类型")}">${options({bar:L("Bars","柱状图"),line:L("Line","折线图")},m.chart)}</select>${button("plot-data",L("Update chart","更新图表"),"class=primary")}`;
      return html;
    }
    function slideControls() {
      slideIndex=M.clamp(slideIndex,0,Math.max(0,scene.slides.length-1));const slide=scene.slides[slideIndex];
      return `<select id="slide-list" aria-label="${L("Slide","幻灯片")}">${scene.slides.map((s,i)=>`<option value="${i}" ${i===slideIndex?"selected":""}>${i+1}. ${escape(s.title)}</option>`).join("")}</select>${button("slide-prev","←")}${button("slide-next","→")}${button("present",presenting?L("End presentation","结束放映"):L("Present","放映"))}${button("export-pptx",L("Export PPTX","导出 PPTX"),`class=primary ${!slide?"disabled":""}`)}<input id="slide-title" type="text" maxlength="100" value="${escape(slide?.title||"")}" aria-label="${L("Slide title","幻灯片标题")}" ${!slide?"disabled":""}>${button("slide-up",L("Move earlier","向前移"),slideIndex===0?"disabled":"")}${button("slide-delete",L("Delete slide","删除本页"),!slide?"disabled":"")}<textarea id="slide-notes" rows="2" maxlength="600" aria-label="${L("Speaker notes","讲稿备注")}" ${!slide?"disabled":""}>${escape(slide?.notes||"")}</textarea>`;
    }
    function bindDailyControls() {
      const on=(id,fn)=>$(id)?.addEventListener("click",fn);
      $('plot-source')?.addEventListener("change",event=>transact(()=>scene.math.source=event.target.value));
      on("plot",()=>transact(()=>{scene.math.expression=$('expression').value;scene.math.min=Number($('xmin').value);scene.math.max=Number($('xmax').value);scene.math.result=mathResult="";}));
      on("calculate",()=>{const input=$("expression").value,action=$("math-action").value;transact(()=>{scene.math.expression=input;scene.math.action=action;});void calculateMath(input.split(";")[0],action);});
      for(const k of ["a","b","c"]){const input=$("param-"+k);if(!input)continue;let before=null;input.oninput=()=>{before ||= M.clone(scene);scene.math[k]=Number(input.value);scene.math.result=mathResult="";$("param-"+k+"-value").textContent=input.value;renderStage();};input.onchange=()=>{if(before){const next=M.clone(scene);scene=before;before=null;transact(()=>scene=next);}};}
      on("plot-data",()=>transact(()=>{window.PENECHO_INK_TOOLS.dataset($('data-input').value);scene.math.data=$('data-input').value;scene.math.chart=$('chart-kind').value;}));
      $('slide-list')?.addEventListener("change",event=>{slideIndex=Number(event.target.value);render();});
      on("slide-prev",()=>{slideIndex=Math.max(0,slideIndex-1);render();});on("slide-next",()=>{slideIndex=Math.min(scene.slides.length-1,slideIndex+1);render();});
      on("present",()=>{presenting=!presenting;document.body.classList.toggle("presenting",presenting);render();});
      on("slide-up",()=>transact(()=>{[scene.slides[slideIndex-1],scene.slides[slideIndex]]=[scene.slides[slideIndex],scene.slides[slideIndex-1]];slideIndex--;}));
      on("slide-delete",()=>transact(()=>scene.slides.splice(slideIndex,1)));
      $('slide-title')?.addEventListener("change",event=>transact(()=>scene.slides[slideIndex].title=event.target.value));
      $('slide-notes')?.addEventListener("change",event=>transact(()=>scene.slides[slideIndex].notes=event.target.value));
      on("export-pptx",()=>void exportPptx());
    }
    function validPhysics(){const expected=scene.physics.kind==="lever"?3:2;return scene.physics.bindings.length===expected&&scene.physics.bindings.every(id=>scene.entities.some(e=>e.id===id));}
    function render() {
      selected=selected.filter(id=>scene.entities.some(e=>e.id===id));
      document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===scene.mode)));
      $('select').setAttribute("aria-pressed",String(tool==="select"));$('draw').setAttribute("aria-pressed",String(tool==="draw"));$('multi').setAttribute("aria-pressed",String(multi));
      $('undo').disabled=!history.length;$('redo').disabled=!future.length;$('recognize').disabled=!scene.pending.length;
      for(const id of ["delete","ungroup"])$(id).disabled=!selected.length;
      $('group').disabled=selected.length<2;$('connect').disabled=selected.length!==2;$('disconnect').disabled=selected.length!==2||!scene.edges.some(e=>selected.includes(e.from)&&selected.includes(e.to));
      $('objects').hidden=['math','slides'].includes(scene.mode);$('label').closest('label').hidden=['math','slides'].includes(scene.mode);$('edge-field').hidden=!['objects','wireframe','flow'].includes(scene.mode);
      $('count').textContent=L(`${scene.entities.length} objects · ${scene.edges.length} links`,`${scene.entities.length} 个对象 · ${scene.edges.length} 条连接`);
      $('objects').innerHTML=scene.entities.map(e=>`<option value="${e.id}" ${selected.includes(e.id)?"selected":""}>${escape(name(e))}${e.group?L(" · grouped"," · 组合"):""}</option>`).join("");
      const e=mainSelected();$('label').disabled=!e;$('label').value=e?.label||"";$('role').disabled=!e;$('role').value=e?.role||"node";
      $('role-field').hidden=!["wireframe","flow"].includes(scene.mode);$('target-field').hidden=scene.mode!=="wireframe"||e?.role!=="button";
      $('target').innerHTML=`<option value="">${L("None","无")}</option>`+scene.entities.filter(x=>x.role==="screen").map(x=>`<option value="${x.id}" ${e?.target===x.id?"selected":""}>${escape(name(x))}</option>`).join("");
      $('help').textContent={math:L('Use semicolons for up to three curves. Adjust a, b, c; or paste label,value data. Local symbolic results depend on the supported expression.','用分号分隔最多三条曲线，拖动 a、b、c 调参；也可粘贴 名称,数值 数据。符号计算结果取决于公式支持范围。'),slides:L('Capture any scene, add a title and notes, then present or export PowerPoint. Charts and experiments export as images; titles remain editable.','在任意场景点「加入演示」，再编辑标题和备注，放映或导出 PowerPoint。场景图像保留外观，标题可在 PPT 中编辑。'),objects:L("Draw separate shapes, then recognize. Drag to move; connectors and labels follow. Original ink is retained.","画出独立图形后点「识别笔画」。拖动对象，连线与名称会跟随；原始矢量笔画保留。"),geometry:L("Select a shape and drag its vertices. Measurements use scene units. The amber point stays on the first edge; mirror copies keep equal area.","选中图形后拖动顶点，角度与面积实时更新（使用场景单位）。黄色点沿首边移动，镜像副本面积相等。"),physics:L("Bind your shapes to an explicit experiment. Idealized models: constant incline friction, small-angle pendulum, ideal spring, a limited lever illustration.","把图形绑定到指定实验。采用教学简化模型：恒定斜面摩擦、小角度单摆、理想弹簧，以及有限角度的杠杆演示。"),wireframe:L("Draw large screen rectangles and smaller controls, recognize, then assign each behavior. Running preserves your sketch layout.","画大矩形作页面、小图形作控件，识别后指定行为。运行原型时保留你的草图布局。"),flow:L("Connections are directional. Branch nodes require yes/no links. Breadth-first mode avoids revisiting nodes; path mode stops after 100 steps.","连线带方向。条件节点使用 yes / no 标签；广度遍历不会重复访问节点，顺序执行最多运行 100 步。")}[scene.mode];
      document.querySelector('aside').hidden=presenting;
      for(const control of document.querySelectorAll('.tools button'))control.hidden=["math","slides"].includes(scene.mode)&&!["undo","redo"].includes(control.id);
      $('capture-slide').disabled=scene.mode==="slides";
      if(scene.mode==="math")$('count').textContent=L("Math results","数学结果");
      if(scene.mode==="slides")$('count').textContent=L("Speaker notes","讲稿备注");
      renderContext();renderStage();
    }
    function path(ps,close=false){return ps.map((p,i)=>`${i?"L":"M"}${p.x} ${p.y}`).join(" ")+(close?" Z":"");}
    function entityShape(e,attributes="") {
      const b=M.bounds(e.points);
      if(["circle","ellipse"].includes(e.kind))return `<ellipse cx="${b.x+b.w/2}" cy="${b.y+b.h/2}" rx="${b.w/2}" ry="${b.h/2}" ${attributes}/>`;
      return `<path d="${path(e.points,!["line","ink"].includes(e.kind))}" ${attributes}/>`;
    }
    function renderStage() {
      svg.dataset.tool=tool;
      let out=`<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#e2e7dc"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="#69816f" stroke-width="1.5"/></marker></defs><rect width="900" height="500" fill="url(#dots)"/>`;
      if(scene.mode==="slides") {
        const slide=scene.slides[slideIndex];
        if(slide){const saved=scene,savedSelection=selected;scene=slide.scene;selected=[];renderStage();const content=svg.innerHTML;scene=saved;selected=savedSelection;svg.innerHTML=content;renderFacts();return;}
      }
      if(scene.mode==="math")out+=mathSvg();
      else if(scene.mode==="physics"&&validPhysics())out+=physicsSvg();
      else {
        if(!wireRun)for(const edge of scene.edges){const ab=M.anchors(scene,edge);if(!ab)continue;const [a,b]=ab;out+=`<path d="M${a.x} ${a.y} L${b.x} ${b.y}" fill="none" stroke="#69816f" stroke-width="2.5" marker-end="url(#arrow)"/><text x="${(a.x+b.x)/2+8}" y="${(a.y+b.y)/2-8}" fill="#587761" font-size="15">${escape(edge.label)}</text>`;}
        for(const e of scene.entities) {
          if(scene.mode==="wireframe"&&wireRun&&scene.activeScreen&&e.id!==scene.activeScreen&&e.parent!==scene.activeScreen)continue;
          const b=M.bounds(e.points),c=M.center(e),active=selected.includes(e.id),hit=scene.mode==="flow"&&run?.current===e.id,
            fill=e.role==="screen"?"#f5f6f0":hit?"#f5d48b":active?"#dcebdc":"#eff3e5";
          out+=`<g class="object" data-object="${e.id}" tabindex="0" role="button" aria-label="${escape(name(e))}" aria-pressed="${active}">${entityShape(e,`fill="${["line","ink"].includes(e.kind)?"none":fill}" stroke="${active?"#287565":"#526d59"}" stroke-width="${active?3:2}"`)}${entityShape(e,'class="hit" fill="transparent" stroke="transparent" stroke-width="14"')}`;
          if(scene.mode==="wireframe"&&["toggle","slider"].includes(e.role)) {
            if(e.role==="toggle")out+=`<rect x="${b.x+8}" y="${b.y+7}" width="52" height="28" rx="14" fill="${e.value?"#347464":"#aebaae"}"/><circle cx="${b.x+(e.value?46:22)}" cy="${b.y+21}" r="10" fill="white"/>`;
            else out+=`<path d="M${b.x+12} ${c.y}H${b.x+b.w-12}" stroke="#b8c9b5" stroke-width="6"/><circle cx="${b.x+12+(b.w-24)*e.value/100}" cy="${c.y}" r="10" fill="#347464"/>`;
          }
          const control=scene.mode==="wireframe"&&["toggle","slider"].includes(e.role);
          out+=`<text x="${c.x}" y="${control?b.y-8:e.role==="screen"?b.y+28:c.y+5}" text-anchor="middle" font-size="16" fill="#355442">${escape(e.label||(scene.mode==="flow"?name(e):""))}</text></g>`;
          if(showInk)for(const stroke of e.ink)out+=`<path d="${path(stroke.points)}" fill="none" stroke="#be7649" stroke-width="1.5" opacity=".7" pointer-events="none"/>`;
          if(scene.mode==="geometry"&&active) {
            const m=M.metrics(e);if(!["circle","ellipse","ink"].includes(e.kind))e.points.forEach((p,i)=>{out+=`<circle class="vertex" data-vertex="${i}" data-owner="${e.id}" cx="${p.x}" cy="${p.y}" r="8" fill="#fffefa" stroke="#287565" stroke-width="2"/><text x="${p.x+12}" y="${p.y-12}" font-size="14" fill="#287565">${String.fromCharCode(65+i)}${m.angles[i]!==undefined?" "+m.angles[i].toFixed(1)+"°":""}</text>`;});
            if(e.points.length>=2){const a=e.points[0],b=e.points[1];out+=`<circle cx="${a.x+(b.x-a.x)*pointT}" cy="${a.y+(b.y-a.y)*pointT}" r="6" fill="#d49535" pointer-events="none"/>`;}
          }
        }
      }
      for(const stroke of scene.pending)out+=`<path d="${path(stroke.points)}" fill="none" stroke="#516b5b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      if(drag?.type==="draw")out+=`<path d="${path(drag.points)}" fill="none" stroke="#287565" stroke-width="3"/>`;
      if(!["math","slides"].includes(scene.mode)&&!scene.entities.length&&!scene.pending.length)out+=`<text class="empty" x="450" y="225" text-anchor="middle">${L("Choose Draw. Try a triangle and a rectangle.","选择画笔，试着画一个三角形和一个矩形。")}</text><text class="empty" x="450" y="258" text-anchor="middle">${L("Then recognize them as two objects.","再点「识别笔画」，把它们变成两个对象。")}</text>`;
      svg.innerHTML=out;renderFacts();
    }
    function physicsSvg() {
      const p=scene.physics,v=M.physics(p,time),bound=p.bindings.map(id=>scene.entities.find(e=>e.id===id)),titles=bound.map(name);
      const text=(x,y,t)=>`<text x="${x}" y="${y}" text-anchor="middle" fill="#46624c" font-size="16">${escape(t)}</text>`;
      const block=(x,y,label,w=60)=>`<rect x="${x-w/2}" y="${y-25}" width="${w}" height="50" rx="5" fill="#e8bd75" stroke="#957944" stroke-width="2"/>${text(x,y+5,label)}`;
      let out=text(450,45,titles.join(" + "));
      if(p.kind==="incline") {
        const rad=p.angle*Math.PI/180,dx=450*Math.cos(rad),dy=450*Math.sin(rad),x=200,y=395-dy,progress=v.distance/4;
        out+=`<path d="M${x} ${y}L${x+dx} 395H${x}Z" fill="#e6eedc" stroke="#638268" stroke-width="2"/><g transform="translate(${x+dx*progress} ${y+dy*progress}) rotate(${p.angle})">${block(0,-28,titles[1],80)}</g>`;
        out+=text(450,455,`${L("Acceleration","加速度")} ${v.acceleration.toFixed(2)} m/s² · ${L("Travel","位移")} ${v.distance.toFixed(2)} m`);
      }
      if(p.kind==="pendulum") {
        const length=100+p.length*45,x=450+length*Math.sin(v.angle),y=90+length*Math.cos(v.angle);
        out+=`<path d="M360 80H540M450 80L${x} ${y}" fill="none" stroke="#638268" stroke-width="4"/><circle cx="${x}" cy="${y}" r="25" fill="#e8bd75" stroke="#957944" stroke-width="2"/>`+text(450,455,`${L("Period (small angle)","周期（小角度近似）")} ${v.period.toFixed(2)} s`);
      }
      if(p.kind==="spring") {
        const x1=260+v.left*120,x2=640+v.right*120,coil=Array.from({length:25},(_,i)=>({x:x1+42+(x2-x1-84)*i/24,y:245+(i===0||i===24?0:i%2?17:-17)}));
        out+=`<path d="M130 280H770" stroke="#b5c7b0" stroke-width="2"/><path d="${path(coil)}" fill="none" stroke="#638268" stroke-width="3"/>`+block(x1,245,`${p.mass} kg`,82)+block(x2,245,`${p.mass2} kg`,82)+text(450,430,`${L("Relative oscillation period","相对振动周期")} ${v.period.toFixed(2)} s`);
      }
      if(p.kind==="lever")out+=`<path d="M415 365L450 285L485 365Z" fill="#e6eedc" stroke="#638268" stroke-width="2"/><g transform="rotate(${v.angle*180/Math.PI} 450 280)"><path d="M200 280H700" stroke="#638268" stroke-width="9"/>${block(235,251,`${p.mass} kg`,80)}${block(665,251,`${p.mass2} kg`,80)}</g>`+text(450,440,`${L("Net torque","净力矩")} ${v.torque.toFixed(2)} N·m${v.balanced?L(" · balanced"," · 平衡"):""}`);
      return out;
    }
    function renderFacts() {
      const e=mainSelected();let facts="";
      if(scene.mode==="math"){
        if(scene.math.source==="data"){
          try{const rows=window.PENECHO_INK_TOOLS.dataset(scene.math.data),sum=rows.reduce((n,r)=>n+r.value,0);$('facts').textContent=L(`${rows.length} values\nTotal: ${sum.toFixed(2)}\nMean: ${(sum/Math.max(1,rows.length)).toFixed(2)}`,`${rows.length} 项数据\n合计：${sum.toFixed(2)}\n平均：${(sum/Math.max(1,rows.length)).toFixed(2)}`);}
          catch(error){$('facts').textContent=String(error.message||error);}
        }else $('facts').textContent=mathResult||L("Adjust parameters to explore the curve. Three expressions at most.","拖动参数探索曲线，最多支持三条表达式。");
        return;
      }
      if(scene.mode==="slides"){const slide=scene.slides[slideIndex];$('facts').textContent=slide?`${slideIndex+1} / ${scene.slides.length}\n${slide.title}\n${slide.notes}`:L("Add a scene from another tab.","从其他页面加入一个场景。");return;}
      if(scene.mode==="physics")facts=validPhysics()?L(`Bound: ${scene.physics.bindings.length} objects\nTime: ${time.toFixed(1)} s`, `已绑定 ${scene.physics.bindings.length} 个对象\n时间：${time.toFixed(1)} s`):L("Select the required shapes, then Bind objects. Or load an example.","选择所需图形后点「绑定对象」，或载入示例。");
      else if(scene.mode==="flow") {const r=run||M.flowStart(scene),names=ids=>ids.map(id=>name(scene.entities.find(e=>e.id===id))).join(" → ");facts=L("Current: ","当前：")+(r.done?L("Finished","结束"):name(scene.entities.find(e=>e.id===r.current)))+"\n"+L("Visited: ","已访问：")+names(r.visited)+"\n"+L("Queue: ","队列：")+names(r.queue)+(r.reason==="limit"?"\n"+L("100-step limit reached","已达到 100 步上限"):"");}
      else if(e) {const m=M.metrics(e);facts=`${kindLabels[e.kind]} · ${e.id}\n${L("Area","面积")} ${m.area.toFixed(1)} u²\n${L("Perimeter / length","周长 / 长度")} ${m.perimeter.toFixed(1)} u`;if(scene.mode==="geometry"&&selected.length===2){const other=scene.entities.find(x=>x.id===selected[1]);facts+="\n"+L("Area difference: ","面积差：")+Math.abs(m.area-M.metrics(other).area).toFixed(1);}}
      else facts=L(`${scene.pending.length} unrecognized strokes\nSelect an object to inspect it.`,`${scene.pending.length} 笔待识别\n选择对象查看属性。`);
      $('facts').textContent=facts;
    }
    function mathSvg() {
      try {
        const tools=window.PENECHO_INK_TOOLS;if(!tools)throw Error(L("Math library is unavailable. Reload Ink Lab.","数学库未载入，请重新打开实验室。"));
        const m=scene.math,colors=["#377c69","#cb8d3e","#677ec1"],left=75,top=55,width=750,height=360;
        let minY=-6,maxY=6,series=[],rows=[];
        if(m.source==="data") {rows=tools.dataset(m.data);minY=Math.min(0,...rows.map(r=>r.value));maxY=Math.max(1,...rows.map(r=>r.value));}
        else {const expressions=m.expression.split(";").map(s=>s.trim()).filter(Boolean);if(expressions.length>3)throw Error(L("Use at most three expressions.","最多支持三条表达式。"));series=expressions.map(text=>({text,fn:tools.compile(text,{a:m.a,b:m.b,c:m.c})}));}
        const x=value=>left+(value-m.min)/(m.max-m.min)*width,y=value=>top+height-(value-minY)/(maxY-minY)*height,zero=y(0);
        let out=`<defs><clipPath id="plot-clip"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs>`;
        for(let i=0;i<=6;i++){const gy=top+i*height/6,value=maxY-i*(maxY-minY)/6;out+=`<path d="M${left} ${gy}H${left+width}" stroke="#e0e6dc"/><text x="${left-12}" y="${gy+5}" text-anchor="end" font-size="13" fill="#768573">${value.toFixed(1)}</text>`;}
        out+=`<path d="M${left} ${top}V${top+height}H${left+width}M${left} ${zero}H${left+width}" fill="none" stroke="#82947e"/>`;
        if(m.source==="data") {
          const dx=width/Math.max(1,rows.length),ps=rows.map((r,i)=>({x:left+dx*(i+.5),y:y(r.value)}));
          rows.forEach((r,i)=>{const px=ps[i].x,py=ps[i].y;if(m.chart==="bar")out+=`<rect x="${px-dx*.3}" y="${Math.min(zero,py)}" width="${dx*.6}" height="${Math.abs(zero-py)}" rx="3" fill="#5b977b"/>`;else out+=`<circle cx="${px}" cy="${py}" r="5" fill="#377c69"/>`;out+=`<text x="${px}" y="${py-9}" text-anchor="middle" font-size="12" fill="#3f6d54">${r.value}</text><text x="${px}" y="450" text-anchor="middle" font-size="12" fill="#667c63">${escape(r.label.slice(0,12))}</text>`;});
          if(m.chart==="line")out+=`<path d="${path(ps)}" fill="none" stroke="#377c69" stroke-width="3"/>`;
        } else {
          for(let i=0;i<=6;i++){const value=m.min+i*(m.max-m.min)/6;out+=`<text x="${x(value)}" y="440" text-anchor="middle" font-size="13" fill="#768573">${value.toFixed(1)}</text>`;}
          series.forEach((curve,index)=>{let d="",previous=null;for(let i=0;i<=500;i++){const px=m.min+(m.max-m.min)*i/500,py=curve.fn(px),screenY=y(py);if(!Number.isFinite(py)||Math.abs(screenY)>10000){previous=null;continue;}const skip=!previous||Math.abs(screenY-previous.y)>height;d+=`${skip?"M":"L"}${x(px).toFixed(2)} ${screenY.toFixed(2)} `;previous={y:screenY};}out+=`<path d="${d}" fill="none" stroke="${colors[index]}" stroke-width="2.8" clip-path="url(#plot-clip)"/><text x="${left+index*250}" y="28" font-size="15" fill="${colors[index]}">${escape(curve.text.slice(0,30))}</text>`;});
        }
        return out;
      } catch(error){mathResult=String(error.message||error);return `<text x="50" y="100" fill="#9a6324" font-size="16">${escape(mathResult.slice(0,95))}</text>`;}
    }
    let vendorTextPromise=null;
    function vendorText() {
      const inline=$('ink-lab-vendor')?.textContent;if(inline)return Promise.resolve(inline);
      if(!vendorTextPromise)vendorTextPromise=(async()=>{const url=window.PENECHO_INK_VENDOR_URL;if(!url)throw Error(L("Local libraries are unavailable.","本地库不可用。"));const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error("Library load failed");return response.text();})().catch(error=>{vendorTextPromise=null;throw error;});
      return vendorTextPromise;
    }
    async function calculateMath(input, action) {
      const request=++mathRequest,signature=()=>JSON.stringify([scene.math.expression.split(";")[0].trim(),scene.math.action,scene.math.a,scene.math.b,scene.math.c]),startedWith=signature();mathWorker?.terminate();clearTimeout(mathTimer);notice(L("Calculating…","正在计算…"));
      try {
        window.PENECHO_INK_TOOLS.expression(input);
        const code=await vendorText();if(request!==mathRequest)return;const url=URL.createObjectURL(new Blob([code,'\nonmessage=e=>{try{postMessage({result:globalThis.PENECHO_INK_TOOLS.calculate(e.data.input,e.data.action,e.data.parameters)})}catch(error){postMessage({error:String(error.message||error)})}}'],{type:"text/javascript"}));
        const worker=mathWorker=new Worker(url);URL.revokeObjectURL(url);
        const finish=text=>{if(worker!==mathWorker)return;clearTimeout(mathTimer);worker.terminate();mathWorker=null;if(signature()!==startedWith)return;mathResult=String(text).slice(0,600);scene.math.result=mathResult;persist();renderFacts();notice(L("Calculation finished.","计算完成。"));};
        worker.onmessage=event=>finish(event.data.error?L("Cannot calculate: ","无法计算：")+event.data.error:event.data.result);
        worker.onerror=()=>finish(L("Calculation failed. Try a simpler expression.","计算失败，请尝试更简单的公式。"));
        mathTimer=setTimeout(()=>finish(L("Timed out after 3 seconds. Try a simpler expression.","计算超过 3 秒已停止，请简化公式。")),3000);
        worker.postMessage({input,action,parameters:{a:scene.math.a,b:scene.math.b,c:scene.math.c}});
      }catch(error){mathResult=error.message;renderFacts();notice(L("Check the expression.","请检查表达式。"));}
    }
    function svgText() {return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="800" viewBox="0 0 900 500"><style>text{font-family:Arial,sans-serif}</style>${svg.innerHTML}</svg>`;}
    async function download(data,name,type) {
      const blob=data instanceof Blob?data:new Blob([data],{type});
      if(parent!==window){const bytes=await blob.arrayBuffer();parent.postMessage({type:"penecho-living-ink-download",name,mime:type||blob.type,bytes},"*",[bytes]);return;}
      const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }
    function pngFromSvg(source) {return new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob([source],{type:"image/svg+xml"})),image=new Image();image.onload=()=>{try{const canvas=document.createElement("canvas");canvas.width=1440;canvas.height=800;const ctx=canvas.getContext("2d");ctx.fillStyle="#fffefa";ctx.fillRect(0,0,1440,800);ctx.drawImage(image,0,0,1440,800);resolve(canvas.toDataURL("image/png"));}catch(error){reject(error);}finally{URL.revokeObjectURL(url);}};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error("Image export failed"));};image.src=url;});}
    async function exportPptx() {
      const button=$('export-pptx');button.disabled=true;notice(L("Building PowerPoint…","正在生成 PowerPoint…"));stop();
      const original=scene,savedSelection=selected;
      try {
        const pptx=new window.PENECHO_INK_TOOLS.PptxGenJS();pptx.layout="LAYOUT_WIDE";pptx.author="PenEcho";pptx.subject="Ink Lab";pptx.title="Ink Lab presentation";
        for(const source of original.slides) {
          scene=source.scene;selected=[];renderStage();const data=await pngFromSvg(svgText()),slide=pptx.addSlide();
          slide.background={color:"FAF9F5"};slide.addText(source.title,{x:.55,y:.22,w:12.2,h:.6,fontSize:26,bold:true,color:"234F48",fontFace:"Arial"});
          slide.addImage({data,x:1,y:1.05,w:11.33,h:6.29});if(source.notes)slide.addNotes(source.notes);
        }
        const data=await pptx.write({outputType:"blob"});await download(data,"penecho-ink-lab.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation");notice(L("PowerPoint exported.","PowerPoint 已导出。"));
      }catch(error){notice(L("Export failed: ","导出失败：")+error.message);}finally{scene=original;selected=savedSelection;render();}
    }
    async function exportHtml() {
      try {
        const vendor=await vendorText(),data=JSON.stringify(scene).replace(/</g,"\\u003c"),style=$('ink-lab-style').textContent;
        const html=`<!doctype html><html lang="${zh?"zh":"en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PenEcho Ink Lab</title><style id="ink-lab-style">${style}</style><script id="ink-lab-vendor">${vendor.replace(/<\/script/gi,"<\\/script")}</script></head><body><script id="penecho-ink-data" type="application/json">${data}</script><script>(${mount.toString().replace(/<\/script/gi,"<\\/script")})((${M.bundleSource})(),JSON.parse(document.getElementById("penecho-ink-data").textContent),${JSON.stringify(language)});</script></body></html>`;
        await download(html,"penecho-ink-lab.html","text/html");notice(L("Standalone webpage exported; no server or AI needed.","独立网页已导出，无需服务器或 AI 即可运行。"));
      }catch(error){notice(error.message);}
    }
    $('capture-slide').onclick=()=>transact(()=>{if(scene.slides.length>=12)throw Error(L("Use at most 12 slides.","最多支持 12 张幻灯片。"));const snapshot=M.clone({...scene,slides:[]});scene.slides.push({title:labels[scene.mode]+" "+(scene.slides.length+1),notes:"",scene:snapshot});},L("Scene added. Open Slides to arrange and export it.","场景已加入演示，可在「演示」中编排和导出。"));
    $('export-svg').onclick=()=>download(svgText(),"penecho-figure.svg","image/svg+xml");
    $('export-png').onclick=async()=>{try{const data=await pngFromSvg(svgText());const bytes=Uint8Array.from(atob(data.split(",")[1]),c=>c.charCodeAt(0));download(new Blob([bytes],{type:"image/png"}),"penecho-figure.png","image/png");}catch(error){notice(error.message);}};
    $('export-html').onclick=()=>void exportHtml();
    document.addEventListener("keydown",event=>{if(!presenting||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.key==="Escape"){presenting=false;document.body.classList.remove("presenting");render();}else if(["ArrowLeft","ArrowRight"," "].includes(event.key)){event.preventDefault();slideIndex=M.clamp(slideIndex+(event.key==="ArrowLeft"?-1:1),0,scene.slides.length-1);render();}});
    function start(){playing=true;previousTime=0;playFrame=requestAnimationFrame(tick);}
    let flowElapsed=0;
    function tick(stamp) {
      if(!playing)return;const delta=previousTime?Math.min(.05,(stamp-previousTime)/1000):0;previousTime=stamp;time+=delta;
      if(scene.mode==="flow"){flowElapsed+=delta;if(flowElapsed>.75){flowElapsed=0;stepFlow();}}
      else if(scene.mode==="physics"){
        renderStage();const current=M.physics(scene.physics,time);
        if(scene.physics.kind==="incline"&&(current.distance>=4||current.stopped)||scene.physics.kind==="lever"&&(current.balanced||Math.abs(current.angle)>=.42)){stop();renderContext();}
      }
      if(playing)playFrame=requestAnimationFrame(tick);
    }
    function stepFlow(){if(!run)run=M.flowStart(scene);else run=M.flowStep(scene,run);if(run.done){stop();notice(run.reason==="limit"?L("Stopped at 100 steps. Check for a loop.","执行到 100 步已停止，请检查循环。"):L("Flow finished.","流程执行结束。"));}render();}
    function pointer(event) {const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const matrix=svg.getScreenCTM();return matrix?p.matrixTransform(matrix.inverse()):{x:0,y:0};}
    function selectObject(id,add){if(add){selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id];}else if(!selected.includes(id))selected=[id];}
    function wireAction(e,p) {
      if(e.role==="button") {const target=e.target||scene.edges.find(edge=>edge.from===e.id&&scene.entities.some(x=>x.id===edge.to&&x.role==="screen"))?.to;if(target)transact(()=>scene.activeScreen=target);else notice(L("Assign a target screen to this button.","请为按钮指定跳转页面。"));}
      if(e.role==="toggle")transact(()=>e.value=e.value?0:100);
      if(e.role==="slider") {const b=M.bounds(e.points);e.value=Math.round(M.clamp((p.x-b.x-12)/(b.w-24)*100,0,100));}
    }
    svg.addEventListener("pointerdown",event=>{
      if(event.button!==0||drag||["math","slides"].includes(scene.mode))return;event.preventDefault();stop();
      const p=pointer(event),vertex=event.target.closest('[data-vertex]'),item=event.target.closest('[data-object]'),e=scene.entities.find(e=>e.id===item?.dataset.object);
      const before=M.clone(scene);
      if(tool==="draw")drag={type:"draw",points:[p],before};
      else if(scene.mode==="physics"&&validPhysics())return;
      else if(scene.mode==="wireframe"&&wireRun&&e){if(e.role==="slider"){drag={type:"slider",eid:e.id,before};wireAction(e,p);}else{wireAction(e,p);return;}}
      else if(vertex)drag={type:"vertex",eid:vertex.dataset.owner,index:Number(vertex.dataset.vertex),before};
      else if(e){selectObject(e.id,event.shiftKey||multi);drag={type:"move",ids:[...selected],last:p,before};render();}
      else{selected=[];render();return;}
      drag.pointerId=event.pointerId;svg.setPointerCapture(event.pointerId);renderStage();
    });
    svg.addEventListener("pointermove",event=>{
      if(!drag||drag.pointerId!==event.pointerId)return;const p=pointer(event);
      if(drag.type==="draw"){if(M.distance(p,drag.points.at(-1))>2)drag.points.push(p);if(drag.points.length>2048)drag.points=M.samples(drag.points);}
      if(drag.type==="move"){M.translate(scene,drag.ids,p.x-drag.last.x,p.y-drag.last.y);drag.last=p;}
      if(drag.type==="vertex")M.moveVertex(scene.entities.find(e=>e.id===drag.eid),drag.index,p);
      if(drag.type==="slider")wireAction(scene.entities.find(e=>e.id===drag.eid),p);
      renderStage();
    });
    function finish(event,cancel=false) {
      if(!drag||drag.pointerId!==event.pointerId)return;const d=drag;drag=null;
      try {if(cancel)scene=d.before;else{if(d.type==="draw")M.addStroke(scene,d.points);scene=M.validate(scene);if(JSON.stringify(scene)!==JSON.stringify(d.before)){history.push(d.before);if(history.length>40)history.shift();future=[];persist();}}}
      catch(error){scene=d.before;notice(error.message);}
      if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);render();
    }
    svg.addEventListener("pointerup",event=>finish(event));svg.addEventListener("pointercancel",event=>finish(event,true));svg.addEventListener("lostpointercapture",event=>finish(event,true));
    svg.addEventListener("keydown",event=>{
      const e=scene.entities.find(e=>e.id===event.target.closest('[data-object]')?.dataset.object);if(!e)return;
      if(event.key==="Enter"||event.key===" "){event.preventDefault();if(wireRun){if(e.role==="slider")transact(()=>e.value=(e.value+10)%110);else wireAction(e,M.center(e));}else{selectObject(e.id,event.shiftKey||multi);render();}}
      if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();if(wireRun&&e.role==="slider")transact(()=>e.value=M.clamp(e.value+(event.key==="ArrowLeft"||event.key==="ArrowDown"?-5:5),0,100));else if(!wireRun)transact(()=>M.translate(scene,[e.id],event.key==="ArrowLeft"?-5:event.key==="ArrowRight"?5:0,event.key==="ArrowUp"?-5:event.key==="ArrowDown"?5:0));}
    });
    $('load').onclick=()=>replace(M.preset($('demo').value));
    $('modes').onclick=event=>{const mode=event.target.dataset.mode;if(!mode)return;stop();wireRun=false;run=null;time=0;transact(()=>scene.mode=mode);};
    $('draw').onclick=()=>{stop();wireRun=false;tool="draw";render();};$('select').onclick=()=>{tool="select";render();};
    $('recognize').onclick=()=>transact(()=>{M.recognize(scene);tool="select";},L("Strokes are now editable objects.","笔画已转为可编辑对象。"));
    $('multi').onclick=()=>{multi=!multi;render();};
    $('group').onclick=()=>transact(()=>M.group(scene,selected));
    $('ungroup').onclick=()=>transact(()=>{const groups=scene.entities.filter(e=>selected.includes(e.id)).map(e=>e.group);scene.entities.filter(e=>groups.includes(e.group)).forEach(e=>e.group="");});
    $('connect').onclick=()=>transact(()=>{M.connect(scene,selected[0],selected[1],$('edge-label').value);run=null;});
    $('disconnect').onclick=()=>transact(()=>{scene.edges=scene.edges.filter(e=>!(selected.includes(e.from)&&selected.includes(e.to)));run=null;});
    $('delete').onclick=()=>transact(()=>{M.remove(scene,selected);selected=[];run=null;});
    $('undo').onclick=()=>{if(!history.length)return;stop();future.push(M.clone(scene));scene=history.pop();mathResult=scene.math.result||"";selected=[];run=null;time=0;persist();render();};
    $('redo').onclick=()=>{if(!future.length)return;stop();history.push(M.clone(scene));scene=future.pop();mathResult=scene.math.result||"";selected=[];run=null;time=0;persist();render();};
    $('objects').onchange=()=>{selected=Array.from($('objects').selectedOptions,o=>o.value);render();};
    $('edge-label').onchange=event=>{if(selected.length===2)transact(()=>scene.edges.filter(e=>selected.includes(e.from)&&selected.includes(e.to)).forEach(e=>e.label=event.target.value));};
    $('label').onchange=event=>transact(()=>{const e=mainSelected();if(e)e.label=event.target.value;});
    $('role').onchange=event=>transact(()=>{const e=mainSelected();if(e)e.role=event.target.value;M.assignParents(scene);run=null;});
    $('target').onchange=event=>transact(()=>{const e=mainSelected();if(e)e.target=event.target.value;});
    addEventListener("message",event=>{if(event.source===parent&&event.data?.type==="penecho-living-ink-saved"&&event.data.revision===revision)$('saved').textContent=event.data.ok?L("Saved in this Canvas","已保存到当前画布"):L("Save failed — undo the last edit","保存失败，请撤销刚才的编辑");});
    addEventListener("pagehide",()=>{stop();mathRequest++;mathWorker?.terminate();clearTimeout(mathTimer);});document.addEventListener("visibilitychange",()=>{if(document.hidden){stop();renderContext();}});
    render();notice(L("Choose an example, or draw your own shapes.","可以载入示例，也可以用画笔画自己的图形。"));
  }
  function createHtml(input, language="en") {
    const scene=M.validate(input),data=JSON.stringify(scene).replace(/</g,"\\u003c"),lang=language==="zh"?"zh":"en";
    const html=`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ink Lab</title><style id="ink-lab-style">${STYLE}</style></head><body><script id="penecho-ink-data" type="application/json">${data}</script><script>(${mount.toString().replace(/<\/script/gi,"<\\/script")})((${M.bundleSource})(),JSON.parse(document.getElementById("penecho-ink-data").textContent),${JSON.stringify(lang)});</script></body></html>`;
    if(html.length>200000)throw Error("This ink scene is too large to save");return html;
  }
  function extractScene(html) {
    const match=String(html).match(/<script id="penecho-ink-data" type="application\/json">([^]*?)<\/script>/);
    if(!match)throw Error("Missing ink scene data");return M.validate(JSON.parse(match[1]));
  }
  return {createHtml,extractScene};
});
