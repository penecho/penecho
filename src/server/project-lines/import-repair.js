"use strict";
// Offline, explicit repair only. This module is never loaded by page requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const F = require("./format.js"), Shared = require("./import-state.js");
const digest = text => crypto.createHash("sha256").update(text).digest("hex");
const valid = slug => typeof slug === "string" && slug && !/[\\/\0]/.test(slug) && ![".",".."].includes(slug);
const textAt = file => fs.readFileSync(file, "utf8");
function plan(docs, states) {
  const grouped = new Map();
  for (const state of states) {
    const project = JSON.parse(textAt(path.join(state,"projects.json"))).projects.find(p => path.resolve(p.docsPath) === path.resolve(docs));
    if (!project) continue;
    for (const [key,rec] of Object.entries(JSON.parse(textAt(path.join(state,"conversations.json"))))) {
      if (rec.projectId !== project.id || !valid(rec.slug) || !fs.existsSync(path.join(docs,"lines",rec.slug+".md"))) continue;
      const list=grouped.get(key)||[];list.push({state,rec});grouped.set(key,list);
    }
  }
  const pairs=[];
  for(const [session,records] of grouped) {
    const slugs=[...new Set(records.map(r=>r.rec.slug))]; if(slugs.length!==2)continue;
    const lines=slugs.map(slug=>{const text=textAt(path.join(docs,"lines",slug+".md")),doc=F.parseLine(text);return{slug,text,doc,hash:digest(text)}});
    if(lines.some(l=>!["done","ready","stopped"].includes(l.doc.status)))continue;
    // Prefer the fuller history; an equal history keeps the first supplied app's Line.
    lines.sort((a,b)=>b.doc.steps.length-a.doc.steps.length);
    const [keep,gone]=lines, norm=t=>slugs.reduce((s,slug)=>s.split(slug).join("__LINE__"),t).replace(/<!--[^]*?-->/g,"").trim();
    const detail=(slug,step)=>{
      const rel=`works/${slug}/${step.id}.md`, full=path.join(docs,rel);
      if(!fs.existsSync(full))return{rel,text:"",hash:"",key:JSON.stringify([step.out,step.took])};
      const text=textAt(full),front=F.splitFront(text).front;
      const result=norm(F.sectionText(text,"Result") || F.splitFront(text).body);
      return{rel,text,hash:digest(text),result,started:front.started,ended:front.ended,key:JSON.stringify([result,front.started||""])};
    };
    const works=keep.doc.steps.filter(F.AGENT_LIKE).map(s=>({step:s,...detail(keep.slug,s)}));
    const stepMap={},reviews=[],extra=[];let blocked="";
    for(const step of gone.doc.steps) {
      if(F.AGENT_LIKE(step)) {
        const d=detail(gone.slug,step),match=works.find(w=>w.key===d.key || (d.result?.length >= 80 && w.result?.includes(d.result) && ((d.started && d.started===w.started) || (d.ended && d.ended===w.ended))));
        if(!match){blocked=`Distinct ${step.label} needs a reviewed merge; neither history was removed.`;break;}
        stepMap[step.id]=match.step.id;
        if(d.text&&match.text){const source=F.splitFront(d.text).front,target=F.splitFront(match.text).front,patch={};for(const k of ["reviewed","rating","rating note"])if(source[k]&&(!target[k] || k==="reviewed"&&String(source[k])>String(target[k])))patch[k]=source[k];if(Object.keys(patch).length)reviews.push({file:match.rel,hash:match.hash,text:F.setFront(match.text,patch)});}
      } else if(!keep.doc.steps.some(s=>s.kind===step.kind&&norm(s.body)===norm(step.body))) extra.push({...step,num:0});
    }
    const rebase=body=>body.replace(/\]\(([^)]+)\)/g,(whole,href)=>{
      if(/^(?:[a-z]+:|#)/i.test(href))return whole;
      const abs=path.resolve(docs,"lines",href), rel=path.relative(docs,abs).split(path.sep).join("/");
      if(rel===`lines/${gone.slug}.md`||rel.startsWith(`works/${gone.slug}/`)||rel.startsWith(`files/${gone.slug}/`))return `](../archive/${rel})`;
      return whole;
    });
    let merged=extra.length?F.updateSteps(keep.text,steps=>steps.push(...extra.map(s=>({...s,body:rebase(s.body)})))):keep.text;
    const history=`[Preserved duplicate history](../archive/lines/${gone.slug}.md)`;
    merged=F.setAbove(merged,"Recovered history",[F.sectionText(merged,"Recovered history"),history].filter(Boolean).join("\n\n"));
    const canonical=F.parseLine(merged);
    const source=records.slice().sort((a,b)=>(b.rec.offset||0)-(a.rec.offset||0)||Object.keys(b.rec.doneTurns||{}).length-Object.keys(a.rec.doneTurns||{}).length)[0].rec;
    const rec=JSON.parse(JSON.stringify(source)), original=source.slug;
    rec.slug=keep.slug;rec.reservedSlug=keep.slug;rec.active=false;
    if(original===gone.slug){rec.stepId=stepMap[rec.stepId]||rec.stepId;rec.appStep=stepMap[rec.appStep]||rec.appStep;}
    for(const k of ["projectId","readBy","here","runOwner","resync"])delete rec[k];
    for(const r of records)Object.assign(rec.doneTurns||={},r.rec.doneTurns||{});
    pairs.push({session,keep:keep.slug,gone:gone.slug,ids:[keep.doc.front.id,gone.doc.front.id],keepHash:keep.hash,goneHash:gone.hash,keepText:merged,goneText:F.setAbove(F.setFront(gone.text,{status:"closed","before archive":gone.doc.status,"merged into":keep.slug}),"Retained Line",`This duplicate import is preserved here. Continue in [${canonical.title}](../../lines/${keep.slug}.md).`),stepMap,reviews,extraSteps:extra.map(s=>({kind:s.kind,text:s.text})),checkpoint:{version:1,owner:docs,reader:"",record:rec},blocked});
  }
  return{version:1,docs,states,created:new Date().toISOString(),pairs};
}
function apply(repair, backup) {
  if(repair.version!==1||!path.isAbsolute(repair.docs)||!path.isAbsolute(backup))throw Error("Use an absolute docs and backup folder.");
  const docs=repair.docs;
  for(const pair of repair.pairs){
    if(!valid(pair.keep)||!valid(pair.gone)||pair.blocked)throw Error(pair.blocked||"Invalid Line path");
    for(const [slug,expected]of[[pair.keep,pair.keepHash],[pair.gone,pair.goneHash]])if(digest(textAt(path.join(docs,"lines",slug+".md")))!==expected)throw Error(`${slug} changed since the plan; make a fresh plan.`);
    for(const review of pair.reviews)if(digest(textAt(path.join(docs,review.file)))!==review.hash)throw Error(`${review.file} changed since the plan.`);
    for(const rel of [`lines/${pair.gone}.md`,`works/${pair.gone}`,`files/${pair.gone}`])if(fs.existsSync(path.join(docs,"archive",rel)))throw Error(`Archive destination already exists: ${rel}`);
  }
  fs.mkdirSync(backup,{recursive:true});Shared.atomic(path.join(backup,"plan.json"),repair);
  const metadata={version:1,created:repair.created,pairs:repair.pairs.map(p=>({session:p.session,keep:p.keep,gone:p.gone,stepMap:p.stepMap}))};
  for(const pair of repair.pairs){
    for(const slug of[pair.keep,pair.gone]){const to=path.join(backup,"lines",slug+".md");fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(docs,"lines",slug+".md"),to);}
    for(const review of pair.reviews){const to=path.join(backup,review.file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(docs,review.file),to);}
  }
  // Persist bindings before archiving. All importers must be quiescent during this operation.
  for(const pair of repair.pairs){const file=path.join(Shared.rootOf({docsPath:docs}),"sessions",digest(pair.session)+".json");if(fs.existsSync(file)){fs.mkdirSync(path.join(backup,"checkpoints"),{recursive:true});fs.copyFileSync(file,path.join(backup,"checkpoints",path.basename(file)));}Shared.atomic(file,pair.checkpoint);}
  Shared.atomic(path.join(Shared.rootOf({docsPath:docs}),"repairs.json"),metadata);
  const done=[];
  for(const pair of repair.pairs){
    for(const review of pair.reviews)fs.writeFileSync(path.join(docs,review.file),review.text);
    fs.writeFileSync(path.join(docs,"lines",pair.keep+".md"),pair.keepText);
    fs.writeFileSync(path.join(docs,"lines",pair.gone+".md"),pair.goneText);
    // The complete old Line, Works and attachments stay together, recoverable.
    for(const rel of[`works/${pair.gone}`,`files/${pair.gone}`,`lines/${pair.gone}.md`]){const from=path.join(docs,rel),to=path.join(docs,"archive",rel);if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.renameSync(from,to);}}
    done.push(pair.gone);Shared.atomic(path.join(backup,"applied.json"),{done});
  }
  return{archived:done,retained:repair.pairs.map(p=>p.keep),extraSteps:repair.pairs.reduce((n,p)=>n+p.extraSteps.length,0),backup};
}
function repairLinks(docs, pairs, backup) {
  const changed=[];
  const rewrite=file=>{
    const text=textAt(file),next=text.replace(/\]\(([^)]+)\)/g,(whole,href)=>{
      if(/^(?:[a-z]+:|#)/i.test(href))return whole;
      const suffix=href.match(/([#?].*)$/)?.[1]||"",target=href.slice(0,href.length-suffix.length),abs=path.resolve(path.dirname(file),target),rel=path.relative(docs,abs).split(path.sep).join("/");
      if(!pairs.some(p=>rel===`lines/${p.gone}.md`||rel.startsWith(`works/${p.gone}/`)||rel.startsWith(`files/${p.gone}/`)))return whole;
      const archived=path.join(docs,"archive",rel);if(!fs.existsSync(archived))return whole;
      return `](${path.isAbsolute(target)?archived:path.relative(path.dirname(file),archived).split(path.sep).join("/")}${suffix})`;
    });
    if(next!==text){const rel=path.relative(docs,file),saved=path.join(backup,"incoming-links",rel);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(file,saved);fs.writeFileSync(file,next);changed.push(rel);}
  };
  const visit=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())visit(file);else if(e.isFile()&&e.name.endsWith(".md"))rewrite(file);}};
  for(const dir of["lines","works","topics"])visit(path.join(docs,dir));
  for(const name of["README.md","understanding.md"])if(fs.existsSync(path.join(docs,name)))rewrite(path.join(docs,name));
  return changed;
}
module.exports={plan,apply,repairLinks};
