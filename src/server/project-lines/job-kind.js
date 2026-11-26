"use strict";
// What a job is about, read from its own words (PE-1085): code, chat, design, research or docs. Only keywords and patterns, so no
// model is asked: it takes no time, costs nothing, and the same words always give the same answer. PenEcho Auto uses it to start
// the agent that does this kind of job best, and the job says which words decided it.
const KINDS = ["code", "chat", "design", "research", "docs"];

// kind, points, pattern. 3: the word nearly says it alone. 2: a usual word for it. 1: it only leans that way.
// Below zero: the words rule the kind out ("do not change any code").
// Each different word a pattern finds counts once (three at most), so a long pasted log counts as a few words, not as hundreds.
const SIGNALS = [
  // ----- code: writing, fixing, or testing code -----
  ["code", 3, /\b(?:bugs?|bugfix\w*|hotfix\w*|debug\w*|refactor\w*|stack ?traces?|traceback|unit tests?|e2e tests?|integration tests?|regression tests?|failing tests?|test suite|test coverage|pull requests?|merge conflicts?|compil\w+|linter|lint(?:s|ing)?|type ?errors?|regex\w*|typescript|javascript|python|golang|kotlin|node\.?js|sql|npm|pnpm|pip|cargo|docker\w*|kubernetes|codebase|source code|segfault|race conditions?|memory leaks?|null pointer|endpoints?|backend|back-end|frontend|front-end|middleware|webhooks?|websockets?|oauth|cron ?jobs?|env(?:ironment)? variables?|repo(?:sitory|sitories|s)?|github|gitlab|git|rebas\w+|ci\/cd|sdk|apis?)\b/gi],
  ["code", 3, /\b(?:add|write|run|fix|update|rerun)\b[^.?!\n]{0,20}\btests?\b|\btests? (?:fail\w*|pass\w*|are red|is red)/gi],
  ["code", 3, /\b(?:build|create|make|add|write|code)\b[^.?!\n]{0,40}\b(?:app|apps|web ?site|web ?app|component|extension|bot|game|widget|dashboard|scripts?|functions?|endpoint|plugin|parser|crawler|scraper)\b/gi],
  ["code", 3, /\b[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|rb|php|cpp|cc|cs|swift|kt|sql|sh|css|scss|html|json|ya?ml|toml)\b/gi],
  ["code", 3, /```|\b\w+\(\)|\b[A-Z]\w*(?:Error|Exception|Warning)\b|\b(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|SIGSEGV|SIGKILL)\b|\bexit code \d+|\bHTTP [45]\d\d\b|\bPR ?#\d+/g],
  ["code", 3, /代码|报错|重构|调试|单元测试|编译|接口|函数|脚本|后端|前端|数据库|仓库|分支|合并|部署|崩溃|漏洞|程序/g],
  ["code", 2, /\b(?:fix(?:es|ed|ing)?|implement\w*|code[sd]?|coding|program(?:s|ming|med)?|scripts?|functions?|methods?|variables?|database|schema|migrations?|deploy\w*|builds?|ci|cli|commit(?:s|ted|ting)?|branch(?:es)?|merg(?:e|es|ed|ing)|crash\w*|exceptions?|optimi[sz]\w+|latency|cach(?:e|es|ed|ing)|modules?|librar(?:y|ies)|dependenc(?:y|ies)|plugins?|algorithms?|pars(?:e|er|ing)|queries|query|patch\w*|server|handler|callback|async|timeout|undefined|json|css|html|http|url|localhost|electron|feature flag|command line|terminal|shell|install\w*|config\w*|bundle|runtime|framework|syntax|revert\w*|rollback|memory|cpu)\b/gi],
  ["code", 2, /修复|修一下|实现|开发|测试|优化|缓存|性能|算法|组件|插件|依赖|升级|提交|服务器|配置|安装|回滚/g],
  // A change asked of a product, in the words people use for one.
  ["code", 1, /\b(?:add|remove|replace|rename|change|move|hide|show|enable|disable|support|allow|prevent|make it|make the|make sure|instead of|by default|should(?: not|n'?t)?|need(?:s)? to|when (?:i|user|users|the user|you) (?:click|open|type|press|select|start|close)\w*|doesn'?t work|not working|broken|fail(?:s|ed|ing|ure)?|errors?|tests?|testing|slow|speed up|feature|features|button|setting|settings|sidebar|popup|dialog|menu|tab|page|click\w*|toggle|option|sync\w*|upload\w*|download\w*|import|export|log ?in|sign ?in|load\w*)\b/gi],
  ["code", 1, /添加|增加|加一个|加上|删除|去掉|改成|改为|替换|隐藏|显示|支持|默认|按钮|设置|页面|点击|失败|不工作|不能用|没反应|太慢/g],
  ["code", -4, /\b(?:do not|don'?t|no need to|not to|without|never) (?:\w+ ){0,2}?(?:implement\w*|cod(?:e|es|ing)|edit|modify|change)\b[^.?!\n]{0,30}|\b(?:read[- ]only|research only|design only|proposal only|no code changes?)\b/gi],
  ["code", -4, /不要(?:改|写|动|实现)代码|不要实现|先不要写|只(?:要|需要)?设计/g],

  // ----- design: UI/UX, visual, canvas/prototypes, 3D -----
  ["design", 3, /\b(?:ui|ux|mock-?ups?|wireframes?|prototyp\w+|redesign\w*|logos?|illustrat\w+|typograph\w+|colou?r (?:palette|scheme)s?|palettes?|figma|sketch(?:es)?|blender|3d|posters?|banners?|infographics?|diagrams?|flow ?charts?|moodboard|branding|brand identity|visual (?:design|style|identity)|look and feel|storyboard|artwork|design system|style guide|draw(?:ing|s|n)?|design (?:first|only)|other designs?)\b/gi],
  ["design", 3, /原型|界面设计|线框|配色|插画|海报|建模|草图|画一|画个|画出|画张|视觉|动效|示意图|流程图|架构图|设计稿/g],
  ["design", 2, /\b(?:design(?:s|ed|ing)?|visual\w*|styl(?:e|es|ing)|theme|dark mode|spacing|alignment|fonts?|colou?r(?:s|ful)?|gradients?|shadows?|responsive|layouts?|icons?|animat\w+|canvas|images?|polish|beautiful|prett(?:y|ier)|aesthetic\w*|looks? (?:better|nicer|cleaner|modern|ugly|bad|wrong|odd)|exquisite|elegant)\b/gi],
  ["design", 2, /设计|布局|样式|风格|好看|美观|难看|字体|颜色|排版|主题|画布|图标|动画/g],

  // ----- research: investigation or analysis -----
  ["research", 3, /\b(?:research\w*|investigat\w*|benchmark\w*|compar(?:e|es|ed|ing|isons?)|literature|survey\w*|market (?:size|research|analysis)|competitors?|competitive|state of the art|root cause|feasibility|due diligence|case stud(?:y|ies)|deep dive|fact[- ]check\w*|look up|find out|look into|check (?:if|whether|why|how|what|recent)|why)\b/gi],
  ["research", 3, /调研|研究|调查|对比|比较|竞品|可行性|查一下|查查|查找|排查|定位问题|为什么/g],
  ["research", 2, /\b(?:analy[sz]\w+|analysis|evaluat\w+|assess\w*|search (?:the web|online|for)|sources?|citations?|papers?|studies|trends?|measur\w+|audit\w*|alternatives|which (?:is|are|one is) (?:better|best|faster|cheaper)|versus|vs\.?|diagnos\w+|figure out|find (?:the )?(?:reason|cause)|what (?:is|are) the (?:difference|differences|options)|how (?:much|many)|pl(?:ea)?se? check|verify|confirm whether|is (?:it|this|that) (?:a bug|expected|normal|possible|correct)|anything (?:wrong|unexpected))\b/gi],
  ["research", 2, /分析|评估|搜索|搜一下|资料|趋势|原因|哪个更好|哪个好|是否|会不会|确认一下|看一下|检查/g],

  // ----- docs: documentation, notes, or slides -----
  ["docs", 3, /\b(?:documentation|docs?|readme(?:\.md)?|changelog|release notes|meeting notes|minutes|slides?|slide deck|deck|presentation|pptx?|powerpoint|keynote|write[- ]?ups?|blog ?posts?|articles?|essays?|newsletters?|press release|user (?:guide|manual)|tutorials?|handbook|faq|white ?paper|memo|cover letter|resume|proofread\w*|translat\w+|flashcards?|note cards?|speech)\b/gi],
  ["docs", 3, /文档|说明书|笔记|纪要|幻灯片|演示文稿|博客|文章|邮件|翻译|润色|周报|日报|简历|教程|手册|讲稿/g],
  ["docs", 2, /\b(?:document(?:s|ed|ing)?|notes?|summar(?:y|ies|i[sz]\w+)|draft\w*|rewrit\w+|reword\w*|copy ?writing|wording|outline|guide|reports?|proposals?|spec(?:ification)?s?|emails?|letters?|announcements?|paragraphs?|grammar|headlines?|captions?|markdown|wiki|sub ?titles?|tagline|slogan|tone)\b/gi],
  ["docs", 2, /总结|摘要|起草|撰写|写一篇|写一份|写个|报告|提纲|大纲|文案|标题|说明/g],

  // ----- chat: discussion, Q&A, or general conversation -----
  ["chat", 3, /\b(?:what do you think|what(?:'s| is) your (?:view|opinion|take)|(?:your|their|a second) (?:opinions?|thoughts|views?|take)|let'?s (?:talk|discuss|chat)|brainstorm\w*|chat about|talk (?:about|through)|discuss\w*|advice|advise|just answer)\b/gi],
  ["chat", 3, /你觉得|你怎么看|聊聊|聊一下|讨论|商量|头脑风暴|给点建议|有什么建议/g],
  ["chat", 2, /\b(?:explain\w*|tell me|help me understand|what does [^.?!\n]{1,40} mean|thoughts on|ideas? for|any ideas?|suggest\w*|recommend\w*|pros and cons|should (?:i|we)|do you (?:think|agree|know)|hello|hi there|thanks|thank you)\b/gi],
  ["chat", 2, /解释|讲讲|说说|告诉我|什么意思|怎么样|建议|想法|你好|谢谢/g],
];
// How the request opens says most: "Fix …", "Compare …", "Draw …". After a polite start such as "please" or "can you".
const POLITE = /^\s*(?:(?:ok|okay|so|and|then|now|also|hi|hello|hey)[,.!]?\s+)*(?:(?:pls|please|plz|kindly)[,]?\s+)?(?:(?:can|could|would|will) you (?:pls |please )?|help (?:me )?(?:to )?|i (?:want|need|would like)(?: you)? to |let'?s |请|帮我|麻烦)?/i;
const OPENS = [
  ["code", 3, /^(?:fix|implement|refactor|debug|deploy|rebase|revert|merge|install|upgrade|optimi[sz]e|修复|实现|重构)/i],
  ["code", 2, /^(?:add|remove|replace|rename|change|move|hide|show|enable|disable|update|delete|添加|增加|删除|去掉|改)/i],
  ["research", 3, /^(?:research|investigate|compare|analy[sz]e|find out|look up|look into|check|verify|evaluate|benchmark|audit|measure|diagnose|inspect|review|调研|研究|分析|对比|比较|查)/i],
  ["design", 3, /^(?:design|redesign|draw|sketch|prototype|mock ?up|illustrate|restyle|设计|画)/i],
  ["docs", 2, /^(?:document|write|draft|summari[sz]e|translate|proofread|rewrite|写|总结|翻译|起草)/i],
  // What the opening verb is to work on: "Update the docs…", "Fix the wording…".
  ["docs", 3, /^\w+ (?:the |a |an |our |my |this |these )?(?:docs?|documentation|readme|changelog|release notes|notes|slides?|deck|presentation|article|essay|email|letter|wording|copy|text)\b/i],
  ["chat", 3, /^(?:explain|tell me|discuss|brainstorm|suggest|recommend|advise|answer|reply|解释|讲讲|聊)/i],
];
// A question with nothing else to go on is a chat. One about something of yours ("will this…", "does our…") needs looking into: research.
const ASKS = /^(?:(?:what|how|who|when|where|which|why)\b|(?:do|does|did) (?:i|we|you|they|it|this|that|these|those|our|my)\b|(?:is|are|was|were|can|could|should|would|will|has|have) (?:i|we|you|they|it|this|that|these|those|there|the|our|my|your|any|a|an)\b)/i;
const ENDS = /[?？]\s*$/;
const YOURS = /\b(?:this|these|those|our|my|we|here|it|recent\w*|still|again|currently)\b|这个|这些|我们|我的|现在/i;
const MAKES = { diagram:"design", explorer:"design", slides:"docs", card:"docs" };
// Where a file is and what a link points to are names, not what is asked: only the last part of each stays.
const PLACES = /\bhttps?:\/\/\S+|(?:~|\b[A-Za-z]:)?(?:\/[\w.@%+~-]+){2,}/g;
// The request is in the first lines; what is pasted after it counts less the further down it is.
const NEAR = 240, FAR = 1200, SCAN = 6000, MOST = 3, ENOUGH = 2, USUAL = 1.5;
const QUESTION = "a question", YOUR_QUESTION = "a question about your own work", USUAL_HERE = "like most jobs in this project";

// → { kind, from } where from lists what decided it, ready to show; kind is "" when the words do not say.
// make: the Make choice of the box (a deck is docs, a diagram design). usual: what this project's jobs usually are, one more hint.
function jobKind(text, { make = null, usual = "" } = {}) {
  if (MAKES[make?.kind]) return { kind:MAKES[make.kind], from:[`Make: ${make.kind}`] };
  const all = String(text || "").slice(0, SCAN).replace(PLACES, m => ` ${m.split("/").at(-1)} `), found = new Map(KINDS.map(k => [k, []]));
  const weight = at => at < NEAR ? 1 : at < FAR ? 0.5 : 0.25;
  const add = (kind, word, points, at = 0) => found.get(kind).push({ word, at, points:points * weight(at) });
  const quoted = text => `“${text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 32)}”`;
  for (const [kind, points, pattern] of SIGNALS) {
    const seen = new Set();
    for (const m of all.matchAll(pattern)) {
      const word = quoted(m[0]);
      if (seen.has(word)) continue;
      seen.add(word); add(kind, word, points, m.index);
      if (seen.size >= MOST) break;
    }
  }
  const opening = all.replace(POLITE, "");
  for (const [kind, points, pattern] of OPENS) {
    const m = opening.match(pattern);
    if (m) add(kind, quoted(m[0]), points);
  }
  const starts = ASKS.test(opening), ends = ENDS.test(all.split(/\n\s*\n/)[0]) || ENDS.test(all), question = starts || ends;
  if (starts) add("chat", QUESTION, 2);
  if (ends) add("chat", QUESTION, 1);
  if (question && YOURS.test(all.slice(0, NEAR))) add("research", YOUR_QUESTION, 3.5);
  // What this project's jobs usually are says nothing about a question.
  const habit = KINDS.includes(usual) && !question ? usual : "";
  const points = kind => found.get(kind).reduce((n, x) => n + x.points, 0), firstAt = kind => Math.min(...found.get(kind).map(x => x.at));
  // The most points, and enough of them. On a tie a chat gives way (it is what a question is when nothing else says), then the kind its words name first.
  const pick = extra => {
    const scores = Object.fromEntries(KINDS.map(k => [k, points(k) + (k === extra ? USUAL : 0)]));
    const best = [...KINDS].sort((a, b) => scores[b] - scores[a] || (a === "chat") - (b === "chat") || firstAt(a) - firstAt(b))[0];
    return { scores, kind:scores[best] >= ENOUGH ? best : "" };
  };
  const words = pick(""), { scores, kind } = habit ? pick(habit) : words;
  // The project's usual kind is named only where it decided: the words alone said nothing, or something else.
  const usualToo = habit && (kind || habit) === habit && words.kind !== habit ? [USUAL_HERE] : [];
  if (!kind) return { kind:habit, from:usualToo, scores };
  const said = found.get(kind).filter(x => x.points > 0).sort((a, b) => b.points - a.points || a.at - b.at).map(x => x.word);
  // A word already inside one that is shown ("server" after "server.js") is not shown again.
  const bare = word => word.replace(/^“|”$/g, ""), shown = [...new Set(said)].filter((word, i, list) => !list.slice(0, i).some(w => bare(w).includes(bare(word))));
  return { kind, from:shown.slice(0, MOST).concat(usualToo), scores };
}

module.exports = { jobKind, KINDS };
