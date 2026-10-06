# PenEcho 回归测试指南（2026-09-29—2026-09-30）

配套 [Bug 汇总](penecho-bug-report-20260929-20260930.md)。本指南覆盖这两天已确认的行为和未闭环报告；测试结果须记录实际版本，不能用本地修复代替UAT／安装包验收。

9/30补充实测：[执行结果与修复记录](../verification/basic-uat-regression-20260930/README.md)。本地3921以`--uat`运行，真实Codex CLI／Agent／普通Canvas AI、画布保存关闭重开及PenEchoLLM请求已通过；Canvas完整检查2474通过，Cloud检查1159通过、44可选跳过，另用临时数据库完成6项必需集成。新增T29–T32覆盖旧功能基础操作。B05／B06／B24和B18的MCP basic分支已本地修复，新增B52的草稿按钮问题也已修复；UAT部署版本未改变。独立重新登录、实体设备和完整模型语义范围仍单列。

## 开始前

1. 记录入口：本地浏览器、Cloud UAT、Mac桌面、Windows桌面或iPad Safari；记录URL、前端版本／资源哈希、后端版本、模型、推理级别、账号类型。确认本地连接 `cloudEnvironment=uat` 和正确base URL，不能只看端口3921。
2. 最新已核对UAT基线为9/30 15:26的 Canvas `0fc34cc7`／Cloud `dfd0398`。自然回答、Agent输出定位、请求保真、编辑并发、Delete新action和CLI升级等之后的本地修改，必须标为“本地新版”；在旧UAT失败时先归类版本差异。
3. 准备独立测试画布：上方旧公式、中间手写hello、下方三道空等号；另放一个可交互Widget、一个文本框、一张图片。保留足够空白，再准备一张内容密集的画布验证无空位场景。不要复用重要原稿。
4. 第一轮开启自动Suggest、关闭Auto AI和笔势，隔离排序时序。随后分轮打开Auto AI、笔势和步骤检查，避免多个触发机制混淆。
5. 打开浏览器Network的Preserve log和Console；记录落笔、抬笔、请求发出、回包、页面应用五个时间点。保存实际发送截图，不以“画布看起来包含”推断模型已收到。
6. 自动化验收用独立profile、配置、测试数据和临时端口；不启动／重启用户的3921，不改现有模型服务。故障注入、真实外部原图重放和发布按各自授权范围执行。

推荐矩阵：先本地新版浏览器和UAT各一轮；完整回归再覆盖Mac、Windows、实体iPad/Pencil，中英文UI、390px／桌面宽度及17%／45%／100%缩放。已在Chromium模拟iPad尺寸不等于实体Safari/Pencil通过。

## 15分钟冒烟顺序

只执行下面每项的基础分支；压力、故障和多设备分支留到完整回归。

| 顺序 | 操作 | 立即检查的结果 |
| --- | --- | --- |
| 0a | T29登录状态、刷新、设备连接 | 本地确实连接UAT，登录／模型权限可用 |
| 0b | T30添加独立测试连接；T31真实CLI请求 | 检测CLI、测试图片、保存、选择均成功，不破坏原连接 |
| 0c | T32新建、文字、保存、关闭、重开、Undo／Redo | 内容完整，操作可恢复；窄草稿Keep不触发Copy |
| 1 | T01确认入口和版本 | 没连错Prod，页面和后端协议一致 |
| 2 | T02写hello，抬笔等待；再写一段较长内容 | 抬笔立即本地Suggest；连续停笔后请求；最终回包不用再补笔 |
| 3 | T03请求未结束时继续写，再点不同建议 | 落笔隐藏；新输入不用等旧请求结束；能停止旧Canvas AI并执行新动作 |
| 4 | T04在Canvas AI运行期间写hello，之后一直等 | AI解除忙碌后自动补发，或明确记录当前已知失败；不靠补一笔掩盖 |
| 5 | T05先分析hello，再写下方公式 | 第二张实际请求图片仍包含全部未消费输入 |
| 6 | T06把鼠标留在旧Suggest，用笔在别处写 | 抬笔工具条跟随新输入、避让内容；排名更新与加载条可见 |
| 7 | T07点普通Answer；T08只圈Widget一角 | Answer入口与手动一致；套索蒙版只含圈内，不移动Widget |
| 8 | T14划掉一句手写／Widget文字（本地新版）；T18图表连续缩放再Undo | 不自动删；确认后只删目标且可撤销；图表交互只占一步 |

T04扩展分支、T10、T15、T19、T23包含未闭环项。记录失败后继续独立测试，不将整个回归写成PASS。T14在未包含Delete的新UAT上应记录版本阻塞。

## 完整用例

### T01 环境、版本和旧进程（B36–B38）

操作：读取运行配置和状态接口；对照前端实际请求结构。新版请求应由Cloud拥有问题定义，客户端提交version/mode/image/context。分别检查ink和result，查找是否仍报questions缺失、invalid_action_space或404。

通过：前后端相互兼容，合法模式能到达图像／模型处理；最新mode拒绝不能被“模型不可用”掩盖。部署后前端刷新及后端重新加载各有证据。

失败证据：URL、环境、进程启动时间、请求JSON去敏版、响应状态与requestId。没有证据时先写“版本待确认”，不要放宽白名单试图绕过。

### T02 停笔时序和最终回包（B02、B03）

操作：分别累计实际落笔≤3s、>3且≤10s、>10s；长时间停顿不计入落笔时长。每次抬笔看本地Suggest，再看远程请求。相同书写在不同缩放下重复。中长输入完成后保持停笔直到回包，期间不再画。

通过：落笔中完全隐藏；抬笔立即出现。短输入连续停笔500ms后请求，中长1000ms后请求；新落笔重新计时。模型最终有效回包立刻更新当前Suggest，不要求下一笔；none／低置信仍保留本地操作，仅不高亮。

计时区分：500/1000ms是稳定停笔到分析准备的调度要求；Widget截图准备和HTTP／模型耗时另记，不能把公网返回当作该计时器。已有隔离浏览器参考约26–31ms显示、509–514ms／1.01–1.03s发起；这些是历史结果，不是所有设备保证。

### T03 取消、竞态和新动作接管（B02、B12）

操作：延迟回包时继续写；让旧请求在取消边界成功返回，再让新请求晚回。重试同一输入；Canvas AI正在工作时点击另一建议和提交Ask；关闭Suggest、Undo或换画布后释放迟到回复。

通过：旧请求不占着前端槽位；不会延迟新请求或清除新加载状态。有效旧候选只在同文档／同输入归属内作为默认，新结果最终胜出；无效归属回包不复活。新动作停止旧执行，旧执行不能迟到写入。点击已排序动作新增分类请求为0，Typed Ask可有一次有界route。

### T04 忙碌解除后的自动恢复（B05、B06、B07）

操作A：Canvas AI运行时写完新hello，让停笔计时器在busy期间到期；完成／取消Canvas AI后一直等待，绝不补笔。操作B：Agent面板打开但不运行，写新内容；关闭面板后仍不补笔。操作C：Auto AI设置一个明确停笔间隔，让PenEchoLLM超时／不可用，另做“疑似手势→擦除”。

通过目标：未消费输入解除允许条件后应重新调度；若产品需要暂停，界面明确说明原因，恢复时不能丢触发。Auto AI不依赖PenEchoLLM判定，并在允许执行状态下按用户设置触发；手势不能吞掉或永久悬挂计时器。

9/30本地修复：A已增加忙碌结束时恢复调度，真实setBusy的回归验证无需补笔且不会重复请求；B只读Suggest不再共用自动执行AI的面板暂停条件。3921可在停笔后打开Agent并进入远程读取。真实慢请求／完整C分支仍需单独记录，不能把“未发出”和“请求失败”都归为额度耗尽。

### T05 完整dirty和正确消费（B01）

操作：写hello并成功排序，再在远处／下方写公式；加入>64笔、>30s暂停、移出视口等扩展分支。检查每次发送的图。擦掉一部分再请求；截图准备过程中补笔；Canvas AI请求期间在原区域重叠补笔，成功后再请求。

通过：排序不消费dirty，所有尚未处理输入仍深色完整；擦掉内容不复活。成功AI只清理该请求实际输入，后来补写仍dirty且被下一次捕获。AI输出不变dirty。普通Answer的viewport范围与PenEchoLLM完整dirty范围分别验收。

### T06 位置、悬停、动画和加载（B04、B08）

操作：旧Suggest上保持鼠标悬停，用Pencil／鼠标在上方写；放置分散旧笔迹、已消费笔迹及Widget作障碍，分别100%／45%／17%缩放及pan；最后填满视口。悬停图标，看名称。

通过：每次抬笔先重新定位；有空位时不盖stroke／Widget，密集无空位才选最小遮挡；不跑出工具栏／视口。书写期间回包不能显示工具条。默认只图标，悬停完整名称；原位淡入及排序，无掉落。刷新排名也有加载条，最终排序不被hover无限挡住，Ask草稿不丢。

### T07 Answer、执行器和语义（B12–B15）

操作：用确定性回包把Answer排第一／第二／前两名外／none，检查普通条；点击Answer与手动Canvas AI比较完整请求。结果Next另测。实际模型用hello、简短问答、一步数学，以及需查资料、运行代码或较大交互产物作对照；More／Widget／套索动作也检查执行器。

通过：普通Answer保留前两位，否则第三／末位，与手动入口一致；Next不强插。其他按钮用排序中该动作自己的execution_*，不能借用第一项。短任务走Canvas AI；需多步工具或预计最终内容>3000tokens（不含thinking）走Agent。问候应自然回答，只有要求转写才复述字面。

本地新版Agent扩展：默认输出近源下方且避让实际像素；移动视口／缩放不丢源锚点；位置文案与工具实际bounds一致。必须把真实分类验证和真实生成语义分别记录。

### T08 Widget局部套索（B17）

操作：只圈Widget一角／图片部分，不圈任何笔迹；移动、缩放套索；让Widget内容变化后再次捕获；用不规则多边形圈手写+Widget，检查实际图；关闭、保存、重开。

通过：可从Widget上方开始画套索，工具顺序橡皮擦→套索→T；Widget身份、位置和大小不因选区移动改变，圈选不多占Undo。圈外像素遮罩，控件／选区边框不入图；采用最新Widget内容。Hand仍承担Widget移动／内部交互，专用套索不误进交互。

### T09 显式指令、语言和文档边界（B16、B19）

操作：英文UI，中文输入“套索区域的内容是”，圈住3+2及一小块报告；另做“用英文回答”“仅解释，不求解”。在圈外放同对象的其他财务段落及文档中的指令。提交含Solve按钮的自定义Ask。

通过：实际提交prompt和生成结果跟随明确用户任务、语言要求；中文描述不被按钮变为求解／动画，不扩读圈外源文。单位、时间范围、对象群体保留，缺信息说明或提问；文档里的指令只是材料。静态套索保留时能按要求输出，不需取消选区。模型语义必须用真实受控用例验收，mock只证明宿主传参。

### T10 MCP与普通Agent的选区路径（B18）

操作：活动套索下调用penecho_capture_canvas(target:"selection", quality:"basic")，检查schema和实际handler；再从普通Agent聊天要求描述选区，对比Assist入口发出的蒙版。没有选择时也测试错误提示。

通过目标：selection/basic在协议和运行时一致，真实图只含闭合圈内；无选区返回SELECTION_REQUIRED，准备期间移动／替换／改变路径返回SELECTION_CHANGED。普通聊天不能只凭bounding box宣称看过蒙版。detail现行限制单Widget／显式region，应返回明确DETAIL_TARGET_REQUIRED，不能用region截图声称圈外已遮罩。

9/30本地修复已接通basic选区捕获，调用蒙版渲染、无选区及异步选区变化的回归通过。外部MCP→活动浏览器→实际图片仍待端到端复验。普通Agent默认概览与Assist自动附带蒙版是入口差异，先记录实际工具调用；没有新增自动附带需求时，不以全画布概览本身判为Bug。

### T11 并发编辑、取消和Undo隔离（B20）

操作：依次保持未修改的Widget／图片／动画选中；修改其中一个但不确认；打开新文本草稿或已有文本编辑；延迟图片解码。Agent同时创建独立内容，再取消用户编辑并Undo/Redo Agent；准备期间打开冲突对象的编辑器。

通过：静态选中不锁全Canvas；未提交编辑仅保护对应对象，其余新内容可写。冲突触发OBJECT_EDIT_CONFLICT且不越权；提交时再检查异步期间新锁。用户取消不删Agent独立输出；Agent Undo不提交／撤销用户草稿，无关Widget iframe和交互状态保留。最后确认用户修改，保存重开，两组历史可分别撤销。

### T12 迟到写入和任务归属（B15、B20）

操作：暂停Agent异步写入，随后Undo源笔画、取消／替换套索、停止任务、换会话或换画布，再释放写入。另测本回合steering后继续，以及新回合普通MCP创建。

通过：已失效归属不能降为无锚点普通写入，不能写到其他画布或重新消费旧dirty；任务完成后普通MCP不继承旧源锚点。保留正常steering，不误杀同回合。保存并重开检查没有隐藏的迟到产物。

### T13 busy恢复和有限重试（B19、B21）

操作：保持真实落笔／拖动／resize时尝试空间写入；做legacy extracted-ink选择；让持久锁不变并尝试换写入工具；仅pan/zoom；然后真实结束手势／解除冲突。

通过：瞬态空间写保护仍在，读取和独立安全操作可继续；相同持久busy不会无限换工具重试，界面保留具体原因。只改视口不解锁；真实mutation-state变化后允许恢复，新用户回合可重新尝试。记录工具调用数与结束状态，而不是只看最终有无结果。

### T14 划除删除（B22，本地新版）

操作：划掉一句手写，旁边另有一行；旧保存raster无向量也测。点击Delete后Reject、再试Keep、Undo；Widget中划掉一句文字，保留按钮和其他文字，失败后重试。Suggest关闭作对照。

通过：点击前绝不删除，不出现独立Delete?；擦除只限目标，用正常草稿确认流程，邻近内容保留。Widget身份／位置／交互保留；成功清掉划线，一个Undo恢复源与划线，失败原文和标记都在，Suggest可重试。AI结果后续推荐不再出现Delete；动作空间仍符合上限。

真实语义补测：文字横线、删改涂抹、负号、分数线和强调下划线作正负对照。mock擦除命令通过不能证明真实识别不会误删。

### T15 Next、result裁剪和重复检查（B09–B11）

操作：分别生成文字、原生画笔、Widget和Agent成果，查看新的result请求及图片；Keep、移动、缩放、Undo、重试。用已完成且写有“✓ Correct”的验算结果和需首次验算的新解答对照。

通过：基于实际新产出而非固定action表；结果清晰完整，必要原题／周围上下文完整，背景淡化且不过度扩展；AI结果不变dirty，原样Keep可复用，修改后旧排名失效。完整验算不应循环Check step；模型none时不硬造下一步。

当前约束：最长边≤1024px，完整data URL≤256KiB（含base64），当前结果扩边约15%、32–160Canvas单位。保存最终编码图和previousAction；特别检查原题只有碎片及新验算被裁在边缘的已知样本。

### T16 多题求解与热点校验（B23、B24）

操作：同时写三道未完成算式及一道已完成题，点击Answer求解（历史样本中的Solve）；目标区明确时，截图仍含另一组旧笔迹和旧hotspots。再用套索限定其中两题。

通过：目标内每道未完成题都解，在各自等号后只补新增答案，不重抄、不默认蓝框；不解圈外题。请求动画范围与实际重点一致。所有hotspots应和最终latestInput相交，不能在模型调用前出现内部400。

9/30本地已按最终latestVisible过滤热点，并用服务器实际latestInput映射验证所有保留热点相交。原截图的失败请求仍未绑定，不能据此唯一认定历史400的现场根因。扩展验证保存payload中的latestInput、sourceRect、hotspotGrid和服务端requestId，避免只留错误截图。

### T17 Widget标题栏、编辑关闭和按需Refine（B25、B26）

操作：重叠两个Widget，从前方内容移到标题栏和10px空档，按下／拖动；缩放及窄屏换行再测。Confirm／关闭文本和AI草稿后立即真实落笔。Refine中点击“PenEchoLLM建议”，关闭、重开，制造错误／空结果，键盘操作和自动Suggest关闭也测。

通过：视觉间距保留，命中空档属于前方Widget，不漏到底层；按钮及内部交互可用。下一次落笔无需500/1000ms冷却，点击关闭不误写。Refine默认折叠、明确点击才请求，去重、取消、失败重试、Ask草稿和键盘焦点正确。

### T18 图表方程、历史、保存和导出（B27、B28）

操作：2D输入圆及y=x²；3D输入z=sin(x)cos(y)、x=y²+z²、x²+y²+z²=1；加入a=2滑块，空白／无效／不支持表达式。连续wheel及slider拖动几十次，拖动中保存／导出，再Undo/Redo、关闭重开。长公式和多行公式滚出侧栏后下载PNG。

通过：整行等式可编辑，模式不随删字母跳变；空行不报红，错误不换数学含义静默绘制。连续交互一步Undo，之前笔迹／结果仍可撤销；保存的是当前参数和视角。公式不截断、完整导出；窄屏及45%缩放仍可读。公式可读性与原生优先补画属于更早的持续回归背景，不误计为两天新增Bug。

### T19 真实模型固定样本组（B14、B32–B35）

固定图片、相同裁图、模型版本及推理设置，保留原始响应，至少覆盖：

| 样本 | 语义验收 |
| --- | --- |
| hello／短问答／一步求解 | Canvas AI；回答任务本身 |
| 无文字迷宫、路线、几何构造、最大值标记 | Answer，保留原图并补解；没有明确任务时可澄清 |
| 整理流程／架构图 | Make diagram，避免只靠框箭头的外形分类 |
| 多项式空等号 | Solve优于只Typeset，数学结果正确 |
| 明确draw f(x)=x sin x，旁边旧积分 | 绘图指令优先，不被旧公式抢走 |
| 闭合粗糙圆／真正半圆；完整6+8=／未写完∫x | action与finished完整度合理，不能仅按视觉类别决定任务 |
| 已验算Correct结果／尚未验算解答 | 不重复相同Check step；首次检查仍可推荐 |
| 三城市时钟；城市标签／建筑对照 | 生成三城市可运行时钟或明确询问，不擅自当建筑 |
| 普通人物草图／有明确数学动画指令的图 | 不凭草图盲推数学教学动画 |

medium和max比较时只改推理级别，裁图完全相同；若同时放大图片，拆为独立实验。记录首选、排序、execution_*、finished/kind及最终作品，不把概率等同准确率。跨版本113条审查的5/49错误不能作为新版错误率。

### T20 Scene开放、空结果和幂等性（B29–B31）

操作：普通Canvas AI、Assist→Agent、MCP分别创建motion、physics、3d；暂停、重播、变速、拖动观察、源JSON修改、保存重开。对格式漏json但scene有效、scene无效、完全空commands作控制回包；同3D scene重复规范化两次。

通过：scene参数已开放、源码可编辑、Widget身份和几何保留；播放器控制实际工作。有效场景规范化后可见，无效重试有限且最终明确失败；空画布不得报已生成。filled及颜色不丢。真实效果和确定性传输用例分开。

### T21 契约、格式、超时和恢复（B37–B41）

在隔离服务用合法各模式与非法未知／重复action、跨模式context、越界图片及previousAction测试。WebP、PNG、JPEG、编码回退各测；让上游慢、失败、取消，再恢复唯一连接。

通过：合法新版通过；非法请求不调用模型、不消费额度。总等待预算约12s，重试分享剩余时间，旧配置不放大；超时释放槽、取消后无迟到结果。一次失败不把唯一连接封到5分钟后，后续有效输入仍能尝试。图片编码成功、上限符合要求，小数点／负号／指数清晰。

当前默认走api.penecho.ai。可选Bridge只在明确测试配置里测>7s但未超deadline的回包；不要重启／开启已撤回的Windows常驻桥接。API的两条keepalive复用、失效后补建分别测。

### T22 状态查询、额度和付费容量（B42、B43）

隔离环境组合游客、免费账号、订阅、无余额；多窗口同时查status，服务不可用／未配置／404／401／429／503／离线再联网；通过受控fixture测凭证轮换、失败、取消、成功、缓存和预留过期。

通过：闲置不可用页面不每2s无限轮询；并发查询合并，恢复事件按需检查。普通手动AI／Typeset／Answer不被PenEchoLLM故障挡住。匿名不占满付费容量，限流不能仅凭换token绕过；匿名并发最多4／全局16。失败／取消／过期释放额度预留，成功计一次，缓存不重复收费；旧status不能覆盖新用量，付费预留不当成已消费。429按服务语义恢复，额度用尽停请求并提示清楚。

### T23 JeVision端到端稳定性和故障隔离（B45–B47）

先只读检查Windows模型、网关、Tunnel、主机状态；在已授权的隔离或维护窗口注入单worker断开／挂起、长多题请求与短请求同时到达、客户端取消；无人值守重启另列维护验收。持续观察必须另获用户对时间和监测的授权，本指南不自动创建监控。

通过目标：模型两路和公共入口分别健康；新请求绕过异常worker，长任务不过度挤短任务，恢复后不重复推理／计费。重启后登录前可用才算无人值守通过。保留GPU OOM、容器身份／restart、每路健康、排队／推理／公网总耗时、Tunnel连接及requestId。

指标口径：按相同题数／图片／是否缓存比较p50/p95；健康200不代表真实推理／语义成功。Tunnel失去四连接、HTTP499、模型5xx、用户失败是不同事件；不把分钟采样“全成功”写成秒级无中断。历史公网单题约635–712ms，四项任务更长，500ms目标尚不能保证。

### T24 Cloud登录、会话、默认模型和积分（B48、B49、B51）

操作：UAT可用登录方式，Google已登录一个／多个账号后登录；GitHub按环境配置判断。保持登录、刷新、重连、注销和注销后旧凭证测试；首次无模型选择、已有选择、原模型不可用分别测试；积分13,430.3等在320／390px中英文显示。

通过：已启用OAuth可完成流程；Google若要求选择账户，确实展示chooser，不能只验证重定向。现有session保留，注销能撤销；持久登录不应被测试新增短TTL破坏，Redis容量另记录。首次自动选最小order可用模型，已有选择不被排序覆盖，不可用时要求重选。积分一行完整。

已知：UAT GitHub禁用为配置限制，Google select_account补充验收曾失败，普通session无TTL是用户明确保留的现状；分别记“配置阻塞／失败／已接受约束”。

### T25 1.3.3旧安装包兼容

用真实1.3.3安装包连接UAT：登录、模型／余额、实际AI、项目／画布CRUD、上传下载、断线重连、已有session。新版Suggest接口只对新版测。

通过：旧功能继续可用，无强制更新才能登录／访问原画布。原版没有JeVision/Suggest，不要求新增入口。已有原连接代码隔离通过不足以替代安装包端到端。

### T26 搜索、步骤提示和移除项

两画布建立已索引公式／流程图／文本／Widget，旧笔迹手动Scan，文字／草图搜索并跳转；另origin和设备作范围对照。错误推导2x+3=7→2x=10，正确2x=4对照。关闭Auto AI后，在旧内容上连续画双下划线、圈加问号、小L坐标轴，和普通字母、分数线作笔势正负对照。切自动Suggest、笔势、步骤检查、底部操作提示并刷新。新用户／已保存字体各测；加载含已有InkLab对象的旧文件。

通过：搜索只承诺已有本地索引，扫描24／容量800／结果24边界一致，不声称手写全文或全历史库已扫描；切画布／关闭停止后续扫描。符合条件的非删除笔势给正确操作或建议，普通字母／分数线不误触发；Auto AI开启时笔势只给建议，不抢定时执行权。步骤只给红线和可点击建议，不自动改推导，自动初筛请求可发生。底部提示开关与Suggest独立、持久；新默认Rounded不覆盖已选字体。练字、Smart Auto、InkLab新建、Make 2 objects interactive均不出现，旧对象正常保存／导出／Undo。

### T27 内置CLI模型发现（B50，本地新版／新安装包）

操作：已登录用户的新会话查看Codex模型列表和gpt-6.1-sol选择，已存在的CLI解析缓存也测；桌面新包再次检查，真实推理另列。

通过：使用预期私有CLI版本和路径，模型发现及会话启动正常，登录保留。0.159.1的本地升级不能作为未重新打包桌面安装包已通过的证据。

### T28 发布完整性和迁移（B38、B44）

检查Git已跟踪源的必要文件、官方生成产物和两个Cloud镜像的provenance；隔离库执行087/088/089，检查NOT VALID→独立验证及持续写入／锁等待。用冻结的canonical输入重建并对照资源哈希；部署后重新验证mode/action、session／画布保留及本地和公网资产。

通过：交付不依赖仅外部临时目录／未跟踪代码；Cloud独立服务文件保留；官方镜像一致。数据库约束有效且迁移边界可说明，发布新后端后旧进程问题消失。提交、推送、部署和验证脚本提交分别记录；不得用旧UAT核心PASS掩盖最新本地修改未验收或OAuth失败。

### T29 登录保持与UAT设备连接（B36、B48、B49）

操作：确认3921的cloudEnvironment为uat、origin为internaltest.penecho.ai；打开账号菜单，检查设备连接、登录账号及模型权限。刷新后再次访问已保存画布并发出真实Suggest请求。用独立测试会话另验重新登录、退出和重新连接；Google／GitHub分别记录，不退出正在使用的主账号来替代独立会话。

通过：登录和设备连接状态一致，刷新保留会话，授权请求能到UAT；退出后的凭证撤销，其他正常会话保持。普通session无TTL是已接受约束，不要求人为过期。

本轮：既有登录保持、设备连接和真实UAT请求PASS；临时Redis会话持久化／撤销集成PASS。独立UAT页面导航被测试浏览器ERR_BLOCKED_BY_CLIENT阻止，重新输入凭证／OAuth未执行，不能写成重新登录PASS。历史GitHub配置禁用及Google账号选择问题仍按B48记录。

### T30 添加和选择连接（旧功能）

操作：在Settings添加独立测试Codex连接；检测CLI路径／版本，选模型及推理级别，执行真实图片测试，保存并选择新连接。取消未保存表单也检查。完成后回选原连接，移除本轮临时连接并对照原连接列表；不得删除或覆盖原配置。

通过：检测、测试、保存、选择均可完成，模型与推理级别保留；错误路径应具体提示，不能生成看似成功但不可用的连接。原有连接内容完整，新连接不影响其他提供商。编辑及失败路径属扩展分支，分别记录。

本轮基础分支PASS：9→10条，真实图片测试成功，保存／选择后可执行Agent与Canvas AI；清理后恢复9条，原连接数据比对完全一致。错误路径及完整编辑分支未执行。

### T31 Codex CLI、Agent与Canvas AI（B50、B52）

操作：使用T30连接进行真实图片理解测试；Agent在独立画布添加明确文本，保留已有内容，分别Undo／Redo。普通Canvas AI解2+2、2+3等可判定的小题；点击草稿本体Keep、再Undo／Redo并保存。特别覆盖输出很窄、靠左右边缘的草稿，检查Keep与Copy命中区域。

通过：真实CLI返回正确结果，Agent成功产生实际画布内容，停止及Undo／Redo状态清晰；普通Canvas AI结果可确认，Keep不会触发Copy，撤销恢复草稿，重做再次确认。模型gpt-6.1-sol与版本0.159.1的本地结果不能替代桌面新安装包验收。

本轮基础分支PASS；B52已从实际页面复现并修复，第二次真实2+3输出直接Keep→Undo→Redo→保存→关闭重开通过。CLI故障注入、安装包和其他提供商另列。

### T32 新建、保存、关闭、重开画布（旧功能）

操作：新建独立命名画布，添加文本／笔迹，等待Saved；另建空白画布，切回原画布。关闭原画布，在Recent搜索确认Not open，再打开并检查原内容；刷新后从Recent再开。Agent输出与已确认AI输出分别保存、关闭、重开。Undo／Redo在关闭前验收，持久化内容在重开后验收。

通过：命名及内容持久化，关闭只改变打开状态；搜索和重开能找到已保存画布，不混入另一画布的内容。当前启动流程不会自动恢复原活动画布，刷新后的空白入口本身不代表数据丢失，应以Recent重开后的内容判断。

本轮基础分支PASS；独立测试画布的文本、Agent新增内容及已确认AI结果均完成相应保存／切换／关闭重开检查。云端上传下载、跨设备同步和极端断电不是本用例的基础PASS范围。

## 开发者快速验证入口

以下是按模块执行的命令参考。9/30本轮已运行完整Canvas／Cloud检查和6项必需数据库集成；扩展浏览器、设备与模型用例不由这些结果代替。运行前确认当前Node和依赖，以及测试是否需要隔离数据库；不使用现有生产数据。测试失败应看具体assertion／fixture／应用错误，不能仅因旧报告通过就忽略。

在canonical Canvas目录：

```bash
npm run check:client
node --test test/smart-suggest.test.js test/suggest-runtime.test.js test/suggest-placement.test.js test/pen-intelligence.test.js test/suggestion-status-recovery.test.js
node --test test/assist-agent-routing.test.js test/assist-agent-context.test.js test/assist-request-fidelity.test.js test/suggest-delete.test.js
node --test test/canvas-agent-mutation-state.test.js test/canvas-agent-concurrent-history.test.js test/canvas-agent-busy-recovery.test.js test/canvas-agent-busy-stop-integration.test.js
node --test test/graph-equations.test.js test/graph-interaction-history.test.js test/ai-request-errors.test.js
node --test test/capture-selection-hotspots.test.js
npm run check
```

在Cloud目录，只读镜像检查及服务单元测试：

```bash
node tools/sync-public-canvas.mjs --source=/Users/heack/workspace/penecho_071_version --check
node tools/sync-canvas-agent-runtime.mjs --source=/Users/heack/workspace/penecho_071_version --check
node --test test/penecho-llm-contract.test.mjs test/penecho-llm-access.test.mjs test/penecho-llm-guard.test.mjs test/jevision.test.mjs test/jevision-usage.test.mjs test/jevision-bridge.test.mjs
npm run check
```

PostgreSQL／Redis真实集成使用既有fixture配置：`penecho-llm-admission.integration.test.mjs`、`penecho-llm-postgres.integration.test.mjs`、`sessions-redis.integration.test.mjs`。没有数据库而skip应记“未验证”，不算通过。

本轮增加两个canonical验证入口，运行目录为Canvas。前者通过3921向UAT提交内置合成图片并验证第二次命中缓存；后者创建随机loopback端口的临时PostgreSQL／Redis，仅执行上述6项必需集成，完成后清理自己的容器。运行前确认本地Docker和对应官方镜像可用。

```bash
node scripts/verify-basic-uat-services.cjs
node scripts/verify-basic-cloud-integrations.cjs
```

浏览器验收已有canonical脚本可复用：`verify-assist-source-placement.cjs`、`verify-assist-lasso-request.cjs`、`verify-assist-edit-concurrency.cjs`、`verify-suggest-delete.cjs`、`verify-graph-interaction-history.cjs`。先阅读对应验证README／脚本参数，使用独立输出目录和profile；`--cloud`是本地同步Cloud客户端模式，不代表实际UAT。完整发布才执行项目规定的全套检查。

## 结果记录与放行标准

每个用例记录PASS／FAIL／BLOCKED／NOT RUN。“旧版本缺功能”“未配置测试库”“无实体设备”用BLOCKED或NOT RUN，不写PASS。

| 字段 | 记录内容 |
| --- | --- |
| 用例／Bug ID | 如T04／B05 |
| 时间与环境 | 北京时间、URL、客户端／浏览器／输入设备 |
| 版本 | Canvas、Cloud、前端hash、模型／checkpoint／推理级别 |
| 前置条件 | 开关、账号档位、dirty／selection／draft／busy状态 |
| 操作与预期 | 精确到最后一笔、点击、等待和回包时机 |
| 实际结果 | 是否发出／HTTP结果／页面是否应用／实际产物 |
| 证据 | requestId、去敏日志、实际上传图、截图／录像、时序和Undo前后 |
| 结论 | PASS／FAIL／BLOCKED／NOT RUN；根因已确认或仅假设 |
| 回归范围 | 失败影响的入口、同根其他用例及目标版本 |

放行至少要求：目标版本的冒烟完成；不丢输入、不误删、不跨文档迟到写入、Undo隔离和合法契约通过；12s等待及取消／额度恢复可验证；已知开放问题有明确结果与发布决定。所有模型语义、实体设备、OAuth、负载和无人值守测试单列，不能由mock或旧版本全套结果替代。
