"use strict";
// The onboarding examples, in four categories: what each one draws on a fresh
// canvas, which suggestion it highlights, and how progress is remembered.
(function (root, factory) {
  const ink = typeof module === "object" && module.exports ? require("./example-ink.js") : root.PENECHO_EXAMPLE_INK;
  const api = factory(ink);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_EXAMPLE_SCENARIOS = api;
})(typeof globalThis === "object" ? globalThis : this, function (ink) {
  const SCHEMA = 1;
  // Each example belongs to exactly one category; a category shows only its own.
  const GOALS = Object.freeze(["study", "code", "work", "play"]);
  const LEGACY_GOALS = Object.freeze({ build: "code", plan: "work", teach: "study" });

  const CAT_HALF = [
    "M80 40c-20 0-40 14-40 36s18 34 40 34",
    "M46 52L44 18l24 18",
    "M76 84l4 4 4-4",
    "M60 86l-28-4",
    "M60 92l-28 4",
  ];
  const ROCKET = [
    "M75 12c22 22 30 60 26 120H49c-4-60 4-98 26-120Z",
    "M49 110l-22 34 24-6",
    "M101 110l22 34-24-6",
    "M60 140c2 22 8 34 15 50 7-16 13-28 15-50",
  ];
  const BIRD = [
    "M90 100c0-22 22-36 50-34 26 2 42 18 40 36-2 20-24 30-50 28-24-2-40-12-40-30Z",
    "M201 76l16 4-15 6",
    "M126 82c-6-24 4-46 24-58 0 22-4 40-12 56",
    "M126 130l-4 20",
    "M146 130l2 20",
    "M92 100l-22-8",
    "M92 108l-24 4",
  ];
  const BIRD_MOTION = ["M20 80h34", "M14 96h40", "M24 112h28"];
  const TIMER_WIREFRAME = [
    "M6 6c70-2 146 1 218-1l2 288c-72 2-146-1-218 1Z",
    "M58 110c34-1 82 1 114-1l1 64c-34 1-80-1-114 1Z",
    "M54 220c34 0 50-1 54 1l-1 38c-18 1-36 0-53-1Z",
    "M124 220c34 0 50-1 54 1l-1 38c-18 1-36 0-53-1Z",
  ];
  const TIC_TAC_TOE = [
    "M60 0c2 60-2 120 0 180",
    "M120 2c-2 60 2 118 0 178",
    "M0 60c60 2 120-2 180 0",
    "M2 120c60-2 118 2 178 0",
    "M14 14l32 32",
    "M46 14l-32 32",
    "M74 74l32 32",
    "M106 74l-32 32",
  ];
  // Bonds run from the oxygen circle's edge to each hydrogen circle's edge.
  const WATER_BONDS = ["M70 140L45 157", "M130 140L155 157"];
  const HEART = ["M100 46c-14-30-74-28-74 18 0 40 46 70 74 104 28-34 74-64 74-104 0-46-60-48-74-18Z", "M100 48c-4 30 4 70 0 118"];
  const DIAGRAM_BOXES = [
    "M0 0c56-3 116 2 172-1l3 66c-56 2-116-2-174 2Z",
    "M250 -2c56-1 114 3 170 0l2 70c-56 2-114-3-170 0Z",
    "M252 200c56 0 114-2 170 2l-2 66c-56-2-114 2-170-1Z",
    "M500 196c52-1 104 2 158 0l2 70c-52 1-104-2-160 1Z",
  ];
  const DIAGRAM_ARROWS = [
    "M180 34c22 0 44-1 64 1",
    "M230 22l14 13-14 12",
    "M336 74c2 40-1 80 0 120",
    "M324 180l12 14 12-14",
    "M426 40c56 16 120 70 150 150",
    "M562 178l15 14 6-19",
  ];

  function text(value, x, y, size, seed) {
    return ink.textStrokes(value, { x, y, size, seed }).strokes;
  }
  function paths(list, x, y, scale, seed) {
    return list.flatMap((d, index) => ink.pathStrokes(d, { x, y, scale, seed: seed + index, spacing: 3 }));
  }

  // Ink is laid out from (0, 0) in screen px; the app centres it in view.
  // Scenarios that rank on the Suggest bar stay within its 64 recorded strokes.
  const SCENARIOS = Object.freeze([
    {
      id: "functions",
      feature: "functions",
      route: "instant",
      action: "plot",
      seconds: 10,
      category: "study",
      title: { en: "Graph a function", zh: "绘制函数图像" },
      description: { en: "Write f(x) and get a live graph with sliders.", zh: "写下 f(x)，得到可拖动参数的实时图像。" },
      coach: { en: "Tap Plot graph. It works instantly, with no AI model.", zh: "点击“绘制函数图”。即时生成，无需 AI 模型。" },
      learned: { en: "Writing is enough. PenEcho reads math and offers the next step.", zh: "写下来就够了。PenEcho 能读懂数学并给出下一步。" },
      preview: "f(x) = a·sin x",
      // Known formula: the example inserts this graph without reading the ink.
      graph: { mode: "2d", expression: "y = a*sin(x)", parameters: { a: 1 } },
      strokes: () => text("f(x) = a·sin x", 0, 0, 64, 101),
    },
    {
      id: "kids-homework",
      feature: "homework",
      category: "study",
      route: "ai",
      action: "check_step",
      seconds: 15,
      title: { en: "Check a child's homework", zh: "检查孩子的作业" },
      description: { en: "Three sums, one slip. PenEcho marks it and writes the fix.", zh: "三道算术题，有一道错了。PenEcho 会标出并写出更正。" },
      coach: { en: "Tap Check. PenEcho checks each answer and writes the correction beside the wrong one.", zh: "点击“检查”。PenEcho 会逐题检查，并在错题旁写出更正。" },
      tip: { en: "Spelling works too: write a few words and tap Check.", zh: "拼写也可以：写几个单词，再点击“检查”。" },
      learned: { en: "Children keep their own handwriting; PenEcho only adds the fix.", zh: "孩子的手写内容会保留，PenEcho 只补上更正。" },
      preview: "12 - 7 = 6",
      // The middle answer is wrong (12 - 7 = 5): the slip the check should find.
      strokes: () => [
        ...text("8 + 5 = 13", 0, 0, 44, 151),
        ...text("12 - 7 = 6", 0, 80, 44, 152),
        ...text("6 × 3 = 18", 0, 160, 44, 153),
      ],
    },
    {
      id: "surface-3d",
      feature: "3d",
      route: "instant",
      action: "plot",
      seconds: 10,
      category: "study",
      title: { en: "See it in 3D", zh: "立体查看" },
      description: { en: "A formula in x and y becomes a surface you can rotate.", zh: "含 x 和 y 的公式会变成可旋转的曲面。" },
      coach: { en: "Two variables make a 3D surface. Drag it to rotate.", zh: "两个变量会生成三维曲面，拖动即可旋转。" },
      learned: { en: "Results are live objects you can explore, not pictures.", zh: "结果是可以探索的对象，而不只是图片。" },
      preview: "z = sin x · cos y",
      graph: { mode: "3d", expression: "z = sin(x)*cos(y)" },
      strokes: () => text("z = sin x · cos y", 0, 0, 60, 202),
    },
    {
      id: "proof-check",
      feature: "proof",
      route: "ai",
      action: "check_step",
      seconds: 15,
      category: "study",
      title: { en: "Check a proof step by step", zh: "逐步检查证明" },
      description: { en: "A worked proof with a slip; PenEcho finds it and writes the fix.", zh: "一段有错误的推导，PenEcho 找出错误并写出更正。" },
      coach: { en: "Tap Check. PenEcho verifies each step and writes the correction next to the wrong line.", zh: "点击“检查”。PenEcho 会逐步核对，并在出错的那一行旁写出更正。" },
      tip: { en: "When you write a new line under earlier steps, PenEcho can flag a doubtful line for you to check.", zh: "在前面步骤下方写新的一行时，PenEcho 会标出可疑的步骤供你检查。" },
      learned: { en: "PenEcho checks your own work and keeps your handwriting; it only adds the fix.", zh: "PenEcho 检查你自己的推导并保留手写内容，只补上更正。" },
      preview: "= a² + b²",
      // The last line drops 2ab: the slip the check should find.
      strokes: () => [
        ...text("(a+b)² = (a+b)(a+b)", 0, 0, 32, 251),
        ...text("= a² + ab + ab + b²", 96, 64, 32, 252),
        ...text("= a² + b²", 96, 128, 32, 253),
      ],
    },
    {
      id: "photo-note",
      feature: "notes",
      // Always offered on the empty canvas: a photo is the quickest way in.
      featured: true,
      route: "ai",
      action: "note",
      seconds: 20,
      category: "study",
      title: { en: "Photo to study notes", zh: "照片变学习笔记" },
      description: { en: "Snap the board after class and get organized notes.", zh: "课后拍下板书，得到整理好的笔记。" },
      coach: { en: "Tap Organize as Note. PenEcho reads the photo and writes study notes with the key formulas and the diagram.", zh: "点击“整理为笔记”。PenEcho 会读取照片，整理出包含关键公式和图示的学习笔记。" },
      tip: { en: "Notes keep the original photo and are saved to the Library under Notes & cards.", zh: "笔记会保留原始照片，并保存在资料库的“笔记与卡片”中。" },
      learned: { en: "A photo of the board becomes notes you can search and review.", zh: "一张板书照片就能变成可搜索、可复习的笔记。" },
      // A lecture blackboard (QED: e⁻μ⁻ scattering). Re-encoded without metadata.
      image: { src: "examples/qed-blackboard.jpg", name: "qed-blackboard.jpg", width: 1321, height: 1400 },
      strokes: () => [],
    },
    {
      id: "knowledge-card",
      feature: "cards",
      route: "ai",
      action: "note",
      seconds: 15,
      category: "study",
      title: { en: "Keep what matters", zh: "留住重点" },
      description: { en: "Save a formula as a knowledge card in your Library.", zh: "把公式保存为知识卡片，收进资料库。" },
      coach: { en: "Organize as Note keeps your handwriting and files the card in the Library.", zh: "“整理为笔记”会保留你的手写内容，并把卡片收进资料库。" },
      tip: { en: "Find cards later in the Library under Notes & cards.", zh: "之后可在资料库的“笔记与卡片”中找到它们。" },
      learned: { en: "The canvas is for thinking; the Library is for keeping.", zh: "画布用来思考，资料库用来保存。" },
      preview: "chain rule",
      strokes: () => [
        ...text("Chain rule", 0, 0, 40, 801),
        ...text("(f∘g)′ = f′(g(x)) · g′(x)", 0, 72, 52, 802),
      ],
    },
    {
      id: "visual-explorer",
      feature: "explorer",
      route: "agent",
      action: "agent",
      seconds: 40,
      category: "study",
      title: { en: "Understand a topic", zh: "看懂一个主题" },
      description: { en: "Messy notes become one clear visual explanation.", zh: "凌乱的笔记变成一张清晰的可视化讲解。" },
      coach: { en: "PenEcho Agent can see your notes. Send the prompt to get a visual explanation.", zh: "PenEcho Agent 能看到你的笔记。发送提示即可获得可视化讲解。" },
      prompt: {
        en: "Turn my handwritten notes on this canvas into one visual explanation: the big picture first, then the parts, and answer every question mark.",
        zh: "把画布上的手写笔记整理成一张可视化讲解：先讲整体，再讲各部分，并回答所有带问号的问题。",
      },
      learned: { en: "The canvas is a place to understand things, not only to draw.", zh: "画布不只是用来画画，也是理解问题的地方。" },
      preview: "attention?",
      strokes: () => [
        ...text("Transformer", 0, 0, 44, 701),
        ...text("tokens → embeddings + position", 0, 80, 30, 702),
        ...text("attention?  Q, K, V", 0, 134, 30, 703),
        ...text("softmax(QK) · V", 0, 188, 30, 704),
        ...text("many heads → concat", 0, 242, 30, 705),
        ...text("encoder / decoder ??", 0, 296, 30, 706),
      ],
    },
    {
      id: "diagram",
      feature: "diagram",
      route: "instant",
      action: "diagram",
      seconds: 15,
      category: "code",
      title: { en: "Sketch to diagram", zh: "草图变图表" },
      description: { en: "Rough boxes and arrows become a clean diagram to export.", zh: "粗略的方框和箭头变成可导出的整洁图表。" },
      coach: { en: "Tap Make diagram. This example is instant; your own sketches use AI. Export as SVG or PNG.", zh: "点击“生成结构图”。本示例即时生成，你自己的草图会使用 AI。可导出 SVG 或 PNG。" },
      tip: { en: "Steps with a yes/no branch become a workflow; arrows between people become a sequence diagram.", zh: "带“是/否”分支的步骤会画成流程图，角色之间的箭头会画成时序图。" },
      learned: { en: "Thinking by hand turns into work you can paste into a doc or deck.", zh: "手绘思考可以直接变成能放进文档或演示的成果。" },
      preview: "App → API",
      // Known sketch: the example inserts this local architecture diagram
      // without reading the ink, as Make diagram would for the same boxes.
      architecture: {
        version: 1,
        title: "Browser → API",
        nodes: [
          { id: "browser", label: "Browser", type: "frontend" },
          { id: "api", label: "API" },
          { id: "postgres", label: "Postgres", type: "database" },
          { id: "cache", label: "Cache", type: "database" },
        ],
        edges: [
          { from: "browser", to: "api" },
          { from: "api", to: "postgres", kind: "data" },
          { from: "api", to: "cache", kind: "data" },
        ],
      },
      strokes: () => [
        ...paths(DIAGRAM_BOXES, 0, 0, 1, 601),
        ...paths(DIAGRAM_ARROWS, 0, 0, 1, 610),
        ...text("Browser", 22, 18, 26, 621),
        ...text("API", 312, 18, 26, 622),
        ...text("Postgres", 270, 218, 26, 623),
        ...text("Cache", 534, 216, 26, 624),
      ],
    },
    {
      id: "code-bug",
      feature: "code",
      category: "code",
      route: "ai",
      action: "check_step",
      seconds: 20,
      title: { en: "Find the bug in a screenshot", zh: "从代码截图里找 bug" },
      description: { en: "Paste a screenshot of code; PenEcho marks the bug and writes the fix.", zh: "贴上一张代码截图，PenEcho 会标出 bug 并写出修复。" },
      coach: { en: "Tap Check. PenEcho reads the code and writes the fix next to the bug.", zh: "点击“检查”。PenEcho 会读取代码，并在 bug 旁写出修复。" },
      tip: { en: "Paste any screenshot, or copy code onto the canvas and tap Check.", zh: "任何截图都可以贴进来，也可以把代码粘贴到画布上再点击“检查”。" },
      learned: { en: "Paste what you are looking at; PenEcho reviews it right where it is.", zh: "把眼前的内容贴进来，PenEcho 就地帮你检查。" },
      // An editor screenshot of average(): `i <= scores.length` reads past the end, so it returns NaN.
      image: { src: "examples/average-bug.jpg", name: "average-bug.jpg", width: 1000, height: 547 },
      strokes: () => [],
    },
    {
      id: "agent-diagrams",
      feature: "agent",
      route: "agent",
      action: "agent",
      seconds: 60,
      category: "code",
      title: { en: "Diagrams with PenEcho Agent", zh: "让 PenEcho Agent 画图" },
      description: { en: "One request, three diagrams: architecture, sequence and workflow.", zh: "一句话，三张图：架构图、时序图和流程图。" },
      coach: { en: "Send this prompt, or say it your own way. The Agent reads your notes and draws all three.", zh: "发送这条提示，或用你自己的话说。Agent 会读取笔记并画出三张图。" },
      // Small on purpose: at most four boxes each, so the Agent draws quickly.
      prompt: {
        en: "Draw three very simple professional diagrams from my notes on this canvas, side by side: 1) an architecture diagram: Web app → API → Database; 2) a sequence diagram with User, Web app and API: sign in, check password, return token; 3) a workflow: Sign in → Password valid? → yes: Home, no: Try again. At most 4 boxes each, short labels.",
        zh: "根据画布上的笔记，并排画三张非常简单的专业图：1）架构图：网页应用 → API → 数据库；2）时序图，参与者为用户、网页应用和 API：登录、校验密码、返回令牌；3）流程图：登录 → 密码正确？→ 是：进入首页，否：重试。每张图最多 4 个框，标签简短。",
      },
      learned: { en: "Ask once in plain words; the Agent draws diagrams you can edit and export.", zh: "用平常的话说一次，Agent 就能画出可编辑、可导出的图。" },
      preview: "Web → API → DB",
      strokes: () => [
        ...text("Login system", 0, 0, 36, 751),
        ...text("Web app → API → Database", 0, 70, 28, 752),
        ...text("sign in: user → app → API", 0, 124, 28, 753),
        ...text("password ok? yes → home", 0, 178, 28, 754),
      ],
    },
    {
      id: "prototype",
      feature: "prototype",
      category: "code",
      route: "agent",
      action: "agent",
      seconds: 60,
      title: { en: "Wireframe to working prototype", zh: "线框图变可用原型" },
      description: { en: "Sketch a screen and the Agent builds a working widget.", zh: "画出一个界面，Agent 会把它做成可用的组件。" },
      coach: { en: "Send this prompt, or describe it your own way. The Agent reads your sketch.", zh: "发送这条提示，或用你自己的话描述。Agent 会读取你的草图。" },
      prompt: {
        en: "Build a working focus timer widget from my sketch on this canvas: a 25-minute countdown with Start, Pause and Reset, placed next to the sketch.",
        zh: "根据画布上的草图做一个可用的专注计时器组件：25 分钟倒计时，带开始、暂停和重置按钮，放在草图旁边。",
      },
      learned: { en: "A sketch and a sentence become something that works.", zh: "一张草图加一句话，就能变成能用的东西。" },
      preview: "[ 25:00 ]",
      strokes: () => [
        ...text("focus timer", 0, 0, 34, 1201),
        ...paths(TIMER_WIREFRAME, 0, 64, 1.4, 1210),
        ...text("25:00", 104, 64 + 124 * 1.4, 40, 1202),
        ...text("start", 84, 64 + 230 * 1.4, 16, 1203),
        ...text("reset", 182, 64 + 230 * 1.4, 16, 1204),
      ],
    },
    {
      id: "class-3d",
      feature: "3d",
      category: "work",
      route: "agent",
      action: "agent",
      seconds: 60,
      title: { en: "Show a class in 3D", zh: "给学生看立体模型" },
      description: { en: "A teacher sketches a molecule; the Agent builds a 3D model to rotate.", zh: "老师画出分子草图，Agent 做出可旋转的三维模型。" },
      coach: { en: "Send this prompt. The Agent builds a 3D model your students can rotate on the canvas.", zh: "发送这条提示。Agent 会做出学生可以在画布上旋转的三维模型。" },
      prompt: {
        en: "Make a simple 3D model of a water molecule (H2O) from my sketch on this canvas that my students can rotate: one oxygen and two hydrogen atoms, labelled, with the 104.5° bond angle. Keep it simple and place it next to my sketch.",
        zh: "根据画布上的草图做一个学生可以旋转的简单水分子（H2O）三维模型：一个氧原子和两个氢原子并加标签，标出 104.5° 键角。保持简单，放在草图旁边。",
      },
      learned: { en: "A rough sketch becomes a 3D model a whole class can explore.", zh: "一张草图就能变成全班都能探索的三维模型。" },
      preview: "H2O",
      strokes: () => [
        ...text("water molecule", 0, 0, 34, 1701),
        ink.ellipseStroke(100, 120, 36, 36, { seed: 1702 }),
        ink.ellipseStroke(28, 168, 20, 20, { seed: 1703 }),
        ink.ellipseStroke(172, 168, 20, 20, { seed: 1704 }),
        ...paths(WATER_BONDS, 0, 0, 1, 1705),
        ...text("O", 90, 106, 28, 1706),
        ...text("H", 20, 158, 22, 1707),
        ...text("H", 164, 158, 22, 1708),
        ...text("104.5°", 66, 210, 24, 1709),
      ],
    },
    {
      id: "patient-3d",
      feature: "3d",
      category: "work",
      route: "agent",
      action: "agent",
      seconds: 60,
      title: { en: "Explain to a patient in 3D", zh: "用立体模型向患者讲解" },
      description: { en: "A doctor notes the heart's parts; the Agent builds a 3D heart to rotate.", zh: "医生写下心脏结构，Agent 做出可旋转的三维心脏。" },
      coach: { en: "Send this prompt. The Agent builds a 3D model you can turn while you explain.", zh: "发送这条提示。Agent 会做出讲解时可以转动的三维模型。" },
      prompt: {
        en: "Make a simple 3D model of the human heart from my notes on this canvas that I can rotate while explaining to a patient: the four chambers labelled (left and right atrium and ventricle) and arrows for the blood flow. Keep it simple and place it next to my notes.",
        zh: "根据画布上的笔记做一个简单的人体心脏三维模型，方便我向患者讲解时旋转：标出四个腔室（左右心房和心室），并用箭头表示血流方向。保持简单，放在笔记旁边。",
      },
      learned: { en: "Explanations land better when people can turn the model themselves.", zh: "让对方亲手转动模型，讲解更容易被理解。" },
      preview: "heart",
      strokes: () => [
        ...text("heart: 4 chambers", 0, 0, 32, 1801),
        ...paths(HEART, 0, 50, 1, 1802),
        ...text("RA   LA", 50, 104, 20, 1803),
        ...text("RV  LV", 64, 142, 17, 1804),
        ...text("blood flow →", 210, 120, 24, 1805),
      ],
    },
    {
      id: "work-note",
      feature: "notes",
      category: "work",
      route: "ai",
      action: "note",
      seconds: 15,
      title: { en: "Meeting notes to a work note", zh: "会议记录变工作笔记" },
      description: { en: "Messy meeting notes become a tidy note with to-dos.", zh: "凌乱的会议记录变成带待办的整洁笔记。" },
      coach: { en: "Tap Organize as Note. Meeting notes become a work note with a date and to-dos.", zh: "点击“整理为笔记”。会议记录会变成带日期和待办的工作笔记。" },
      tip: { en: "Notes keep your handwriting and are saved to the Library under Notes & cards.", zh: "笔记会保留你的手写内容，并保存在资料库的“笔记与卡片”中。" },
      learned: { en: "Quick scribbles become notes you can find and act on later.", zh: "随手的记录会变成之后能找到、能执行的笔记。" },
      preview: "- ship demo",
      strokes: () => [
        ...text("Team sync", 0, 0, 34, 1301),
        ...text("- ship demo", 0, 64, 28, 1302),
        ...text("- fix tour: Ana", 0, 114, 28, 1303),
        ...text("- icons?", 0, 164, 28, 1304),
      ],
    },
    {
      id: "plan",
      feature: "plan",
      category: "work",
      route: "agent",
      action: "agent",
      seconds: 45,
      title: { en: "From an idea to the next step", zh: "从想法到下一步" },
      description: { en: "Rough to-dos become a plan with steps, dependencies and decisions.", zh: "零散的待办变成有步骤、依赖和决策的计划。" },
      coach: { en: "Send this prompt. The Agent turns your notes into a plan you can discuss and refine.", zh: "发送这条提示。Agent 会把笔记变成可以讨论、继续完善的计划。" },
      prompt: {
        en: "Turn my notes on this canvas into one clear plan view: the steps in order, what depends on what, the open decision, and the next action. Keep it short and place it next to my notes.",
        zh: "把画布上的笔记整理成一张清晰的计划图：按顺序列出步骤、依赖关系、待定的决策和下一步行动。保持简短，放在笔记旁边。",
      },
      learned: { en: "Notes become a plan with steps, dependencies and the next action.", zh: "笔记会变成有步骤、依赖和下一步行动的计划。" },
      preview: "Launch v1.5",
      strokes: () => [
        ...text("Launch v1.5", 0, 0, 36, 1401),
        ...text("- write release notes", 0, 70, 28, 1402),
        ...text("- QA pass → fix bugs", 0, 124, 28, 1403),
        ...text("- ship Friday?", 0, 178, 28, 1404),
      ],
    },
    {
      id: "chart",
      feature: "data",
      category: "work",
      route: "agent",
      action: "agent",
      seconds: 45,
      title: { en: "Numbers to a chart", zh: "数字变图表" },
      description: { en: "Jot down a few numbers and get a chart with the trend.", zh: "随手写几个数字，就能得到带趋势说明的图表。" },
      coach: { en: "Send this prompt. The Agent turns the numbers in your notes into a chart.", zh: "发送这条提示。Agent 会把笔记里的数字变成图表。" },
      prompt: {
        en: "Make a simple bar chart from the numbers in my notes on this canvas (Q1 120, Q2 150, Q3 90, Q4 170), mark the highest and lowest quarter, and add one sentence about the trend. Place it next to my notes.",
        zh: "用画布笔记里的数字（Q1 120、Q2 150、Q3 90、Q4 170）做一张简单的柱状图，标出最高和最低的季度，并用一句话说明趋势。放在笔记旁边。",
      },
      learned: { en: "Numbers you jot down become a chart and a sentence about the trend.", zh: "随手记下的数字会变成图表和一句趋势说明。" },
      preview: "Q1 120 Q2 150",
      strokes: () => [
        ...text("Sales 2026", 0, 0, 36, 1501),
        ...text("Q1 120    Q2 150", 0, 70, 30, 1502),
        ...text("Q3 90     Q4 170", 0, 126, 30, 1503),
      ],
    },
    {
      id: "illustration",
      feature: "visual",
      route: "ai",
      action: "vivid",
      seconds: 20,
      category: "play",
      title: { en: "Doodle to illustration", zh: "涂鸦变插画" },
      description: { en: "A rough doodle becomes a storybook or 3D illustration.", zh: "随手涂鸦变成绘本或立体插画。" },
      coach: { en: "Same subject, finished look. Your sketch stays where it is.", zh: "同一主题，完整画面。你的草图会保留。" },
      tip: { en: "Typed words work too: write a line and tap Create visual.", zh: "文字也可以：写一行字，再点击“生成可视内容”。" },
      learned: { en: "A rough drawing is a good prompt. No drawing skill needed.", zh: "粗糙的草图就是好提示，不需要绘画功底。" },
      preview: "rocket",
      strokes: () => [...paths(ROCKET, 0, 0, 2, 401), ink.ellipseStroke(75 * 2, 72 * 2, 26, 26, { seed: 409 })],
    },
    {
      id: "animate-sketch",
      feature: "animation",
      route: "ai",
      action: "animate_sketch",
      seconds: 20,
      category: "play",
      title: { en: "Bring a sketch to life", zh: "让草图动起来" },
      description: { en: "Your own strokes move: wings flap, legs hop.", zh: "你画的笔画会动起来：翅膀扇动，双脚跳跃。" },
      coach: { en: "Speed lines tell PenEcho to make it move. Tap Animate sketch.", zh: "速度线告诉 PenEcho 让它动起来。点击“让画动起来”。" },
      tip: { en: "Write a formula and tap Explain with animation for a step-by-step animated explanation.", zh: "写下公式并点击“动画讲解”，即可获得分步动画讲解。" },
      learned: { en: "Small pen marks steer what PenEcho does.", zh: "小小的笔画标记就能引导 PenEcho。" },
      preview: "bird ≡",
      strokes: () => [
        ...paths(BIRD, 0, 0, 1.8, 501),
        ink.ellipseStroke(186 * 1.8, 74 * 1.8, 16 * 1.8, 16 * 1.8, { seed: 509 }),
        ink.ellipseStroke(190 * 1.8, 70 * 1.8, 3, 3, { seed: 511, spacing: 1.5 }),
        ...paths(BIRD_MOTION, -10, 0, 1.8, 520),
      ],
    },
    {
      id: "finish-drawing",
      feature: "drawing",
      route: "ai",
      action: "finish_drawing",
      seconds: 20,
      category: "play",
      title: { en: "Draw cleaner, finish faster", zh: "画得更整齐，完成得更快" },
      description: { en: "Hold to snap shapes. Let PenEcho finish a sketch in your style.", zh: "停笔即可规整形状，让 PenEcho 用你的笔触补完草图。" },
      coach: { en: "Tap Finish drawing. The rest is added as real strokes you can erase.", zh: "点击“补全画作”。补上的部分是可擦除的真实笔画。" },
      tip: { en: "Tip: finish a rough circle and hold the pen still for half a second to snap it.", zh: "提示：画完粗略的圆后停笔半秒，即可自动规整。" },
      learned: { en: "PenEcho adds to your ink instead of replacing it.", zh: "PenEcho 是在你的笔迹上补充，而不是替换。" },
      preview: "half a cat",
      strokes: () => [...paths(CAT_HALF, 0, 0, 2.4, 301), ink.ellipseStroke(64 * 2.4, 70 * 2.4, 6, 6, { seed: 309 })],
    },
    {
      id: "tic-tac-toe",
      feature: "game",
      category: "play",
      route: "agent",
      action: "agent",
      seconds: 60,
      title: { en: "Sketch a game, then play it", zh: "画个游戏，马上就玩" },
      description: { en: "A tic-tac-toe sketch becomes a game you can play.", zh: "一张井字棋草图变成可以玩的游戏。" },
      coach: { en: "Send this prompt. The Agent turns your sketch into a game you can play right here.", zh: "发送这条提示。Agent 会把草图变成可以直接在这里玩的游戏。" },
      prompt: {
        en: "Turn my tic-tac-toe sketch on this canvas into a small playable game: two players take turns, the winning line is highlighted, and a Restart button starts a new round. Place it next to my sketch.",
        zh: "把画布上的井字棋草图做成一个可以玩的小游戏：两名玩家轮流落子，高亮获胜的连线，并有“重新开始”按钮开始新一局。放在草图旁边。",
      },
      learned: { en: "A sketch and one sentence are enough to make something playable.", zh: "一张草图加一句话，就能做出可以玩的东西。" },
      preview: "# X O",
      strokes: () => [
        ...text("tic-tac-toe", 0, 0, 34, 1601),
        ...paths(TIC_TAC_TOE, 10, 70, 1.3, 1610),
        ink.ellipseStroke(10 + 150 * 1.3, 70 + 30 * 1.3, 20, 20, { seed: 1620 }),
        ink.ellipseStroke(10 + 30 * 1.3, 70 + 150 * 1.3, 20, 20, { seed: 1621 }),
      ],
    },
  ]);

  const BY_ID = new Map(SCENARIOS.map((scenario, index) => [scenario.id, { scenario, index }]));

  function get(id) {
    return BY_ID.get(id)?.scenario || null;
  }

  function next(id) {
    const entry = BY_ID.get(id);
    return entry ? SCENARIOS[entry.index + 1] || null : SCENARIOS[0];
  }

  function localized(value, language) {
    if (!value || typeof value !== "object") return String(value || "");
    return language === "zh" ? value.zh || value.en : value.en;
  }

  // Ink for a scenario, normalized so its bounding box starts at (0, 0).
  function strokes(id) {
    const scenario = get(id);
    if (!scenario) return [];
    const list = scenario.strokes().filter((stroke) => stroke.length > 1);
    const box = ink.bounds(list);
    return list.map((stroke) => stroke.map((point) => ({ x: Math.round((point.x - box.x) * 10) / 10, y: Math.round((point.y - box.y) * 10) / 10 })));
  }

  // The architecture Widget document, identical to src/architecture/schema.js
  // architectureHtml for this already-valid object; the Widget host lays it out.
  function architectureDocument(architecture, language) {
    const lang = String(language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en",
      loading = lang === "zh-CN" ? "正在布局架构图…" : "Laying out architecture diagram…",
      json = JSON.stringify(architecture).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><section data-penecho-architecture><script type="application/json" data-architecture-source>${json}</script><p role="status">${loading}</p></section></body></html>`;
  }

  function normalizeGoal(goal) {
    const value = LEGACY_GOALS[goal] || goal;
    return GOALS.includes(value) ? value : null;
  }

  // A chosen category lists only its own examples, in teaching order. With no
  // category, every example in category order.
  function ordered(goal) {
    const category = normalizeGoal(goal);
    return category ? SCENARIOS.filter((scenario) => scenario.category === category) : SCENARIOS.slice();
  }

  // The empty canvas. With a category: its own examples only, the first untried
  // one, then any featured example (always, tried or not), then the rest with
  // tried ones last. With no category: one lead example from each category.
  function welcome(goal, tried = [], count = 4) {
    const done = new Set(tried), category = normalizeGoal(goal);
    if (!category) {
      return GOALS.map((id) => {
        const list = ordered(id);
        return list.find((scenario) => scenario.featured) || list.find((scenario) => !done.has(scenario.id)) || list[0];
      }).filter(Boolean).slice(0, count);
    }
    const list = ordered(category),
      queue = [...list.filter((scenario) => !done.has(scenario.id)), ...list.filter((scenario) => done.has(scenario.id))],
      featured = list.filter((scenario) => scenario.featured),
      picks = queue.filter((scenario) => !scenario.featured).slice(0, 1);
    for (const scenario of [...featured, ...queue]) if (picks.length < count && !picks.includes(scenario)) picks.push(scenario);
    return picks;
  }

  function parseProgress(raw) {
    let value = raw;
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw);
      } catch {
        value = null;
      }
    }
    const tried = Array.isArray(value?.tried) ? [...new Set(value.tried.filter((id) => BY_ID.has(id)))] : [];
    return {
      schema: SCHEMA,
      goal: normalizeGoal(value?.goal),
      goalAsked: value?.goalAsked === true,
      tried,
    };
  }

  function serializeProgress(progress) {
    return JSON.stringify(parseProgress(progress));
  }

  function markTried(progress, id) {
    const current = parseProgress(progress);
    if (!BY_ID.has(id) || current.tried.includes(id)) return current;
    return { ...current, tried: [...current.tried, id] };
  }

  function setGoal(progress, goal) {
    return { ...parseProgress(progress), goal: normalizeGoal(goal), goalAsked: true };
  }

  return { SCHEMA, GOALS, SCENARIOS, get, next, localized, strokes, architectureDocument, ordered, welcome, parseProgress, serializeProgress, markTried, setGoal };
});
