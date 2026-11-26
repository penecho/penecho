// PenEcho Lines UI localization (English / Simplified Chinese).
// Reads and writes the shared `penecho-language` preference so Projects/Lines, Settings,
// Canvas, and Electron desktop menus all follow the same language selection immediately.
var linesLang, linesIsZh, linesT, linesTranslateTitle, linesTranslateTree, linesTranslatePage, linesRefreshLanguage, linesSetLang;
(() => {
  const LANG_KEY = 'penecho-language';

  function getLanguage() {
    try { return localStorage.getItem(LANG_KEY) === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
  }
  const isZh = () => getLanguage() === 'zh';

  // Exact English -> Simplified Chinese UI phrase table.
  // "Line" / "Lines" and brand/technical proper nouns (PenEcho, PenEcho Cloud, Work,
  // MeetCue, MCP, Git, Markdown, Token, CLI, API, Agent) stay in English.
  const PHRASES = Object.freeze({
    // ---------- Settings modal & navigation ----------
    'Settings': '设置',
    'Close settings': '关闭设置',
    'Close (Esc)': '关闭 (Esc)',
    'Project agents': '项目 Agent',
    'Canvas': '画布',
    'Integrations': '集成',
    'App': '应用',
    'Local providers': '本地提供方',
    'Local agent providers': '本地 Agent 提供方',
    'Preset agents': '预设 Agent',
    'API providers': 'API 提供方',
    'Canvas AI': '画布 AI',
    'View': '视图',
    'Canvas view': '画布视图',
    'MCP': 'MCP',
    'General': '通用',
    'Archived': '已归档',
    'Project agents · Step 1': '项目 Agent · 第 1 步',
    'Project agents · Step 2': '项目 Agent · 第 2 步',
    'Canvas AI · Step 1': '画布 AI · 第 1 步',
    'Canvas AI · Step 2': '画布 AI · 第 2 步',
    'External integration': '外部集成',
    'Project agents setup': '项目 Agent 配置',
    'Canvas AI setup': '画布 AI 配置',

    // ---------- Settings: General ----------
    'Preferences': '偏好设置',
    'Appearance': '外观',
    'Light': '浅色',
    'Dark': '深色',
    'System': '跟随系统',
    'Language': '语言',
    'Language used in Canvas controls and prompts.': 'PenEcho 界面与画布控件使用的语言。',
    'Language used across PenEcho and Canvas.': 'PenEcho 界面与画布使用的语言。',
    'Page zoom': '页面缩放',
    'Adjust the size of Projects and Canvas.': '调整项目与画布界面的显示比例。',
    'Other devices': '其他设备',
    'Open PenEcho from a tablet or phone on this network.': '在同一网络的平板或手机上打开 PenEcho。',
    'Open': '打开',
    'PenEcho Cloud sync': 'PenEcho Cloud 同步',
    'Run tasks sent from penecho.ai on this computer.': '在这台电脑上运行从 penecho.ai 发来的任务。',
    'Run Asks sent from penecho.ai': '运行来自 penecho.ai 的请求',
    'Auto-fetch tasks from PenEcho Cloud and run them here, only after you click Run with an agent on penecho.ai.': '自动获取来自 PenEcho Cloud 的任务并在此运行，仅在你在 penecho.ai 点击用 Agent 运行后触发。',
    'Auto-fetch tasks from PenEcho Cloud and run them here, only after you click Run with an agent on penecho.ai. Change this on the computer running PenEcho.': '自动获取来自 PenEcho Cloud 的任务并在此运行，仅在你在 penecho.ai 点击用 Agent 运行后触发。请在运行 PenEcho 的电脑上修改此项。',
    'Auto-fetch tasks from PenEcho Cloud and run them here, only after you click Run with an agent on penecho.ai. Sign in to PenEcho Cloud to sync projects and fetch tasks.': '自动获取来自 PenEcho Cloud 的任务并在此运行，仅在你在 penecho.ai 点击用 Agent 运行后触发。登录 PenEcho Cloud 以同步项目并获取任务。',
    'Change this on the computer running PenEcho.': '请在运行 PenEcho 的电脑上修改此项。',
    'Sign in to PenEcho Cloud to sync projects and fetch tasks.': '登录 PenEcho Cloud 以同步项目并获取任务。',
    'About': '关于',
    'Handwriting canvas & Project Lines workspace.': '手写画布与 Project Lines 工作区。',
    'Changelog': '更新日志',
    'Checks for updates every few hours.': '每隔几小时自动检查更新。',
    'Check for updates': '检查更新',
    'Checking for updates…': '正在检查更新…',
    'You have the latest version.': '当前已是最新版本。',
    'Restart to update': '重启以更新',
    'Restarting…': '正在重启…',
    'Downloading update': '正在下载更新',
    'Update failed': '更新失败',
    'Update': '更新',
    'What’s new': '更新说明',
    'Try again': '重试',
    'The update could not be completed.': '无法完成更新。',

    // ---------- Settings: Local providers (setup.js / settings.js) ----------
    'Installed CLIs & built-in runner': '已安装的 CLI 与内置运行器',
    'Installed CLIs on the host computer': '宿主电脑上已安装的 CLI',
    'On your computers': '在你的电脑上',
    'Working agents installed on computers signed in to this account.': '已登录此账号的电脑上安装的可运行 Agent。',
    'No computers connected yet. Open PenEcho on your Mac or PC to see its installed agents here.': '尚未连接电脑。在 Mac 或 PC 上打开 PenEcho 即可在此查看其已安装的 Agent。',
    'Connected computers': '已连接的电脑',
    'Connect PenEcho on a computer': '在电脑上连接 PenEcho',
    'Check again': '重新检测',
    'Checking…': '检测中…',
    'Checking local CLI tools…': '正在检测本地 CLI 工具…',
    'Checking local CLI tools again…': '正在重新检测本地 CLI 工具…',
    'Checking local providers…': '正在检测本地提供方…',
    'Could not check local CLIs': '无法检测本地 CLI',
    'Install or sign in to a CLI tool': '安装或登录一个 CLI 工具',
    'No CLI tool can run yet. Install one below, then click Check again.': '尚无可用的 CLI 工具。请先在下方安装，然后点击「重新检测」。',
    'Not installed or signed out': '未安装或未登录',
    'Signed out': '未登录',
    'Not installed': '未安装',
    'Signed in': '已登录',
    'Ready': '就绪',
    'Needs a fix': '需要修复',
    'Create preset': '创建预设',
    'Manage presets': '管理预设',
    'No preset yet': '暂无预设',
    'Try a run': '试运行',
    'Trying a run': '正在试运行',
    'Answered': '已响应',
    'No answer': '无响应',
    'Install': '安装',
    'Installing': '正在安装',
    'Updating': '正在更新',
    'Install failed': '安装失败',
    'Copy install prompt': '复制安装提示词',
    'Copy update prompt': '复制更新提示词',
    'Copy fix prompt': '复制修复提示词',
    'The update did not work': '更新未成功',
    'Copy the prompt into any agent, and it does the update.': '将提示词复制到任意 Agent 中即可完成更新。',
    'Update it when it is done, or copy the prompt into another agent.': '待其空闲后再更新，或将提示词复制到其他 Agent 中执行。',
    'Try Update again, or copy the update prompt into another agent.': '请重试更新，或将更新提示词复制到其他 Agent。',
    'Try Install again, or copy the install prompt into another agent.': '请重试安装，或将安装提示词复制到其他 Agent。',
    'Use PenEcho Cloud here. Configure personal API keys in your own agent.': '此处使用 PenEcho Cloud。如需个人 API 密钥，请在各自的 Agent 中配置。',
    'PenEcho finds and syncs your WorkBuddy work. It does not assign tasks to WorkBuddy.': 'PenEcho 会发现并同步你的 WorkBuddy 工作记录，但不会向 WorkBuddy 派发任务。',
    'CLI status summary': 'CLI 状态摘要',
    'Online now': '当前在线',
    'Offline': '离线',
    'Runs Asks sent from penecho.ai': '运行来自 penecho.ai 的请求',
    'Cloud Asks off': '云端请求已关闭',
    'No external CLI agents reported': '未检测到外部 CLI Agent',
    'Connected': '已连接',
    'Update prompt copied. Paste it into any agent.': '已复制更新提示词，可粘贴到任意 Agent。',
    'Install prompt copied. Paste it into any agent.': '已复制安装提示词，可粘贴到任意 Agent。',
    'Fix prompt copied. Paste it into any agent.': '已复制修复提示词，可粘贴到任意 Agent。',
    'Copied. Run it in Terminal.': '已复制，请在终端中运行。',

    // ---------- Settings: Preset agents & Model prices ----------
    'Your preset agents': '你的预设 Agent',
    'Your agents': '你的 Agent',
    'Presets': '预设',
    'Model prices': '模型价格',
    'New preset': '新建预设',
    'Add preset': '添加预设',
    'Add & make default': '添加并设为默认',
    'Built in': '内置',
    'Default': '默认',
    'Clear': '清除',
    'Make default': '设为默认',
    'Edit': '编辑',
    'Remove': '移除',
    'Not rated': '未评分',
    'Rated from next Work': '下次 Work 起计分',
    'Not on this computer': '不在此电脑上',
    'Hidden from agent pickers': '已从 Agent 选择器隐藏',
    'Orchestrator assignments off': '已关闭调度器派单',
    'No price': '无价格',
    'Default model': '默认模型',
    'default model': '默认模型',
    'default effort': '默认推理强度',
    'Provider needs sign-in → Fix': '提供方需登录 → 去修复',
    'Provider needs fix → Fix': '提供方需修复 → 去修复',
    'Pin all': '全部固定',
    'Pin model & effort for Auto and Orchestrator': '固定模型和推理强度以供 Auto 与调度器使用',
    'No preset agents yet': '还没有预设 Agent',
    'Pick a local provider, a model and an effort, so Auto and the Orchestrator can use it.': '选择本地提供方、模型和推理强度，以便 Auto 和调度器调用。',
    'Install or sign in to a CLI tool in Local providers first.': '请先在「本地提供方」中安装或登录 CLI 工具。',
    'Go to Local providers →': '前往本地提供方 →',
    'Ready to add from Local providers': '可从本地提供方添加',
    'These CLIs are installed and ready but have no preset yet. Add one so Auto and the Orchestrator can use it.': '这些 CLI 已安装就绪，但尚无预设。添加后 Auto 与调度器即可使用。',
    'No default: each project picks its own working agent, or an agent that already builds.': '未设默认：每个项目会自行选择正在使用的 Agent 或已配置的 Agent。',
    'Restart PenEcho to save agents here.': '请重启 PenEcho 后在此保存 Agent 预设。',
    'Sign in or open PenEcho on a computer to manage custom agent presets.': '登录或在电脑上打开 PenEcho 以管理自定义 Agent 预设。',
    'Custom agent presets are saved on the computer that runs PenEcho.': '自定义 Agent 预设保存在运行 PenEcho 的电脑上。',
    'Available via your computer': '通过你的电脑可用',
    'Runs on PenEcho Cloud credits': '使用 PenEcho Cloud 积分运行',
    'Working agents that pick up an Ask on a Line, work through the files, and report back. Set up custom presets in the PenEcho app on your computer.': '负责在 Line 上接手请求、处理文件并回报结果的 Agent。可在电脑版 PenEcho 中配置自定义预设。',
    'Choose a model and effort for your agents, so their jobs are rated and the Orchestrator can assign them work.': '为你的 Agent 选择模型与推理强度，以便记录任务评分并让调度器自动派发工作。',
    'Set model & effort': '设置模型与强度',
    'Local provider': '本地提供方',
    'Model': '模型',
    'Custom model name': '自定义模型名称',
    'Choose a Cloud model': '选择云端模型',
    'No Cloud models available': '暂无可用云端模型',
    'Type another model…': '输入其他模型…',
    'Effort': '推理强度',
    'Custom effort': '自定义推理强度',
    'Type another effort…': '输入其他强度…',
    'Default effort is not counted in ratings.': '默认推理强度不计入评分。',
    'Access': '权限',
    'Reviewed': '已审阅',
    'Project folders': '仅项目文件夹',
    'Full access': '完全权限',
    'The agent\'s own safety check approves each command and turns down risky ones, or asks you in PenEcho when approval is needed.': '由 Agent 自身的安全检查审批命令并拦截高风险操作，或在需要时在 PenEcho 中询问你。',
    'Changes files only in this project\'s folders. Nobody is asked.': '仅修改当前项目文件夹中的文件，无需逐次询问。',
    'Runs every command without asking, anywhere on this computer.': '不经询问即可在这台电脑的任意位置运行命令。',
    'Runs every command without asking, within this agent\'s own settings.': '在 Agent 自身配置范围内，不经询问执行命令。',
    'Name': '名称',
    'Where this preset is used': '此预设的用途',
    'Show in agent pickers': '在 Agent 选择器中显示',
    'Choose this preset yourself when you run a Line or start an orchestrator, or let PenEcho Auto choose it.': '在运行 Line 或启动调度器时手动选择此预设，或让 PenEcho Auto 自动选用。',
    'Allow orchestrator assignments': '允许调度器派发任务',
    'Let the orchestrator choose this preset when it delegates work.': '允许调度器在拆分任务时自动选用此预设。',
    'Default for every project': '设为所有项目的默认',
    'Test run': '测试运行',
    'Testing': '测试中',
    'Test again': '重新测试',
    'Choose an effort, so its jobs are rated.': '请选择一个推理强度，以便为其任务评分。',
    'Paste this into any agent': '将此内容粘贴到任意 Agent',
    'If it answers in a chat, paste the answer here': '如果它在对话中回复，请将回复粘贴到此处',
    'Save prices': '保存价格',
    'Restart PenEcho to set model prices here.': '请重启 PenEcho 后在此设置模型价格。',
    'Input': '输入',
    'Output': '输出',
    'Cached': '缓存',
    'From': '来源',
    'No model prices yet.': '暂无模型价格。',
    'Prompt': '提示词',

    // ---------- Settings: API providers & Canvas AI ----------
    'PenEcho Cloud': 'PenEcho Cloud',
    'Zero-key managed models for Canvas AI, paid with PenEcho Cloud credits.': '免密钥托管的画布 AI 模型，使用 PenEcho Cloud 积分计费。',
    'Models paid with credits. No key needed.': '按积分计费的模型，无需配置密钥。',
    'Pick Cloud model →': '选择云端模型 →',
    'Cloud models ready in Canvas AI': '云端模型已在画布 AI 中就绪',
    'Loading Cloud models…': '正在加载云端模型…',
    'No Cloud models are available.': '暂无可用的云端模型。',
    'Couldn’t load Cloud models.': '无法加载云端模型。',
    'Your API keys & local model servers': '你的 API 密钥与本地模型服务',
    'Add API provider': '添加 API 提供方',
    'No API provider yet. Add one above, or use PenEcho Cloud credits.': '尚未添加 API 提供方。请在上方添加，或使用 PenEcho Cloud 积分。',
    'Custom API keys are saved privately on the computer that runs PenEcho.': '自定义 API 密钥仅私密保存在运行 PenEcho 的电脑上。',
    'No provider connected yet': '尚未连接提供方',
    'Pick a model after connecting a provider': '连接提供方后再选择模型',
    'Choose a model': '选择模型',
    'Manage API providers': '管理 API 提供方',
    'Open Canvas AI →': '前往画布 AI →',
    'Use in Canvas AI': '用于画布 AI',
    'Active in Canvas AI': '当前画布 AI 正在使用',
    'No longer used. Configure this CLI in its own agent settings.': '已不再使用。请在其自身的 Agent 设置中配置此 CLI。',
    'Partners': '合作伙伴',
    'Vendors': '模型厂商',
    'Relays': '中转服务',
    'On this computer': '本机服务',
    'Custom': '自定义',
    'Add a provider': '添加提供方',
    'Find a provider': '搜索提供方',
    'Add it as Custom': '作为自定义提供方添加',
    'OpenAI format': 'OpenAI 格式',
    'Anthropic format': 'Anthropic 格式',
    'Address': '接口地址',
    'List models': '获取模型列表',
    'API key': 'API 密钥',
    'Get a key ↗': '获取密钥 ↗',
    'Saved. Type a new one to replace it.': '已保存。输入新密钥以替换。',
    'Paste your key': '粘贴你的密钥',
    'Use for Canvas AI right away': '立即用于画布 AI',
    'Test': '测试',
    'Add provider': '添加提供方',
    'Key saved': '已保存密钥',
    'key saved': '已保存密钥',
    'no key': '无密钥',
    'It answered.': '连接测试成功。',
    'Global': '国际版',
    'China': '中国区',
    'Singapore': '新加坡',
    'US': '美国',
    'Canvas AI model': '画布 AI 模型',
    'Model for Canvas AI': '画布 AI 模型',
    'Thinking effort for Canvas AI': '画布 AI 思考强度',
    'Default effort': '默认强度',
    'No thinking': '不思考',
    'Low effort': '低强度',
    'Medium effort': '中强度',
    'High effort': '高强度',
    'Max effort': '最高强度',
    'AI on the Canvas': '画布上的 AI',
    'Auto AI': '自动 AI',
    'Respond to your handwriting after you pause.': '在你停笔后自动响应你的手写内容。',
    'Auto AI delay': '自动 AI 延迟',
    'Smart suggestions': '智能建议',
    'Suggest actions beside new ink and in widget toolbars.': '在新笔迹旁与组件工具栏中提供建议操作。',
    'Pen gestures': '手写笔手势',
    'Circle + ? explains, double underline typesets, L plots, strikethrough deletes.': '画圈加问号解释、双下划线排版、画 L 绘函数图、划掉删除。',
    'Step checker': '步骤检查',
    'Marks a derivation line that looks wrong. Checks only when you tap.': '标记疑似出错的推导步骤，仅在你点击时检查。',
    'How AI draws': 'AI 绘图方式',
    'AI handwriting': 'AI 手写字体',
    'The lettering AI uses when it writes onto the Canvas.': 'AI 在画布上书写时使用的字体风格。',
    'Rounded': '圆体',
    'Handwritten': '手写体',
    'Classic serif': '经典衬线',
    'Sans serif': '无衬线',
    'Illustration style': '插画风格',
    'Storybook uses soft pastel picture-book art; 3D uses glossy soft volumes.': '绘本风为柔和粉彩插画；3D 为柔光立体质感。',
    'Storybook': '绘本风',
    '3D': '3D 立体',
    'Illustration background': '插画背景',
    'Auto adds a fitting scene when you drew none; None illustrates only your ink.': '自动模式会在未画背景时补充合适场景；无背景则只绘制你的笔迹。',
    'Auto': '自动',
    'None': '无',
    'Thinking indicator': '思考指示灯',
    'Show a quiet pulse while AI is working.': 'AI 运行时显示柔和的脉冲提示。',
    'After 500 free suggestions a day': '每日 500 次免费建议之后',
    'Use credits after 500 free daily suggestions (0.1 each)': '每日 500 次免费建议用完后使用积分（每次 0.1 积分）',
    'Daily limit': '每日上限',
    'Included in your subscription': '已包含在你的订阅中',
    'Unlimited smart suggestions are included with your plan.': '你的套餐已包含无限次智能建议。',
    '500 free smart suggestions daily when signed in': '登录后每日享 500 次免费智能建议',
    'Signed-in accounts can opt in to 0.1 credits per suggestion after the daily free allowance.': '登录账号可在每日免费额度用完后按每次 0.1 积分继续使用。',
    'Canvas setting updated.': '画布设置已更新。',
    'Saved suggestion spending.': '已保存建议额度设置。',

    // ---------- Settings: View (Canvas) ----------
    'Canvas grid': '画布网格',
    'Choose the paper background for every Canvas.': '选择所有画布的纸张背景样式。',
    'Dots': '点阵',
    'Scroll to zoom': '滚轮缩放',
    'Off: scroll pans and pinch or ⌘ + scroll zooms.': '关闭时滚轮平移画布，双指捏合或 ⌘ + 滚轮缩放。',
    'Tool & shortcut hints': '工具与快捷键提示',
    'Show tool tips and keyboard shortcuts at the bottom of the Canvas.': '在画布底部显示工具说明与键盘快捷键。',
    'Widget & image shadows': '组件与图片阴影',
    'Lift widgets and cards off the Canvas with a soft shadow.': '为组件与卡片添加柔和阴影以增强层次感。',

    // ---------- Settings: MCP ----------
    'Local MCP bridge': '本地 MCP 桥接服务',
    'Refresh': '刷新',
    'Retry': '重试',
    'MCP ready': 'MCP 已就绪',
    'Checking MCP bridge…': '正在检测 MCP 桥接服务…',
    'Listening': '监听中',
    'Local MCP service starts automatically when PenEcho runs.': 'PenEcho 启动时会自动开启本地 MCP 服务。',
    'Copy URL': '复制地址',
    'Copy JSON': '复制 JSON',
    'One-click external app setup': '一键配置外部应用',
    'Claude Desktop & Claude Code': 'Claude Desktop 与 Claude Code',
    'Adds PenEcho MCP to Claude on this computer.': '将 PenEcho MCP 添加到此电脑上的 Claude。',
    'Adds PenEcho MCP to Codex on this computer.': '将 PenEcho MCP 添加到此电脑上的 Codex。',
    'Configured': '已配置',
    'Reconfigure': '重新配置',
    'Configure Claude': '配置 Claude',
    'Configure Codex': '配置 Codex',
    'Session behavior': '会话行为',
    'Keep awake while MCP is connected': 'MCP 连接期间保持唤醒',
    'Stay awake while an external MCP client has a Canvas session open.': '外部 MCP 客户端打开画布会话时阻止电脑休眠。',
    'Prevent display sleep during live MCP drawing sessions.': '在实时 MCP 绘图会话期间防止屏幕休眠。',
    'Connect via MCP': '通过 MCP 连接',
    'Let Claude, ChatGPT, or another MCP client draw directly on your Canvases.': '让 Claude、ChatGPT 或其他 MCP 客户端直接在你的画布上作画。',
    'Open a Canvas and turn on “MCP can draw here” in its ⋯ menu, or configure local desktop clients from PenEcho on your computer.': '打开画布并在 ⋯ 菜单中开启「允许 MCP 在此绘制」，或在电脑版 PenEcho 中一键配置桌面客户端。',
    'Copied MCP URL.': '已复制 MCP 地址。',
    'Copied MCP configuration JSON.': '已复制 MCP 配置 JSON。',

    // ---------- Settings: Archived ----------
    'Nothing archived.': '暂无已归档项目。',
    'Delete project?': '删除项目？',
    'Delete project': '删除项目',
    'Its example folders, which PenEcho made, are deleted too.': '由 PenEcho 创建的示例文件夹也将一并删除。',

    // ---------- Sidebar rail & Project bar & Switcher ----------
    'My Canvases': '我的画布',
    'Pinned': '已置顶',
    'Projects': '项目',
    'New project': '新建项目',
    'New line': '新建 Line',
    'Start a new line': '新建 Line',
    'Show fewer': '收起',
    'Fold': '折叠',
    'Unfold': '展开',
    'Pin': '置顶',
    'Unpin': '取消置顶',
    'Rename': '重命名',
    'Sign in': '登录',
    'Sign in to Cloud': '登录 PenEcho Cloud',
    'Sign in to PenEcho Cloud': '登录 PenEcho Cloud',
    'Sign out': '退出登录',
    'Plan & credits': '套餐与积分',
    'Switch project': '切换项目',
    'Drop to attach': '松手以添加附件',
    'Add images or files': '添加图片或文件',
    'Home': '首页',
    'Orchestrator': '调度器',
    'Topics': '主题',
    'Canvases & files': '画布与文件',
    'Statistics': '统计',
    'More': '更多',
    'Ask AI': '问 AI',
    'Ask AI about this project': '向 AI 询问本项目',
    'Search': '搜索',
    'Search project': '搜索项目',
    'Share': '分享',
    'Share project': '分享项目',
    'Memory': '记忆',
    'Vault': '文件库',
    'Archive': '归档',
    'Deleted': '已删除',
    'Project settings': '项目设置',
    'Back': '后退',
    'Forward': '前进',
    'Hide projects': '隐藏侧栏',
    'Show projects': '显示侧栏',
    'Hide sidebar': '隐藏侧栏',
    'Show sidebar': '显示侧栏',
    'Shared with you': '与你共享',
    'Synced with your computer': '已与你的电脑同步',
    'Keep in PenEcho Cloud': '同步到 PenEcho Cloud',
    'Uploading to PenEcho Cloud': '正在上传到 PenEcho Cloud',

    // ---------- Project Home / Empty / Lines list / Statuses ----------
    'All lines': '全部 Line',
    'Recent lines': '最近的 Line',
    'Kind of job': '任务类型',
    'Start with a drawing': '从画图开始',
    'Sync conversations': '同步对话',
    'Start a new line. Type / for quick starts.': '开始一条新 Line。输入 / 快速开始。',
    'Filter': '筛选',
    'Filter lines': '筛选 Line',
    'Show all lines': '显示全部 Line',
    'Working': '进行中',
    'Needs you': '需要你',
    'To review': '待审阅',
    'Todo': '待办',
    'Stopped': '已停止',
    'Finished': '已完成',
    'Not started': '未开始',
    'Not sent': '未发送',
    'Not finished': '未完成',
    'Notes': '笔记',
    'Results and notes': '结果与笔记',
    'New note': '新建笔记',
    'New Canvas': '新建画布',
    'New canvas': '新建画布',
    'Nothing here yet.': '这里还没有内容。',
    'Lines you open show here.': '你打开过的 Line 会显示在这里。',
    'No Works in the last 30 days.': '过去 30 天内暂无 Work。',
    'Works by day': '每日 Work',
    'Token savings': 'Token 节省',
    'Details': '详情',
    'Token savings evidence': 'Token 节省详情',
    'Open the Canvas': '打开画布',
    'Draw a diagram or note — it becomes your first line.': '绘制图表或笔记——它将成为你的第一条 Line。',
    'Sync recent conversations': '同步最近对话',
    'Sync more': '同步更多',
    'Syncing…': '同步中…',
    'Sync from a code folder': '从代码文件夹同步',
    'Import recent conversations from agents in that folder.': '导入该文件夹中各 Agent 最近的对话记录。',
    'Your latest 50 conversations in this project\'s folders.': '导入本项目文件夹中最近的 50 条对话。',
    'Up to 50 more unsynced conversations in this project\'s folders, newest first.': '按最新优先再同步最多 50 条未同步的对话。',
    'Example projects': '示例项目',
    'Working in your own agent? Copy starter prompt': '在自己的 Agent 中工作？复制引导提示词',
    'Let agents keep project memory': '让 Agent 维护项目记忆',
    'Let your agents keep this project\'s memory': '让你的 Agent 维护本项目记忆',
    'Adds a skill so Claude & Codex read MEMORY.md first and update it safely.': '添加技能，让 Claude 和 Codex 优先读取 MEMORY.md 并安全更新。',
    'Let agents draw on Canvas': '让 Agent 在画布上作画',
    'Let your agents draw on this project\'s Canvas': '让你的 Agent 在本项目画布上作画',
    'Adds a skill so Claude & Codex draw editable diagrams here instead of text art.': '添加技能，让 Claude 和 Codex 在此绘制可编辑图表而非字符画。',
    'Add skill': '添加技能',
    'Later': '以后再说',
    'No agent found': '未找到 Agent',
    'Finding agents…': '正在查找 Agent…',
    'Set up agents': '配置 Agent',
    'Agent setup options': 'Agent 配置选项',
    'Set up agents or check again': '配置 Agent 或重新检测',
    'Manage presets, default model and effort': '管理预设、默认模型与推理强度',
    'This project is archived.': '此项目已归档。',
    'Restore': '恢复',
    'Not another AI agent. A better way to work with yours.': '不是又一个 AI Agent，而是与你的 Agent 协作的更好方式。',
    'Create a project': '创建一个项目',
    'View architecture full size': '查看完整架构图',
    'Note': '笔记',
    'Ask': '请求',
    'Work': 'Work',
    'your words': '你自己的话',
    'for an agent': '交给 Agent',
    'a drawing': '一张画图',
    'agent reply': 'Agent 回复',
    '+ Link code folder': '+ 关联代码文件夹',
    'Docs folder': '文档文件夹',
    'Code folder': '代码文件夹',
    'Change': '更改',
    'Add': '添加',
    'Copy pointer for AGENTS.md': '复制 AGENTS.md 指引',
    'Tell agents in the code folder where these docs are': '告知代码文件夹中的 Agent 项目文档所在位置',
    'Project knowledge': '项目知识',
    'Project memory': '项目记忆',
    'Project Topics': '项目主题',
    'Recent conversations': '最近对话',
    'Archive this project': '归档此项目',
    'Drawing skill': '绘图技能',
    'Memory skill': '记忆技能',
    'Rename project': '重命名项目',
    'Save name': '保存名称',
    'Save': '保存',
    'Cancel': '取消',
    'Close': '关闭',
    'Choose…': '选择…',
    'Copy': '复制',
    'Copy this': '复制以下内容',
    'How this folder works': '项目文件夹说明',
    'Download': '下载',
    'Copy image': '复制图片',
    'Fit': '适应窗口',
    'Scroll to zoom · Drag to pan': '滚轮缩放 · 拖拽平移',
    'Couldn’t load this image.': '无法加载此图片。',
    'This file is no longer in the project.': '此文件已不在项目中。',
    'Download this file to open it.': '下载此文件以打开。',
    'Opening…': '正在打开…',
    'Opening Canvas…': '正在打开画布…',
    'Still saving this Canvas…': '仍在保存此画布…',
    'Restart PenEcho to finish this update, then reload this page.': '请重启 PenEcho 完成更新，然后刷新此页面。',
    'Connected again.': '已重新连接。',
    'PenEcho is not answering. Your files are safe. Trying again.': 'PenEcho 暂无响应，你的文件很安全，正在重试。',
    'Could not refresh from PenEcho Cloud. Trying again.': '无法从 PenEcho Cloud 刷新，正在重试。',
    'This folder is empty.': '此文件夹为空。',
    'Link one to sync the latest conversations from every agent in that folder.': '关联代码文件夹即可同步其中各 Agent 的最新对话。',
    'It leaves the sidebar and the Canvas. Its folders and lines stay as they are, and Restore brings it back.': '将从侧栏和画布中隐藏，文件夹与 Line 原样保留，随时可恢复。',
    'It is out of the sidebar list and the Canvas. Settings › Archived lists it.': '已从侧栏和画布隐藏，可在「设置 › 已归档」中查看。',
    'It leaves the sidebar. Its lines and files stay in PenEcho Cloud, and Restore brings it back.': '将从侧栏隐藏，Line 与文件仍保留在 PenEcho Cloud，随时可恢复。',
    'It is out of the sidebar. Archived at the end of the sidebar lists it.': '已从侧栏隐藏，可在侧栏底部的已归档中查看。',
    'Unread': '未读',
    'Answer': '回复',
    'Open line': '打开 Line',
    'Outdated': '已过时',
    'Review': '审阅',
    'Mark reviewed': '标为已审阅',
    'Mark todo': '标为待办',
    'Archive all': '全部归档',
    'Checked out in your folder': '已在本地文件夹检出',
    'Write the first thing of a new line in the box': '在下方输入框写下新 Line 的第一句话',
    'Track changes': '跟踪更改',
    'Keep a history, so work can go on branches': '保留变更历史，便于在分支上开展工作',
    'Not now': '暂不',
    'Remove from plan': '从计划中移除',
    'Sub-Line': '子 Line',
    'Will stay open after leaving this sub-Line': '离开此子 Line 后将保持展开',
    'Will fold after leaving this sub-Line': '离开此子 Line 后将自动折叠',
    'Dismiss': '关闭',
    'Undo': '撤销',
    'Saved': '已保存',
    'Saved.': '已保存。',
    'Handed over.': '已转交。',

    // ---------- Composer & Line detail ----------
    'Ask for anything': '输入任何需求',
    'Ask an agent, write a note, or type / for quick starts…': '向 Agent 提问、记录笔记，或输入 / 快速开始…',
    'Write a note, ask an agent, or type / for quick starts…': '记录笔记、向 Agent 提问，或输入 / 快速开始…',
    'Add a note to this line': '为这条 Line 添加笔记',
    'Start a line with a note': '用一条笔记开始新 Line',
    'Send': '发送',
    'Send (Enter)': '发送 (Enter)',
    'Send to AI': '发给 AI',
    'Save as note': '存为笔记',
    'Send to AI, or save as a note': '发给 AI 或存为笔记',
    'Send to an agent, on this line': '在当前 Line 发送给 Agent',
    'Send to an agent, on a new line': '在新 Line 中发送给 Agent',
    'Save as note: your words on the line, read by no agent': '存为笔记：仅记录在这条 Line，不会发送给 Agent',
    'Sending…': '发送中…',
    'Quick starts': '快速开始',
    'What to make': '要生成什么',
    'Add a new drawing canvas': '添加新画布',
    'Add new canvas': '添加新画布',
    'Click to draw on it': '点击在图上标注',
    'Draw on it': '在图上标注',
    'Opens the Canvas': '将打开画布',
    'Adds a note': '添加一条笔记',
    'Adds a Topic to the docs folder': '在文档文件夹中添加主题',
    'Find a branch': '查找分支',
    'No branch by that name': '没有同名分支',
    'New branch from': '新建分支基于',
    'In your folder': '当前文件夹',
    'Off main': '基于 main',
    'No Git: notes, plans, drawings': '无 Git：笔记、计划、画图',
    'No changes on this branch yet.': '此分支尚无更改。',
    'Queued': '排队中',
    'Unreviewed': '未审阅',
    'Reviewing…': '审阅中…',
    'Reviewing': '正在审阅',
    'Ignored': '已忽略',
    'Unverified': '未验证',
    'Parts': '子任务',
    'Parent not in this project': '父 Line 不在当前项目中',
    'Marked by you.': '由你标记。',
    'Already completed elsewhere?': '已在别处完成？',
    'Not sent yet.': '尚未发送。',
    'Delete': '删除',
    'Edit on canvas': '在画布中编辑',
    'Open page': '打开页面',
    'Continue ↵': '继续 ↵',
    'Submit': '提交',
    'Submit answers': '提交回答',
    'Steer ↵': '引导 ↵',
    'Steer': '引导',
    'Stop': '停止',
    'Discard': '丢弃',
    'Send fixes': '发送修复',
    'View review': '查看审阅',
    'Orchestrator review': '调度器审阅',
    'Orchestrator reviewer': '调度器审阅者',
    'Orchestrator settings…': '调度器设置…',
    'Orchestrator Line': '调度器 Line',
    'Ignored in stats': '不计入统计',
    'Findings': '发现项',
    'Report note': '报告备注',
    '(not asked)': '（未要求）',
    'What you asked': '你的要求',
    'Review note': '审阅备注',
    'Summary': '摘要',
    'Original output': '原始输出',
    'No original output was recorded for this review.': '此次审阅未记录原始输出。',
    'Why this agent': '为何选择此 Agent',
    'Review access': '审阅权限',
    'Excluded from agent ranking': '不计入 Agent 排行',
    'Score breakdown': '评分细项',
    'Reviewer notes': '审阅说明',
    'Evidence checked': '已核查证据',
    'Good': '满意',
    'Not good': '不满意',
    'Difficulty': '难度',
    'Difficulty:': '难度：',
    'Was this work helpful?': '这项工作有帮助吗？',
    'Save note': '保存备注',
    'Waiting on you': '等待你的回复',
    'Mark with sub-Lines…': '连同子 Line 一起标记…',
    'Mark reviewed…': '标记已审阅…',
    'Mark this Line reviewed': '将此 Line 标为已审阅',
    'Markdown and LaTeX': 'Markdown 与 LaTeX',
    'The drawing is not in the folder any more.': '该画作已不在文件夹中。',
    'Are you sure?': '确定吗？',
    'Yes, delete': '确认删除',
    'Its Orchestrator review goes with it.': '关联的调度器审阅记录也将一并删除。',
    'Work file': 'Work 文件',
    'Copy path': '复制路径',
    'Copy prompt': '复制提示词',
    'Send again': '重新发送',
    'Continue': '继续',
    'Remove from queue': '移出队列',
    'Carry on with': '换 Agent 继续',
    'Refer': '引用',
    'Start now': '立即开始',
    'Back to lines': '返回 Line 列表',
    'Sub-Lines': '子 Line',
    'Jump to sub-Lines': '跳转到子 Line',
    'Copy Line reference': '复制 Line 引用',
    'Open Line file': '打开 Line 文件',
    'Copy Line file path': '复制 Line 文件路径',
    'Rename line': '重命名 Line',
    'Delete line?': '删除 Line？',
    'Delete line': '删除 Line',
    'Title': '标题',
    'Save title': '保存标题',
    'Archive without merging?': '未合并就归档？',
    'Merge first': '先合并',
    'Archive anyway': '仍然归档',
    'Model not recorded': '未记录模型',
    'effort not recorded': '未记录推理强度',
    'Model and effort not recorded': '未记录模型与推理强度',
    'Copy link': '复制链接',
    'Unarchive': '取消归档',
    'Duplicate': '复制一份',
    'Merge': '合并',
    'Branch': '分支',

    // ---------- Orchestrator ----------
    'Hand over the whole job. The Orchestrator puts the right agents on it and keeps watch.': '把整件事交给调度器，它会安排最合适的 Agent 协作并全程跟进。',
    'How Orchestrator chooses models': '调度器如何选择模型',
    'Agents': 'Agent',
    'Why use it': '为什么使用它',
    'Hide why to use it': '收起说明',
    'Hide': '隐藏',
    'Hide the agents panel': '隐藏 Agent 面板',
    'Show the agents panel': '显示 Agent 面板',
    'Agent record & prices': 'Agent 战绩与价格',
    'Manage agents': '管理 Agent',
    'Manage agents…': '管理 Agent…',
    'Start': '开始',
    'Start (Enter)': '开始 (Enter)',
    'Add for later': '稍后运行',
    'Start or add for later': '开始或加入稍后运行',
    'What should get done or discussed?': '要完成什么任务或讨论什么？',
    'Job or question for the orchestrator': '交给调度器的任务或问题',
    'Model and effort chosen automatically': '自动选择模型与推理强度',
    'Runner default model': '默认模型',
    'Runner default effort': '默认推理强度',
    'To choose an orchestrator, turn on “Show in agent pickers” for a preset that can run here.': '要选择调度器，请在可用预设中开启「在 Agent 选择器中显示」。',
    'The orchestrator runs on your computer. Open PenEcho there to start a job from here.': '调度器在你的电脑上运行。请先在电脑上打开 PenEcho 再从此处启动任务。',
    'Splits big jobs': '拆分大型任务',
    'Breaks a large job into smaller ones when that helps, and runs them side by side.': '在合适时将复杂任务拆分成多个子任务并行推进。',
    'The right agent for each part': '各司其职选 Agent',
    'Strong models on the hard parts, cheaper ones on the simple parts: the best result for what you spend.': '难题用强模型、简单部分用高性价比模型，花更少钱拿更好结果。',
    'Rates every finished job': '自动评估每次完成',
    'Scores each agent’s work as it finishes, and uses those scores to choose agents for each kind of job.': '任务完成时自动评分，并依据历史表现按任务类型挑选 Agent。',
    'Watches and checks': '全程跟进与验收',
    'Follows every job, checks each result against your goal, and reports back once.': '跟踪所有子任务，对照目标逐项核查后汇总汇报。',
    'Nothing hidden': '过程完全透明',
    'Every job is a Line you can open, steer or stop, with what it cost.': '每个任务都是一条可随时打开、引导或停止的 Line，费用一目了然。',
    'Uses the agents you have': '复用你已有的 Agent',
    'Works with the agents you already set up, on your own computer.': '直接使用你本机已配置好的各类 Agent。',
    'A deck from meeting notes': '从会议纪要生成演示文稿',
    'Two opinions, compared': '对比两个 Agent 的方案',
    'Fix a bug, with a test': '定位修复 Bug 并补测试',
    'Orchestrator settings': '调度器设置',
    'Review first jobs': '审阅首个任务',
    'When an Orchestrator Line’s first job finishes, another agent checks it against your Ask and rates it out of 5.': '当调度器 Line 的首个任务完成时，由另一位 Agent 对照请求核查并给出 5 分制评分。',
    'Reviewer': '审阅者',
    'Who checks. Auto picks your best-rated coding agent that did not do the job.': '负责核查的 Agent。「自动」会选择未参与该任务且编码评分最高的 Agent。',
    'Prices and ratings': '价格与评分',
    'Model prices and starting ratings from penecho.ai. Your own ratings stay, and count more with every job.': '来自 penecho.ai 的模型价格与初始评分。你自己的评价会保留，且随任务增多权重更高。',
    'Not synced': '未同步',
    'Sync': '同步',
    'Sync again': '重新同步',
    'Get prices and ratings': '获取价格与评分',
    'Getting prices and ratings…': '正在获取价格与评分…',
    'Prices and ratings are up to date': '价格与评分已是最新',
    'Sub-agents': '子 Agent',
    'Add an agent': '添加 Agent',
    'Change in settings.': '在设置中更改。',
    'Orchestrator ratings': '调度器评分',
    'Work stopped': 'Work 已停止',
    'Marks reviewed for you': '自动帮你标为已审阅',
    'It marks the Works it accepts as reviewed': '会自动将验收通过的 Work 标为已审阅',
    'Search sessions or Lines': '搜索会话或 Line',
    'Search sessions or Lines by title or ID': '按标题或编号搜索会话或 Line',
    'Filter sessions by status': '按状态筛选会话',
    'Loading sessions…': '正在加载会话…',
    'Loading agents…': '正在加载 Agent…',
    'Loading…': '加载中…',
    'Starting…': '正在启动…',
    'Adding…': '正在添加…',
    'Uploading files…': '正在上传文件…',
    'Waiting its turn': '排队等待',
    'Error': '出错',
    'Discarded': '已丢弃',
    'Limit': '已达上限',
    'Token limit': 'Token 上限',
    'Open report': '打开报告',
    'Worked alone': '独立完成',
    'Delegated': '已委派',
    'Delegation planned': '计划委派',
    'Split': '已拆分',
    'Split planned': '计划拆分',
    'No matching sessions': '没有匹配的会话',
    'Clear filters': '清除筛选',
    'No sessions yet': '暂无会话',
    'Give your agent a goal. It can split the work across Lines or run tasks in parallel on one Line. It uses the agent record in Statistics to choose agents, rates each Work from 1 to 5 and reports back here.': '给 Agent 一个目标，它可以将任务拆分到多条 Line 或在同一条 Line 上并行推进。它会参考统计中的 Agent 战绩来分配任务，为每个 Work 打分（1–5 分）并在此汇总汇报。',
    'Sessions': '会话',
    'No Works yet.': '暂无 Work。',
    'No Works yet': '暂无 Work',
    'No Works yet. Each agent appears here once it has one.': '暂无 Work。Agent 完成一次工作后会显示在这里。',
    'Recent ratings': '最近评分',
    'Agent record': 'Agent 战绩',
    'Per agent, model and effort · combined rating, tokens and cost': '按 Agent、模型与强度统计 · 综合评分、Token 与费用',
    'Who did the work': '执行者',
    'Look up with AI': '用 AI 查询',
    'Looking up…': '查询中…',
    'Ask your agent to look up current model prices': '让 Agent 查询当前模型价格',
    'Average cost per Work': '单次 Work 平均费用',
    "The orchestrator's score and yours, combined. Yours counts twice.": '综合调度器评分与你的评价（你的评价占双倍权重）。',
    'Restart PenEcho to enable lookup.': '请重启 PenEcho 以启用查询。',
    'What it can do': '它能做什么',
    'How agents are ranked (last 60 days)': 'Agent 排名方式（近 60 天）',
    'Task added for later': '已加入稍后运行',
    'Sent to your computer': '已发送到你的电脑',
    'Job discarded': '已丢弃任务',
    'All': '全部',
    'Code': '代码',
    'Chat': '对话',
    'Design': '设计',
    'Research': '研究',
    'Docs': '文档',

    // ---------- Statistics & Prices & Home Filters ----------
    'Project statistics': '项目统计',
    'Period': '时间范围',
    'Today': '今天',
    'Yesterday': '昨天',
    'Just now': '刚刚',
    'This week': '本周',
    '7 days': '7 天',
    '30 days': '30 天',
    'All agents': '全部 Agent',
    'This project': '本项目',
    'Totals': '汇总',
    'Est. cost (USD)': '预估费用 (USD)',
    'Est. cost': '预估费用',
    'Not rated yet': '暂无评分',
    'Nothing compared yet': '暂无对比数据',
    'nothing compared yet': '暂无对比数据',
    'Not reported': '未上报',
    'less cost': '成本降低',
    'more cost': '成本增加',
    'tokens saved': '节省 Token',
    'New in': '新增输入',
    'From cache': '缓存命中',
    'In': '输入',
    'Out': '输出',
    'Period for Topics and Token savings': '主题与 Token 节省的时间范围',
    'Token savings period': 'Token 节省的时间范围',
    'Group by': '分组方式',
    'Sync from penecho.ai': '从 penecho.ai 同步',
    'Use a prompt': '使用提示词',
    'Add price': '添加价格',
    'US$ / 1M tokens': '美元 / 百万 Token',
    'US$ per 1M tokens': '美元 / 每百万 Token',
    'All projects on this computer': '本机全部项目',
    'All PenEcho users': '全体 PenEcho 用户',
    'Example · All projects on this computer': '示例 · 本机全部项目',
    'Example · All PenEcho users': '示例 · 全体 PenEcho 用户',
    'Grouped by agent and model · combined rating, tokens and cost': '按 Agent 与模型分组 · 综合评分、Token 与费用',
    'No Works in this period.': '该时间段内暂无 Work。',
    'Needs your rating': '待你评分',
    'Your feedback counts twice in each agent’s rating': '你的反馈在每个 Agent 评分中占双倍权重',
    'rating': '评分',
    'Light only': '仅轻量任务',
    '95% interval': '95% 置信区间',
    'Rank': '排名',
    'Model · Agent · Effort': '模型 · Agent · 强度',
    'Score': '评分',
    'Cost / Work': '单次费用',
    'Time / Work': '单次耗时',
    'Rating': '评价',
    'Works': 'Work 数',
    'Where each model is strong': '各模型擅长领域',
    'Score against cost': '评分与费用对比',
    'Higher is better, further left is cheaper. The line joins pairings no other pairing beats on both.': '越靠上评分越高，越靠左费用越低。折线连接帕累托最优组合。',
    'Cost per Work (log scale)': '单次 Work 费用（对数坐标）',
    'Leaderboard': '排行榜',
    'PenEcho Real-World AI Agent Leaderboard': 'PenEcho 真实任务 AI Agent 排行榜',
    'Agent apps, models and effort levels ranked from real use, not benchmarks or votes.': '基于真实任务数据排名的 Agent 应用、模型与推理强度，而非跑分或投票。',
    'Open Leaderboard': '打开排行榜',
    'Agent index': 'Agent 指数',
    'Not enough rated Works yet': '已评分的 Work 数量不足',
    'Compare with every user on the PenEcho Real-World AI Agent Leaderboard': '在 PenEcho 真实任务排行榜中与全体用户数据对比',
    'Time': '耗时',
    'Tokens / Work': '单次 Token',
    'Cost': '费用',
    'Example project only': '仅示例项目',
    'Open Orchestrator': '打开调度器',
    'Show my current stats': '显示我的真实统计',
    'Example statistics · Sample data': '示例统计 · 样本数据',
    'No ratings to show yet — here is an example': '尚无评分数据——以下是示例预览',
    'Everything in the preview below uses sample data. Your real statistics replace it automatically as soon as ratings exist.': '下方预览使用样本数据。一旦产生真实评分，将自动替换为你的数据。',
    'Rate Works yourself': '自己给 Work 评分',
    'optional': '可选',
    'Use the Orchestrator': '使用调度器',
    'auto-rates': '自动评分',
    'No ratings yet': '尚无评分',
    'View example': '查看示例',
    'Example': '示例',
    'Example preview · Sample data for illustration': '示例预览 · 仅供演示的样本数据',
    'Top pairings by score with 95% intervals': '按评分排名的最佳组合（含 95% 区间）',
    'Orchestrator score and yours, combined; yours counts twice': '综合调度器评分与你的反馈（你的反馈双倍权重）',
    'Score against cost per Work': '评分与单次 Work 费用对比',
    'Load more': '加载更多',
    'No measured Work in this period yet.': '该时间段内暂无已统计的 Work。',
    'How this is worked out': '计算方式',
    'Open Work': '打开 Work',
    'Usage evidence (JSON)': '用量依据 (JSON)',
    'Context sources (JSON)': '上下文来源 (JSON)',

    // ---------- Find / Ask AI ----------
    'Ask a question about this project': '询问关于此项目的问题',
    'Search all lines': '搜索全部 Line',
    'Your Asks': '你的请求',
    "Agents' work": 'Agent 的工作',
    'Drawing': '画图',
    'working': '进行中',
    'stopped': '已停止',
    'need you': '需要你',
    'todo': '待办',
    'to review': '待审阅',
    'to send': '待发送',
    'Lines with an Ask not sent yet': '有尚未发送请求的 Line',
    'Lines waiting for your answer or choice': '等待你回复或选择的 Line',
    'Finished lines marked Todo': '标为待办的已完成 Line',
    'Finished results to review': '待审阅的已完成结果',
    'Lines working': '进行中的 Line',
    'Lines stopped': '已停止的 Line',
    'Nothing found': '未找到匹配内容',
    'No matches in this category.': '此分类下没有匹配结果。',
    'No matching lines with this status.': '该状态下没有匹配的 Line。',
    'No matches in the available results.': '当前结果范围内没有匹配项。',
    'Showing part of the results. Filters apply to these matches; narrow your search to find more.': '仅显示部分结果，筛选作用于当前结果；请缩小搜索范围查看更多。',
    'No lines about this.': '没有相关 Line。',
    'None right now.': '当前没有符合条件的 Line。',
    'No open lines.': '暂无进行中的 Line。',
    'Clear status': '清除状态筛选',
    'Saved answers': '已保存的回答',
    'Recent searches': '最近搜索',
    'Show all statuses': '显示全部状态',
    'Reading the project\'s docs…': '正在阅读项目文档…',
    'Filter lines by status': '按状态筛选 Line',
    'Show matches from': '显示匹配来源',
    'Searching': '搜索中',
    'Agent that answers': '回答所用的 Agent',
    'Ask the selected agent (Enter)': '向所选 Agent 提问 (Enter)',
    'Ask again': '再问一次',
    'Copy answer': '复制回答',
    'Delete this answer': '删除此回答',

    // ---------- Canvases & Files & Vault & Deleted & Switcher ----------
    'Canvases': '画布',
    'Pages and prototypes': '页面与原型',
    'Slides': '幻灯片',
    'Documents': '文档',
    'Pictures': '图片',
    'Meetings': '会议',
    'Page': '页面',
    'Document': '文档',
    'Picture': '图片',
    'Spreadsheet': '表格',
    'Media': '媒体',
    'File': '文件',
    'Everyone': '全部',
    'Made by AI': 'AI 生成',
    'From you': '来自你',
    'Favourites': '收藏',
    'Add to favourites': '加入收藏',
    'Remove from favourites': '取消收藏',
    'Any size': '任意大小',
    '1 MB or larger': '1 MB 及以上',
    '10 MB or larger': '10 MB 及以上',
    '100 MB or larger': '100 MB 及以上',
    'Line status': 'Line 状态',
    'All files': '全部文件',
    'Could be cleaned up': '可清理',
    'Archived Lines': '已归档 Line',
    'Deleted Line leftovers': '已删除 Line 残留',
    'No Line link': '未关联 Line',
    'In use': '使用中',
    'Nothing current links to it or names it': '当前没有任何内容引用或提及它',
    'Only archived Lines use it': '仅已归档 Line 使用了它',
    'Its Line was deleted; nothing else uses it': '所属 Line 已删除，且无其他引用',
    'Nothing links to it or names it': '没有任何内容引用或提及它',
    'In current work, or a Canvas of its own': '正在当前工作中使用，或为独立画布',
    'Archived Line': '已归档 Line',
    'Deleted Line': '已删除 Line',
    'No Line': '无关联 Line',
    'Mixed Lines': '多个 Line',
    'Project folder': '项目文件夹',
    'Newest first': '最新优先',
    'By kind': '按类型',
    'Largest first': '最大优先',
    'Deleting…': '删除中…',
    'No Canvases or files yet.': '暂无画布或文件。',
    'No files match.': '没有匹配的文件。',
    'No favourites yet.': '暂无收藏。',
    'No favourites match.': '没有匹配的收藏。',
    'Nothing here.': '这里还没有内容。',
    'Open Canvas': '打开画布',
    'Open on Canvas': '在画布中打开',
    'Edit on Canvas': '在画布中编辑',
    'Open in browser': '在浏览器中打开',
    'Open in a new tab': '在新标签页中打开',
    'Reveal in Finder': '在访达中显示',
    'Show in File Explorer': '在文件资源管理器中显示',
    'Show in folder': '在文件夹中显示',
    'Copy Markdown': '复制 Markdown',
    'Download PNG': '下载 PNG',
    'Download folder as zip': '打包下载文件夹 (ZIP)',
    'Hand to an agent': '交给 Agent 处理',
    'Project files': '项目文件',
    'Add what every agent here should know': '添加每位 Agent 都需要了解的项目信息',
    'Zoom in': '放大',
    'Zoom out': '缩小',
    'Items': '其他条目',
    'Nothing deleted in the last week.': '最近一周没有删除任何内容。',
    'No deleted lines.': '没有已删除的 Line。',
    'No deleted items.': '没有已删除的条目。',
    'Restore its line first': '请先恢复所属 Line',
    'Gone for good within a day': '1 天内永久删除',
    'Recent': '最近',
    'All projects': '全部项目',
    'In PenEcho Cloud': '在 PenEcho Cloud 中',
    'Cloud-only project': '仅云端项目',
    'Open on penecho.ai': '在 penecho.ai 打开',
    'Empty': '空项目',
    'Folder not found': '找不到文件夹',
    'No projects yet.': '暂无项目。',
    'Ready for its first request': '随时可以开始第一个请求',
    'Remove from this list': '从列表移除',
    'Choose its new place': '重新选择文件夹',
    'Bring in from the Library': '从画布库导入',
    'Looking…': '查找中…',
    'Bring in all': '全部导入',
    'Bring in': '导入',
    'Rename Canvas': '重命名画布',
    'Open its line': '打开所属 Line',
    'Move its line to…': '将其 Line 移动到…',
    'Move to…': '移动到…',
    'Take off its line': '从所属 Line 移出',
    'Canvas deleted': '画布已删除',
    'Preview unavailable': '无法预览',
    'Download file': '下载文件',
    'Scroll to zoom · Drag to move': '滚轮缩放 · 拖拽移动',
    'Select all': '全选',
    'From the line': '来自 Line',
    'Kind': '类型',
    'Open Library': '打开画布库',
    'Show': '显示',
    'Selected files': '已选文件',
    'Kinds': '类型',
    'Find a file': '查找文件',
    'Where': '位置',
    'Size': '大小',
    'Zoom': '缩放',
    'Move to Deleted': '移至已删除',
    'Previous': '上一个',
    'Next': '下一个',
    'Show in Vault': '在文件库中显示',
    'Each one leaves this list and is removed for good 7 days after it was deleted.': '每个项目会在删除 7 天后永久移除。',

    // ---------- Cloud / Share / Hosted / MeetCue / Make ----------
    'Getting the files ready…': '正在准备文件…',
    'Getting the files ready': '正在准备文件',
    'Reading the project\'s files…': '正在读取项目文件…',
    'Cloud status unavailable.': '无法获取云端状态。',
    'Checking PenEcho Cloud…': '正在检查 PenEcho Cloud…',
    'Sign in to check sharing status or sync this project.': '登录以查看分享状态或同步此项目。',
    'Last sync time unavailable.': '暂无上次同步时间。',
    'First sync history': '首次同步历史',
    'See the plans': '查看套餐',
    'Take it out of PenEcho Cloud?': '要从 PenEcho Cloud 移除吗？',
    'Its copy in Cloud is deleted. The project on this computer stays.': '云端副本将被删除，本机项目保持不变。',
    'Keep it': '保留',
    'Take it out': '移除',
    'Taking it out of PenEcho Cloud': '正在从 PenEcho Cloud 移除',
    'Your code stays on this computer.': '你的代码保留在这台电脑上。',
    'First sync': '首次同步',
    'Compare': '对比',
    'This line changed here and on penecho.ai, and the two could not be joined.': '这条 Line 在本机和 penecho.ai 均有改动，无法自动合并。',
    'This one': '保留本机版本',
    'Keep this one': '保留此版本',
    'The other': '另一版本',
    'Keep the other': '保留另一版本',
    'Keep both': '两者都保留',
    'Take it back': '撤回',
    'Turn on': '开启',
    'Run it now': '立即运行',
    'You are out of credits. This Ask is kept, not sent.': '积分已用完，此请求已保留暂未发送。',
    'Get credits': '获取积分',
    'Share link…': '分享链接…',
    'Sign in to share': '登录以分享',
    'Stop sharing': '停止分享',
    'Share again': '重新分享',
    'Done': '完成',
    'Link': '链接',
    'Stays open until you stop sharing.': '在停止分享前持续有效。',
    'This link has ended.': '此分享链接已失效。',
    'Keep it with Plus': '升级 Plus 持续保留',
    'Finish signing in in your browser. This updates by itself.': '请在浏览器中完成登录，此处会自动更新。',
    'Dashboard': '控制台',
    'Your name': '你的名字',
    'Add note': '添加笔记',
    'Add picture': '添加图片',
    'Draw': '画图',
    'Draw on canvas': '在画布上画',
    'Add to note': '添加到笔记',
    'Delete…': '删除…',
    'Remove from list': '从列表移除',
    'Dismiss welcome': '关闭欢迎提示',
    'Sign in to connect': '登录以连接',
    'Connect MeetCue': '连接 MeetCue',
    'See your meeting as a live map.': '将你的会议实时呈现为结构导图。',
    'Add to project': '添加到项目',
    'Getting your meetings…': '正在获取会议列表…',
    'No meetings recorded yet.': '尚未录制任何会议。',
    'Disconnect': '断开连接',
    'Disconnect MeetCue?': '断开 MeetCue 连接？',
    'No minutes yet.': '暂无会议纪要。',
    'Actions': '行动项',
    'Full meeting map': '完整会议导图',
    'Whole map': '全图',
    'Meeting maps': '会议导图',
    'Action items': '行动项',
    'Minutes': '会议纪要',
    'Getting the minutes…': '正在获取会议纪要…',
    'Delete meeting?': '删除会议？',
    'Delete meeting': '删除会议',
    'Open the minutes': '打开纪要',
    'Also linked in': '同时关联于',
    'Open in MeetCue': '在 MeetCue 中打开',
    'Open minutes file': '打开纪要文件',
    'All meetings': '全部会议',
    'Meeting': '会议',
    'Send this line to MeetCue': '将此 Line 发送到 MeetCue',
    'Use in MeetCue': '在 MeetCue 中使用',
    'Diagram': '图表',
    'AI picks': 'AI 自动选',
    'Architecture': '架构图',
    'Workflow': '流程图',
    'Sequence': '时序图',
    'Explorer': '交互探索',
    'Explain': '讲解',
    'Note card': '笔记卡片',
    'Knowledge card': '知识卡片',
    'Flashcards': '闪卡',
    'Work note': '工作笔记',
    'What is left': '剩余内容',
    'Merge two Topics': '合并两个主题',
    'Sources': '来源',
    'Outline': '大纲',
    'All Topics': '全部主题',
    'View more': '查看更多',
    'Building Topics': '正在构建主题',
    'Build Topics': '构建主题',
    'Rebuild': '重建',
    'Rebuild Topics': '重建主题',
    'Agent': 'Agent',
    'New Topic': '新建主题',
    'Overview': '概览',
    'No topics yet': '暂无主题',
    'Other': '其他',
    'No Lines yet': '暂无 Line',
  });

  // Dynamic pattern translations for interpolated UI strings.
  const FILTER_STATUS_MAP = {
    All: '全部', Working: '进行中', Stopped: '已停止', 'Needs you': '需要你',
    Todo: '待办', 'To review': '待审阅', Finished: '已完成', Unread: '未读',
  };
  const PATTERNS = [
    [/^(\d+) more top-level Lines or orchestrator groups$/, '还有 $1 条顶层 Line 或调度器分组'],
    [/^(\d+) more not sent$/, '还有 $1 条未发送'],
    [/^(\d+) more$/, '$1 项更多'],
    [/^(\d+) to fix$/, '$1 个需修复'],
    [/^(\d+) live$/, '$1 个在线'],
    [/^(\d+) needs? a fix · (\d+) ready$/, '$1 个需修复 · $2 个就绪'],
    [/^(\d+) needs? a fix$/, '$1 个需修复'],
    [/^(\d+) ready on this computer$/, '本机 $1 个就绪'],
    [/^(\d+) ready$/, '$1 个就绪'],
    [/^(\d+) signed out$/, '$1 个未登录'],
    [/^(\d+) not installed$/, '$1 个未安装'],
    [/^(\d+) saved presets? active$/, '已启用 $1 个预设'],
    [/^(\d+) available$/, '$1 个可用'],
    [/^(\d+) computers? connected$/, '已连接 $1 台电脑'],
    [/^Presets \((\d+)\)$/, '预设 ($1)'],
    [/^Quick-add all \((\d+)\)$/, '全部快速添加 ($1)'],
    [/^(\d+) with no price$/, '$1 个未设价格'],
    [/^(\d+) API keys?$/, '$1 个 API 密钥'],
    [/^PenEcho Cloud · (\d+) API keys?$/, 'PenEcho Cloud · $1 个 API 密钥'],
    [/^Currently using (.+)$/, '当前使用 $1'],
    [/^Using (.+)$/, '正在使用 $1'],
    [/^Default model (.+)$/, '默认模型 $1'],
    [/^Default \((.+)\)$/, '默认（$1）'],
    [/^(.+)'s default$/, '$1 默认'],
    [/^Set in (.+)$/, '在 $1 中设置'],
    [/^(.+) \(needs fix\)$/, '$1（需修复）'],
    [/^(.+) controls this in its own settings\.$/, '$1 在其自身设置中控制此项。'],
    [/^(\d+) agents? aren't being rated\.$/, '$1 个 Agent 未参与评分。'],
    [/^Pin (\d+) agents?$/, '固定 $1 个 Agent'],
    [/^Pinned (\d+) agents?\. Their jobs are rated from the next Work\.$/, '已固定 $1 个 Agent，将从下一次 Work 起记录评分。'],
    [/^Pinned (.+)\. Its jobs are rated from the next Work\.$/, '已固定 $1，将从下一次 Work 起记录评分。'],
    [/^Added (\d+) presets? for Auto and Orchestrator\.$/, '已为 Auto 和调度器添加 $1 个预设。'],
    [/^Every project now runs with (.+) by default\.$/, '现在所有项目默认使用 $1 运行。'],
    [/^Removed (.+)$/, '已移除 $1'],
    [/^Canvas AI uses (.+) from now on\.$/, '画布 AI 现已切换为 $1。'],
    [/^Canvas AI: (.+), from now on\.$/, '画布 AI：$1，已生效。'],
    [/^Added\. Canvas AI uses (.+) now\.$/, '已添加，画布 AI 现已使用 $1。'],
    [/^Added (.+)\.$/, '已添加 $1。'],
    [/^(\d+) models found\. Pick one in Model\.$/, '找到 $1 个模型，请在「模型」中选择。'],
    [/^Configured (.+) for PenEcho MCP\.$/, '已为 $1 配置 PenEcho MCP。'],
    [/^Connected · (\d+) Canvas(?:es)? live$/, '已连接 · $1 个画布在线'],
    [/^([0-9,.]+) credits used today$/, '今日已用 $1 积分'],
    [/^([0-9,.]+) credits left$/, '剩余 $1 积分'],
    [/^([0-9,.]+) credits$/, '$1 积分'],
    [/^Update to v?(.+)$/, '更新到 v$1'],
    [/^Version (.+) is available\.$/, '新版本 $1 可用。'],
    [/^Version (.+) is ready to install\.$/, '版本 $1 已就绪，可以安装。'],
    [/^Installing v(.+)…$/, '正在安装 v$1…'],
    [/^Downloading v(.+)$/, '正在下载 v$1'],
    [/^Downloading PenEcho v(.+)$/, '正在下载 PenEcho v$1'],
    [/^Restarting to install PenEcho v(.+)$/, '正在重启以安装 PenEcho v$1'],
    [/^PenEcho v(.+) is ready\. Restart to install it\.$/, 'PenEcho v$1 已就绪，重启即可安装。'],
    [/^Download PenEcho v(.+)\. You can keep working while it downloads\.$/, '下载 PenEcho v$1。下载期间你可以继续工作。'],
    [/^(\d+) presets?: (.+)$/, '$1 个预设：$2'],
    [/^No preset yet · default model (.+)$/, '暂无预设 · 默认模型 $1'],
    [/^Updated (.+)\.$/, '已更新 $1。'],
    [/^Installed (.+)\.$/, '已安装 $1。'],
    [/^(.+) is already installed(.*)\.$/, '$1 已安装$2。'],
    [/^Back to (.+)$/, '返回$1'],
    [/^Settings: (\d+) to fix$/, '设置：$1 个需修复'],
    [/^(\d+) working now$/, '$1 进行中'],
    [/^(\d+) need(?:s)? you$/, '$1 需要你'],
    [/^(\d+) working$/, '$1 进行中'],
    [/^(\d+) finished$/, '$1 已完成'],
    [/^(\d+) unread$/, '$1 未读'],
    [/^(\d+) to review$/, '$1 待审阅'],
    [/^(\d+) stopped$/, '$1 已停止'],
    [/^(\d+) todo$/, '$1 待办'],
    [/^(\d+) to send$/, '$1 待发送'],
    [/^(\d+) unsent$/, '$1 未发送'],
    [/^\+ (\d+) finished$/, '+ $1 条已完成'],
    [/^(\d+) earlier lines?$/, '更早的 $1 条 Line'],
    [/^Nothing matches “(.+)”\.$/, '没有匹配「$1」的内容。'],
    [/^(All|Working|Stopped|Needs you|Todo|To review|Finished|Unread) · No lines match these filters$/, (_, st) => `${FILTER_STATUS_MAP[st] || st} · 没有符合筛选条件的 Line`],
    [/^(All|Working|Stopped|Needs you|Todo|To review|Finished|Unread) · (.+)$/, (_, st, rest) => {
      const body = rest
        .replace(/^(\d+) of (\d+) lines? shown/, '显示 $1 / $2 条 Line')
        .replace(/^(\d+) lines?/, '$1 条 Line')
        .replace(/ · (\d+) finished folded/, ' · 已折叠 $1 条已完成')
        .replace(/ · (\d+) sub-sessions? collapsed/, ' · 已收起 $1 个子会话');
      return `${FILTER_STATUS_MAP[st] || st} · ${body}`;
    }],
    [/^Working · (\d+) (min|h|d)$/, (_, n, u) => `进行中 · ${n} ${{ min:'分钟', h:'小时', d:'天' }[u]}`],
    [/^(\d+)m ago$/, '$1 分钟前'],
    [/^(\d+)h ago$/, '$1 小时前'],
    [/^(\d+)d ago$/, '$1 天前'],
    [/^Today (\d\d:\d\d)$/, '今天 $1'],
    [/^Yesterday (\d\d:\d\d)$/, '昨天 $1'],
    [/^(\d+)–(\d+) of (\d+) sessions$/, '第 $1–$2 个，共 $3 个会话'],
    [/^(\d+) sessions?$/, '$1 个会话'],
    [/^(\d+) Lines? stopped$/, '$1 条 Line 已停止'],
    [/^(\d+) Lines? with errors$/, '$1 条 Line 出错'],
    [/^(Stopped|Finished) · Work still running$/, (_, st) => `${st === 'Stopped' ? '已停止' : '已完成'} · Work 仍在运行`],
    [/^Earlier report · (.+)$/, '更早报告 · $1'],
    [/^Last activity (.+)$/, '最近活动 $1'],
    [/^Waiting for (.+)$/, '等待 $1'],
    [/^Synced (.+)$/, '已同步于 $1'],
    [/^Orchestrator started(.*)$/, (_, tail) => `调度器已启动${tail.replace(/ · (Code|Chat|Design|Research|Docs) job → /, (_, k) => ` · ${{ Code:'代码', Chat:'对话', Design:'设计', Research:'研究', Docs:'文档' }[k]}任务 → `)}`],
    [/^Agent that orchestrates: (.+)$/, '调度 Agent：$1'],
    [/^Start \(Enter\) or Add for later \((.+)\)$/, '开始 (Enter) 或稍后运行 ($1)'],
    [/^Show all (\d+) agents$/, '显示全部 $1 个 Agent'],
    [/^Show all (\d+) sub-Lines$/, '显示全部 $1 条子 Line'],
    [/^Show all (\d+)$/, '显示全部 $1 项'],
    [/^Select all (\d+)$/, '全选 $1 项'],
    [/^(\d+) selected$/, '已选 $1 项'],
    [/^(\d+) archived sub-Lines?$/, '$1 条已归档子 Line'],
    [/^Mark (\d+) Lines? reviewed$/, '将 $1 条 Line 标为已审阅'],
    [/^Rate (\d+) Works?$/, '评价 $1 个 Work'],
    [/^(\d+) of (\d+) Works priced$/, '$1 / $2 个 Work 已计价'],
    [/^(\d+) rated(?: · (\d+) good(?: · (\d+) not)?)?$/, (_, r, g, b) => `${r} 已评分${g != null ? ` · ${g} 满意${b != null ? ` · ${b} 不满意` : ''}` : ''}`],
    [/^(.+) cache reads$/, '$1 次缓存读取'],
    [/^less cost · ≈ (.+) (fewer|more) tokens$/, (_, n, dir) => `成本降低 · ${dir === 'fewer' ? '减少' : '增加'}约 ${n} Token`],
    [/^(\d+) fresh starts?$/, '$1 次全新启动'],
    [/^Showing (\d+) of (\d+) matches\. Narrow your search to find more\.$/, '显示 $1 / $2 条匹配结果，请缩小搜索范围查看更多。'],
    [/^Showing (\d+) of (\d+)$/, '已显示 $1 / $2'],
    [/^Available: (\d+) lines?$/, '当前可用：$1 条 Line'],
    [/^(\d+) of (\d+) lines?$/, '$1 / $2 条 Line'],
    [/^Page (\d+) of (\d+)$/, '第 $1 / $2 页'],
    [/^Page (\d+)$/, '第 $1 页'],
    [/^(Previous|Next) page$/, (_, d) => d === 'Previous' ? '上一页' : '下一页'],
    [/^What you delete stays here for (\d+) days, then it is gone for good\.$/, '删除的内容会在此保留 $1 天，之后将永久清除。'],
    [/^Gone for good in (\d+) days$/, '$1 天后永久删除'],
    [/^(\d+) agents? ready$/, '$1 个 Agent 就绪'],
    [/^(\d+) in (?:its app|their apps)$/, '$1 个在各自应用中'],
    [/^(\d+) sub-Lines?$/, '$1 条子 Line'],
    [/^(\d+) sub-sessions?$/, '$1 个子会话'],
    [/^Sub-Lines of (.+)$/, '$1 的子 Line'],
    [/^Actions for (.+)$/, '$1 的操作'],
    [/^More for (.+)$/, '$1 的更多操作'],
    [/^Lines in (.+)$/, '$1 中的 Line'],
    [/^Start a new line in (.+)$/, '在 $1 中新建 Line'],
    [/^Fold (.+)$/, '折叠 $1'],
    [/^Unfold (.+)$/, '展开 $1'],
    [/^Pin (.+)$/, '置顶 $1'],
    [/^Unpin (.+)$/, '取消置顶 $1'],
    [/^Delete (.+)$/, '删除 $1'],
    [/^Archived (.+)$/, '已归档 $1'],
    [/^Restored (.+)$/, '已恢复 $1'],
    [/^Deleted (.+)$/, '已删除 $1'],
    [/^Signed in as (.+)$/, '已登录为 $1'],
    [/^Switch project, current project (.+)$/, '切换项目，当前项目 $1'],
    [/^Opening (.+)…$/, '正在打开 $1…'],
    [/^Work took (.+)$/, 'Work 用时 $1'],
    [/^(\d+) new marks?$/, '$1 个新标注'],
    [/^Preview (.+)$/, '预览 $1'],
    [/^Remove (.+)$/, '移除 $1'],
    [/^Go to (.+)$/, '前往 $1'],
    [/^Stop referring to (.+)$/, '取消引用 $1'],
    [/^Copied (.+)$/, '已复制 $1'],
    [/^Synced (\d+) conversations?\.$/, '已同步 $1 条对话。'],
    [/^No other conversations in these folders\.$/, '这些文件夹中没有其他对话。'],
    [/^(.+) effort$/, (_, lvl) => {
      const map = { none:'无', minimal:'极低', low:'低', medium:'中', high:'高', xhigh:'极高', max:'最高', default:'默认' };
      return `${map[lvl.toLowerCase()] || lvl} 推理强度`;
    }],
    [/^(\d+) s$/, '$1 秒'],
    [/^(\d+(?:\.\d+)?) min$/, '$1 分钟'],
    [/^(\$\S+) total$/, '共 $1'],
    [/^(\d+) kinds$/, '$1 种类型'],
    [/^(.+) · via (.+)$/, '$1 · 经由 $2'],
    [/^(.+) · key saved$/, '$1 · 已保存密钥'],
    [/^(.+) · no key$/, '$1 · 无密钥'],
    [/^(.+) · Agents$/, (_, name) => `${name === 'This project' ? '本项目' : name === 'Example project' ? '示例项目' : name} · Agent`],
    [/^(.+) only$/, (_, name) => `仅 ${name === 'This project' ? '本项目' : name === 'Example project' ? '示例项目' : name}`],
    [/^(Code|Class notes|Excel to PPT) · (\d+) lines?$/, (_, kind, n) => {
      const km = { Code:'代码', 'Class notes':'课堂笔记', 'Excel to PPT':'Excel 生成 PPT' };
      return `${km[kind] || kind} · ${n} 条 Line`;
    }],
    [/^(\d+) lines? open$/, '$1 条进行中 Line'],
    [/^(\d+) lines?$/, '$1 条 Line'],
    [/^(\d+) more commits?$/, '多 $1 次提交'],
    [/^(\d+) Works? by agent$/i, '$1 个 Work（按 Agent）'],
    [/^(\d+) Works? by kind of job$/i, '$1 个 Work（按任务类型）'],
    [/^(.+) · Works by day$/i, (_, name) => `${name === 'This project' ? '本项目' : name === 'Example project' ? '示例项目' : name} · 每日 Work`],
    [/^(\d+) works?$/i, '$1 个 Work'],
    [/^(\d+) files?$/, '$1 个文件'],
    [/^(\d+) canvases?$/i, '$1 个画布'],
    [/^(\d+) notes?$/, '$1 条笔记'],
    [/^(\d+) pictures?$/, '$1 张图片'],
    [/^Now · (.+)$/, '现在 · $1'],
  ];

  // Mixed-HTML UI sentences where English word order contains inline elements (<strong>, <button>, <code>).
  // Keyed by normalized textContent so Chinese grammar reads naturally while preserving interactive buttons/code.
  const MIXED_HTML = [
    [
      /^Install, sign in, update, and verify local agent runtimes here\. Configure models, efforts, and permissions in Preset agents\.$/,
      () => '在此安装、登录、更新并验证本地 Agent 运行环境。模型、推理强度与权限请在 <strong>预设 Agent</strong> 中配置。',
    ],
    [
      /^Saved provider \+ model \+ effort profiles used by Lines, PenEcho Auto, and Orchestrator\. Save the same model at several efforts \(e\.g\. high and medium\) so Auto learns which fits each job\.$/,
      () => '已保存的 <strong>提供方 + 模型 + 推理强度</strong> 配置，供 Line、PenEcho Auto 和调度器使用。可为同一模型保存多种强度（如高和中），让 Auto 学习不同任务的最佳搭配。',
    ],
    [
      /^Add an agent so the Orchestrator has someone to hand work to$/,
      () => '<button type="button" class="link orch-hint-link" data-act="open-agents">添加 Agent</button>，让调度器有可分配任务的执行者',
    ],
    [
      /^The Orchestrator can’t compare costs yet\. Get prices and ratings$/,
      () => '调度器还无法比较费用。<button type="button" class="link orch-hint-link" data-act="orch-sync">获取价格与评分</button>',
    ],
    [
      /^Reviews are on\. Change in settings\.$/,
      () => '审阅已开启。<button type="button" class="link orch-hint-link" data-act="orch-settings">在设置中更改。</button>',
    ],
    [
      /^You or PenEcho Auto pick the coordinator\. It does the job or hands parts to presets with Allow orchestrator assignments\. Only presets in Settings → Agents are used: save a model at several efforts to find the best fit\.$/,
      () => '由你或 <strong>PenEcho Auto</strong> 选定主控 Agent。它会直接完成任务，或拆分交给开启了 <strong>允许调度器派发任务</strong> 的预设。仅使用 <strong>设置 → 预设 Agent</strong> 中的配置：为同一模型保存多种推理强度可找到最佳搭配。',
    ],
    [
      /^No local provider can run yet\. Install or fix one in Local providers\.$/,
      () => '尚无可用的本地提供方。请先在 <button type="button" class="sys-inline-link" data-act="open-setup">本地提供方</button> 中安装或修复。',
    ],
    [
      /^Used strictly by Canvas AI \(drawing answers & handwriting\)\. Project agents use Local providers instead\.$/,
      () => '仅用于 <strong>画布 AI</strong>（绘图解答与手写交互）。项目 Agent 请在 <button type="button" class="sys-inline-link" data-act="open-setup">本地提供方</button> 中配置。',
    ],
    [
      /^The drawing Canvas answer AI — answers right beside your strokes when you tap AI, circle ink, or turn on Auto AI\.$/,
      () => '<b>画布绘图解答 AI</b>——当你点击 AI、圈选笔迹或开启自动 AI 时，直接在笔迹旁给出解答。',
    ],
    [
      /^Separate external integration: MCP lets outside AI apps connect into PenEcho to read and draw on Canvases you opt in\. It does not require Canvas AI API keys or Project Agent presets\.$/,
      () => '<strong>独立外部集成：</strong>MCP 允许外部 AI 应用连接<em>进入</em> PenEcho，读取并在你授权的画布上绘图。它不需要画布 AI 的 API 密钥或项目 Agent 预设。',
    ],
    [
      /^Per-Canvas access is always opt-in: turn on or pause “MCP can draw here” from any Canvas’s ⋯ menu\.$/,
      () => '每个画布的访问权限默认关闭：可在任意画布的 <code>⋯</code> 菜单中开启或暂停「允许 MCP 在此绘制」。',
    ],
    [
      /^Pick which model answers when you draw on a Canvas\. Manage API providers$/,
      () => '选择在画布上绘图时用于回答的模型。<button type="button" class="link sys-canvas-providers" data-act="open-providers" data-focus-id="sysTab-providers">管理 API 提供方</button>',
    ],
    [
      /^Currently using (.+) · Manage API providers$/,
      m => `当前使用 ${escHtml(m[1])} · <button type="button" class="link sys-canvas-providers" data-act="open-providers" data-focus-id="sysTab-providers">管理 API 提供方</button>`,
    ],
    [
      /^Sign in to PenEcho Cloud or add an API provider to pick a model for Canvas AI\. API providers$/,
      () => '登录 PenEcho Cloud 或添加 API 提供方，即可为画布 AI 选择模型。<button type="button" class="link sys-canvas-providers" data-act="open-providers" data-focus-id="sysTab-providers">API 提供方</button>',
    ],
    [
      /^Sign in to PenEcho Cloud to pick a model for Canvas AI\. API providers$/,
      () => '登录 PenEcho Cloud 即可为画布 AI 选择模型。<button type="button" class="link sys-canvas-providers" data-act="open-providers" data-focus-id="sysTab-providers">API 提供方</button>',
    ],
    [
      /^Endpoint (https?:\/\/\S+)$/,
      m => `接入地址 <code>${escHtml(m[1])}</code>`,
    ],
  ];

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function translateText(raw) {
    if (!isZh() || typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return raw;
    const lead = raw.slice(0, raw.indexOf(trimmed));
    const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
    if (Object.hasOwn(PHRASES, trimmed)) return lead + PHRASES[trimmed] + tail;
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(trimmed)) {
        const next = trimmed.replace(pattern, replacement);
        if (next !== trimmed) return lead + next + tail;
      }
    }
    return raw;
  }

  function translateTitle(title) {
    if (!isZh() || typeof title !== 'string') return title;
    const mSettings = title.match(/^(.+) · Settings · PenEcho Lines$/);
    if (mSettings) return `${translateText(mSettings[1])} · 设置 · PenEcho Lines`;
    if (title === 'New project · PenEcho Lines') return '新建项目 · PenEcho Lines';
    if (title === 'Projects · PenEcho Lines') return '项目 · PenEcho Lines';
    return title;
  }

  // Strictly skip user-authored content (project names, line titles, markdown bodies, code, diffs, transcripts).
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SVG', 'TEXTAREA', 'OPTION']);
  const USER_CONTENT_SELECTOR = [
    '[data-no-i18n]',
    '.brand', '.brand-lines',
    '.md', '.md-words', '.words', '.diff-body', '.rd-body', '.rd-preview', '.rd-area',
    '.file-code', '.mc-transcript',
    '.rail-project .rail-name',
    '.rail-line:not(.is-new) .rail-title',
    '.row-title-text', '.hl-words', '.lp-parent-title', '.lp-head h1',
    '.hm-rc > strong', '.tp-tt', '.tp-chip > span', '.tp-filter > span',
    '.orch-title > span', '.orch-line-t > span', '.orch-reason', '.orch-ask > span', '.orch-report > span', '.orch-rating-note',
    '.fl-tx > b', '.fl-where', '.fv-head > h3', '.fl-in > h3', '.fl-path', '.fl-line',
    '.fr-q', '.fl-title', '.fh-text', '.fa-body', '.fa-line > span',
    '.ar-main .row-name', '.del-main > strong', '.del-location', '.del-excerpt',
    '.project-name > span', '.sw-name', '.sw-text > strong', '.sw-p-head h3', '.sw-p-lines span',
    '.fc-foot > strong', '.tree-file > span', '.sx-rq-t',
    '.rv-text', '.rv-agent-name', '.lpp-who-name', '.lps-agent', '.rev-target',
    '.shelf-open .shelf-text > strong', '.sys-usage-details pre',
  ].join(', ');
  const SKIP_ANCESTOR_SELECTOR = `script, style, code, pre, kbd, svg, textarea, ${USER_CONTENT_SELECTOR}`;

  const TRANSLATABLE_ATTRS = ['aria-label', 'title', 'placeholder'];

  function shouldSkipElement(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SVG') return true;
    if (typeof el.matches === 'function' && el.matches(USER_CONTENT_SELECTOR)) return true;
    return false;
  }

  function translateContextualText(raw, parentEl) {
    if (!isZh() || typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const lead = raw.slice(0, raw.indexOf(trimmed));
    const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
    if (trimmed === 'Lines' && parentEl?.closest?.('[data-grid="lines"]')) {
      return lead + '线条' + tail;
    }
    if (trimmed === 'Reviewed' && parentEl?.closest?.('select[name="access"], .wc-how')) {
      return lead + '需审批' + tail;
    }
    return translateText(raw);
  }

  function translateAttributes(el) {
    for (const attr of TRANSLATABLE_ATTRS) {
      const val = el.getAttribute?.(attr);
      if (!val) continue;
      const next = translateText(val);
      if (next !== val) el.setAttribute(attr, next);
    }
  }

  function tryMixedHtml(el) {
    if (!el || el.nodeType !== 1 || !el.childElementCount) return false;
    const tag = el.tagName;
    if (tag !== 'P' && tag !== 'SMALL' && tag !== 'DIV' && tag !== 'SPAN') return false;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z]/.test(text)) return false;
    for (const [pattern, build] of MIXED_HTML) {
      const m = text.match(pattern);
      if (m) {
        const html = build(m);
        if (el.innerHTML !== html) el.innerHTML = html;
        return true;
      }
    }
    return false;
  }

  let translating = false;

  function translateTree(root) {
    if (!isZh() || !root) return;
    if (root.nodeType === 3) {
      const parent = root.parentElement;
      if (!parent || parent.closest?.(SKIP_ANCESTOR_SELECTOR)) return;
    } else if (root.nodeType === 1 && root.closest?.(SKIP_ANCESTOR_SELECTOR)) {
      return;
    }
    const prev = translating;
    translating = true;
    try {
      const walk = node => {
        if (!node) return;
        if (node.nodeType === 3) {
          const val = node.nodeValue;
          const next = translateContextualText(val, node.parentElement);
          if (next !== val) node.nodeValue = next;
          return;
        }
        if (node.nodeType !== 1) return;
        if (shouldSkipElement(node)) return;
        translateAttributes(node);
        // Translate <option> text too (even though <textarea>/<input> values are never translated).
        if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') return;
        if (!node.childElementCount) {
          const val = node.textContent;
          const next = translateContextualText(val, node);
          if (next !== val) node.textContent = next;
          return;
        }
        if (tryMixedHtml(node)) return;
        for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
      };
      walk(root);
    } finally {
      translating = prev;
    }
  }

  function applyStaticChrome(lang = getLanguage()) {
    if (typeof document === 'undefined') return;
    const zh = lang === 'zh';
    if (document.documentElement) document.documentElement.lang = zh ? 'zh-CN' : 'en';
    const switcher = document.getElementById('switcher');
    if (switcher) {
      switcher.setAttribute('aria-label', zh ? '切换项目' : 'Switch project');
      const swList = document.getElementById('swList');
      if (swList) swList.setAttribute('aria-label', zh ? '项目' : 'Projects');
      const newBtn = switcher.querySelector('.sw-foot [data-act="new-project"]');
      if (newBtn) {
        const svg = newBtn.querySelector('svg');
        const label = zh ? '新建项目' : 'New project';
        newBtn.innerHTML = (svg ? svg.outerHTML : '') + label;
      }
    }
    const drop = document.getElementById('dropOverlay');
    if (drop) drop.textContent = zh ? '松手以添加附件' : 'Drop to attach';
    const pick = document.getElementById('filePick');
    if (pick) pick.setAttribute('aria-label', zh ? '添加图片或文件' : 'Add images or files');
  }

  function translatePage() {
    if (!isZh() || typeof document === 'undefined') return;
    applyStaticChrome('zh');
    const targets = [
      document.getElementById('app'),
      document.getElementById('sysModal'),
      document.getElementById('menu'),
      document.getElementById('switcher'),
      document.getElementById('lightbox'),
      ...document.querySelectorAll('dialog[open]'),
    ];
    for (const el of targets) if (el) translateTree(el);
    const nextTitle = translateTitle(document.title);
    if (nextTitle !== document.title) document.title = nextTitle;
  }

  // MutationObserver runs ONLY while Chinese is active, translating any lazy or dynamically inserted UI nodes.
  let observer = null;
  let pendingNodes = new Set();
  let flushScheduled = false;

  function flushMutations() {
    flushScheduled = false;
    if (!isZh()) { pendingNodes.clear(); return; }
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    for (const node of nodes) {
      if (node.isConnected) translateTree(node);
    }
    const nextTitle = translateTitle(document.title);
    if (nextTitle !== document.title) document.title = nextTitle;
  }

  function syncObserver() {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return;
    if (!isZh()) {
      observer?.disconnect();
      observer = null;
      pendingNodes.clear();
      return;
    }
    if (observer) return;
    observer = new MutationObserver(records => {
      if (translating || !isZh()) return;
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const added of rec.addedNodes) {
            if (added.nodeType === 1 || added.nodeType === 3) pendingNodes.add(added);
          }
        } else if (rec.type === 'characterData' && rec.target) {
          pendingNodes.add(rec.target);
        }
      }
      if (pendingNodes.size && !flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushMutations);
      }
    });
    observer.observe(document.body, { childList:true, subtree:true, characterData:true });
  }

  function refreshAll() {
    const lang = getLanguage();
    applyStaticChrome(lang);
    syncObserver();
    if (typeof document !== 'undefined') {
      // Clear cached render signatures so every region repaints cleanly in the new language.
      const bar = document.getElementById('projbar');
      if (bar) delete bar.dataset.projbarSig;
      for (const id of ['railAccount', 'railMine', 'railUpdate', 'homeBelow', 'emptyAgents', 'lineWarnings']) {
        const el = document.getElementById(id);
        if (el) delete el.dataset.h;
      }
      // Reset Settings modal header and cached panel snapshots so static modal chrome also updates.
      const modal = document.getElementById('sysModal');
      if (modal) {
        const h2 = modal.querySelector('#sysmTitle');
        if (h2) h2.textContent = lang === 'zh' ? '设置' : 'Settings';
        const closeBtn = modal.querySelector('.sysm-x');
        if (closeBtn) {
          closeBtn.setAttribute('aria-label', lang === 'zh' ? '关闭设置' : 'Close settings');
          closeBtn.setAttribute('title', lang === 'zh' ? '关闭 (Esc)' : 'Close (Esc)');
        }
      }
      if (typeof resetSettingsCache === 'function') resetSettingsCache();
      if (typeof resetViewCache === 'function') resetViewCache();
      // If New Project page is visible, remove it so PenEchoProjects remounts in the new language.
      if (typeof S === 'object' && S?.newPage) document.querySelector('#view .np-page')?.remove();
    }
    if (typeof render === 'function') render();
    else if (typeof settingsRender === 'function') settingsRender();
    if (typeof renderRail === 'function') renderRail();
    if (typeof renderProjbar === 'function') renderProjbar();
    if (typeof railUpdateRender === 'function') railUpdateRender();
    if (typeof renderSwitcher === 'function' && document.getElementById('switcher') && !document.getElementById('switcher').hidden) renderSwitcher();
    if (lang === 'zh') translatePage();
  }

  function setLanguage(value, { persist = true, dispatch = true } = {}) {
    const lang = value === 'zh' ? 'zh' : 'en';
    if (persist) {
      try { localStorage.setItem(LANG_KEY, lang); } catch {}
    }
    applyStaticChrome(lang);
    if (dispatch && typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('penecho:languagechange', { detail:{ language:lang } }));
    }
    if (typeof window !== 'undefined') window.PenEchoCanvasShell?.syncSettings?.();
    refreshAll();
    return lang;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      if (event.key === LANG_KEY) {
        const lang = getLanguage();
        applyStaticChrome(lang);
        if (typeof CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('penecho:languagechange', { detail:{ language:lang } }));
        }
        refreshAll();
      }
    });
    if (typeof document !== 'undefined') {
      const init = () => {
        applyStaticChrome();
        syncObserver();
        if (isZh()) translatePage();
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
      else init();
    }
  }

  const api = {
    getLanguage,
    isZh,
    setLanguage,
    t: translateText,
    translateTitle,
    translateTree,
    translatePage,
    applyStaticChrome,
    refreshAll,
  };
  linesLang = getLanguage;
  linesIsZh = isZh;
  linesT = translateText;
  linesTranslateTitle = translateTitle;
  linesTranslateTree = translateTree;
  linesTranslatePage = translatePage;
  linesRefreshLanguage = refreshAll;
  linesSetLang = setLanguage;
  if (typeof window !== 'undefined') {
    window.PenEchoLinesI18n = api;
    window.linesLang = getLanguage;
    window.linesIsZh = isZh;
    window.linesT = translateText;
    window.linesTranslateTitle = translateTitle;
    window.linesTranslateTree = translateTree;
    window.linesTranslatePage = translatePage;
    window.linesRefreshLanguage = refreshAll;
    window.linesSetLang = setLanguage;
  }
})();
