// "Start a project": the explainer, the example projects, the form and the folder picker.
// It stands alone, because both the Projects page and an empty Canvas show it.
(() => {
  // Where a new project's Markdown goes before there is any project to go beside.
  // The server says where, since on Windows that is a whole path such as C:\Users\you\Documents\PenEcho.
  let DEFAULT_BASE = "~/Documents/PenEcho", HOST_CASE_INSENSITIVE = null;
  const useBase = (base, { caseInsensitive } = {}) => { if (base) DEFAULT_BASE = base; if (typeof caseInsensitive === "boolean") HOST_CASE_INSENSITIVE = caseInsensitive; };
  const WORDS = {
    en: {
      tagline:"Not another AI agent. A better way to work with yours.", start:"Start a project", justDraw:"Or just draw anywhere on this Canvas.", gives:"What one project gives you", startNew:"Start a project", backCanvas:"Back to my Canvas", drawCanvas:"Draw on a Canvas", worksWith:"Works with",
      found:"Found on this computer", alsoWorks:"Also works with", noAgent:"No AI agent yet.", noAgentP:"You can still draw, write notes and try the examples. To ask AI:", guestAI:"Use PenEcho AI · 10 free", setupAgent:"Set up an agent",
      linesTitle:"A project is a folder of lines", linesP:"Each line is one thing you are working on. Any agent can carry it on, and it stays one Markdown file.", example:"Calculus 101", exLines:[["Lesson 1", "lesson-1.md"], ["Lesson 2", "lesson-2.md"], ["Exam plan", "exam-plan.md"]],
      kNote:"Note", kNoteP:"your words", kAsk:"Ask", kAskP:"for an agent", kCanvas:"Canvas", kCanvasP:"a drawing", kResult:"Result", kResultP:"what comes back", kMeeting:"Meeting", kDone:"Finished", kWorking:"Working", codeLines:"With a code folder, a line can follow Git: every branch is a line on main, and only you merge.", model:"A project is a folder of Markdown with pictures", pitch:"Use any agent, anywhere:",
      // The eight the first page shows: each title and its short line.
      vault:"All your AI work, in one place", vaultS:"Chats and results from each agent are saved in your own folder.",
      handover:"One line for each piece of work", handoverS:"Any agent carries on from one small file, and nothing is compacted away.",
      tree:"See all your work on one screen", treeS:"Which agent is doing what, and what waits for you.",
      draw:"Draw to show AI what you mean", drawS:"Sketch an idea or mark up a screenshot.",
      read:"Plain files you can read anywhere", readS:"Every line is a tidy Markdown file.",
      memory:"Memory for the whole project", memoryS:"A new agent never starts from zero.",
      find:"Search, or ask how it stands", findS:"Your agent says what is done, not merged and left.",
      follow:"If you have code, it follows Git", followS:"Each branch shows as a line; only you merge.",
      // What New project and the empty Canvas start page show: 8 equal points, each with a simple image.
      tokenBadge:"−51% tokens",
      points8:{
        collab:["Agents collaborate on one task", "Let Claude design, Sonnet write the code, and Astra review—right on the same Line, or coordinated by the Orchestrator."],
        collabHosted:["Agents collaborate on one task", "Let Claude design, Sonnet write the code, and Astra review—right on the same Line, with every step kept in order."],
        tokens:["True token savings, with proof", "Picks when to start fresh or continue on the same Line—passing compact context instead of full chat history. Every task shows why tokens were saved."],
        ratings:["Smarter Orchestrator & real ratings", "Rates every finished task and learns from past runs for the best cost-efficiency. Real-task model ratings in Statistics also guide your manual picks."],
        ratingsHosted:["Real-task model ratings in Statistics", "Detailed model ratings based on real tasks in Statistics help you choose the right agent for design, code, or review."],
        sync:["Auto-sync across every agent", "All your agent sessions sync into the project automatically—never lose history, continue any session with any agent, or move to a new computer."],
        lifecycle:["Full job lifecycle at scale", "Track every job from Ask to Working, Needs you, Review, and Done—keeping hundreds of parallel tasks calm and clear on one screen."],
        canvas:["Work visually on PenEcho Canvas", "Draw on screenshots, sketch UI prototypes, or create diagrams and slides—seamless visual communication your agents read alongside your prompt."],
        markdownTopics:["Plain Markdown Lines & Topics", "Every Line is a clean Markdown file readable in any viewer. All AI work also auto-summarizes into Topic requirement docs with history—in Markdown too."],
        share:["Easy project & Canvas sharing", "Share a whole project or any Canvas with a link so teammates can review, annotate, and collaborate seamlessly."],
      },
      vision:"Where this is going", visionP:"Work with whichever agents you like, wherever you like. Each one reads the same Markdown, so any of them can take over, and you can look in from PenEcho, your phone or any Markdown viewer. What you write goes back to them, and they carry on.", visionNow:"Today this works on the computer running PenEcho, and from other devices on the same network. Sync through your own cloud comes later.",
      examples:"Example projects", exApp:"Code · 3 lines", exClass:"Class notes · 2 lines", exDeck:"Excel to PPT · 1 line", exName:{ app:"Timeline app (Demo)", class:"Calculus class notes (Demo)", deck:"Sales review deck (Demo)" }, createTitle:"Create a project",
      name:"Project name", namePh:"Website redesign", docs:"Docs folder", docsDesc:"Where PenEcho stores your Lines as plain Markdown (.md) files you can read anywhere—managing task lifecycles, notes, drawings, and project memory.", code:"Code folder", optional:"optional", codeDesc:"Your existing source code or repository folder. Agents work on your code here, follow Git branches, and sync conversations into Lines.", codePh:"Leave empty if no source code", choose:"Choose…", create:"Create project", importDocs:"Open existing docs folder…", chooseImport:"Choose a PenEcho docs folder",
      codePrivacy:"Kept separate from your Docs folder—your code stays on the computer running PenEcho.",
      codeUsed:(name, archived) => archived ? `Already used by archived project “${name}”. Choose another code folder.` : `Already used by project “${name}”. Choose another code folder.`,
      importSkipped:(name, archived) => `Docs folder opened without linking the code folder: it is already used by ${archived ? "archived " : ""}project “${name}”.`,
      base:"One folder each, inside", folderRule:"Use an empty folder outside any existing PenEcho project. PenEcho manages the files and folders inside it.",
      folderErrors:{ PROJECT_EXISTS:"This folder already belongs to a PenEcho project. Open that project, or use “Open existing docs folder”.", PROJECT_OVERLAP:"This folder overlaps an existing PenEcho project. Choose an empty folder outside it.", FOLDER_NOT_EMPTY:"This docs folder is not empty. Choose an empty folder or a new folder path. To reopen a PenEcho project, use “Open existing docs folder”." },
      canvas:"Canvas", canvasP:"<strong>Where pictures come from.</strong> Diagrams, Visual Explorer pages and notes land in the Topic as images.", topicP:"<strong>One Topic, one file.</strong> What you asked and what was done, in order. Edit it here or in any Markdown editor.", tasksP:"<strong>The detail of each piece of work.</strong> The Topic links to them, so a new agent reads one file and only opens these if it needs to.",
      needName:"Give the project a name, or choose a folder.", chooseDocs:"Choose the docs folder", chooseCode:"Choose the code folder", dialog:"Choose a folder", onHost:"On the computer running PenEcho", useThis:"Choose this folder", cancel:"Cancel", close:"Close", empty:"No folders inside this one.", top:"Folders", more:"Some folders are not shown.", denied:"This computer does not allow access to this folder.", privateAsk:"This folder may hold private files. Open it anyway?", openAnyway:"Open it", failed:"PenEcho could not read that folder.", noFolders:"PenEcho cannot show folders here. Type the path instead.",
      need:n => `${n} need${n === 1 ? "s" : ""} you`, working:n => `${n} working`, gone:"Folder not found", pictures:n => `${n} ${n === 1 ? "picture" : "pictures"}`, topics:n => `${n} ${n === 1 ? "line" : "lines"}`, emptyP:"Empty",
    },
    zh: {
      tagline:"不是又一个 AI Agent，而是与你的 Agent 协作的更好方式。", start:"开始一个项目", justDraw:"或者直接在画布上画。", gives:"一个项目能给你什么", startNew:"开始一个项目", backCanvas:"回到我的画布", drawCanvas:"在画布上画", worksWith:"支持",
      found:"在这台电脑上找到", alsoWorks:"也支持", noAgent:"还没有 AI Agent。", noAgentP:"你仍然可以画画、写笔记、试试示例。要让 AI 来做：", guestAI:"使用 PenEcho AI · 免费 10 次", setupAgent:"设置 Agent",
      linesTitle:"项目就是一组 Line 的文件夹", linesP:"每条 Line 是你在做的一件事。任何 Agent 都能接着做，它始终是一个 Markdown 文件。", example:"微积分 101", exLines:[["第 1 课", "lesson-1.md"], ["第 2 课", "lesson-2.md"], ["考试计划", "exam-plan.md"]],
      kNote:"笔记", kNoteP:"你自己的话", kAsk:"请求", kAskP:"交给 Agent", kCanvas:"画布", kCanvasP:"一张图", kResult:"结果", kResultP:"Agent 交回的", kMeeting:"会议", kDone:"完成", kWorking:"进行中", codeLines:"有代码文件夹时，Line 可以跟着 Git 走：每个分支都是 main 上的一条 Line，只有你来合并。", model:"项目就是一个放着 Markdown 和图片的文件夹", pitch:"用哪个 Agent、在哪里用都可以：",
      vault:"所有 AI 工作，汇到一个地方", vaultP:"继续用各个 Agent 自己的应用，对话和结果会自动存进你自己的文件夹。",
      handover:"一件事，一条 Line", handoverP:"任何 Agent 都从一个小文件接着做，什么都不会被压缩掉。",
      tree:"所有工作，一屏看清", treeP:"哪个 Agent 在做什么、做到哪里、哪些在等你，一眼就能看到。",
      draw:"画出来，让 AI 明白你的意思", drawP:"在画布上画个想法，或在截图上圈几笔，再把图和文字一起发给 AI。",
      read:"普通文件，随处可读", readP:"每条 Line 都是一个整洁的 Markdown 文件，带着它的图片，在手机上也一样好读。",
      memory:"整个项目共享记忆", memoryP:"你的决定和 Agent 学到的东西不断积累，新 Agent 不必从零开始。",
      find:"搜索，或直接问进展", findP:"一次搜遍你问过的、每个结果和 Agent 途中说的话；也可以直接问，你选的 Agent 会说清做完了什么、哪些还没提交或合并、还剩什么，并链到对应的 Line。",
      follow:"有代码的话，跟着 Git 走", followP:"加上代码文件夹，每个分支都显示为一条 Line，只有你来合并。",
      tokenBadge:"省 51% Token",
      points8:{
        collab:["多个 Agent 协作完成同一任务", "让 Claude 设计、Sonnet 写代码、Astra 审阅——都在同一条 Line 上完成，或交由 Orchestrator 协同调度。"],
        collabHosted:["多个 Agent 协作完成同一任务", "让 Claude 设计、Sonnet 写代码、Astra 审阅——都在同一条 Line 上按顺序接力完成。"],
        tokens:["真正省 Token，每项有据可查", "自动判断在同一条 Line 上新开或续接，只传精简上下文而非完整聊天记录。每个任务都会说明为何省下了 Token。"],
        ratings:["越用越聪明的调度与真实评分", "自动为每次完成评分并从历史任务中学习，实现更高性价比。统计页里的真实任务模型评分也能辅助你手动选择。"],
        ratingsHosted:["基于真实任务的模型评分", "统计页里按真实任务汇总的模型评分，帮你为设计、编码或审阅选出合适的 Agent。"],
        sync:["跨 Agent 会话自动同步", "所有 Agent 的会话自动同步到项目中——历史永不丢失，任意会话可换任意 Agent 接着做，也能轻松迁移到新电脑。"],
        lifecycle:["完整任务生命周期管理", "从提问、进行中、需要你、待审阅到已完成全程追踪——上百个并行任务也能在一屏里清晰掌握。"],
        canvas:["在 PenEcho 画布上可视化协作", "在截图上直接圈画、草绘 UI 原型，或生成架构图与幻灯片——Agent 会连同你的文字一起看懂你的画布。"],
        markdownTopics:["纯 Markdown 的 Line 与自动 Topic", "每条 Line 都是整洁的 Markdown 文件，任意阅读器随时可看。所有 AI 任务也会自动归档为带历史记录的 Topic 需求文档。"],
        share:["轻松分享项目与画布协作", "一条链接即可分享整个项目或任意画布，让同伴直接审阅、圈画批注、无缝协作。"],
      },
      vision:"我们的目标", visionP:"想用哪些 Agent、在哪里用都可以。它们读的是同一份 Markdown，谁都能接手；你可以在 PenEcho、手机或任何 Markdown 阅读器上查看。你写下的内容会回到 Agent 那里，它们接着干。", visionNow:"目前可以在运行 PenEcho 的电脑上使用，也可以用同一网络里的其他设备打开。通过你自己的云同步以后会有。",
      examples:"示例项目", exApp:"代码 · 3 条 Line", exClass:"课堂笔记 · 2 条 Line", exDeck:"Excel 生成 PPT · 1 条 Line", exName:{ app:"Timeline app (Demo)", class:"Calculus class notes (Demo)", deck:"Sales review deck (Demo)" }, createTitle:"创建一个项目",
      name:"项目名称", namePh:"网站改版", docs:"文档文件夹", docsDesc:"PenEcho 存放 Line 的地方，保存为纯 Markdown（.md）文件，随时随地都能阅读——同时管理任务生命周期、笔记、画图与项目记忆。", code:"代码文件夹", optional:"可选", codeDesc:"项目原有的源代码或仓库文件夹。Agent 会在这里编写代码、跟踪 Git 分支，并将对话同步为 Line。", codePh:"没有代码可留空", choose:"选择…", create:"创建项目", importDocs:"打开已有的文档文件夹…", chooseImport:"选择 PenEcho 文档文件夹",
      codePrivacy:"与文档文件夹分开存放，你的代码保留在运行 PenEcho 的电脑上。",
      codeUsed:(name, archived) => archived ? `此代码文件夹已被归档项目“${name}”使用，请选择其他代码文件夹。` : `此代码文件夹已被项目“${name}”使用，请选择其他代码文件夹。`,
      codeSubmit:(name, archived) => archived ? `此代码文件夹已被归档项目“${name}”使用。请在“设置 › 已归档”中恢复或删除“${name}”，或选择其他代码文件夹。` : `此代码文件夹已被项目“${name}”使用。请改为打开该项目，或先在项目设置中解除其代码文件夹关联。`,
      importSkipped:(name, archived) => `文档文件夹已打开，但未关联代码文件夹：它已被${archived ? "归档" : ""}项目“${name}”使用。`,
      base:"每个项目占一个子文件夹，位置在", folderRule:"请选择已有 PenEcho 项目以外的空文件夹。PenEcho 会管理其中的文件和文件夹。",
      folderErrors:{ PROJECT_EXISTS:"此文件夹已属于一个 PenEcho 项目。请打开该项目，或使用“打开已有的文档文件夹”。", PROJECT_OVERLAP:"此文件夹与已有 PenEcho 项目的文件夹重叠。请选择该项目以外的空文件夹。", FOLDER_NOT_EMPTY:"此文档文件夹不是空的。请选择空文件夹或填写新的文件夹路径。要重新打开 PenEcho 项目，请使用“打开已有的文档文件夹”。" },
      canvas:"画布", canvasP:"<strong>图片从这里来。</strong>架构图、Visual Explorer 和笔记都以图片的形式放进 Topic。", topicP:"<strong>一个 Topic，一个文件。</strong>你问了什么、做了什么，按顺序写在里面。在这里或任何 Markdown 编辑器里修改。", tasksP:"<strong>每项工作的详情。</strong>Topic 会链接到它们，新 Agent 读一个文件就能接着做，需要时才打开这些。",
      needName:"请给项目起个名字，或者选择一个文件夹。", chooseDocs:"选择文档文件夹", chooseCode:"选择代码文件夹", dialog:"选择文件夹", onHost:"运行 PenEcho 的这台电脑上", useThis:"选择这个文件夹", cancel:"取消", close:"关闭", empty:"这里面没有文件夹。", top:"文件夹", more:"有些文件夹没有显示。", denied:"这台电脑不允许访问这个文件夹。", privateAsk:"这个文件夹可能有私人文件，仍要打开吗？", openAnyway:"打开", failed:"PenEcho 读不了这个文件夹。", noFolders:"这里无法显示文件夹，请直接输入路径。",
      need:n => `${n} 个需要你`, working:n => `${n} 个进行中`, gone:"找不到文件夹", pictures:n => `${n} 张图片`, topics:n => `${n} 条 Line`, emptyP:"空项目",
    },
  };
  const ICON = {
    folder:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>', right:'<path d="M9 5l7 7-7 7"/>', x:'<path d="M6 6l12 12M18 6L6 18"/>',
    canvas:'<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7.500 15c2-4 3.500-5 5-3s3 1 4-2.500"/>', doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', check:'<path d="M5 12.500l4.500 4.500L19 7"/>', swap:'<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>', phone:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    code:'<path d="M8.500 7l-5 5 5 5M15.500 7l5 5-5 5"/>', pen:'<path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 013 3L8 19z"/><path d="M14.500 6.500l3 3"/>', note:'<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>',
    slides:'<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M12 16.5V20M8.5 20h7"/>',
    done:'<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>', book:'<path d="M12 6.5c-2-1.3-4.5-1.5-7-1v13c2.5-.5 5-.3 7 1 2-1.3 4.5-1.5 7-1v-13c-2.5-.5-5-.3-7 1z"/><path d="M12 6.5v13"/>',
    chart:'<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M12 16.5V20M8.5 20h7"/><path d="M7.5 12.5l3-3 2.5 2 3.5-4"/>',
    lines:'<path d="M6 4v16"/><path d="M6 7q0 5 5 5h3.500"/><circle cx="17" cy="12" r="2.500"/>',
  };
  const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function call(path, { method = "GET", body } = {}) {
    const response = await fetch(`/api/lines${path}`, { method, credentials:"same-origin", headers:{ accept:"application/json", ...(body ? { "content-type":"application/json" } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || `PenEcho could not do that (${response.status}).`), { status:response.status, code:data?.code, conflict:data?.conflict });
    return data;
  }
  // New projects go beside the one made last, which the server lists first. The examples live in PenEcho's own folder, so they never decide it.
  function baseFolder(projects) {
    const last = (projects || []).find(p => p.docsPath && !p.missing && !p.example);
    return last ? last.docsParent || last.docsPath.replace(/[\\/]+[^\\/]+[\\/]*$/, "") || DEFAULT_BASE : DEFAULT_BASE;
  }
  // A typed path and a picked path should meet even when one uses ~, a trailing slash or different letter case on a case-insensitive host.
  function codeFolderOwner(value, projects, { base = DEFAULT_BASE, excludeId = null, caseInsensitive = HOST_CASE_INSENSITIVE } = {}) {
    const clean = folder => String(folder || "").trim().replace(/[\\/]+$/, "");
    const suffix = clean(DEFAULT_BASE).replace(/^~/, "").replace(/\\/g, "/");
    const roots = [clean(base), ...(projects || []).flatMap(p => [clean(p.docsParent), clean(p.docsPath), clean(p.code)])].filter(folder => folder && !folder.startsWith("~"));
    const rooted = roots.find(folder => suffix && folder.replace(/\\/g, "/").toLowerCase().endsWith(suffix.toLowerCase()));
    const home = rooted ? rooted.slice(0, -suffix.length) : "";
    const foldCase = typeof caseInsensitive === "boolean"
      ? caseInsensitive
      : roots.some(folder => /^[A-Za-z]:[\\/]/.test(folder) || /^\/Users\//.test(folder))
        ? true
        : roots.some(folder => /^\/home\//.test(folder))
          ? false
          : typeof navigator !== "undefined" && /Mac|Win/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);
    const key = folder => {
      let normalized = clean(folder);
      if (home) normalized = normalized.replace(/^~(?=$|[\\/])/, home);
      normalized = normalized.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
      return foldCase ? normalized.toLowerCase() : normalized;
    };
    const candidate = key(value);
    if (!candidate) return null;
    return (projects || []).find(p => p.id !== excludeId && p.code && key(p.code) === candidate) || null;
  }

  // ---------- Choosing a folder ----------
  // On the computer running PenEcho the system's own dialog opens. From another machine, this shows that computer's folders, as PenEcho Agent does.
  async function pickFolder(prompt, lang = "en") {
    const result = await call("/pick-folder", { method:"POST", body:{ prompt } });
    if (result.path) return result.path;
    if (result.canceled) return null;
    return browseFolders(prompt, lang);
  }
  function browseFolders(prompt, lang = "en") {
    const w = WORDS[lang] || WORDS.en;
    return new Promise(resolve => {
      const back = document.createElement("div");
      back.className = "pld-back";
      back.innerHTML = `<div class="pld" role="dialog" aria-modal="true" aria-label="${esc(prompt || w.dialog)}">
        <header class="pld-head"><div><strong>${esc(prompt || w.dialog)}</strong><span>${esc(w.onHost)}</span></div><button type="button" class="pld-x" data-pld="close" aria-label="${esc(w.close)}">${icon("x", 18)}</button></header>
        <nav class="pld-crumbs" aria-label="${esc(w.top)}"></nav>
        <div class="pld-list" role="list"></div>
        <footer class="pld-foot"><code class="pld-path"></code><button type="button" class="pld-btn" data-pld="close">${esc(w.cancel)}</button><button type="button" class="pld-btn primary" data-pld="use" disabled>${esc(w.useThis)}</button></footer>
      </div>`;
      document.body.append(back);
      const list = back.querySelector(".pld-list"), crumbs = back.querySelector(".pld-crumbs"), pathEl = back.querySelector(".pld-path"), use = back.querySelector('[data-pld="use"]');
      const returnTo = document.activeElement;
      const state = { roots:[], root:null, path:"", approved:false, chosen:"" };
      const finish = value => { back.remove(); removeEventListener("keydown", onKey, true); returnTo?.focus?.(); resolve(value); };
      const onKey = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(null); } };
      addEventListener("keydown", onKey, true);
      const row = (name, data, extra = "") => `<button type="button" class="pld-row" role="listitem" ${data}>${icon("folder", 17)}<span>${esc(name)}</span>${extra}${icon("right", 15)}</button>`;
      function showRoots() {
        state.root = null; state.path = ""; state.chosen = ""; use.disabled = true; pathEl.textContent = "";
        crumbs.innerHTML = `<span>${esc(w.top)}</span>`;
        list.innerHTML = state.roots.map(root => row(root.name, `data-root="${esc(root.id)}"`)).join("") || `<p class="pld-note">${esc(w.noFolders)}</p>`;
      }
      async function open(root, path = "") {
        let data;
        try { data = await call(`/folders/${encodeURIComponent(root.id)}?${new URLSearchParams({ path, ...(state.approved ? { approved:"1" } : {}) })}`); }
        catch (error) {
          if (error.code === "project_root_approval_required") { ask(root, path); return; }
          list.innerHTML = `<p class="pld-note">${esc(error.message || w.failed)}</p>`;
          return;
        }
        state.root = root; state.path = data.path || "";
        state.chosen = data.selectable ? data.absolute : "";
        use.disabled = !state.chosen; pathEl.textContent = data.absolute || ""; pathEl.title = data.absolute || "";
        const segments = state.path ? state.path.split("/") : [];
        crumbs.innerHTML = [...(state.roots.length > 1 ? [`<button type="button" data-crumb="roots">${esc(w.top)}</button>`] : []), `<button type="button" data-crumb="">${esc(root.name)}</button>`, ...segments.map((segment, i) => `<button type="button" data-crumb="${esc(segments.slice(0, i + 1).join("/"))}">${esc(segment)}</button>`)].join("<i>/</i>");
        list.innerHTML = data.permissionDenied ? `<p class="pld-note">${esc(w.denied)}</p>` : (data.entries || []).map(entry => row(entry.name, `data-path="${esc(entry.path)}"${entry.approvalRequired ? ' data-private="1"' : ""}`)).join("") + (data.truncated ? `<p class="pld-note">${esc(w.more)}</p>` : "") || `<p class="pld-note">${esc(w.empty)}</p>`;
        list.scrollTop = 0;
      }
      function ask(root, path) {
        list.innerHTML = `<div class="pld-ask"><p>${esc(w.privateAsk)}</p><code>${esc(path)}</code><div><button type="button" class="pld-btn" data-crumb="${esc(state.path)}">${esc(w.cancel)}</button><button type="button" class="pld-btn primary" data-approve="${esc(path)}">${esc(w.openAnyway)}</button></div></div>`;
      }
      back.addEventListener("click", event => {
        const target = event.target.closest("button"); if (!target) { if (event.target === back) finish(null); return; }
        if (target.dataset.pld === "close") finish(null);
        else if (target.dataset.pld === "use") finish(state.chosen);
        else if (target.dataset.root) { const root = state.roots.find(x => x.id === target.dataset.root); if (root) open(root); }
        else if (target.dataset.approve !== undefined) { state.approved = true; open(state.root, target.dataset.approve); }
        else if (target.dataset.crumb === "roots") showRoots();
        else if (target.dataset.crumb !== undefined) open(state.root, target.dataset.crumb);
        else if (target.dataset.path !== undefined) { if (target.dataset.private && !state.approved) ask(state.root, target.dataset.path); else open(state.root, target.dataset.path); }
      });
      call("/folders").then(({ roots }) => {
        state.roots = roots || [];
        if (state.roots.length === 1) open(state.roots[0]); else showRoots();
      }).catch(error => { list.innerHTML = `<p class="pld-note">${esc(error.message || w.noFolders)}</p>`; });
      back.querySelector(".pld-x").focus();
    });
  }

  // ---------- The explainer ----------
  function explainerHTML(lang = "en") {
    const w = WORDS[lang] || WORDS.en;
    return `<section class="pls-model" aria-label="${esc(w.model)}">
      <h3>${esc(w.model)}</h3>
      <div class="pls-row">
        <article class="pls-file"><header>${icon("canvas", 15)}<span>${esc(w.canvas)}</span></header>
          <div class="pls-page pls-dots" aria-hidden="true"><svg viewBox="0 0 120 54"><rect x="4" y="18" width="30" height="18" rx="3" fill="#fff" stroke="#8a919e"/><rect x="84" y="4" width="32" height="18" rx="3" fill="#eff6ff" stroke="#2563eb"/><rect x="84" y="32" width="32" height="18" rx="3" fill="#fff" stroke="#8a919e"/><path d="M34 25L84 14M34 29L84 40" stroke="#2563eb" stroke-width="1.600" fill="none"/></svg></div>
          <p>${w.canvasP}</p></article>
        <div class="pls-link" aria-hidden="true">${icon("right", 20)}</div>
        <article class="pls-file main"><header>${icon("doc", 15)}<code>topic.md</code></header>
          <div class="pls-page" aria-hidden="true"><i class="w1"></i><i class="w2"></i><svg viewBox="0 0 120 26"><rect x="1" y="1" width="118" height="24" rx="3" fill="#eff6ff" stroke="#bfdbfe"/><path d="M12 18c14-14 26-14 40-5s32 6 56-7" stroke="#2563eb" stroke-width="1.800" fill="none"/></svg></div>
          <p>${w.topicP}</p></article>
        <div class="pls-link two" aria-hidden="true">${icon("swap", 20)}</div>
        <article class="pls-file main"><header>${icon("check", 15)}<code>topic/work-1.md</code></header>
          <div class="pls-page" aria-hidden="true"><b class="on"></b><b class="on"></b><b class="now"></b><b></b></div>
          <p>${w.tasksP}</p></article>
      </div>
    </section>`;
  }

  // The agents PenEcho follows. The ones not on this computer are shown as not here yet.
  const AGENT_NAMES = [["claude", "Claude Code"], ["codex", "Codex"], ["opencode", "OpenCode"], ["pi", "Pi"], ["dsh", "DeepSeek Harness"], ["kimi", "Kimi"], ["omp", "omp"], ["antigravity", "Antigravity"]];
  function chipsHTML(agents, extra = "") {
    const here = agents && agents.length ? new Set(agents.filter(a => a.available).map(a => a.id)) : null;
    return `<div class="pls-chips${extra ? ` ${extra}` : ""}">${AGENT_NAMES.map(([id, name]) => `<span class="pls-chip${here && !here.has(id) ? " off" : ""}" data-agent="${id}"><i></i>${esc(name)}</span>`).join("")}</div>`;
  }
  // ---------- What one project gives you ----------
  // New project and the empty Canvas start page show 8 equal points, each with a simple inline SVG illustration.
  // The pictures take their colours from classes, so they follow the Lines tokens in dark mode too.
  const FEATURES = ["vault", "handover", "tree", "draw", "read", "memory", "find", "follow"];
  const POINT_KEYS = ["collab", "tokens", "ratings", "sync", "lifecycle", "canvas", "markdownTopics", "share"];
  const ptSVG = body => `<svg class="pls-art pls-pt-svg" viewBox="0 0 76 58" width="76" height="58" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const POINT_ART = {
    // Direction B · Tidecraft Monoline: deep-sea monoline art + soft tide wash, matching the nav icons in Light and Dark modes.
    collab:() => ptSVG(`<circle cx="38" cy="24" r="16" class="tc-wash"/>`
      + `<path class="tc-stroke" stroke-width="2" d="M29.5 24C27.5 21.5 26.8 18.2 27.6 15.2 28.6 10.6 32.8 7.5 38 7.5s9.4 3.1 10.4 7.7c.8 3 .1 6.3-1.9 8.8"/>`
      + `<path class="tc-stroke" stroke-width="1.9" d="M29.5 24c-2.2 4-6.2 6.8-8.2 3.8-.7-1.2-.3-2.8 1-3.3M46.5 24c2.2 4 6.2 6.8 8.2 3.8.7-1.2.3-2.8-1-3.3M34.4 25.2c-.4 5.5-2.4 10.5-5.6 10.8-1.4.2-2.4-.8-2.2-2.2M41.6 25.2c.4 5.5 2.4 10.5 5.6 10.8 1.4.2 2.4-.8 2.2-2.2"/>`
      + `<circle cx="34.2" cy="18.2" r="1.6" class="tc-ink"/><circle cx="41.8" cy="18.2" r="1.6" class="tc-ink"/>`
      + `<path class="tc-accent" stroke-width="1.7" d="M14 45.5c8-2.8 16-2.8 24 0s16 2.8 24 0"/>`
      + `<circle cx="22" cy="44" r="3.4" class="tc-coral"/><circle cx="38" cy="45.5" r="3.4" class="tc-blue"/><circle cx="54" cy="44" r="3.4" class="tc-teal"/>`
      + `<circle cx="58" cy="12" r="2" class="tc-stroke" stroke-width="1.6"/>`),
    tokens:() => ptSVG(`<rect x="13" y="13" width="50" height="32" rx="16" class="tc-wash"/>`
      + `<path class="tc-muted" stroke-width="2" stroke-dasharray="3.2 3.2" d="M18 24h40"/>`
      + `<path class="tc-stroke" stroke-width="3.2" d="M18 24h19"/>`
      + `<circle cx="44" cy="18.5" r="2.2" class="tc-accent" stroke-width="1.6"/>`
      + `<circle cx="51" cy="14" r="1.5" class="tc-stroke" stroke-width="1.5"/>`
      + `<circle cx="56" cy="19.5" r="1.3" class="tc-accent" stroke-width="1.4"/>`
      + `<text x="38" y="38.5" class="tc-green-txt" font-size="11.5" font-weight="750" text-anchor="middle">−51%</text>`
      + `<path class="tc-stroke" stroke-width="1.7" opacity=".55" d="M15 47c7.5-2.5 15-2.5 23 0s15.5 2.5 23 0"/>`),
    ratings:() => ptSVG(`<circle cx="49" cy="24" r="16" class="tc-wash"/>`
      + `<path class="tc-stroke" stroke-width="1.8" d="M14 47.5h48"/>`
      + `<path class="tc-stroke" stroke-width="2.1" d="M22 47.5V35M35 47.5V27M48 47.5V19"/>`
      + `<circle cx="22" cy="30.5" r="2.6" class="tc-paper tc-stroke" stroke-width="1.8"/>`
      + `<circle cx="35" cy="22.5" r="2.6" class="tc-paper tc-stroke" stroke-width="1.8"/>`
      + `<circle cx="48" cy="14.5" r="2.6" class="tc-paper tc-accent" stroke-width="1.8"/>`
      + `<path class="tc-amber" d="M58.28 13.31Q59 11.6 59.72 13.31Q60.44 15.02 62.29 15.17Q64.14 15.33 62.73 16.54Q61.33 17.76 61.75 19.56Q62.17 21.37 60.59 20.41Q59 19.45 57.41 20.41Q55.83 21.37 56.25 19.56Q56.67 17.76 55.27 16.54Q53.86 15.33 55.71 15.17Q57.56 15.02 58.28 13.31Z"/>`
      + `<text x="20.5" y="18.5" class="tc-ink" font-size="9.5" font-weight="750" text-anchor="middle">4.9</text>`),
    sync:() => ptSVG(`<circle cx="38" cy="29" r="19" class="tc-wash"/>`
      + `<circle cx="38" cy="29" r="17.5" class="tc-stroke" stroke-width="1.9"/>`
      + `<path class="tc-accent" stroke-width="2" d="M30 25.2a9 9 0 0115.6-3.2M46 18.2v4.3h-4.3M46 32.8a9 9 0 01-15.6 3.2M30 39.8v-4.3h4.3"/>`
      + `<circle cx="15" cy="29" r="4.2" class="tc-coral"/>`
      + `<circle cx="61" cy="29" r="4.2" class="tc-blue"/>`
      + `<circle cx="56" cy="12" r="2" class="tc-stroke" stroke-width="1.6"/>`),
    lifecycle:() => ptSVG(`<path class="tc-wash" d="M18 46V30a20 20 0 0140 0v16Z"/>`
      + `<path class="tc-stroke" stroke-width="1.9" d="M14 46h48"/>`
      + `<path class="tc-stroke" stroke-width="1.9" d="M20 46V31a18 18 0 0136 0v15"/>`
      + `<circle cx="30" cy="34" r="3" class="tc-green"/><circle cx="38" cy="34" r="3" class="tc-teal"/><circle cx="46" cy="34" r="3" class="tc-amber"/>`
      + `<path class="tc-accent" stroke-width="1.7" d="M31 24a8.5 8.5 0 0114 0"/>`
      + `<rect x="44" y="6.5" width="23" height="12" rx="6" class="tc-blue"/><text class="pa-ft" x="55.5" y="15" font-size="7.4" text-anchor="middle">100+</text>`
      + `<circle cx="18" cy="14" r="2" class="tc-stroke" stroke-width="1.6"/>`),
    canvas:() => ptSVG(`<rect x="13" y="10" width="50" height="38" rx="9" class="tc-wash"/>`
      + `<rect x="13" y="10" width="50" height="38" rx="9" class="tc-stroke" stroke-width="2"/>`
      + `<path class="tc-accent" stroke-width="2" d="M21 34.5c4.2-3.4 8.5-3.4 12.7 0s8.5 3.4 12.7 0 8.5-3.4 10.6-1.4"/>`
      + `<ellipse cx="32" cy="24" rx="9.5" ry="5.5" transform="rotate(-10 32 24)" class="tc-coral-stroke" stroke-width="1.9"/>`
      + `<path class="tc-stroke" stroke-width="1.8" d="M46 26l9-9 3.5 3.5-9 9-4.5 1z"/>`
      + `<circle cx="24" cy="18" r="2" class="tc-stroke" stroke-width="1.6"/>`),
    markdownTopics:() => ptSVG(`<circle cx="31" cy="29" r="16.5" class="tc-wash"/>`
      + `<path class="tc-stroke" stroke-width="2" d="M31 28.4L31.27 28.33L31.63 28.35L32.01 28.55L32.34 28.95L32.5 29.54L32.38 30.24L31.94 30.92L31.17 31.42L30.16 31.59L29.05 31.33L28.03 30.58L27.33 29.39L27.12 27.89L27.55 26.3L28.63 24.9L30.29 23.95L32.32 23.7L34.43 24.28L36.28 25.7L37.51 27.85L37.85 30.46L37.14 33.14L35.36 35.47L32.71 37.04L29.5 37.5L26.2 36.67L23.33 34.57L21.39 31.4L20.76 27.56L21.67 23.61L24.09 20.16L27.78 17.78L32.27 16.95L36.9 17.9L40.99 20.62L43.84 24.83"/>`
      + `<path class="tc-accent" stroke-width="1.5" opacity=".7" d="M31 29l9-6M31 29l11 3M31 29l4 11"/>`
      + `<path class="tc-stroke" stroke-width="1.9" d="M51 22.5h12M51 29h9"/>`
      + `<text x="57" y="41.5" class="tc-blue-txt" font-size="9.5" font-weight="750" text-anchor="middle">.md</text>`
      + `<circle cx="57" cy="13.5" r="2" class="tc-stroke" stroke-width="1.6"/>`),
    share:() => ptSVG(`<circle cx="38" cy="29" r="17" class="tc-wash"/>`
      + `<path class="tc-stroke" stroke-width="2" d="M13 44.5c4.5-3.2 9-3.2 13.5 0s9 3.2 13.5 0 9-3.2 13.5 0 9 3.2 11 1"/>`
      + `<path class="tc-stroke" stroke-width="2" d="M38 38V17M31 24l7-7 7 7"/>`
      + `<path class="tc-accent" stroke-width="1.8" d="M24 22a16 16 0 000 14M52 22a16 16 0 010 14"/>`
      + `<circle cx="17" cy="29" r="3.4" class="tc-teal"/><circle cx="59" cy="29" r="3.4" class="tc-blue"/>`
      + `<circle cx="52" cy="11.5" r="2" class="tc-stroke" stroke-width="1.6"/>`),
  };
  // The kinds of mark on a line, drawn the same in the picture and in its legend.
  const MARK = { n:"note", a:"ask", c:"canvas", r:"result" };
  const markHTML = k => `<i class="pls-mk mk-${MARK[k]}" aria-hidden="true"></i>`;
  // A project, its lines and the file each line is: the one thing to understand before starting.
  function linesModelHTML(lang = "en") {
    const w = WORDS[lang] || WORDS.en;
    const faces = { "lesson-1.md":["cl", "cx"], "lesson-2.md":["ds"], "exam-plan.md":["cx", "pi"] }, marks = ["ncar", "nca", "nar"];
    const rows = w.exLines.map(([title, file], i) => `<li class="pls-tline"><span class="pls-marks">${[...marks[i]].map(markHTML).join("")}</span><b>${esc(title)}</b><span class="pls-faces" aria-hidden="true">${faces[file].map(who => `<i class="pa-${who}">${{ cl:"Cl", cx:"Cx", ds:"Ds", pi:"Pi" }[who]}</i>`).join("")}</span><span class="pls-leader" aria-hidden="true"></span><code>${esc(file)}</code></li>`).join("");
    const legend = [["n", w.kNote, w.kNoteP], ["a", w.kAsk, w.kAskP], ["c", w.kCanvas, w.kCanvasP], ["r", w.kResult, w.kResultP]];
    return `<section class="pls-lines" aria-label="${esc(w.linesTitle)}">
      <header class="pls-lines-head"><h3>${esc(w.linesTitle)}</h3><p>${esc(w.linesP)}</p></header>
      <div class="pls-tree"><span class="pls-folder">${icon("folder", 14)}${esc(w.example)}</span><ul>${rows}</ul></div>
      <ul class="pls-kinds">${legend.map(([k, name, say]) => `<li>${markHTML(k)}<b>${esc(name)}</b>${esc(say)}</li>`).join("")}</ul>
    </section>`;
  }
  // ---------- A project building itself ----------
  // The picture beside the name: a project's folder, then its lines growing one mark at a time (a note, an Ask, an agent's work,
  // a Canvas, a meeting), each line with the file it is. Every piece carries the moment it appears (data-t, in milliseconds).
  const STAGE_MARK = {
    note:'<rect class="st-note" x="-9.5" y="-12" width="19" height="24" rx="4.5"/><path class="st-glyph" d="M-4.5-4.5h9M-4.5.5h9M-4.5 5.5h5"/>',
    ask:'<circle class="st-ask" r="8.5"/>',
    work:who => `<circle class="st-work" r="11.5"/><text class="st-who" y="3.4">${who}</text>`,
    run:who => `<circle class="st-work" r="11.5"/><text class="st-who" y="3.4">${who}</text><circle class="st-spin" r="16"/>`,
    canvas:'<rect class="st-cv" x="-14" y="-11" width="28" height="22" rx="5.5"/><path class="st-cv-ink" d="M-8 3c3-8 6-8 8-2s5 4 8-3"/>',
    meet:'<rect class="st-meet" x="-12" y="-12" width="24" height="24" rx="7.5"/><path class="st-glyph" d="M0-6.5v6M-4.5-1.5a4.5 4.5 0 0 0 9 0M0 3v3.5"/>',
    done:'<circle class="st-done" r="11.5"/><path class="st-check" d="M-4.5 .5-1.2 3.8 4.8-3"/>',
  };
  function stageHTML(lang = "en") {
    const w = WORDS[lang] || WORDS.en, [one, two, three] = w.exLines, X = 40, FIRST = 56, STEP = 86;
    const lines = [
      { y:122, at:700, title:one, marks:[["note", w.kNote], ["ask", w.kAsk], ["work", "Claude", "C"], ["canvas", w.kCanvas], ["done", w.kDone]] },
      { y:242, at:4600, title:two, marks:[["canvas", w.kCanvas], ["ask", w.kAsk], ["work", "Codex", "Cx"], ["ask", w.kAsk], ["run", w.kWorking, "Ds"]] },
      { y:362, at:8500, title:three, marks:[["meet", w.kMeeting], ["note", w.kNote], ["ask", w.kAsk], ["work", "Pi", "Pi"]] },
    ];
    const chip = w.example.length * (lang === "zh" ? 13 : 7.6) + 28;
    let out = `<path class="st-trunk st-seg" pathLength="1" d="M${X} 56V404" data-t="0"/><g class="st-pop" data-t="0"><rect class="st-chip" x="${X - 18}" y="24" width="${chip}" height="30" rx="8"/><text class="st-chip-t" x="${X - 4}" y="44">${esc(w.example)}</text></g>`;
    for (const line of lines) {
      let at = line.at, from = X;
      const [title, file] = line.title, fileW = file.length * 6.9 + 16;
      out += `<text class="st-title st-fade" x="${X + 34}" y="${line.y - 24}" data-t="${at + 150}">${esc(title)}</text>`;
      line.marks.forEach(([kind, label, who], i) => {
        const x = X + FIRST + i * STEP, mark = STAGE_MARK[kind];
        out += `<path class="st-line st-seg" pathLength="1" d="${i ? `M${from} ${line.y}H${x}` : `M${X} ${line.y - 26}q0 26 26 26H${x}`}" data-t="${at}"/>`;
        at += 380;
        out += `<g transform="translate(${x} ${line.y})"><g class="st-pop" data-t="${at}">${typeof mark === "function" ? mark(who) : mark}</g></g><text class="st-label st-fade" x="${x}" y="${line.y + 32}" data-t="${at + 80}">${esc(label)}</text>`;
        at += 260; from = x;
      });
      // The file the line is, once the line is there.
      out += `<g class="st-fade" data-t="${at + 200}"><rect class="st-file" x="${496 - fileW}" y="${line.y - 40}" width="${fileW}" height="22" rx="6"/><text class="st-file-t" x="${496 - fileW / 2}" y="${line.y - 24.5}">${esc(file)}</text></g>`;
    }
    return `<section class="pls-stage" data-lang="${esc(lang)}" role="img" aria-label="${esc(w.linesTitle)}"><svg viewBox="0 0 520 416" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg></section>`;
  }
  // Plays the picture, rests, and plays it again while it is on the page.
  const stageTimers = new WeakMap();
  function playStage(stage) {
    if (!stage) return;
    (stageTimers.get(stage) || []).forEach(clearTimeout);
    const pieces = [...stage.querySelectorAll("[data-t]")];
    if (reduced()) { for (const piece of pieces) piece.classList.add("in"); return; }
    for (const piece of pieces) piece.classList.remove("in");
    let last = 0;
    const timers = pieces.map(piece => { const at = Number(piece.dataset.t); last = Math.max(last, at); return setTimeout(() => piece.classList.add("in"), 350 + at); });
    timers.push(setTimeout(() => { if (stage.isConnected) playStage(stage); }, last + 7000));
    stageTimers.set(stage, timers);
  }
  // Use any agent, anywhere, and the agents themselves.
  const agentsHTML = (lang = "en", agents) => `<div class="pls-agents"><p class="pls-pitch">${esc((WORDS[lang] || WORDS.en).pitch)}</p>${chipsHTML(agents)}</div>`;
  // The agents a project works with, as the start page names them: a dot and a name each.
  const worksWithHTML = (lang = "en", agents) => `<div class="pls-works"><span class="pls-works-k">${esc((WORDS[lang] || WORDS.en).worksWith)}</span>${chipsHTML(agents, "is-plain")}</div>`;
  // Whether PenEcho's own AI for guests (Cloud, G1) answers. It does not exist yet, so its button stays hidden. The one place that decides.
  const guestModelAvailable = () => false;
  const tick = '<svg class="pls-tick" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7"/></svg>';
  // What to do with no agent on this computer: PenEcho's own AI (once it answers) or setting one up. The first page and an example's saved result both offer it.
  const toAskAIHTML = (lang = "en") => { const w = WORDS[lang] || WORDS.en; return `<button type="button" class="pld-btn primary pls-guest" data-pls-guest${guestModelAvailable() ? "" : " hidden"}>${esc(w.guestAI)}</button><a class="pld-btn pls-setup" data-pls-setup href="projects.html#setup">${esc(w.setupAgent)}</a>`; };
  // Found on this computer: the agents here, each with a tick, then the others in one line. None here: what you can still do, and how to ask AI.
  function foundHTML(lang = "en", agents = null) {
    const w = WORDS[lang] || WORDS.en, head = `<span class="pls-works-k">${esc(w.found)}</span>`;
    if (!agents) return `<div class="pls-found-here" data-pls-found>${head}</div>`;
    const named = AGENT_NAMES.map(([id, name]) => { const a = agents.find(x => x.id === id); return { id, name:a?.name || name, mono:a?.mono || name.slice(0, 2), here:Boolean(a?.available) }; });
    const here = named.filter(a => a.here), rest = named.filter(a => !a.here);
    if (!here.length) return `<div class="pls-found-here" data-pls-found data-found="none">${head}<div class="pls-none"><p><b>${esc(w.noAgent)}</b> ${esc(w.noAgentP)}</p><div class="pls-none-row">${toAskAIHTML(lang)}</div></div></div>`;
    return `<div class="pls-found-here" data-pls-found data-found="${here.length}">${head}<div class="pls-here">${here.map(a => `<span class="pls-ag" data-agent="${esc(a.id)}"><i class="pls-ag-face">${esc(a.mono)}</i>${esc(a.name)}${tick}</span>`).join("")}</div>${rest.length ? `<p class="pls-also">${esc(w.alsoWorks)} ${esc(rest.map(a => a.name).join(", "))}</p>` : ""}</div>`;
  }
  // What a project gives you: 8 equal points, each with a simple vector illustration.
  // penecho.ai has no Orchestrator, so hosted copy (orchestrator:false) omits Orchestrator mentions while keeping all 8 points.
  function benefitsHTML(lang = "en", agents, { agentsRow = true, heading = true, orchestrator = true } = {}) {
    const w = WORDS[lang] || WORDS.en;
    const item = key => {
      const copyKey = !orchestrator && (key === "collab" || key === "ratings") ? `${key}Hosted` : key;
      const [title, body] = w.points8[copyKey];
      return `<li class="pls-point" data-gain="${key}"><span class="pls-pt-art">${POINT_ART[key](w)}</span><div class="pls-pt-copy"><h3>${esc(title)}</h3><p>${esc(body)}</p></div></li>`;
    };
    return `<section class="pls-gains" aria-label="${esc(w.gives)}">
      ${agentsRow ? agentsHTML(lang, agents) : ""}
      ${heading ? `<h2 class="pls-gives">${esc(w.gives)}</h2>` : ""}
      <ul class="pls-points">${POINT_KEYS.map(item).join("")}</ul>
    </section>`;
  }
  // The start page's eight, as words only.
  function featureListHTML(lang = "en") {
    const w = WORDS[lang] || WORDS.en;
    return `<ul class="pls-list" aria-label="${esc(w.gives)}">${FEATURES.map(key => `<li data-gain="${key}"><h3>${esc(w[key])}</h3><p>${esc(w[`${key}S`] || w[`${key}P`])}</p></li>`).join("")}</ul>`;
  }
  // Where this is going, in as many words. It has its own home on an empty project.
  function visionHTML(lang = "en") {
    const w = WORDS[lang] || WORDS.en;
    return `<div class="pls-vision"><h4>${esc(w.vision)}</h4><p>${esc(w.visionP)} ${esc(w.visionNow)}</p></div>`;
  }

  // ---------- Pictures of projects ----------
  // A project's own latest picture. Before it has one, a small map of its work.
  function pictureHTML(p) {
    if (p.thumb) return `<img src="/api/lines/projects/${encodeURIComponent(p.id)}/file?path=${encodeURIComponent(p.thumb)}" alt="">`;
    const lines = (p.lines || []).slice(0, 3), landed = (p.landed || []).slice(-4);
    if (!lines.length && !landed.length) return `<span class="pls-letter">${esc((p.name || "?")[0])}</span>`;
    const W = 240, H = 100, mainX = 10;
    let s = `<path d="M${mainX},8V${H - 8}" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>`;
    lines.forEach((line, i) => {
      const y = 26 + i * 26, x = mainX + 20, stops = line.stations || [], n = Math.max(2, stops.length), sp = Math.min(44, (W - x - 16) / (n - 1)), reached = Math.max(0, stops.findIndex(st => st.state !== "done" && st.state !== "off")), mid = x + reached * sp;
      s += `<path d="M${mainX},${y - 8}Q${mainX},${y} ${mainX + 8},${y}H${mid}" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round"/><path d="M${mid},${y}H${x + (n - 1) * sp}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round"/><circle cx="${mid}" cy="${y}" r="4" fill="${line.status === "working" ? "var(--c-run)" : line.status === "stopped" ? "var(--red)" : line.status === "waiting" ? "var(--amber-mark)" : "var(--c-end)"}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${s}</svg>`;
  }
  function statusText(p, w) {
    if (p.missing) return w.gone;
    const need = (p.lines || []).filter(l => ["waiting", "stopped"].includes(l.status) || l.questions).length, work = (p.lines || []).filter(l => l.status === "working").length, bits = [];
    if (need) bits.push(w.need(need));
    if (work) bits.push(w.working(work));
    const topics = (p.lines || []).length + (p.landed || []).length;
    if (!bits.length && topics) bits.push(w.topics(topics));
    if (!bits.length && p.pictures) bits.push(w.pictures(p.pictures));
    return bits.join(" · ") || w.emptyP;
  }
  // Clicking a project grows its picture to fill the screen, and the project opens from there.
  function zoomOpen(card, url, picture = card?.querySelector?.(".pls-pic")) {
    if (!card || reduced() || !document.body.animate) { location.assign(url); return; }
    const raw = (picture || card).getBoundingClientRect(), z = window.PenEchoPageScale?.layoutScale?.() || 1;
    const from = { left:raw.left / z, top:raw.top / z, width:raw.width / z, height:raw.height / z }, vw = innerWidth / z, vh = innerHeight / z, cover = document.createElement("div");
    cover.className = "pls-zoom";
    const shot = (picture || card).cloneNode(true);
    shot.classList.add("pls-zoom-pic");
    shot.style.left = `${from.left}px`; shot.style.top = `${from.top}px`; shot.style.width = `${from.width}px`; shot.style.height = `${from.height}px`;
    cover.append(shot); document.body.append(cover);
    const scale = Math.max(vw / from.width, vh / from.height), x = vw / 2 - (from.left + from.width / 2), y = vh / 2 - (from.top + from.height / 2);
    cover.animate([{ opacity:0 }, { opacity:1 }], { duration:180, fill:"forwards", easing:"ease-out" });
    const grow = shot.animate([{ transform:"none", opacity:1 }, { transform:`translate(${x}px,${y}px) scale(${scale})`, opacity:.25 }], { duration:440, fill:"forwards", easing:"cubic-bezier(.3,.7,.2,1)" });
    try { sessionStorage.setItem("penecho-lines-zoomed", "1"); } catch { /* It only skips the last part of the animation. */ }
    grow.onfinish = () => location.assign(url);
  }
  const projectUrl = p => `/projects.html#${encodeURIComponent(p.id)}`;
  const plain = event => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button);

  // ---------- The panel ----------
  // The same three example projects the Projects page offers. One already in your list opens; otherwise the click makes it.
  const EXAMPLES = [{ kind:"app", icon:"code", words:"exApp" }, { kind:"class", icon:"pen", words:"exClass" }, { kind:"deck", icon:"slides", words:"exDeck" }];
  function panelHTML(lang, projects, { showExamples, drawHint, showTitle, base, startButton = false, showModel = false, showBenefits = true, backToCanvas = false, drawCanvas = false, agents = null }) {
    const w = WORDS[lang] || WORDS.en;
    const examples = showExamples ? `<section class="pls-examples" aria-label="${esc(w.examples)}">
        <h3>${esc(w.examples)}</h3>
        <div class="pls-ex-row">${EXAMPLES.map(x => `<button type="button" class="pls-ex k-${x.kind}" data-example="${x.kind}"><span class="pls-ex-ic">${icon(x.icon, 18)}</span><span class="pls-ex-t"><strong>${esc(w.exName[x.kind])}</strong><span>${esc(w[x.words])}</span></span></button>`).join("")}</div>
        <p class="pls-ex-error" role="alert" hidden></p>
      </section>` : "";
    const title = showTitle ? `<header class="pls-head"><h2 class="pls-title">${esc(w.start)}</h2>${drawHint ? `<span>${esc(w.justDraw)}</span>` : ""}</header>` : "";
    // What PenEcho opens on, and an empty Canvas, on one screen: the name, the two buttons and the agents beside what a project is,
    // then the two main benefit cards and six icon points, and that you can just draw.
    const body = startButton
      ? `<div class="pls-hero">
        <div class="pls-intro">
          <header class="pls-brand"><h2>PenEcho <span>Lines</span></h2><p>${esc(w.tagline)}</p></header>
          <div class="pls-start-row"><a class="pld-btn primary pls-start-new" href="/projects.html#new">${esc(w.startNew)}</a>${drawCanvas ? `<button type="button" class="pld-btn pls-back pls-draw" data-pls-draw>${icon("pen", 16)}${esc(w.drawCanvas)}</button>` : backToCanvas ? `<button type="button" class="pld-btn pls-back" data-pls-back>${esc(w.backCanvas)}</button>` : ""}</div>
          ${foundHTML(lang, agents)}
        </div>
        ${showModel ? stageHTML(lang) : ""}
      </div>
      ${showBenefits ? benefitsHTML(lang, agents, { agentsRow:false, heading:false }) : ""}
      ${drawHint ? `<p class="pls-draw-hint">${esc(w.justDraw)}</p>` : ""}`
      : `${examples}
      ${title}
      ${showModel ? stageHTML(lang) : ""}
      ${showBenefits ? benefitsHTML(lang) : ""}`;
    return `${body}
      <form class="pls-form"${startButton ? " hidden" : ""} autocomplete="off" aria-label="${esc(w.createTitle)}">
        <div class="pls-rows">
          <label class="pls-field"><span class="pls-label">${esc(w.name)}</span><input name="name" type="text" placeholder="${esc(w.namePh)}"></label>
          <div class="pls-field"><div class="pls-field-head"><label class="pls-label" data-for="docs">${esc(w.docs)}</label><p class="pls-desc pls-docs-desc">${esc(w.docsDesc)}</p></div><div class="pls-path"><input name="docs" type="text" value="${esc(base)}" placeholder="${esc(base)}" spellcheck="false"><button type="button" class="pld-btn" data-pick="docs">${esc(w.choose)}</button></div>
            <p class="pls-hint pls-sub">${esc(w.base)} <code>${esc(base)}</code></p><p class="pls-hint pls-folder-rule">${esc(w.folderRule)}</p></div>
          <div class="pls-field"><div class="pls-field-head"><label class="pls-label" data-for="code">${esc(w.code)} <em>${esc(w.optional)}</em></label><p class="pls-desc pls-code-desc">${esc(w.codeDesc)}</p></div><div class="pls-path"><input name="code" type="text" placeholder="${esc(w.codePh)}" spellcheck="false"><button type="button" class="pld-btn" data-pick="code">${esc(w.choose)}</button></div>
            <p class="pls-hint pls-code-privacy">${esc(w.codePrivacy)}</p></div>
        </div>
        <footer class="pls-form-foot"><p class="pls-error" role="alert" hidden></p><button type="submit" class="pld-btn primary pls-create">${esc(w.create)}</button><button type="button" class="pls-import" data-import>${esc(w.importDocs)}</button></footer>
      </form>`;
  }
  const folderName = value => String(value || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  // A name becomes one folder, so a slash in it must not make two, and no name may climb out.
  const folderSafe = text => String(text || "").replace(/[\\/]+/g, "-").replace(/^\.+/, "").trim();
  // Whether the docs folder still follows the name, kept for when the list of projects refreshes.
  const following = new WeakMap();
  let formId = 0;
  // ---------- Which agents are here ----------
  // The Canvas has no list of its own, so it is asked for once and kept.
  let agentOnce = null, agentList = null;
  function knownAgents() {
    if (!agentOnce) agentOnce = call("/agents").then(({ agents }) => { agentList = agents || []; return agentList; }).catch(() => []);
    return agentOnce;
  }
  function showAgents(host, agents) {
    if (!agents?.length) return;
    for (const chip of host.querySelectorAll(".pls-chip[data-agent]")) {
      const known = agents.find(a => a.id === chip.dataset.agent);
      if (known) chip.classList.toggle("off", !known.available);
    }
  }
  function mount(host, { lang = "en", projects = [], showExamples = true, onExample, showTitle = true, drawHint = false, agents = null, onCreated, startButton = false, showModel = false, showBenefits = true, backToCanvas = false, drawCanvas = false, showAgents:agentRow = false, create = null, makeExample = null } = {}) {
    const w = WORDS[lang] || WORDS.en;
    host.classList.add("pls");
    // A form half filled in stays as it was when the list of projects refreshes.
    const old = host.querySelector(".pls-form"), kept = old ? Object.fromEntries(new FormData(old)) : null;
    const hadFocus = old?.contains(document.activeElement) ? document.activeElement.name : "";
    const base = baseFolder(projects);
    // The picture keeps playing where it was when the list of projects refreshes.
    const stageWas = host.querySelector(".pls-stage");
    host.innerHTML = panelHTML(lang, projects, { showExamples, drawHint, showTitle, base, startButton, showModel, showBenefits, backToCanvas, drawCanvas, agents:agents || agentList });
    const stage = host.querySelector(".pls-stage");
    if (stage && stageWas?.dataset.lang === lang) stage.replaceWith(stageWas); else playStage(stage);
    // The New project page has no six pictures beside the form, so the agents found here come with it.
    if (agentRow && !showBenefits) host.querySelector(".pls-rows")?.insertAdjacentHTML("beforeend", `<div class="pls-field pls-found"><span class="pls-label">${esc(lang === "zh" ? "找到的 Agent" : "Agents found")}</span>${chipsHTML(agents)}</div>`);
    host.classList.toggle("pls-has-examples", Boolean(host.querySelector(".pls-examples")));
    const form = host.querySelector(".pls-form"), error = host.querySelector(".pls-error"), sub = host.querySelector(".pls-sub");
    const { name:nameField, docs, code } = form.elements;
    const fid = ++formId;
    docs.id = `pls-docs-${fid}`;
    code.id = `pls-code-${fid}`;
    host.querySelector('[data-for="docs"]')?.setAttribute("for", docs.id);
    host.querySelector('[data-for="code"]')?.setAttribute("for", code.id);
    const docsDesc = host.querySelector(".pls-docs-desc");
    docsDesc.id = `pls-docs-desc-${fid}`;
    const rule = host.querySelector(".pls-folder-rule");
    rule.id = `pls-folder-rule-${fid}`;
    docs.setAttribute("aria-describedby", `${docsDesc.id} ${rule.id}`);
    const codeDesc = host.querySelector(".pls-code-desc");
    codeDesc.id = `pls-code-desc-${fid}`;
    const codePrivacy = host.querySelector(".pls-code-privacy");
    codePrivacy.id = `pls-code-privacy-${fid}`;
    code.setAttribute("aria-describedby", `${codeDesc.id} ${codePrivacy.id}`);
    if (kept) for (const [name, value] of Object.entries(kept)) form.elements[name].value = value;
    // Where the project is kept is someone else's to say (penecho.ai keeps it in Cloud): the form asks only for its name.
    if (create) {
      for (const field of [docs, code]) field.closest(".pls-field").hidden = true;
      host.querySelector("[data-import]").hidden = true;
    }
    // The docs folder is the project's own folder inside the base, named by the project or
    // else by its code folder. Once you choose or type a folder, it is used exactly as it is.
    let follows = !kept || following.get(host) !== false;
    const setFollows = value => { follows = value; following.set(host, value); };
    const ownName = () => folderSafe(nameField.value.trim()) || folderName(code.value.trim());
    const sep = /\\/.test(base) && !base.includes("/") ? "\\" : "/";
    const ownFolder = () => ownName() ? `${base.replace(/[\\/]+$/, "")}${sep}${ownName()}` : base;
    const updateCodeHint = () => {
      const owner = codeFolderOwner(code.value, projects, { base });
      codePrivacy.textContent = owner ? w.codeUsed(owner.name, Boolean(owner.archived)) : w.codePrivacy;
      codePrivacy.classList.toggle("is-conflict", Boolean(owner));
    };
    const follow = () => {
      if (follows && document.activeElement !== docs) docs.value = ownFolder();
      sub.hidden = !follows;
      nameField.placeholder = (!follows && folderName(docs.value.trim())) || folderName(code.value.trim()) || w.namePh;
      updateCodeHint();
    };
    nameField.addEventListener("input", follow);
    code.addEventListener("input", () => { code.removeAttribute("aria-invalid"); error.hidden = true; follow(); });
    // Emptying the field hands it back to the name, once you have left it.
    docs.addEventListener("input", () => { setFollows(!docs.value.trim()); follow(); });
    docs.addEventListener("blur", follow);
    follow();
    if (hadFocus) form.elements[hadFocus]?.focus();
    const fail = text => { error.hidden = false; error.textContent = text; };
    for (const pic of host.querySelectorAll(".pls-pic")) if (pic.dataset.color) pic.style.setProperty("--project-color", pic.dataset.color);
    for (const card of host.querySelectorAll(".pls-card")) card.addEventListener("click", event => { if (!plain(event)) return; event.preventDefault(); zoomOpen(card, card.getAttribute("href")); });
    for (const button of host.querySelectorAll("[data-example]")) button.addEventListener("click", async () => {
      const kind = button.dataset.example;
      if (makeExample) {
        button.disabled = true;
        try { await makeExample(kind); }
        catch (problem) { const said = host.querySelector(".pls-ex-error"); said.hidden = false; said.textContent = problem.message; }
        finally { button.disabled = false; }
        return;
      }
      let project = projects.find(p => p.example === kind && !p.missing && !p.archived);
      if (!project) {
        button.disabled = true;
        try { ({ project } = await call("/examples", { method:"POST", body:{ kind } })); }
        catch (problem) { const said = host.querySelector(".pls-ex-error"); said.hidden = false; said.textContent = problem.message; return; }
        finally { button.disabled = false; }
      }
      if (onExample) onExample(project, button); else zoomOpen(button, projectUrl(project), button.querySelector(".pls-ex-ic"));
    });
    for (const button of host.querySelectorAll("[data-pick]")) button.addEventListener("click", async () => {
      const field = button.dataset.pick;
      try {
        const chosen = await pickFolder(field === "docs" ? w.chooseDocs : w.chooseCode, lang);
        if (chosen) {
          form.elements[field].value = chosen;
          if (field === "docs") setFollows(false); else form.elements[field].removeAttribute("aria-invalid");
          error.hidden = true; follow();
        }
      } catch (problem) { fail(problem.message); }
    });
    // A docs folder made before comes back with its name, its code folder if that is here, and its Topic ids.
    host.querySelector("[data-import]").addEventListener("click", async () => {
      try {
        const folder = await pickFolder(w.chooseImport, lang);
        if (!folder) return;
        const { project, codeConflict } = await call("/projects/import", { method:"POST", body:{ docsPath:folder } });
        error.hidden = true;
        if (onCreated) onCreated(project, { codeConflict });
        else {
          if (codeConflict) {
            try { sessionStorage.setItem("penecho-lines-import-conflict", JSON.stringify({ ...codeConflict, projectId:project.id })); }
            catch { /* The project still opens without linking the conflicting code folder. */ }
          }
          zoomOpen(host.querySelector(".pls-create"), projectUrl(project));
        }
      } catch (problem) { fail(problem.message); }
    });
    let creating = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (creating) return;
      const name = nameField.value.trim(), codePath = code.value.trim();
      if (create) {
        if (!name) { fail(lang === "zh" ? "请给项目起个名字。" : "Give the project a name."); nameField.focus(); return; }
        const submit = form.querySelector(".pls-create");
        creating = true; submit.disabled = true; error.hidden = true;
        try { await create(name); } catch (problem) { fail(problem.message); } finally { creating = false; submit.disabled = false; }
        return;
      }
      const folder = follows ? ownName() && ownFolder() : docs.value.trim();
      if (!folder) { fail(w.needName); nameField.focus(); return; }
      const submit = form.querySelector(".pls-create");
      creating = true; submit.disabled = true; error.hidden = true;
      docs.removeAttribute("aria-invalid");
      code.removeAttribute("aria-invalid");
      try {
        const { project } = await call("/projects", { method:"POST", body:{ name:name || folderName(folder), docsPath:folder, codePath:codePath || undefined } });
        form.reset(); error.hidden = true; setFollows(true); follow();
        if (onCreated) onCreated(project);
        else {
          // The Lines page it opens brings in its conversations, as it does for a project made there.
          try { sessionStorage.setItem("penecho-lines-made", project.id); } catch { /* Then Sync conversations is a click. */ }
          zoomOpen(host.querySelector(".pls-create"), projectUrl(project));
        }
      } catch (problem) {
        if (problem.code === "CODE_FOLDER_IN_USE") {
          code.setAttribute("aria-invalid", "true");
          fail(lang === "zh" && problem.conflict?.name ? w.codeSubmit(problem.conflict.name, Boolean(problem.conflict.archived)) : problem.message);
        } else {
          fail(lang === "zh" ? w.folderErrors[problem.code] || problem.message : problem.message);
          if (w.folderErrors[problem.code] || problem.code === "BAD_FOLDER") docs.setAttribute("aria-invalid", "true");
        }
      } finally { creating = false; submit.disabled = false; }
    });
    if (agents) showAgents(host, agents); else knownAgents().then(list => showAgents(host, list));
    // The agents found here, once PenEcho has looked.
    const found = host.querySelector("[data-pls-found]:not([data-found])");
    if (found) knownAgents().then(list => { if (found.isConnected) found.outerHTML = foundHTML(lang, list); });
  }
  window.PenEchoProjects = { mount, codeFolderOwner, pickFolder, browseFolders, explainerHTML, benefitsHTML, featureListHTML, agentsHTML, linesModelHTML, stageHTML, followHTML:benefitsHTML, visionHTML, pictureHTML, statusText:(p, lang = "en") => statusText(p, WORDS[lang] || WORDS.en), zoomOpen, projectUrl, plain, useBase, guestModelAvailable, agents:knownAgents, toAskAIHTML, list:async () => { const first = window.projectLinesFirstList; window.projectLinesFirstList = null; const data = first ? (await first) || await call("/projects") : await call("/projects"); useBase(data?.base, { caseInsensitive:data?.caseInsensitive }); return data; } };
})();
