"use strict";
// Portable, deterministic scene data. No DOM, network, or generated code is needed.
(function(root, factory) {
  const api = factory();
  api.bundleSource = factory.toString();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_LIVING_INK_MODEL = api;
})(typeof globalThis === "object" ? globalThis : this, function livingInkModel() {
  const VERSION = 1, MAX_BYTES = 90000, MAX_ENTITIES = 64, MAX_STROKES = 48;
  const modes = ["objects", "geometry", "math", "physics", "wireframe", "flow", "slides"];
  const kinds = ["triangle", "rectangle", "polygon", "circle", "ellipse", "line", "ink"];
  const roles = ["node", "start", "branch", "screen", "button", "toggle", "slider"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const round = n => Math.round(n * 10) / 10;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const center = e => {
    if(["triangle","rectangle","polygon"].includes(e.kind))return {x:e.points.reduce((n,p)=>n+p.x,0)/e.points.length,y:e.points.reduce((n,p)=>n+p.y,0)/e.points.length};
    const b = bounds(e.points);return { x:b.x + b.w / 2, y:b.y + b.h / 2 };
  };
  function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w:Math.max(...xs) - x, h:Math.max(...ys) - y };
  }
  function empty() {
    return { version:VERSION, nextId:1, mode:"objects", entities:[], edges:[], pending:[],
      physics:{ kind:"incline", angle:30, friction:0.15, mass:1, mass2:1, length:2, stiffness:8, amplitude:25, bindings:[] },
      flow:{ branch:true, traversal:"path" }, activeScreen:"",
      math:{expression:"a*sin(x)+b; cos(x)",a:1,b:0,c:0,min:-6,max:6,source:"functions",chart:"bar",data:"Mon,12\nTue,18\nWed,15\nThu,24\nFri,29",action:"derivative",result:""},slides:[] };
  }
  function id(scene, prefix = "e") { return prefix + scene.nextId++; }
  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 10000 || Math.abs(p.y) > 10000) throw Error("Invalid scene coordinates");
    return { x:round(p.x), y:round(p.y) };
  }
  function text(s, max = 60) { return typeof s === "string" ? s.slice(0, max) : ""; }
  function validate(value) {
    if (!value || value.version !== VERSION || JSON.stringify(value).length > MAX_BYTES) throw Error("Invalid or oversized ink scene");
    if (!Array.isArray(value.entities) || value.entities.length > MAX_ENTITIES || !Array.isArray(value.edges) || value.edges.length > 96 || !Array.isArray(value.pending) || value.pending.length > MAX_STROKES) throw Error("Scene limit reached");
    const s = empty(), ids = new Set();
    s.nextId = Number.isInteger(value.nextId) && value.nextId > 0 && value.nextId < 1e8 ? value.nextId : 1;
    s.mode = modes.includes(value.mode) ? value.mode : "objects";
    const identifier = v => { if (typeof v !== "string" || !/^[a-z]\d{1,8}$/.test(v) || ids.has(v)) throw Error("Invalid scene ID"); ids.add(v); s.nextId = Math.max(s.nextId, Number(v.slice(1)) + 1); return v; };
    const strokes = input => input.map(stroke => {
      if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 128) throw Error("Invalid stroke");
      return { id:identifier(stroke.id), points:stroke.points.map(point) };
    });
    for (const e of value.entities) {
      if (!kinds.includes(e.kind) || !Array.isArray(e.points) || e.points.length < 2 || e.points.length > 128 || !Array.isArray(e.ink) || e.ink.length > MAX_STROKES) throw Error("Invalid entity");
      s.entities.push({ id:identifier(e.id), kind:e.kind, points:e.points.map(point), ink:strokes(e.ink), label:text(e.label),
        group:/^g\d{1,8}$/.test(e.group || "") ? e.group : "", role:roles.includes(e.role) ? e.role : "node",
        parent:text(e.parent, 16), target:text(e.target, 16), value:clamp(Number(e.value) || 0, 0, 100), rightAngle:e.rightAngle === true });
    }
    const entityIds = new Set(s.entities.map(e => e.id));
    for (const e of s.entities) {
      if (!entityIds.has(e.parent) || e.parent === e.id) e.parent = "";
      if (!entityIds.has(e.target)) e.target = "";
    }
    for (const edge of value.edges) {
      if (!entityIds.has(edge.from) || !entityIds.has(edge.to) || edge.from === edge.to || !Array.isArray(edge.ink) || edge.ink.length > 8) throw Error("Invalid edge");
      s.edges.push({ id:identifier(edge.id), from:edge.from, to:edge.to, label:text(edge.label, 24), ink:strokes(edge.ink) });
    }
    s.pending = strokes(value.pending);
    const p = value.physics || {};
    s.physics = { kind:["incline", "pendulum", "spring", "lever"].includes(p.kind) ? p.kind : "incline",
      angle:clamp(Number(p.angle) || 0, 0, 70), friction:clamp(Number(p.friction) || 0, 0, 1),
      mass:clamp(Number(p.mass) || 1, .1, 10), mass2:clamp(Number(p.mass2) || 1, .1, 10),
      length:clamp(Number(p.length) || 2, .5, 5), stiffness:clamp(Number(p.stiffness) || 8, 1, 30),
      amplitude:clamp(Number(p.amplitude) || 0, 0, 60),
      bindings:Array.isArray(p.bindings) ? [...new Set(p.bindings.filter(x => entityIds.has(x)))].slice(0, 4) : [] };
    s.flow = { branch:value.flow?.branch !== false, traversal:value.flow?.traversal === "breadth" ? "breadth" : "path" };
    s.activeScreen = entityIds.has(value.activeScreen) ? value.activeScreen : "";
    const math=value.math||{};
    s.math={expression:text(math.expression||s.math.expression,480),a:clamp(Number(math.a??1)||0,-5,5),b:clamp(Number(math.b)||0,-5,5),c:clamp(Number(math.c)||0,-5,5),
      min:clamp(Number(math.min??-6),-100,99),max:clamp(Number(math.max??6),-99,100),source:math.source==="data"?"data":"functions",chart:math.chart==="line"?"line":"bar",data:text(math.data||s.math.data,2000),action:["derivative","integral","solve","simplify","evaluate"].includes(math.action)?math.action:"derivative",result:text(math.result,600)};
    if(!Number.isFinite(s.math.min)||!Number.isFinite(s.math.max)||s.math.max-s.math.min<.1)throw Error("Invalid plot range");
    if(value.slides!==undefined) {
      if(!Array.isArray(value.slides)||value.slides.length>12)throw Error("Use at most 12 slides");
      s.slides=value.slides.map(slide=>{
        if(!slide.scene||slide.scene.mode==="slides"||slide.scene.slides?.length)throw Error("Invalid slide scene");
        return {title:text(slide.title,100),notes:text(slide.notes,600),scene:validate({...slide.scene,slides:[]})};
      });
    }
    if (JSON.stringify(s).length > MAX_BYTES) throw Error("Scene limit reached");
    return s;
  }
  // Keep corners while dropping redundant co-linear samples, including separate pen strokes.
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1), 0, 1);
    return distance(p, { x:a.x+t*dx, y:a.y+t*dy });
  }
  function simplify(points, epsilon = 2) {
    if (points.length <= 2) return points.map(point);
    let far = 0, index = 0;
    for (let i=1; i<points.length-1; i++) { const d=segmentDistance(points[i],points[0],points.at(-1)); if(d>far){far=d;index=i;} }
    if (far <= epsilon) return [point(points[0]), point(points.at(-1))];
    return [...simplify(points.slice(0,index+1),epsilon).slice(0,-1),...simplify(points.slice(index),epsilon)];
  }
  function samples(points) {
    let out = simplify(points, 1.2);
    if (out.length > 128) out = Array.from({length:128}, (_,i) => out[Math.round(i*(out.length-1)/127)]);
    return out;
  }
  function fit(points) {
    const b = bounds(points), diagonal = Math.hypot(b.w,b.h);
    if (diagonal < 8) return null;
    const start = points[0], end = points.at(-1), closed = distance(start,end) < Math.max(12,diagonal*.19);
    if (!closed && points.every(p=>segmentDistance(p,start,end)<Math.max(4,diagonal*.05))) return {kind:"line",points:[start,end]};
    if (!closed || b.w < 10 || b.h < 10) return null;
    let polygon = simplify([...points.slice(0,-1),start], Math.max(3,diagonal*.055)).slice(0,-1);
    // A pen can start in the middle of an edge. Remove that collinear seam too.
    for(let i=polygon.length-1;i>=0&&polygon.length>3;i--) if(segmentDistance(polygon[i],polygon[(i+polygon.length-1)%polygon.length],polygon[(i+1)%polygon.length])<diagonal*.06) polygon.splice(i,1);
    if (polygon.length === 3) return {kind:"triangle", points:polygon};
    if (polygon.length === 4) {
      const angles = metrics({kind:"polygon",points:polygon}).angles;
      return { kind:angles.every(a=>Math.abs(a-90)<22)?"rectangle":"polygon", points:polygon };
    }
    const cx=b.x+b.w/2,cy=b.y+b.h/2,radial=points.map(p=>Math.hypot((p.x-cx)/(b.w/2),(p.y-cy)/(b.h/2)));
    if(radial.reduce((s,r)=>s+Math.abs(r-1),0)/radial.length<.15) return {kind:Math.abs(b.w-b.h)/Math.max(b.w,b.h)<.18?"circle":"ellipse",points:[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}]};
    return null;
  }
  function addStroke(s, points) {
    if(s.pending.length>=MAX_STROKES) throw Error("Recognize the current strokes before drawing more");
    const ps=samples(points); if(ps.length<2 || distance(ps[0],ps.at(-1))<1 && ps.length===2)return;
    s.pending.push({id:id(s,"s"),points:ps});
  }
  function entity(s, kind, points, label="", ink=[]) {
    if(s.entities.length>=MAX_ENTITIES)throw Error("This scene supports up to 64 objects");
    const e={id:id(s),kind,points:points.map(point),ink:clone(ink),label,group:"",role:"node",parent:"",target:"",value:0,rightAngle:false};
    s.entities.push(e);return e;
  }
  function connect(s, from, to, label="", ink=[]) {
    if(from===to || !s.entities.some(e=>e.id===from) || !s.entities.some(e=>e.id===to))throw Error("Select two different objects");
    if(s.edges.length>=96)throw Error("Connection limit reached");
    const edge={id:id(s,"l"),from,to,label:text(label,24),ink:clone(ink)};s.edges.push(edge);return edge;
  }
  function recognize(s) {
    const strokes=s.pending, used=new Set(), lines=[];
    let count=0;
    strokes.forEach((stroke,i)=>{const f=fit(stroke.points);if(f&&f.kind!=="line"){entity(s,f.kind,f.points,"",[stroke]);used.add(i);count++;}else if(f)lines.push({i,stroke,f});});
    // Assemble 3–4 separate straight strokes into a closed shape. Do not merge touching closed objects.
    for(const first of lines) {
      if(used.has(first.i))continue;
      const search=(chain,vertices)=>{
        if(chain.length>=3 && distance(vertices.at(-1),vertices[0])<18) return {chain,vertices:vertices.slice(0,-1)};
        if(chain.length>=4)return null;
        for(const next of lines) {
          if(used.has(next.i)||chain.includes(next))continue;
          const [a,b]=next.f.points, end=vertices.at(-1);
          const target=distance(end,a)<18?b:distance(end,b)<18?a:null;
          if(target){const found=search([...chain,next],[...vertices,target]);if(found)return found;}
        }return null;
      };
      const found=search([first],[...first.f.points]);
      if(found){const ps=found.vertices;entity(s,ps.length===3?"triangle":metrics({kind:"polygon",points:ps}).angles.every(a=>Math.abs(a-90)<22)?"rectangle":"polygon",ps,"",found.chain.map(l=>l.stroke));found.chain.forEach(l=>used.add(l.i));count++;}
    }
    strokes.forEach((stroke,i)=>{if(!used.has(i)){const f=fit(stroke.points);entity(s,f?.kind||"ink",f?.points||stroke.points,"",[stroke]);count++;}});
    s.pending=[];
    // Turn connecting lines into attached edges while preserving their original vectors.
    for(const line of [...s.entities].filter(e=>e.kind==="line")) {
      const nearest=p=>s.entities.filter(e=>!["line","ink"].includes(e.kind)).map(e=>({e,d:boxDistance(p,bounds(e.points))})).sort((a,b)=>a.d-b.d)[0];
      const a=nearest(line.points[0]),b=nearest(line.points.at(-1));
      if(a&&b&&a.e!==b.e&&a.d<35&&b.d<35){connect(s,a.e.id,b.e.id,"",line.ink);s.entities=s.entities.filter(e=>e!==line);}
    }
    assignParents(s);return count;
  }
  function boxDistance(p,b) {return Math.hypot(Math.max(b.x-p.x,0,p.x-b.x-b.w),Math.max(b.y-p.y,0,p.y-b.y-b.h));}
  function translate(s, ids, dx, dy) {
    const groups=new Set(s.entities.filter(e=>ids.includes(e.id)&&e.group).map(e=>e.group));
    const selected=new Set(s.entities.filter(e=>ids.includes(e.id)||groups.has(e.group)).map(e=>e.id));
    s.entities.forEach(e=>{if(selected.has(e.parent))selected.add(e.id);});
    for(const e of s.entities.filter(e=>selected.has(e.id))){e.points=e.points.map(p=>point({x:p.x+dx,y:p.y+dy}));e.ink.forEach(stroke=>stroke.points=stroke.points.map(p=>point({x:p.x+dx,y:p.y+dy})));}
  }
  function group(s, ids) { const name=id(s,"g");s.entities.filter(e=>ids.includes(e.id)).forEach(e=>e.group=name);return name; }
  function remove(s, ids) {
    s.entities=s.entities.filter(e=>!ids.includes(e.id));s.edges=s.edges.filter(e=>!ids.includes(e.from)&&!ids.includes(e.to));
    s.entities.forEach(e=>{if(ids.includes(e.parent))e.parent="";if(ids.includes(e.target))e.target="";});
    s.physics.bindings=s.physics.bindings.filter(x=>!ids.includes(x));if(ids.includes(s.activeScreen))s.activeScreen="";
  }
  function anchors(s, edge) {
    const a=s.entities.find(e=>e.id===edge.from),b=s.entities.find(e=>e.id===edge.to);if(!a||!b)return null;
    const ca=center(a),cb=center(b);
    function border(e,c,other){
      const box=bounds(e.points),dx=other.x-c.x,dy=other.y-c.y;
      if(["circle","ellipse"].includes(e.kind)){const scale=1/(Math.hypot(dx/(box.w/2||1),dy/(box.h/2||1))||1);return {x:c.x+dx*scale,y:c.y+dy*scale};}
      const cross=(ax,ay,bx,by)=>ax*by-ay*bx;let nearest=Infinity;
      if(!["line","ink"].includes(e.kind))for(let i=0;i<e.points.length;i++){
        const a=e.points[i],b=e.points[(i+1)%e.points.length],sx=b.x-a.x,sy=b.y-a.y,den=cross(dx,dy,sx,sy);if(Math.abs(den)<1e-8)continue;
        const t=cross(a.x-c.x,a.y-c.y,sx,sy)/den,u=cross(a.x-c.x,a.y-c.y,dx,dy)/den;
        if(t>=0&&u>=0&&u<=1)nearest=Math.min(nearest,t);
      }
      return Number.isFinite(nearest)?{x:c.x+dx*nearest,y:c.y+dy*nearest}:c;
    }
    return [border(a,ca,cb),border(b,cb,ca)];
  }
  function metrics(e) {
    const ps=e.points,b=bounds(ps);
    if(["circle","ellipse"].includes(e.kind)){const a=b.w/2,c=b.h/2;return {area:Math.PI*a*c,perimeter:Math.PI*(3*(a+c)-Math.sqrt((3*a+c)*(a+3*c))),angles:[],lengths:[]};}
    const closed=!["line","ink"].includes(e.kind),lengths=[],angles=[];
    let area=0;
    for(let i=0;i<ps.length;i++) {const a=ps[i],b=ps[(i+1)%ps.length],p=ps[(i+ps.length-1)%ps.length];area+=a.x*b.y-b.x*a.y;if(closed||i<ps.length-1)lengths.push(distance(a,b));if(closed){const d=distance(a,b)*distance(a,p);angles.push(d<1e-8?0:Math.acos(clamp(((b.x-a.x)*(p.x-a.x)+(b.y-a.y)*(p.y-a.y))/d,-1,1))*180/Math.PI);}}
    return {area:closed?Math.abs(area)/2:0,perimeter:lengths.reduce((a,b)=>a+b,0),angles,lengths};
  }
  function moveVertex(e,index,p) {
    if(index<0||index>=e.points.length)return;
    const old=clone(e.points);e.points[index]=point(p);
    // Right angle at vertex B: project C onto the normal of AB, preserving its signed height.
    if(e.rightAngle&&e.points.length===3) {
      const [a,b,c]=e.points,dx=a.x-b.x,dy=a.y-b.y,length=Math.hypot(dx,dy);
      if(length<1){e.points=old;return;}
      const nx=-dy/length,ny=dx/length,h=(c.x-b.x)*nx+(c.y-b.y)*ny;
      e.points[2]=point({x:b.x+nx*(Math.abs(h)<1?1:h),y:b.y+ny*(Math.abs(h)<1?1:h)});
    }
  }
  function mirror(s, eid) {
    const original=s.entities.find(e=>e.id===eid);if(!original)return null;
    const b=bounds(original.points),e=entity(s,original.kind,original.points.map(p=>({x:b.x+b.w+40+(b.x+b.w-p.x),y:p.y})),original.label,[]);
    e.rightAngle=original.rightAngle;return e;
  }
  function assignParents(s) {
    const screens=s.entities.filter(e=>e.role==="screen");
    for(const e of s.entities.filter(e=>e.role!=="screen")){const c=center(e);e.parent=screens.filter(p=>boxDistance(c,bounds(p.points))===0).sort((a,b)=>metrics(a).area-metrics(b).area)[0]?.id||"";}
    if(!s.activeScreen)s.activeScreen=screens[0]?.id||"";
  }
  function bindPhysics(s, selected=[]) {
    const all=s.entities.filter(e=>!selected.length||selected.includes(e.id)), solid=e=>!["ink","line"].includes(e.kind);
    let bound=[];
    if(s.physics.kind==="incline")bound=[all.find(e=>e.kind==="triangle"),all.find(e=>["rectangle","polygon"].includes(e.kind))];
    if(s.physics.kind==="pendulum")bound=[all.find(e=>e.kind==="line"),all.find(e=>["circle","ellipse"].includes(e.kind))];
    if(s.physics.kind==="spring")bound=all.filter(solid).slice(0,2);
    if(s.physics.kind==="lever")bound=[all.find(e=>e.kind==="triangle"),...all.filter(e=>solid(e)&&e.kind!=="triangle").slice(0,2)];
    if(bound.some(e=>!e)||bound.length<(s.physics.kind==="lever"?3:2))return false;
    s.physics.bindings=bound.map(e=>e.id);return true;
  }
  function physics(p, time) {
    const t=Math.max(0,Number(time)||0),g=9.81,theta=p.angle*Math.PI/180;
    if(p.kind==="incline"){const acceleration=g*Math.max(0,Math.sin(theta)-p.friction*Math.cos(theta));return {acceleration,distance:Math.min(4,.5*acceleration*t*t),velocity:Math.min(Math.sqrt(8*acceleration),acceleration*t),stopped:acceleration===0};}
    if(p.kind==="pendulum"){const omega=Math.sqrt(g/p.length);return {angle:p.amplitude*Math.PI/180*Math.cos(omega*t),period:2*Math.PI/omega};}
    if(p.kind==="spring"){const omega=Math.sqrt(p.stiffness*(1/p.mass+1/p.mass2)),delta=.8*Math.cos(omega*t);return {left:-delta*p.mass2/(p.mass+p.mass2),right:delta*p.mass/(p.mass+p.mass2),period:2*Math.PI/omega};}
    const torque=g*(p.mass2-p.mass)*p.length/2;return {torque,angle:Math.sign(torque)*Math.min(.42,Math.abs(torque)*t*t/80),balanced:Math.abs(torque)<1e-8};
  }
  function flowStart(s) {return { current:s.entities.find(e=>e.role==="start")?.id||s.entities.find(e=>!s.edges.some(l=>l.to===e.id))?.id||s.entities[0]?.id||"",queue:[],visited:[],steps:0,done:false,reason:"" };}
  function flowStep(s,run) {
    const next=clone(run);if(next.done)return next;
    if(!next.current){next.done=true;next.reason="empty";return next;}
    next.visited.push(next.current);next.steps++;
    if(next.steps>=100){next.done=true;next.reason="limit";return next;}
    let edges=s.edges.filter(e=>e.from===next.current);
    if(s.entities.find(e=>e.id===next.current)?.role==="branch")edges=edges.filter(e=>e.label.toLowerCase()===(s.flow.branch?"yes":"no"));
    if(s.flow.traversal==="breadth") {
      for(const edge of edges)if(!next.visited.includes(edge.to)&&!next.queue.includes(edge.to))next.queue.push(edge.to);
      next.current=next.queue.shift()||"";
    }else next.current=edges[0]?.to||"";
    if(!next.current){next.done=true;next.reason="end";}return next;
  }
  function importStrokes(input) {
    const s=empty(),all=input.flatMap(stroke=>stroke.points),b=all.length?bounds(all):{x:0,y:0,w:1,h:1},scale=Math.min(1,760/Math.max(1,b.w),380/Math.max(1,b.h));
    for(const stroke of input.slice(-MAX_STROKES))addStroke(s,stroke.points.map(p=>({x:70+(p.x-b.x)*scale,y:50+(p.y-b.y)*scale})));
    recognize(s);return s;
  }
  function recentObjectOffer(input) {
    const candidates=input.slice(-12);
    // Unrelated handwriting before the newest shapes must not suppress their action.
    for(let first=0;first<candidates.length-1;first++){
      const strokes=candidates.slice(first),scene=importStrokes(strokes),closed=scene.entities.filter(e=>!["ink","line"].includes(e.kind));
      if(closed.length>=2&&closed.length>=scene.entities.length*.7&&closed.some(e=>e.ink.some(s=>s.id==="s"+strokes.length)))return {strokes,count:closed.length};
    }
    return null;
  }
  function preset(name) {
    const s=empty(),rect=(x,y,w,h,label="")=>entity(s,"rectangle",[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],label),
      tri=()=>entity(s,"triangle",[{x:130,y:340},{x:130,y:120},{x:430,y:340}]),
      circle=(x,y,r,label="")=>entity(s,"circle",[{x:x-r,y:y-r},{x:x+r,y:y+r}],label);
    if(name==="blank")return s;
    if(name==="math"||name==="data"){s.mode="math";if(name==="data")s.math.source="data";}
    if(name==="slides") {
      s.mode="slides";
      s.slides=[{title:"Explore a shape",notes:"Drag vertices and compare areas.",scene:preset("geometry")},{title:"From shape to experiment",notes:"Change the angle and friction.",scene:preset("incline")},{title:"Explore a function",notes:"Change a, b, and c.",scene:preset("math")}];
    }
    if(["objects","geometry","incline"].includes(name)){tri();rect(490,180,130,90);s.mode=name==="incline"?"physics":name;}
    if(name==="pendulum"){entity(s,"line",[{x:420,y:80},{x:520,y:300}]);circle(520,330,30);s.mode="physics";}
    if(name==="spring"){rect(220,210,90,70);rect(580,210,90,70);s.mode="physics";}
    if(name==="lever"){tri();rect(240,160,65,65);rect(600,160,65,65);s.mode="physics";}
    if(s.mode==="physics"){s.physics.kind=name;bindPhysics(s);}
    if(name==="wireframe") {
      s.mode="wireframe";
      const a=rect(60,50,320,390,"Home"),b=rect(500,50,320,390,"Details");a.role=b.role="screen";
      const go=rect(100,150,240,55,"Open details");go.role="button";go.target=b.id;
      const toggle=rect(100,235,110,46,"Notifications");toggle.role="toggle";
      const slider=rect(100,320,235,36,"Volume");slider.role="slider";slider.value=35;
      const back=rect(540,155,240,55,"Back");back.role="button";back.target=a.id;
      connect(s,go.id,b.id,"open");connect(s,back.id,a.id,"back");assignParents(s);
    }
    if(name==="flow"||name==="tree") {
      s.mode="flow";s.flow.traversal=name==="tree"?"breadth":"path";
      const a=rect(350,45,180,65,"Start"),b=rect(350,185,180,65,name==="tree"?"A":"Ready?");a.role="start";b.role=name==="tree"?"node":"branch";
      const c=rect(110,340,180,65,name==="tree"?"B":"Continue"),d=rect(590,340,180,65,name==="tree"?"C":"Retry");
      connect(s,a.id,b.id);connect(s,b.id,c.id,name==="tree"?"":"yes");connect(s,b.id,d.id,name==="tree"?"":"no");
    }
    return s;
  }
  return {bundleSource:livingInkModel.toString(),VERSION,MAX_BYTES,MAX_ENTITIES,MAX_STROKES,modes,kinds,roles,clone,clamp,bounds,center,distance,empty,validate,samples,fit,addStroke,entity,connect,recognize,translate,group,remove,anchors,metrics,moveVertex,mirror,assignParents,bindPhysics,physics,flowStart,flowStep,importStrokes,recentObjectOffer,preset};
});
