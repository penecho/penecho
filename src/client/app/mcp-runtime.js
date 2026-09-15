  // External MCP sessions share Canvas primitives, but never an Agent conversation.
  var mcpRuntime = { socket:null, browserId:null, wanted:false, reconnectTimer:0, reconnectStatusTimer:0, reconnectAt:0, reconnecting:false, reconnectDelay:1000, generation:0, sessions:new Map(), previews:new Map(), controllers:new Map(), queue:Promise.resolve(), queued:0, status:null, loading:null, loadError:null, configuring:false, configureResult:null, feedbackSequence:0, feedback:[], ready:false, connectionLost:false, authRequired:false, heartbeatTimer:0, heartbeatSupported:false, catalogSupported:false, catalogSignature:"", lastPong:0, activeMutation:null, mutationDocumentId:null, glowTimer:0, glowing:false, pendingView:new Map(), viewSequence:0, layoutTimer:0, layoutSince:0, viewPaused:false, exampleStatusTimer:0 };
  const mcpCopy = {
    keepAwake:["Keep awake while MCP is connected","MCP 连接时保持唤醒"],
    keepAwakeHelp:["Optional. In a browser, keep this tab visible. Your device may still suspend.","可选。浏览器中请保持此标签页可见；设备仍可能进入休眠。"],
    troubleshoot:["Troubleshoot","Troubleshoot"],
    troubleshootHeading:["Allow MCP inbound connections","允许 MCP 入站连接"],
    troubleshootHelp:["If PenEcho works on the host but other computers cannot connect, send the prompt below to an Agent on the host to allow the required inbound TCP ports.","如果 PenEcho 在主机上可用，但其他电脑无法连接，请将下方提示词发给主机上的 Agent，开放所需的 TCP 入站端口。"],
    troubleshootStepNetwork:["Keep PenEcho running on the Windows host. Both computers should be on the same trusted private network.","保持 Windows 主机上的 PenEcho 运行，确认两台电脑处于同一可信专用网络。"],
    troubleshootStepPrompt:["Copy the prompt below and send it to an Agent on the PenEcho host.","复制下方提示词，发给运行 PenEcho 的主机上的 Agent。"],
    troubleshootStepRetry:["Reconnect from your AI client after the inbound ports are open.","开放入站端口后，从 AI 客户端重新连接。"],
    copyTroubleshootPrompt:["Copy troubleshooting prompt","复制排查提示词"],
    listenerAddresses:["Current MCP listening addresses: {addresses}","当前 MCP 监听地址：{addresses}"],
    listenerLoading:["Current MCP listening addresses: loading…","当前 MCP 监听地址：正在获取…"],
    listenerUnavailable:["Current MCP listening addresses: unavailable","当前 MCP 监听地址：暂不可用"],
    troubleshootCopying:["Copying…","正在复制…"],
    troubleshootCopyFailed:["Could not copy. Check clipboard permission and try again.","复制失败，请检查剪贴板权限后重试。"],
    troubleshootPromptCopied:["Prompt copied","提示词已复制"],
    certificateInvalid:["Connection certificate needs repair. Reset it, then copy a new setup prompt.","连接证书需要修复。请重置证书后重新复制配置指引。"],
    certificate:["Connection certificate","连接证书"],
    certificateHelp:["Saved automatically, including after restart. Usually no reset is needed.","自动保存，重启后继续使用。通常无需重置。"],
    certificateReset:["Reset connection certificate…","重置连接证书…"],
    certificateResetTitle:["Reset connection certificate?","重置连接证书？"],
    certificateResetHelp:["Agents on other computers will disconnect. Copy the new setup prompt and send it to each previously connected Agent to update its configuration.","其他电脑上的 Agent 将断开连接。请重新复制配置指引，发给之前连接过的每台电脑上的 Agent 更新配置。"],
    certificateResetNote:["All configured Agents need the new certificate and connection key. Normal restarts do not need a reset.","已配置的所有 Agent 都需要更新证书与连接密钥。正常重启无需重置。"],
    certificateResetConfirm:["Reset certificate","重置证书"],cancel:["Cancel","取消"],
    certificateChanged:["Certificate reset. Copy the new setup prompt for every previously connected computer.","证书已重置。请复制新的配置指引，为之前连接过的每台电脑更新配置。"],
    certificateCopyNew:["Copy new setup prompt","复制新的配置指引"],
    certificateCopied:["Copied. Send it to each previously connected Agent to update its certificate.","已复制。请发给之前连接过的各个 Agent，更新连接证书。"],

    lanBusy:["Updating connection…","正在更新连接…"],lanDisabled:["LAN connection is off.","局域网连接已关闭。"],
    lanOpenFirst:["Open MCP above to connect another computer.","先在上方开放 MCP，即可连接局域网其他电脑。"],
    lanNoAddress:["No LAN address is available. Check your network connection.","未找到局域网地址，请检查网络连接。"],
    lanFailed:["Could not update LAN access. Check the connection and retry.","未能更新局域网连接，请检查连接后重试。"],

    checkingSetup:["Checking MCP setup…","正在检查 MCP 配置…"],
    toolbarSetup:["Set up MCP Server","配置 MCP Server"],
    toolbarOpen:["Make canvases discoverable to external AI","允许外部 AI 发现并编辑画布"],
    toolbarClose:["Turn off MCP discovery","关闭 MCP 开放"],
    retryCountdown:["MCP retry in {seconds}s · Cancel","MCP 将在 {seconds} 秒后重试 · 取消"],
    retryConnecting:["MCP reconnecting… · Cancel","MCP 正在重连… · 取消"],
    toolbarCancelRetry:["MCP retry active. Click MCP Server to cancel.","MCP 自动重试中。点击 MCP Server 可取消。"],
    toolbarRetry:["Connection failed. Click MCP Server to retry.","连接失败。点击 MCP Server 重试。"],
    cloudSignInRequired:["Cloud session expired. Sign in again, then reopen MCP.","Cloud 登录已过期。重新登录后，再开启 MCP。"],
    nav:["MCP service","MCP 服务"], eyebrow:["MCP Service","MCP 服务"], heading:["Connect your AI Agent", "连接你的 AI Agent"],
    canvasNotice:["MCP connected · AI can update this canvas","MCP 已连接 · AI 可更新此画布"],
    canvasCloudLocal:["MCP · Cloud + Local online","MCP · 云端与本地在线"],
    canvasCloud:["MCP · Cloud online","MCP · 云端在线"],
    canvasLocal:["MCP · Local online","MCP · 本地在线"],
    canvasConnecting:["MCP · Connecting…","MCP · 连接中…"],
    canvasLost:["MCP connection lost","MCP 连接已断开"],
    canvasApplying:["is updating the canvas…","正在更新画布…"],
    canvasSessions:["sessions","个会话"],
    canvasSession:["session","个会话"],
    newContent:["Show new content","查看新内容"],
    lastUpdate:["Last update","最近更新"],
    canvasNoticeHelp:["Open MCP settings to manage or turn off access to this canvas.","打开 MCP 设置，管理或关闭对此画布的访问。"],
    description:["Works with Codex, Claude Code, OpenCode, Pi and other MCP clients.", "支持 Codex、Claude Code、OpenCode、Pi 等 MCP 客户端。"],
    enable:["Make workspace discoverable", "开放空间工作区"],
    accessHelp:["Connected clients can find and open your Device, Server and connected Cloud canvases, read their content, and edit the Canvas bound to a conversation. Images are captured on request. Turn this off to disconnect all external sessions.","外部客户端可查找并打开本设备、Server 和已连接 Cloud 中的画布，读取内容，并编辑对话绑定的画布。截图按需获取。关闭后会断开全部外部会话。"],
    stepOpen:["Open your workspace","开放你的工作区"],
    stepOpenHint:["Connected AI can read and edit your canvases, and open Device, Server and Cloud documents.","连接的 AI 可以读取和编辑你的画布，也能打开本设备、Server 与 Cloud 中的文档。"],
    stepOpenNote:["Turning this off disconnects all external sessions.","关闭后会断开全部外部会话。"],
    setup:["CLI on this computer", "这台电脑上的 CLI"],refresh:["Check again", "重新检查"],
    setupHint:["Select a terminal CLI client for one-click setup. For desktop apps, use the setup prompt below.","选择终端 CLI 客户端进行一键配置。桌面应用请使用下方配置指引。"],
    clientCodexHint:["Terminal AI client","终端 AI 客户端"],
    clientClaudeHint:["Terminal AI client","终端 AI 客户端"],
    clientOtherHint:["OpenCode / Pi / other CLI clients","OpenCode / Pi / 其他 CLI 客户端"],
    configure:["Auto configure", "自动配置"],copyInstructions:["Copy setup prompt", "复制配置指引"],
    session:["Start your Spatial Workspace","开始使用 Spatial Workspace"],
    sessionHint:["Copy the prompt, close Settings, and check that the MCP indicator on the right of the toolbar is green. Send it to your external Agent to start.","复制提示词后关闭设置，确认工具栏右侧的 MCP 亮绿灯，再发给外部 Agent 即可开始。"],
    starterTitle:["Start with your current task","从当前任务开始"],
    starterPrompt:["Use PenEcho as our spatial workspace for this task. Show the work with useful diagrams or an interactive view, and revise it from my feedback.","把当前任务放到 PenEcho 空间工作区，用合适的图示或交互界面展示，并根据我的反馈继续修改。"],
    morePrompts:["More examples","更多示例"],
    copyPrompt:["Copy prompt","复制提示词"],exampleCopied:["Prompt copied","提示词已复制"],
    exampleDesignTitle:["Three design options","三个设计方案"],
    exampleDesignPrompt:["Echo this UI idea in PenEcho with three design options, then let me choose.", "帮我 echo 一下这个界面想法，在 PenEcho 上展示三个方案，让我选择。"],
    exampleArchTitle:["Compare architectures","新旧架构对比"],
    exampleArchPrompt:["Compare the old and new architecture as a diagram on canvas.", "把新旧架构的对比放到 canvas 上，用图形展示差异。"],
    exampleWidgetTitle:["Handwriting to Widget","手写内容转 Widget"],
    exampleWidgetPrompt:["Turn the handwriting on this canvas into an interactive Widget.", "把当前画布上的手写内容整理成一个可交互的 Widget。"],
    exampleFolderTitle:["Show a folder","展示文件夹内容"],
    exampleFolderPrompt:["PenEcho the current folder’s architecture as a diagram.", "帮我 penecho 一下当前文件夹的架构。"],
    exampleCodeTitle:["Echo code changes","改代码并回显重点"],
    exampleCodePrompt:["Put your proposed code changes on canvas for review, then echo the implemented changes.", "把你要做的代码修改放到 canvas 上供我确认，完成后 echo 一下重点改动。"],
    exampleFeedbackTitle:["Revise from feedback","根据界面反馈修改"],
    exampleFeedbackPrompt:["Read my latest feedback and annotations on the current PenEcho canvas, then revise the existing UI in place.","读取我在当前 PenEcho 画布上的最新反馈和批注，根据这些反馈修改现有界面。"],
    setupPromptLabel:["Setup prompt","配置提示词"],
    manualSteps:["Open a conversation in the AI app you want to connect. Copy the prompt below, paste it into that conversation and send it. Keep PenEcho running with MCP enabled; another computer must be on the same network.","在需要连接的 AI 应用中打开对话。复制下面的提示词，粘贴到对话中并发送。保持 PenEcho 运行并开启 MCP；另一台电脑需在同一局域网。"],
    remoteManualSteps:["On the computer running PenEcho, open Settings → MCP service. Select Codex CLI or Claude Code CLI and choose Auto configure; for another Agent, copy the setup prompt below and send it to that Agent. Reload the client, then return here and open your workspace.","在运行 PenEcho 的电脑上打开 Settings → MCP 服务。选择 Codex CLI 或 Claude Code CLI 并点击自动配置；其他 Agent 使用下方的复制配置指引。重载客户端后，回到此页面开放工作区。"],
    capDrawTitle:["Draw & annotate","绘图与批注"],capDrawHint:["Diagrams, notes and sketches","关系图、笔记与草图"],
    capPlotTitle:["Plots & Widgets","函数图与 Widget"],capPlotHint:["Curves and interactive UI","曲线与交互界面"],
    capCaptureTitle:["Capture on request","按需截图"],capCaptureHint:["Screenshots only when asked","仅在你要求时截图"],
    manual:["Connect with a setup prompt", "通过配置指引连接"],manualHint:["Works with the CLI clients above, desktop apps and other MCP-compatible clients, including Codex, Claude, OpenCode, Zcode, Hermes, Kimi and others. Copy the setup prompt to your Agent.","上方 CLI、桌面应用及其他支持 MCP 的客户端均可使用，包括 Codex、Claude、OpenCode、Zcode、Hermes、Kimi 等。将配置指引复制给 Agent 即可开始。"],

    how:["How to use it","如何使用"],
    howHelp:["Ask your AI to show useful work and revise it from your feedback. Use lightweight drawings for text and diagrams, function plots for curves, and Widgets for interactive UI. Request a screenshot when checking a design. Progress updates do not call another model or take screenshots.","让 AI 展示有用的成果，并结合你的反馈继续修改。文字和关系图使用轻量绘图，曲线使用函数图，交互 UI 使用 Widget。检查设计时再获取截图。进度更新不调用额外模型，也不生成截图。"],
    thoughtHelp:["Shows the AI’s shared plans, decisions and results. Session updates are supplied by the external AI client.","展示 AI 分享的计划、决策和结果。会话更新由外部 AI 客户端主动提供。"],
    connected:["Discoverable · AI can connect", "已可被发现 · AI 可连接"], disconnected:["Not discoverable", "未开放"],connecting:["Opening MCP Server…", "正在开放 MCP Server…"],
    localOnly:["Open an editable Canvas to enable MCP. Read-only viewers cannot register.","请打开可编辑画布以启用 MCP。只读查看页不能注册。"],
    copied:["Copied","已复制"],configured:["Reload your AI client to finish.", "重载 AI 客户端即可完成。"],
    loadingConfig:["Loading connection configuration…","正在加载连接配置…"],
    configuring:["Configuring…","正在配置…"],
    configurePending:["Saving the MCP configuration. This may take up to 20 seconds.","正在保存 MCP 配置，可能需要约 20 秒。"],
    configureUpdated:["Configuration updated","配置已更新"],
    configureUpdatedHelp:["Updated to this PenEcho program. Reload your AI client to use it.","已更新为当前 PenEcho 程序的配置。重载 AI 客户端后生效。"],
    configureTrust:["Configuration saved · certificate setup required","配置已保存 · 需要完成证书设置"],
    configureTrustHelp:["Copy the setup prompt below to your Agent to trust this certificate, reload MCP and verify the connection.","将下方配置指引发给 Agent，完成证书信任、重载 MCP 并验证连接。"],
    configureSaved:["Configuration saved","配置已保存"],
    configureExisting:["Existing configuration found · not verified","已发现已有配置 · 尚未验证"],
    configureExistingHelp:["No changes were made. Reload this AI client and check for PenEcho tools. If they are unavailable, compare its existing entry with Manual configuration below.","本次未修改配置。请重新加载此 AI 客户端，检查是否出现 PenEcho 工具；若未出现，请对照下方“手动配置”检查已有条目。"],
    configureFailed:["Automatic configuration failed","自动配置失败"],
    configureFailedHelp:["Retry, or copy the setup prompt below and send it to your Agent.","请重试，或复制下方的配置指引，发给你的 Agent。"],
    configureUncertain:["Configuration result not confirmed","配置结果尚未确认"],
    configureUncertainHelp:["The request did not finish. Check the AI client's PenEcho entry before retrying; it may already have been saved.","请求未完成。重试前请检查 AI 客户端中的 PenEcho 条目，配置可能已经保存。"],
    loadFailed:["Could not load configuration. Select Check again.","未能加载配置。请点击“重新检查”。"],
    serviceOutdated:["This running PenEcho service has no usable MCP configuration. Restart PenEcho to load the updated service, then check again.","当前运行的 PenEcho 服务未提供有效的 MCP 配置。请重启 PenEcho 以加载更新后的服务，然后重新检查。"],
    hostRequired:["Configure MCP on the computer running PenEcho. Other devices can view the canvas but cannot configure its local AI clients.","请在运行 PenEcho 的电脑上配置 MCP。其他设备可以查看画布，但不能配置这台电脑的 AI 客户端。"],
    remoteSetup:["Auto configure is available on the computer running PenEcho. To connect an Agent on this computer, use the setup prompt below.","自动配置需要在运行 PenEcho 的电脑上使用。连接此电脑上的 Agent，请使用下方配置提示词。"],
    deviceRequired:["MCP needs a linked device. Go to Linked Devices to connect a computer running PenEcho.","MCP 需要关联设备。请前往「连接设备」，连接运行 PenEcho 的电脑。"],
    deviceOffline:["Linked Device is unavailable. Open Linked Devices to reconnect, then retry MCP.","Linked Device 不可用。请前往「连接设备」恢复连接后重试 MCP。"],
    deviceUpdate:["Update PenEcho on the linked computer to enable MCP, then retry.","请更新已连接电脑上的 PenEcho，再重试 MCP。"],
    accessDenied:["MCP access was refused. On the PenEcho computer, try its localhost address, or refresh and unlock this page before checking again.","MCP 访问被拒绝。请在 PenEcho 所在电脑尝试 localhost 地址，或刷新并解锁页面后重新检查。"],
    focus:["Show","定位"],working:["Working","进行中"],waiting:["Waiting","等待中"],done:["Done","已完成"],error:["Needs attention","需要处理"],
  };
  function mcpText(key) { return mcpCopy[key]?.[state.language === "zh" ? 1 : 0] || key; }
  function mcpEl(id) { return document.getElementById(id); }
  const mcpClientInputs = [...document.querySelectorAll('input[name="mcpClient"]')];
  function mcpSelectedClient() { return mcpClientInputs.find(input=>input.checked)?.value || "codex"; }
  function mcpLocal() { return window.PENECHO_CONFIG?.runtime !== "viewer"; }
  function mcpCanCopySetup() { return window.PENECHO_CONFIG?.runtime !== "cloud" && !!mcpLanInstructions() && (mcpRemoteBrowser() ? mcpRuntime.status?.canCopyLanSetup === true : !!mcpRuntime.status?.config); }
  function mcpRemoteBrowser() { return window.PENECHO_CONFIG?.runtime === "cloud" || mcpRuntime.status?.canConfigureLocalClients === false; }
  const MCP_BROWSER_CALL_DEADLINE_MS = 44_000;
  function mcpExecutionAbortError(signal) {
    const reason=signal?.reason;
    if(reason instanceof Error&&typeof reason.code==="string")return reason;
    return Object.assign(Error("The MCP Canvas operation was cancelled."),{code:"REQUEST_CANCELLED"});
  }
  function mcpWaitForExecution(promise,execution) {
    const signal=execution.controller.signal;
    if(signal.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(mcpExecutionAbortError(signal));}
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(mcpExecutionAbortError(signal));
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
      Promise.resolve(promise).then(
        value=>{signal.removeEventListener("abort",abort);resolve(value);},
        error=>{signal.removeEventListener("abort",abort);reject(error);},
      );
    });
  }
  function mcpExecutionCurrent(execution) {
    return execution.socket === mcpRuntime.socket && execution.socket?.readyState === WebSocket.OPEN
      && execution.generation === mcpRuntime.generation && !execution.controller.signal.aborted
      && (typeof canvasDocuments==="undefined" || !execution.documentId || execution.documentEpoch===canvasDocuments.epoch)
      && (!execution.activeDocumentId || typeof canvasDocuments==="undefined" || execution.activeDocumentId===canvasDocuments.activeId);
  }
  function mcpOpenCanvasCatalog() {
    return typeof canvasDocumentsCatalog==="function"?canvasDocumentsCatalog():[];
  }
  function mcpPublishCanvasCatalog(force=false) {
    const socket=mcpRuntime.socket;
    if(!socket||socket.readyState!==WebSocket.OPEN||!mcpRuntime.catalogSupported)return;
    const documents=mcpOpenCanvasCatalog(),signature=JSON.stringify(documents);
    if(!socket||socket.readyState!==WebSocket.OPEN||!mcpRuntime.catalogSupported||!force&&signature===mcpRuntime.catalogSignature)return;
    socket.send(JSON.stringify({type:"catalog",documents}));mcpRuntime.catalogSignature=signature;
  }
  function mcpKeepAwakeEnabled() {
    try{return localStorage.getItem("penecho-mcp-keep-awake")==="true";}catch{return false;}
  }
  function mcpReleaseWakeLock() {
    mcpRuntime.wakeGeneration=(mcpRuntime.wakeGeneration||0)+1;
    const lock=mcpRuntime.wakeLock;mcpRuntime.wakeLock=null;
    if(lock)Promise.resolve(lock.release()).catch(()=>{});
    if(mcpRuntime.desktopAwake){mcpRuntime.desktopAwake=false;Promise.resolve(window.penechoDesktop?.setMcpKeepAwake?.(false)).catch(()=>{});}
  }
  async function mcpSyncWakeLock() {
    const connected=mcpKeepAwakeEnabled()&&mcpRuntime.wanted&&mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN;
    if(!connected){mcpReleaseWakeLock();return;}
    if(window.penechoDesktop?.setMcpKeepAwake) {
      if(mcpRuntime.desktopWakeRequest)return;
      mcpRuntime.desktopAwake=true;
      const generation=mcpRuntime.wakeGeneration||0;
      const request=Promise.resolve().then(()=>{if(generation===(mcpRuntime.wakeGeneration||0)&&mcpRuntime.desktopAwake)return window.penechoDesktop.setMcpKeepAwake(true);});mcpRuntime.desktopWakeRequest=request;
      try{await request;}catch{}finally{if(mcpRuntime.desktopWakeRequest===request)mcpRuntime.desktopWakeRequest=null;}
      return;
    }
    if(document.hidden){mcpReleaseWakeLock();return;}
    if(mcpRuntime.wakeLock||mcpRuntime.wakeRequest||!globalThis.navigator?.wakeLock?.request)return;
    const generation=mcpRuntime.wakeGeneration||0;
    const request=Promise.resolve().then(()=>navigator.wakeLock.request("screen"));mcpRuntime.wakeRequest=request;
    try {
      const lock=await request;
      if(generation!==(mcpRuntime.wakeGeneration||0)||document.hidden||!mcpKeepAwakeEnabled()||!mcpRuntime.wanted||!mcpRuntime.ready){await lock.release();return;}
      mcpRuntime.wakeLock=lock;
      lock.addEventListener("release",()=>{if(mcpRuntime.wakeLock===lock)mcpRuntime.wakeLock=null;},{once:true});
    }catch{}finally{if(mcpRuntime.wakeRequest===request)mcpRuntime.wakeRequest=null;}
  }
  function mcpDisconnect(lost=false) {
    if(!mcpRuntime)return;
    if(typeof mcpReleaseWakeLock==="function")mcpReleaseWakeLock();
    clearTimeout(mcpRuntime.reconnectTimer);mcpRuntime.reconnectTimer=0;
    clearTimeout(mcpRuntime.reconnectStatusTimer);mcpRuntime.reconnectStatusTimer=0;mcpRuntime.reconnectAt=0;
    if(!lost){mcpRuntime.wanted=false;mcpRuntime.reconnecting=false;}
    if(typeof canvasDocuments!=="undefined"&&canvasDocuments.activeId) {
      const active=canvasDocumentsCurrent();active.feedback=mcpRuntime.feedback;active.feedbackSequence=mcpRuntime.feedbackSequence;
      for(const doc of canvasDocuments.records.values()){const saved=canvasDocumentsWorkspaceData(doc);doc.sessions=saved.sessions;doc.internalSessions=saved.internalSessions||[];}
      canvasDocumentsSyncExtension(active);
    }
    mcpRuntime.generation++;
    clearTimeout(mcpRuntime.layoutTimer);mcpRuntime.layoutTimer=0;mcpRuntime.layoutSince=0;
    for(const [id] of mcpRuntime.pendingView)if(!mcpRuntime.sessions.get(id)?.internalAgent)mcpRuntime.pendingView.delete(id);
    if(!mcpRuntime.pendingView.size)mcpRuntime.viewPaused=false;
    clearTimeout(mcpRuntime.heartbeatTimer);clearTimeout(mcpRuntime.glowTimer);
    mcpRuntime.heartbeatTimer=0;mcpRuntime.glowTimer=0;mcpRuntime.ready=false;mcpRuntime.heartbeatSupported=false;mcpRuntime.catalogSupported=false;mcpRuntime.catalogSignature="";mcpRuntime.connectionLost=lost;mcpRuntime.activeMutation=null;mcpRuntime.mutationDocumentId=null;mcpRuntime.glowing=false;
    for (const controller of mcpRuntime.controllers.values()) controller.abort();
    mcpRuntime.controllers.clear();
    // A retired connection may still be unwinding an asynchronous operation.
    // Its generation guards revoke writes; new calls need their own queue.
    mcpRuntime.queue=Promise.resolve();mcpRuntime.queued=0;
    for(const [id,widget] of mcpRuntime.previews)if(!widget.internalAgent){unmountWidget(widget);mcpRuntime.previews.delete(id);}
    const socket=mcpRuntime.socket; mcpRuntime.socket=null; socket?.close();
    for(const [id,session] of mcpRuntime.sessions)if(!session.internalAgent)mcpRuntime.sessions.delete(id);
    if(!mcpRuntime.sessions.size)mcpRuntime.feedback=[];
    if(mcpRuntime.pendingView.size&&!mcpRuntime.viewPaused)mcpRuntime.layoutTimer=setTimeout(()=>mcpFlushView(false),900);
    if(lost&&mcpRuntime.wanted){const delay=mcpRuntime.reconnectDelay||1000,generation=mcpRuntime.generation;mcpRuntime.reconnectDelay=Math.min(delay*2,10000);mcpRuntime.reconnecting=true;mcpRuntime.reconnectAt=Date.now()+delay;mcpRuntime.reconnectTimer=setTimeout(()=>{if(generation!==mcpRuntime.generation)return;mcpRuntime.reconnectTimer=0;if(mcpRuntime.wanted){try{mcpConnect(true);}catch{mcpDisconnect(true);}}},delay);}
    mcpRenderSettings();
    if(mcpRuntime.toolbarManaged&&(!mcpRuntime.toolbarPending||lost))setStatus(mcpText(lost?(mcpRuntime.wanted?"toolbarCancelRetry":"toolbarRetry"):"disconnected"));
  }
  function mcpDisposeSession(sessionId) {
    const session=mcpRuntime.sessions.get(sessionId);
    if(!session||session.internalAgent)return;
    const doc=typeof canvasDocuments!=="undefined"?canvasDocuments.records.get(session.documentId):null;
    if(doc){const workspace=canvasDocumentsWorkspaceData(doc);doc.sessions=workspace.sessions;doc.internalSessions=workspace.internalSessions||[];}
    mcpRuntime.pendingView.delete(sessionId);
    mcpRuntime.sessions.delete(sessionId);
    if(doc){canvasDocumentsSyncExtension(doc);if(!canvasDocumentsIsActive(doc))void canvasDocumentsPersist(doc).catch(error=>canvasDocumentsReport(error,()=>canvasDocumentsPersist(doc)));}
    mcpRenderSettings();
  }
  function mcpAccessLabel() {
    const connected=mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN,
      availability=mcpRuntime.socket?.availability||{cloud:connected&&window.PENECHO_CONFIG?.runtime==="cloud",local:connected&&window.PENECHO_CONFIG?.runtime!=="cloud"};
    return mcpText(availability.cloud&&availability.local?"canvasCloudLocal":availability.cloud?"canvasCloud":availability.local?"canvasLocal":"canvasConnecting");
  }
  function mcpRenderCanvasStatus() {
    const connected=mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN,
      sessions=[...mcpRuntime.sessions.values()].filter(session=>!session.internalAgent&&!session.closed&&mcpSessionVisible(session)),
      clients=[...new Set(sessions.map(session=>session.client||"AI"))],
      mutationVisible=!mcpRuntime.mutationDocumentId||typeof canvasDocuments==="undefined"||mcpRuntime.mutationDocumentId===canvasDocuments.activeId,
      notice=mcpEl("mcpCanvasNotice"),ring=mcpEl("mcpCanvasRing"),button=mcpEl("mcpCanvasNoticeButton"),
      newButton=mcpEl("mcpShowNewContent"),count=[...mcpRuntime.pendingView].filter(([id])=>mcpSessionTransportActive(mcpRuntime.sessions.get(id))&&mcpSessionVisible(mcpRuntime.sessions.get(id))).reduce((sum,[,ids])=>sum+ids.size,0);
    const retrying=mcpRuntime.wanted&&!mcpRuntime.ready&&mcpRuntime.reconnecting;
    if(notice)notice.hidden=!count&&!retrying&&(!mcpLocal()||(!connected&&!mcpRuntime.connectionLost));
    if(button)button.hidden=retrying||!mcpLocal()||(!connected&&!mcpRuntime.connectionLost);
    if(ring){ring.hidden=!connected;ring.setAttribute("data-state",mcpRuntime.glowing&&mutationVisible?"updating":"open");}
    if(newButton){newButton.hidden=!count;newButton.textContent=mcpText("newContent");}
    const accessLabel=mcpAccessLabel();
    let label=mcpText(mcpRuntime.authRequired?"cloudSignInRequired":"canvasLost");
    if(connected)label=mcpRuntime.activeMutation&&mutationVisible?`${mcpRuntime.activeMutation} ${mcpText("canvasApplying")}`:sessions.length?`MCP · ${clients.slice(0,2).join(" / ")}${clients.length>2?" +":""} · ${sessions.length} ${mcpText(sessions.length===1?"canvasSession":"canvasSessions")}`:accessLabel;
    if(button){if(button.textContent!==label)button.textContent=label;button.title=connected?`${accessLabel}. ${mcpText("canvasNoticeHelp")}`:mcpText("canvasNoticeHelp");}
  }
  // PenEcho owns deterministic placement and camera batching; MCP clients provide only content.
  function mcpSessionTransportActive(session) {
    return Boolean(session&&!session.closed&&(session.internalAgent||mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN));
  }
  function mcpHasInternalSession() {
    for(const session of mcpRuntime.sessions.values())if(session.internalAgent&&!session.closed&&mcpSessionVisible(session))return true;
    return false;
  }
  function mcpSessionVisible(session) {
    return Boolean(session)&&(!session.documentId||typeof canvasDocuments==="undefined"||session.documentId===canvasDocuments.activeId);
  }
  function mcpTaskBounds(session,ids=null) {
    let region=null;
    for(const id of ids||[session.boardObjectId,...[...session.artifacts.values()].flatMap(item=>item.objectIds||[item.objectId])]){
      const doc=typeof canvasDocuments!=="undefined"&&canvasDocuments.records.get(session.documentId),object=doc?canvasDocumentsObject(doc,id):canvasAgentObject(id);if(object)region=unionDirtyBounds(region,doc?canvasDocumentsBounds(object):canvasAgentBox(object));
    }
    return region;
  }
  const MCP_PRESENTATION_SIZES = {base:[480,360],wide:[992,360],tall:[480,752],large:[992,752],page:[1200,800]};
  function mcpPresentation(args,previous=null) {
    const input=args.presentation||previous?.presentation||{},intent=input.intent||"deliver",role=input.role||"primary";
    return {...input,intent,role,attention:input.attention||(intent==="review"?"request":role!=="primary"||intent==="inspect"?"quiet":"normal")};
  }
  function mcpReadingScreenStage() {
    const stage=canvasAgentFramePlan({x:0,y:0,w:1,h:1},0).stage;
    if(!stage)return stage;
    // The Canvas extends behind its overlaid toolbar. Reading content starts
    // below that real obstruction, including wrapped toolbars at narrow widths.
    const toolbar=typeof canvasElementLayoutRect==="function"?canvasElementLayoutRect(document.querySelector?.(".toolbar")):null;
    if(toolbar&&toolbar.left<stage.x+stage.w&&toolbar.right>stage.x&&toolbar.top<=stage.y&&toolbar.bottom>stage.y){
      const y=Math.min(stage.y+stage.h,toolbar.bottom);return {...stage,y,h:stage.h-(y-stage.y)};
    }
    return stage;
  }
  function mcpPresentationViewport(doc=null) {
    const saved=doc&&!canvasDocumentsIsActive(doc)?doc.stored?.item?.view:null,
      hasSavedStage=saved?.region?.w>0&&saved?.region?.h>0&&saved?.scale>0,
      stage=saved?.readingStage||(hasSavedStage?{x:0,y:0,w:saved.region.w*saved.scale,h:saved.region.h*saved.scale}:mcpReadingScreenStage()),
      scale=Math.max(.03,Math.min(2,Number(saved?.scale??state.scale)||1));
    return {stage,scale,panX:Number(saved?.panX??state.panX)||0,panY:Number(saved?.panY??state.panY)||0};
  }
  function mcpPresentationSize(args,doc=null) {
    const preset=MCP_PRESENTATION_SIZES[args.presentation?.size||"page"]||MCP_PRESENTATION_SIZES.page,
      requested={width:args.width||preset[0],height:args.height||preset[1]};
    if(args.presentation?.intent==="inspect")return requested;
    const {stage,scale}=mcpPresentationViewport(doc);
    if(!stage?.w||!stage?.h)return {...requested,contentWidth:requested.width,contentHeight:requested.height};
    const page=args.presentation?.size==="page"||(!args.presentation?.size&&requested.width===1200&&requested.height===800),
      availableW=Math.max(300,Math.floor(stage.w-48)),availableH=Math.max(200,Math.floor(stage.h-72)),
      // Authoring pixels are screen pixels. Only the finite Canvas boundary,
      // never a tile-sized footprint cap, limits the world-coordinate conversion.
      contentWidth=Math.min(4096,(SIZE-96)*scale,page?availableW:Math.max(300,Math.min(requested.width,availableW))),
      contentHeight=Math.min(4096,(SIZE-96)*scale,page?availableH:Math.max(200,Math.min(requested.height,availableH))),
      width=contentWidth/scale,height=contentHeight/scale;
    return {width,height,contentWidth,contentHeight};
  }
  function mcpRegionFramePlan(region) {
    const {stage,scale}=mcpPresentationViewport();
    if(!stage?.w||!stage?.h)return null;
    return {stage,scale,panX:stage.x+Math.max(24,(stage.w-region.w*scale)/2)-region.x*scale,
      panY:stage.y+48+Math.max(0,(stage.h-72-region.h*scale)/2)-region.y*scale};
  }
  function mcpRevealRegion(region,explicit=false) {
    const frame=mcpRegionFramePlan(region);
    if(!frame)return false;
    const {stage,scale}=frame,x=(state.panX||0)+region.x*scale,y=(state.panY||0)+region.y*scale,
      visible=x>=stage.x+23&&y>=stage.y+23&&x+region.w*scale<=stage.x+stage.w-23&&y+region.h*scale<=stage.y+stage.h-23;
    if(!explicit&&visible)return false;
    state.panX=frame.panX;state.panY=frame.panY;
    requestRender();canvasAgentSyncState();return true;
  }
  function mcpWidgetFramePlan(widget) {
    return mcpRegionFramePlan(canvasAgentBox({kind:"widget",item:widget}));
  }
  // Semantic placement has one owner for visible and parked documents. It never
  // changes existing geometry, and searches downwards instead of a 4608px shelf.
  function mcpArrange(width,height,session,presentation,view,boundsFor,collisions) {
    const gap=32/(view?.scale||1),p= presentation||{},owned=[...(session?.artifacts.values()||[])],
      anchor=p.relativeTo?session?.artifacts.get(p.relativeTo):null;
    if(p.relativeTo&&!anchor)throw Error("Related artifact not found in this session. Use an existing artifactId.");
    const reference=anchor?boundsFor(anchor):null;
    if(anchor&&!reference)throw Error("Related artifact was removed. Choose an existing artifact.");
    const primary=owned.find(a=>a.presentation?.role!=="supporting"&&a.presentation?.role!=="alternative"),
      primaryBounds=primary&&boundsFor(primary),last=owned.map(boundsFor).filter(Boolean).at(-1),
      viewport=view||{x:0,y:0,w:1280,h:900},
      origin={x:Math.max(0,Math.min(SIZE-width,viewport.x)),y:Math.max(0,Math.min(SIZE-height,viewport.y))};
    let x=reference?.x??primaryBounds?.x??last?.x??origin.x,
      y=reference?reference.y+reference.h+gap:last?last.y+last.h+gap:origin.y;
    const beside=reference&&(p.relation==="beside"||!p.relation&&p.intent==="compare");
    if(beside&&reference.w+gap+width<=Math.max(width,(viewport.readableWidth||viewport.w)-96)) {x=reference.x+reference.w+gap;y=reference.y;}
    x=Math.max(0,Math.min(SIZE-width,x));
    const findSlot=(column,start)=>{
      for(let row=Math.max(0,start),attempt=0;attempt<2048&&row+height<=SIZE;attempt++){
        const hits=collisions({x:column-gap/2,y:row-gap/2,w:width+gap,h:height+gap});
        if(!hits.length)return {placement:{mode:"absolute",x:column,y:row},layout:{zone:{x:column,y:row,w:width,h:height},x:0,y:height+gap,rowHeight:height}};
        row=Math.max(row+gap,...hits.map(b=>b.y+b.h+gap));
      }
      return null;
    };
    const below=findSlot(x,y);if(below)return below;
    // Near the finite Canvas bottom, find another clear column instead of
    // falling back onto the previous result or rejecting an otherwise empty Canvas.
    const columns=new Set([x,48,SIZE-width]);
    for(let column=0;column+width<=SIZE;column+=width+gap)columns.add(column);
    for(const column of columns){const slot=findSlot(column,0);if(slot)return slot;}
    throw Error("No clear space remains for this work. Move the group or use another Canvas.");
  }
  function mcpReadingWorldRect(doc=null) {
    const {stage,scale,panX,panY}=mcpPresentationViewport(doc);
    return stage?.w&&stage?.h?{x:(stage.x+24-panX)/scale,y:(stage.y+48-panY)/scale,
      w:Math.max(1,stage.w-48)/scale,h:Math.max(1,stage.h-72)/scale,readableWidth:Math.max(1,stage.w-48)/scale,scale}:null;
  }
  function mcpPlanPlacement(width,height,session=null,presentation=null) {
    if(typeof canvasDocumentsCurrent==="function")return canvasDocumentsPlace(canvasDocumentsCurrent(),width,height,session,presentation);
    const occupied=canvasAgentAllObjects().map(item=>canvasAgentInternalRect(item.box)),ink=visibleInkBounds({x:0,y:0,w:SIZE,h:SIZE});if(ink)occupied.push(ink);
    return mcpArrange(width,height,session,presentation,mcpReadingWorldRect(),a=>mcpTaskBounds(session,a.objectIds||[a.objectId]),box=>occupied.filter(b=>intersection(box,b)));
  }
  function mcpContentUpdateRegion(result,args) {
    const doc=canvasDocuments.records.get(result.documentId);
    if(!doc)return null;
    const ids=result.objectIds?[...result.objectIds]:[result.objectId||args.objectId];
    if(args.path?.startsWith("objects/")) {
      try {ids.push(decodeURIComponent(args.path.split("/")[1]));} catch {}
    }
    let region=null;
    for(const id of new Set(ids.filter(Boolean))) {
      const object=canvasDocumentsObject(doc,id);
      if(object)region=unionDirtyBounds(region,canvasDocumentsBounds(object));
    }
    if(!region&&args.region)region={x:args.region.x,y:args.region.y,w:args.region.w,h:args.region.h};
    return region&&[region.x,region.y,region.w,region.h].every(Number.isFinite)&&region.w>0&&region.h>0?region:null;
  }
  function mcpViewBlockedBy() {
    if(document.hidden)return "page-hidden";
    if(state.navigationLocked)return "navigation-locked";
    // pointers also caches hover positions; only the navigation set tracks
    // pressed Canvas pointers and is released globally on pointerup/cancel.
    if(state.trackpadGesture||state.navigationDeadline>performance.now())return "active-navigation";
    if(state.drawing||state.panGesture||state.touchGesture||state.widgetGesture||state.imageGesture||state.selectionGesture||state.animationGesture||state.canvasAgentNavigationPointerIds?.size)return "active-gesture";
    if(state.textEditors?.size)return "text-editing";
    if(document.activeElement?.tagName==="IFRAME")return "widget-interaction";
    if(mcpEl("settingsLayer")?.hidden===false)return "settings-open";
    return null;
  }
  function mcpViewBusy() {return Boolean(mcpViewBlockedBy());}
  // Bounded metadata, computed only on inspection; no capture, DOM scan or timer.
  function mcpAttentionState(session) {
    return {pendingObjects:mcpRuntime.pendingView.get(session.sessionId)?.size||0,paused:mcpRuntime.viewPaused,blockedBy:mcpRuntime.queued>1?"canvas-queue":mcpViewBlockedBy(),canvasScale:state.scale||1};
  }
  function mcpPauseView() {
    if(!mcpRuntime.socket&&!mcpHasInternalSession())return;
    mcpRuntime.viewPaused=true;clearTimeout(mcpRuntime.layoutTimer);mcpRuntime.layoutTimer=0;mcpRenderCanvasStatus();
  }
  function mcpQueueView(session,widget,presentation=null) {
    if(presentation?.attention==="quiet"||presentation?.intent==="inspect")return;
    if(!mcpSessionTransportActive(session))return;
    let pending=mcpRuntime.pendingView.get(session.sessionId);
    if(!pending){pending=new Set();mcpRuntime.pendingView.set(session.sessionId,pending);}
    pending.add(widget.id);
    if(!pending.order)pending.order=new Map();
    pending.order.set(widget.id,++mcpRuntime.viewSequence);
    if(!mcpRuntime.layoutSince)mcpRuntime.layoutSince=Date.now();
    clearTimeout(mcpRuntime.layoutTimer);
    if(!mcpRuntime.viewPaused)mcpRuntime.layoutTimer=setTimeout(()=>mcpFlushView(false),Math.max(0,Math.min(900,2500-(Date.now()-mcpRuntime.layoutSince))));
    mcpRenderCanvasStatus();
  }
  function mcpFlushView(explicit=false) {
    clearTimeout(mcpRuntime.layoutTimer);mcpRuntime.layoutTimer=0;
    if(!mcpRuntime.pendingView.size)return;
    if(mcpRuntime.queued){mcpRuntime.layoutTimer=setTimeout(()=>mcpFlushView(explicit),150);return;}
    if(mcpViewBusy()||(!explicit&&mcpRuntime.viewPaused)){mcpRuntime.viewPaused=true;mcpRenderCanvasStatus();return;}
    const groups=[...mcpRuntime.pendingView].filter(([id])=>mcpSessionTransportActive(mcpRuntime.sessions.get(id))&&mcpSessionVisible(mcpRuntime.sessions.get(id)));
    if(!groups.length){mcpRenderCanvasStatus();return;}
    const candidates=groups.flatMap(([id,ids])=>{
      const session=mcpRuntime.sessions.get(id),seen=new Set(),items=[];
      for(const objectId of ids){
        const artifact=[...session.artifacts.values()].find(a=>(a.objectIds||[a.objectId]).includes(objectId)),key=artifact||objectId;
        if(seen.has(key))continue;seen.add(key);
        const objectIds=artifact?(artifact.objectIds||[artifact.objectId]):[objectId],p=artifact?.presentation||{};
        const object=objectIds.length===1?canvasAgentObject(objectIds[0]):null;
        items.push({id,order:Math.max(...objectIds.map(value=>ids.order?.get(value)||0)),widget:object?.kind==="widget"?object.item:null,objectIds:objectIds.filter(value=>ids.has(value)),bounds:mcpTaskBounds(session,objectIds),rank:p.attention==="request"?3:p.role==="supporting"||p.role==="alternative"?1:2});
      }
      return items;
    }).filter(item=>item.bounds).sort((a,b)=>b.rank-a.rank||b.order-a.order);
    if(!candidates.length){for(const [id] of groups)mcpRuntime.pendingView.delete(id);mcpRenderCanvasStatus();return;}
    let shown=candidates,region=candidates.reduce((bounds,item)=>unionDirtyBounds(bounds,item.bounds),null);
    // A delivered document gets its own readable viewport. Do not squeeze older
    // pending documents into the same camera frame or focus the oldest result.
    const widgetFrame=candidates[0].widget?mcpWidgetFramePlan(candidates[0].widget):mcpRegionFramePlan(candidates[0].bounds);
    if(widgetFrame||canvasAgentFramePlan(region,96).scale<.65){shown=[candidates[0]];region=shown[0].bounds;}
    const view=typeof viewportRect==="function"?viewportRect():null,stage=canvasAgentFramePlan(region,96).stage,scale=state.scale||1,
      screenX=(state.panX||0)+region.x*scale,screenY=(state.panY||0)+region.y*scale,
      unobscured=!stage||screenX>=stage.x+24&&screenY>=stage.y+24&&screenX+region.w*scale<=stage.x+stage.w-24&&screenY+region.h*scale<=stage.y+stage.h-24,
      alreadyVisible=(widgetFrame?scale>=widgetFrame.scale*.99:scale>=.65)&&unobscured&&view&&region.x>=view.x&&region.y>=view.y&&region.x+region.w<=view.x+view.w&&region.y+region.h<=view.y+view.h;
    // An explicit reveal is a request to focus, even if an overview already
    // contains the artifact at a scale too small for reading its content.
    if(explicit||!alreadyVisible) {
      if(widgetFrame){
        mcpRevealRegion(region,explicit);
      }else canvasAgentFrameRegion(region,96);
    }
    // Older results remain on Canvas, but must not pull focus backwards on a
    // later timer after the latest result has been shown.
    const acknowledged=widgetFrame?candidates.filter(item=>item.rank<=shown[0].rank):shown;
    for(const item of acknowledged){const ids=mcpRuntime.pendingView.get(item.id);for(const objectId of item.objectIds){ids?.delete(objectId);ids?.order?.delete(objectId);}if(!ids?.size)mcpRuntime.pendingView.delete(item.id);}

    mcpRuntime.layoutSince=0;mcpRuntime.viewPaused=false;mcpRenderCanvasStatus();
  }

  function mcpHeartbeat(socket) {
    if(socket!==mcpRuntime.socket)return;
    void mcpSyncWakeLock();
    if(!document.hidden&&(!mcpRuntime.ready||mcpRuntime.heartbeatSupported)&&Date.now()-mcpRuntime.lastPong>45000){mcpDisconnect(true);return;}
    if(socket.readyState===WebSocket.OPEN&&mcpRuntime.ready&&mcpRuntime.heartbeatSupported){try{socket.send(JSON.stringify({type:"ping"}));}catch{mcpDisconnect(true);return;}}
    mcpRuntime.heartbeatTimer=setTimeout(()=>mcpHeartbeat(socket),15000);
  }
  function mcpBeginMutation(client,documentId=null) {
    clearTimeout(mcpRuntime.glowTimer);mcpRuntime.activeMutation=client||"AI";mcpRuntime.mutationDocumentId=documentId;mcpRuntime.glowing=true;mcpRenderCanvasStatus();
  }
  function mcpEndMutation() {
    mcpRuntime.activeMutation=null;mcpRenderCanvasStatus();
    mcpRuntime.glowTimer=setTimeout(()=>{mcpRuntime.glowing=false;mcpRuntime.glowTimer=0;mcpRenderCanvasStatus();},650);
  }
  function mcpRenderSettings() {
    if(!mcpRuntime)return;
    document.querySelectorAll("[data-mcp-label]").forEach(node=>{const key=node.dataset.mcpLabel,text=mcpText(key);
      node.textContent=text;
      if(/^example.*Prompt$/.test(key)){
        node.replaceChildren(...text.split(/(penecho|echo|canvas|画布)/gi).filter(Boolean).map(part=>{
          if(!/^(penecho|echo|canvas|画布)$/i.test(part))return document.createTextNode(part);
          const strong=document.createElement("b");strong.textContent=part;return strong;
        }));
      }});
    document.querySelectorAll("[data-mcp-aria]").forEach(node=>{node.setAttribute("aria-label",mcpText(node.dataset.mcpAria));});
    if(mcpEl("mcpKeepAwake"))mcpEl("mcpKeepAwake").checked=mcpKeepAwakeEnabled();
    const connected=mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN, connecting=!!mcpRuntime.socket&&!connected;
    mcpRenderCanvasStatus();mcpRenderToolbar();mcpRenderLan();
    mcpRenderTroubleshoot();
    if(mcpEl("mcpEnabled")){mcpEl("mcpEnabled").setAttribute("aria-checked",String(mcpRuntime.wanted||connected||connecting));mcpEl("mcpEnabled").classList.toggle("on",mcpRuntime.wanted||connected||connecting);mcpEl("mcpEnabled").disabled=!mcpLocal();}
    const connection=mcpEl("mcpConnectionStatus");
    if(connection){
      connection.textContent=connected?mcpAccessLabel():mcpText(!mcpLocal()?"localOnly":connecting?"connecting":mcpRuntime.authRequired?"cloudSignInRequired":mcpRuntime.connectionLost?(mcpRuntime.wanted?"toolbarCancelRetry":"toolbarRetry"):"disconnected");
      connection.dataset.state=!mcpLocal()?"off":connected?"on":connecting?"pending":mcpRuntime.connectionLost?"error":"off";
    }
    const remote=mcpRemoteBrowser(),config=remote?null:mcpRuntime.status?.config;
    for(const id of ["mcpClients","mcpManual"])if(mcpEl(id))mcpEl(id).hidden=false;
    if(mcpEl("mcpManualSteps"))mcpEl("mcpManualSteps").textContent=mcpText(remote&&!mcpCanCopySetup()?"remoteManualSteps":"manualSteps");
    const setupHint=document.querySelectorAll('[data-mcp-label="setupHint"]');
    for(const node of setupHint)node.textContent=mcpText(remote?"remoteSetup":"setupHint");
    const configStatus=mcpEl("mcpConfigStatus");
    if(configStatus){configStatus.hidden=!mcpRuntime.loading&&!mcpRuntime.loadError;configStatus.textContent=mcpRuntime.loading?mcpText("loadingConfig"):mcpRuntime.loadError?mcpConfigurationErrorText(mcpRuntime.loadError):"";}
    for(const id of ["mcpCopyInstructions","mcpConfigure"])if(mcpEl(id))mcpEl(id).disabled=!config||!!mcpRuntime.lanBusy;
    if(mcpEl("mcpCopyInstructions"))mcpEl("mcpCopyInstructions").disabled=!mcpCanCopySetup()||!!mcpRuntime.lanBusy;
    if(mcpEl("mcpConfigure")&&mcpRuntime.configuring)mcpEl("mcpConfigure").disabled=true;
    if(mcpEl("mcpConfigure")){mcpEl("mcpConfigure").textContent=mcpText(mcpRuntime.configuring?"configuring":"configure");mcpEl("mcpConfigure").setAttribute("aria-busy",String(mcpRuntime.configuring));}
    for(const input of mcpClientInputs)input.disabled=remote||mcpRuntime.configuring;
    const configureNotice=mcpEl("mcpConfigureStatus"),outcome=mcpRuntime.configureResult;
    if(configureNotice){
      configureNotice.hidden=!mcpRuntime.configuring&&!outcome;
      configureNotice.classList.toggle("success",!mcpRuntime.configuring&&["saved","updated"].includes(outcome?.kind));
      configureNotice.classList.toggle("error",!mcpRuntime.configuring&&outcome?.kind==="failed");
      configureNotice.textContent=mcpRuntime.configuring?mcpText("configurePending"):outcome?`${outcome.client} · ${mcpText({trust:"configureTrust",saved:"configureSaved",updated:"configureUpdated",existing:"configureExisting",failed:"configureFailed",uncertain:"configureUncertain"}[outcome.kind])}\n${mcpText({trust:"configureTrustHelp",saved:"configured",updated:"configureUpdatedHelp",existing:"configureExistingHelp",failed:"configureFailedHelp",uncertain:"configureUncertainHelp"}[outcome.kind])}${outcome.detail?`\n${outcome.detail}`:""}`:"";
    }
    if(mcpEl("mcpConfigure"))mcpEl("mcpConfigure").hidden=mcpSelectedClient()==="other";
    if(mcpEl("mcpManual")&&(remote||mcpSelectedClient()==="other"||!config&&!mcpRuntime.loading&&!mcpRuntime.configuring&&!mcpRuntime.lanBusy)){
      mcpEl("mcpManual").open=true;
      mcpRenderSetupPrompt();
    }
  }
  function mcpRenderTroubleshoot() {
    const listener=mcpEl("mcpListenerStatus"),http=mcpRuntime.status?.http;
    if(listener){
      const addresses=[];
      if(http?.enabled&&!mcpRuntime.loadError)for(const value of [...(Array.isArray(http.urls)?http.urls:[]),http.localUrl]){
        try{
          const url=new URL(value);
          if(url.protocol!=="https:"||url.username||url.password)continue;
          const address=`${url.hostname}:${url.port||"443"}`;
          if(!addresses.includes(address))addresses.push(address);
        }catch{}
      }
      listener.textContent=mcpRuntime.loading?mcpText("listenerLoading"):addresses.length?mcpText("listenerAddresses").replace("{addresses}",addresses.join(" · ")):mcpText("listenerUnavailable");
    }
    const busy=!!mcpRuntime.troubleshootBusy;
    for(const id of ["mcpCopyTroubleshootPrompt"]){
      const button=mcpEl(id);
      if(button){button.disabled=busy;button.setAttribute("aria-busy",String(busy));}
    }
    const notice=mcpEl("mcpTroubleshootStatus");
    if(notice){
      const result=mcpRuntime.troubleshootResult;
      notice.textContent=busy?mcpText("troubleshootCopying"):result?mcpText(result.key):"";
      notice.hidden=!notice.textContent;
    }
  }
  async function mcpCopyTroubleshoot() {
    if(mcpRuntime.troubleshootBusy)return;
    mcpRuntime.troubleshootBusy=true;mcpRuntime.troubleshootResult=null;mcpRenderTroubleshoot();
    try{
      const content=mcpTroubleshootPrompt();
      const copied=await writeClipboardText(content);
      mcpRuntime.troubleshootResult={key:copied?"troubleshootPromptCopied":"troubleshootCopyFailed"};
    }catch{mcpRuntime.troubleshootResult={key:"troubleshootCopyFailed"};}
    finally{mcpRuntime.troubleshootBusy=false;mcpRenderTroubleshoot();}
  }
  function mcpRenderSetupPrompt() {
    const block=mcpEl("mcpSetupBlock"),code=mcpEl("mcpSetupPromptCode");
    if(!block||!code)return;
    const available=mcpCanCopySetup();
    block.hidden=!available;
    const text=available&&mcpEl("mcpManual")?.open?mcpInstructions():"";
    if(code.textContent!==text)code.textContent=text;
    mcpEl("mcpSetupPrompt")?.setAttribute("aria-label",mcpText("setupPromptLabel"));
  }
  function mcpRenderLan() {
    mcpRenderSetupPrompt();
    const section=mcpEl("mcpLan"),lan=mcpRuntime.status?.http,host=!mcpRemoteBrowser();
    if(!section)return;
    section.hidden=!host||!lan;
    if(!host||!lan){if(mcpEl("mcpCertificateDialog")?.open)mcpEl("mcpCertificateDialog").close();return;}
    const active=mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN;
    const reset=mcpEl("mcpResetCertificate");
    if(reset)reset.disabled=!!mcpRuntime.lanBusy||(!lan.hostId&&!lan.fingerprint&&!lan.identityError);
    const notice=mcpEl("mcpCertificateNotice");if(notice)notice.hidden=!mcpRuntime.certificateChanged;
    const copy=mcpEl("mcpCopyInstructions");
    if(copy){copy.textContent=mcpText(mcpRuntime.certificateChanged?"certificateCopyNew":"copyInstructions");copy.disabled=!mcpCanCopySetup()||!!mcpRuntime.lanBusy;}
    const status=mcpEl("mcpLanStatus");
    if(status){status.textContent=mcpRuntime.lanMessage||(lan.identityError?mcpText("certificateInvalid"):!active?mcpText("lanOpenFirst"):!lan.enabled?mcpText("lanDisabled"):!lan.urls?.length?mcpText("lanNoAddress"):"");status.hidden=!status.textContent;}
  }

  async function mcpLanAction(action,extra={}) {
    if(mcpRemoteBrowser()||mcpRuntime.lanBusy)return;
    mcpRuntime.lanBusy=true;mcpRuntime.lanMessage="";mcpRenderLan();
    let success=false;
    try{
      const endpoint="http";
      const result=await mcpApi(endpoint,{action,...extra});
      success=true;
      if(mcpRuntime.status)mcpRuntime.status={...mcpRuntime.status,[endpoint]:result[endpoint]};
    }catch(error){
      mcpRuntime.lanMessage=mcpText("lanFailed");
    }finally{mcpRuntime.lanBusy=false;mcpRenderLan();}
    return success;
  }
  async function mcpLanRefresh() {
    if(window.PENECHO_CONFIG?.runtime === "cloud")return;
    if(mcpRuntime.loading)await mcpRuntime.loading;
    await mcpRefreshSettings();
  }
  async function mcpLanOpened() {
    await mcpRefreshSettings();
  }
  function mcpLanInstructions() {
    const http=mcpRuntime.status?.http;
    if(http?.enabled&&http.hostId&&http.certificatePem&&http.accessToken&&http.discoveryCliUrl&&http.discoveryCliSha256&&http.sessionCliUrl&&http.sessionCliSha256)return {transport:"stdio-http",serverRunning:true,hostId:http.hostId,certificatePem:http.certificatePem,accessToken:http.accessToken,initialUrl:http.initialUrl||http.urls?.[0]||http.localUrl,addresses:(http.urls?.length?http.urls:[http.localUrl]).filter(Boolean),discoveryCliUrl:http.discoveryCliUrl,discoveryCliSha256:http.discoveryCliSha256,sessionCliUrl:http.sessionCliUrl,sessionCliSha256:http.sessionCliSha256,idleTimeoutMs:http.clientIdleMs||1800000};
    if(http?.enabled&&http.hostId&&http.certificatePem&&http.accessToken&&http.discoveryCliUrl&&http.discoveryCliSha256)return {transport:"http",serverRunning:true,hostId:http.hostId,certificatePem:http.certificatePem,accessToken:http.accessToken,addresses:[...(http.urls||[]),http.localUrl].filter(Boolean),discoveryCliUrl:http.discoveryCliUrl,discoveryCliSha256:http.discoveryCliSha256};
    return null;
  }
  function mcpRememberSetup() {
    mcpRuntime.setupKnown=true;
    try{localStorage.setItem("penecho-mcp-setup-completed","true");}catch{}
  }
  function mcpSetupKnown() {
    if(mcpRuntime.setupKnown)return true;
    try{return localStorage.getItem("penecho-mcp-setup-completed")==="true";}catch{return false;}
  }
  async function mcpToolbarClick() {
    if(mcpRuntime.toolbarChecking)return;
    if(mcpRuntime.socket||mcpRuntime.wanted){
      if(mcpRuntime.ready)mcpRememberSetup();
      mcpRuntime.toolbarManaged=false;mcpRuntime.toolbarPending=false;mcpDisconnect();setStatus(mcpText("disconnected"));return;
    }
    if(!mcpLocal()){openSettings();selectSettingsPage("mcp");return;}
    if(window.PENECHO_CONFIG?.runtime==="cloud"){
      mcpRuntime.toolbarChecking=true;setStatus(mcpText("checkingSetup"));mcpRenderToolbar();
      try{
        await mcpRefreshSettings();
        if(mcpRuntime.loadError){mcpShowConfigurationError(mcpRuntime.loadError);return;}
      }finally{mcpRuntime.toolbarChecking=false;mcpRenderToolbar();}
    }
    mcpRuntime.toolbarManaged=true;mcpRuntime.toolbarPending=true;setStatus(mcpText("connecting"));
    try{mcpConnect();}catch{mcpDisconnect(true);setStatus(mcpText(mcpRuntime.wanted?"toolbarCancelRetry":"toolbarRetry"));mcpRenderSettings();}
  }
  function mcpCancelReconnect() {
    if(!mcpRuntime.wanted)return;
    mcpRuntime.toolbarManaged=false;mcpRuntime.toolbarPending=false;
    mcpDisconnect();setStatus(mcpText("disconnected"));
  }
  function mcpRenderReconnectStatus() {
    clearTimeout(mcpRuntime.reconnectStatusTimer);mcpRuntime.reconnectStatusTimer=0;
    const button=mcpEl("mcpReconnectCancel");if(!button)return;
    const active=mcpRuntime.wanted&&!mcpRuntime.ready&&mcpRuntime.reconnecting;
    button.hidden=!active;if(!active)return;
    const seconds=Math.max(0,Math.ceil((mcpRuntime.reconnectAt-Date.now())/1000));
    const text=mcpText(mcpRuntime.reconnectAt?"retryCountdown":"retryConnecting").replace("{seconds}",String(seconds));
    if(button.textContent!==text)button.textContent=text;
    if(mcpRuntime.reconnectAt)mcpRuntime.reconnectStatusTimer=setTimeout(mcpRenderReconnectStatus,1000);
  }
  function mcpRenderToolbar() {
    window.PenEchoMcpSettings?.setConnection({enabled:Boolean(mcpRuntime.wanted),connected:Boolean(mcpRuntime.ready),label:mcpAccessLabel()});
    window.PenEchoStudioNavigator?.syncMcp?.(Boolean(mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN),{reveal:!mcpRuntime.reconnecting});
    mcpRenderReconnectStatus();
    const button=mcpEl("mcpToolbarToggle");if(!button)return;
    const connected=mcpRuntime.ready&&mcpRuntime.socket?.readyState===WebSocket.OPEN,opening=Boolean(mcpRuntime.socket)&&!connected;
    button.setAttribute("aria-pressed",String(mcpRuntime.wanted||connected||opening));button.setAttribute("aria-busy",String(opening||Boolean(mcpRuntime.toolbarChecking)));button.disabled=Boolean(mcpRuntime.toolbarChecking);
    const title=mcpText(mcpRuntime.wanted||connected||opening?"toolbarClose":mcpRuntime.authRequired?"cloudSignInRequired":mcpRuntime.connectionLost?"toolbarRetry":"toolbarOpen");
    button.title=title;button.setAttribute("aria-label",`MCP Server · ${title}`);
    button.setAttribute("data-state",connected?"connected":opening||mcpRuntime.toolbarChecking?"connecting":mcpRuntime.connectionLost?"failed":"off");
    if(mcpRuntime.toolbarPending&&(connected||mcpRuntime.connectionLost)){
      setStatus(mcpText(connected?"connected":mcpRuntime.wanted?"toolbarCancelRetry":"toolbarRetry"));mcpRuntime.toolbarPending=false;
    }
  }
  function mcpShowConfigurationError(error) {
    const text=mcpConfigurationErrorText(error);
    setStatus(text);
    if(window.PENECHO_CONFIG?.runtime!=="cloud"||!["linked_device_required","device_offline","device_timeout"].includes(error.code))return;
    const notice=mcpEl("status");if(!notice)return;
    const link=document.createElement("a");
    link.href="/dashboard.html#devices";
    link.textContent=text;
    link.setAttribute("data-mcp-device-link","");
    notice.replaceChildren(link);
  }
  function mcpConfigurationErrorText(error) {
    if(error.code==="linked_device_required")return mcpText("deviceRequired");
    if(["device_offline","device_timeout"].includes(error.code))return mcpText("deviceOffline");
    if(["mcp_update_required","remote_mcp_unsupported","device_mcp_unsupported","linked_device_update_required"].includes(error.code))return mcpText("deviceUpdate");
    if(error.code==="local_host_required")return mcpText("hostRequired");
    if([404,405].includes(error.status)||error.code==="mcp_configuration_unavailable")return mcpText("serviceOutdated");
    if([401,403].includes(error.status))return mcpText("accessDenied");
    return mcpText("loadFailed");
  }
  async function mcpApi(path,body={}) {
    const response=await fetch(`/api/mcp/${path}`,{method:"POST",headers:authenticatedApiHeaders({"Content-Type":"application/json"}),credentials:"same-origin",cache:"no-store",body:JSON.stringify(body),signal:AbortSignal.timeout(path==="configure"?20000:5000)});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result||typeof result!=="object")throw Object.assign(Error(typeof result?.error==="string"?result.error:result?.error?.message||"MCP request failed."),{status:response.status,code:result?.error?.code||result?.code||(typeof result?.error==="string"?result.error:undefined),existing:result?.existing===true});
    return result;
  }
  async function mcpRefreshSettings() {
    if(!mcpLocal()||mcpRuntime.loading){mcpRenderSettings();return mcpRuntime.loading;}
    mcpRuntime.loadError=null;
    mcpRuntime.loading=(async()=>{
      try{
        const status=await mcpApi("status"),config=status.config;
        if(status.canConfigureLocalClients!==false&&!(config?.type==="http"&&/^https:\/\//.test(config.url||""))&&(!config||typeof config.command!=="string"||!config.command.trim()||!Array.isArray(config.args)||config.args.some(arg=>typeof arg!=="string")))throw Object.assign(Error("MCP configuration is unavailable."),{code:"mcp_configuration_unavailable"});
        mcpRuntime.status=status;
      }catch(error){mcpRuntime.status=null;mcpRuntime.loadError=error;}
      finally{mcpRuntime.loading=null;mcpRenderSettings();}
    })();
    mcpRenderSettings();return mcpRuntime.loading;
  }
  function mcpInstructions() {
    const direct=mcpLanInstructions();
    if(direct?.transport==="stdio-http")return `Configure PenEcho MCP on THIS Agent's computer using one lightweight stdio CLI per client-owned MCP session. The CLI connects directly to PenEcho HTTPS; no shared Gateway or background discovery daemon.

${JSON.stringify(direct,null,2)}

Use this computer's user home and this REQUIRED installation directory: ~/.penecho/mcp on macOS/Linux, %USERPROFILE%\\.penecho\\mcp on Windows. Download discoveryCliUrl to discover.js and sessionCliUrl to client.js in that directory. Do not choose any other directory or filename. Both the MCP command configuration and upload commands MUST use this exact downloaded client.js. The upload script is this same client.js: ~/.penecho/mcp/client.js on macOS/Linux, %USERPROFILE%\\.penecho\\mcp\\client.js on Windows. It is not stored in the Agent skill directory or PenEcho application directory. Retain its resolved absolute path and the local Node executable for subsequent uploads. hostId identifies the PenEcho server, NOT a Canvas instance, document or session. For every upload copy the hostId supplied above, which is also the value after --host-id in the MCP entry. client.js resolves addresses and ports automatically; do not guess IDs, inspect its source or parse port mappings. Verify each SHA-256 against its supplied hash BEFORE execution. Use a locally installed Node.js 18+ and absolute executable/script paths. Never use another computer's paths. Save {hostId,certificatePem,accessToken,initialUrl,addresses} in a private temporary JSON file, run node <absolute discover.js> --import <temporary file> WITHOUT --client, then delete only that temporary file. Discovery only saves verified host credentials and addresses; it does not need the Agent's name and must not rewrite Agent configuration during normal reconnects.

Configure this Agent's supported stdio MCP entry named penecho with command=<absolute local Node executable> and args=[<absolute client.js>,"--host-id",hostId]. Preserve unrelated settings and replace only the previous PenEcho entry; remove old HTTP url/header fields and any old idle-exit option from that entry. Do not add an idle process-exit timer. For Codex use its MCP command/args format; for Claude use its stdio command/args format; use the actual supported format for other clients. Authorization and certificate trust stay in the shared ~/.penecho/mcp store, read by client.js. Do not place accessToken on the command line, print credentials, disable TLS verification, or configure discover.js as the stdio server.

Connection order is the last successful IP + port (or the supplied initialUrl on first connection), freshly read shared endpoint cache, then one-shot LAN discovery. Missing, stale or unreachable cache all trigger discovery. Authenticate every candidate and save the verified new address. The same complete sequence runs if reconnecting after idle release fails; another process may already have updated the cache. No hostname lookup is required on this path and address changes never rewrite AI configuration.

The AI client owns the CLI stdin/stdout. Keep the lightweight CLI alive while stdin is open; idle for 30 minutes releases only HTTP, and the next request reconnects and restores the same Canvas. In-flight work prevents idle release. EOF or shutdown signals close the process. Do not add an idle-exit argument, gateway, OS startup job, periodic discovery or reconnect loop while idle. Retry safe connection failures within a bounded request; do not blindly replay a write whose outcome is unknown.

Reload this Agent's MCP integration and verify initialize, tools/list, and penecho_list_canvases. Keep one unique stable client/sessionKey per logical conversation plus returned sessionId/documentId. HTTP recovery in the living CLI restores its original document; after CLI restart call penecho_start_session with the same client/sessionKey/documentId. Never use a new conversation's key or silently switch an existing conversation to another browser. A closed Canvas can reopen; only definitive DOCUMENT_NOT_FOUND permits replacement. Report the actually verified connection result.

Image files on THIS Agent's computer: run the downloaded client.js as a separate one-shot command using the same local Node executable and host ID: node "<absolute client.js>" --host-id HOST_ID --upload-image "<absolute image path>" --canvas-id CANVAS_ID --document-id DOCUMENT_ID --request-id UNIQUE_ID. Obtain canvasId and documentId from penecho_start_session with target:current; keep that exact document open and current. Reuse the configured environment and --state-directory if present. Quote paths on Windows/macOS/Linux. The CLI sends original bytes to /mcp/images on the SAME HTTPS port and with the same authentication as /mcp; image processing runs on PenEcho, with no client-side converter or Base64 needed. Maximum original file size: 32 MiB. Supported raw files: PNG, WebP, JPG/JPEG, GIF, TIFF, AVIF; HEIC/HEIF depends on server codecs. Prefer WebP generally, PNG for lossless diagrams/transparency, JPEG for photos. Copy the returned source verbatim into Widget img src or CSS url(), or pass it to penecho_place_image with the sessionId and a new requestId. Never pass a local filesystem path as MCP source. Chat attachment Data URLs can use penecho_upload_image directly. Retry uncertain uploads with the identical target, file and requestId. Verify client.js --help includes --upload-image; if absent, download and verify the current client again.

Optional helper skill: if this Agent supports local skills, create or update penecho-mcp using its supported skill location and format. Use this one-shot SKILL.md content (adapt the format if needed): When saving the skill, replace NODE_PATH, CLIENT_JS_PATH and HOST_ID below with the actual absolute local Node executable, fixed installation path expanded to an absolute client.js path and supplied hostId. These are connection identifiers, not credentials; never embed accessToken.

---
name: penecho-mcp
description: Create, read, or edit PenEcho canvases, including following the user's drawings and notes.
---

Use connected tools; search only missing deferred tools. Bind once with start_session; retain sessionId/documentId and stable client/sessionKey. Use target:current for the user's current Canvas.

Upload files with the installed bridge: "NODE_PATH" "CLIENT_JS_PATH" --host-id HOST_ID --upload-image "ABSOLUTE_IMAGE_PATH" --canvas-id CANVAS_ID --document-id DOCUMENT_ID --request-id UNIQUE_ID. Required client.js location: ~/.penecho/mcp/client.js (macOS/Linux), %USERPROFILE%\\.penecho\\mcp\\client.js (Windows), not the skill or application directory. HOST_ID is the setup server hostId, never a canvasId/documentId/sessionId. Copy it from the MCP entry if needed. client.js resolves the address/port automatically; do not inspect source or port mappings. Get canvasId/documentId from start_session target:current; reuse returned source. Read upload_image source parameters for upload details.

Follow live schemas; get_guidance only for the needed topic. Keep artifact IDs. Read source/contentHash before patching. Retry uncertain writes with identical arguments/requestId. Capture when visual evidence is needed; combine final mutation and completion. Inbox reads do not acknowledge.

If skill creation is unavailable or fails, simply skip it and continue MCP setup; no extra user action is needed.`;
    if(direct?.transport==="http")return `Configure PenEcho using native Streamable HTTP MCP on THIS Agent's computer. Preserve unrelated client configuration. No Gateway, background daemon, or stdio bridge is needed.

${JSON.stringify(direct,null,2)}

Use Node.js 18+ for the short-lived discovery helper. Download discoveryCliUrl to ~/.penecho/mcp/discover.js (use this computer's home directory on Windows too). Verify its SHA-256 equals discoveryCliSha256 BEFORE executing. Save {hostId,certificatePem,accessToken,addresses} to a private temporary JSON file, import with node <absolute discover.js> --import <file> --client <codex|claude>, then delete only that temporary file. The helper stores shared credentials, trusted CA and endpoint cache under ~/.penecho/mcp. For another client, use --client json and its documented native HTTP MCP format, preserving other entries. Never configure the helper itself as a stdio MCP server. Never print accessToken or disable TLS verification. A certificate is trust; the bearer token authorizes access.

Finish certificate trust using this client's supported CA configuration. Codex supports CODEX_CA_CERTIFICATE and Claude Code supports NODE_EXTRA_CA_CERTS; these are environment variables of the actual client process, not per-server HTTP environment fields. Configure persistent trust for the actual launch method or use an already trusted OS certificate store supported by that client. A saved MCP entry alone does not prove the running client trusts this CA. Reload the MCP client and verify initialize, tools/list and penecho_list_canvases.

When the cached endpoint fails, run node <absolute discover.js> --host-id ${direct.hostId} --client <client> again: it probes the cache, rediscovers the trusted host only when needed, updates the matching configuration, and exits. Do not poll or keep a remote-client process alive. Use the client's supported MCP refresh/reconnect after an endpoint change; MCP does not universally execute discovery commands or hot-reload changed URLs. Report the actual verified result.

Install a small PenEcho bootstrap skill in this Agent's supported local skill format if available: trigger on PenEcho, echo, canvas or spatial-workspace requests, including requests to follow Canvas drawings or handwriting; When the user refers to Canvas drawings, handwriting, circles, arrows or annotations (e.g. “请按照我画的内容来执行”, “请按照我写的来进行操作”, “follow what I drew/wrote”), decide whether the requested action depends on visual information missing from the available context. These phrases are routing cues, not mandatory screenshot triggers. Reuse already understood drawings, supplied images or readable feedback captures when sufficient; do not re-view or recapture unchanged content on every turn or edit. Ordinary source edits and fully specified text instructions need no image. If execution depends on unseen, changed or unclear ink or spatial relationships, inspect the relevant image; source/JSON alone cannot establish those visual details. Only when existing image evidence is insufficient, call penecho_capture_canvas with quality:"basic" and the relevant selection, region, object or viewport target; use target:"canvas" for whole-Canvas context. Request detail only if needed to read the marks. Use the intended document/session; never silently switch documents. If capture fails or handwriting is ambiguous, resolve that specific gap before dependent edits. Read source as needed for implementation. Discover PenEcho tools and read penecho://guidance/skill; on connection failure run the saved discovery command above and refresh the MCP connection using this client's supported mechanism. Preserve a unique stable sessionKey for this logical conversation, its client name and returned documentId. New conversations use different keys. Call penecho_start_session with the same key and documentId after reconnect; PenEcho restores the original Canvas even when it was closed, and creates a replacement only if the document is definitively missing. New conversations without a target use the most recently enabled browser. Never redirect an existing conversation merely because another browser connected. After reconnect verify the returned documentId and recovery result before continuing edits. Do not claim a failed connection succeeded.`;
    return "";
  }
  function mcpConnect(reconnecting=false) {
    if(!mcpLocal())return;
    mcpDisconnect();mcpRuntime.authRequired=false;mcpRuntime.wanted=true;mcpRuntime.reconnecting=reconnecting;
    mcpRuntime.browserId=mcpRuntime.browserId||canvasClientId();
    const generation=mcpRuntime.generation;
    if(!reconnecting&&typeof canvasDocumentsReady==="function")void canvasDocumentsReady().then(()=>{if(generation!==mcpRuntime.generation||!mcpRuntime.wanted)return;const doc=canvasDocumentsCurrent();mcpRuntime.feedback=doc.feedback;mcpRuntime.feedbackSequence=doc.feedbackSequence;canvasDocumentsRender();}).catch(error=>{if(generation===mcpRuntime.generation&&mcpRuntime.wanted)canvasDocumentsReport(error,()=>canvasDocumentsReady());});
    const socket=window.PenEchoCloudMcpSocket
      ?new window.PenEchoCloudMcpSocket()
      :new WebSocket(`${location.protocol==="https:"?"wss:":"ws:"}//${location.host}${window.PENECHO_CONFIG?.runtime==="cloud"?"/api/v1/remote-canvas/mcp":"/api/mcp/canvas"}`);
    mcpRuntime.socket=socket;mcpRuntime.lastPong=Date.now();mcpHeartbeat(socket);
    socket.addEventListener("availabilitychange",()=>{if(socket===mcpRuntime.socket)mcpRenderSettings();});
    socket.addEventListener("open",()=>{if(socket!==mcpRuntime.socket)return;const documents=mcpOpenCanvasCatalog();mcpRuntime.catalogSignature=JSON.stringify(documents);socket.send(JSON.stringify({type:"hello",canvasId:mcpRuntime.browserId,title:state.currentSnapshotName||"PenEcho Canvas",documents,documentRename:true}));mcpRenderSettings();});
    socket.addEventListener("message",event=>{
      if(socket!==mcpRuntime.socket)return;let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==="dispose-session"){mcpDisposeSession(message.sessionId);return;}
      if(message.type==="lan-status-changed"){void mcpLanRefresh();return;}
      if(message.type==="ready"){mcpRuntime.reconnectDelay=1000;mcpRuntime.ready=true;mcpRuntime.connectionLost=false;mcpRuntime.heartbeatSupported=message.heartbeat===true;mcpRuntime.catalogSupported=message.catalog===true;mcpRuntime.lastPong=Date.now();mcpRenderSettings();if(!reconnecting)showCanvasHint("canvasHintMcpConnected");void mcpLanOpened();if(typeof canvasDocuments!=="undefined"){const doc=canvasDocumentsCurrent();mcpRuntime.feedback=doc.feedback;mcpRuntime.feedbackSequence=doc.feedbackSequence;canvasDocuments.error=null;canvasDocuments.retry=null;canvasDocumentsRender();}mcpPublishCanvasCatalog();void mcpSyncWakeLock();return;}
      if(message.type==="pong"){mcpRuntime.lastPong=Date.now();return;}
      if(message.type==="cancel"){mcpRuntime.controllers.get(message.requestId)?.abort(Object.assign(Error("The MCP request was cancelled."),{code:"REQUEST_CANCELLED"}));return;}
      if(message.type!=="call")return;
      if(mcpRuntime.queued>=32&&message.name!=="mcp_find_canvases"){socket.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"CANVAS_BUSY",message:"Canvas update queue is full."}}));return;}
      if(mcpRuntime.controllers.has(message.requestId)){socket.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"INVALID_REQUEST",message:"This MCP request ID is already active."}}));return;}
      // Server and renderer may run on different machines. Only compare local
      // elapsed time; the server owns its absolute deadline and sends cancellation.
      const remaining=Number.isFinite(message.timeoutMs)?message.timeoutMs:MCP_BROWSER_CALL_DEADLINE_MS;
      if(remaining<=0){socket.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:"REQUEST_EXPIRED",message:"This MCP call expired before the browser received it. Retry the current request."}}));return;}
      const controller=new AbortController();mcpRuntime.controllers.set(message.requestId,controller);mcpRuntime.queued++;
      const execution={kind:"mcp",socket,generation,controller,preserveView:true};
      const timeoutMs=Math.max(1,Math.min(MCP_BROWSER_CALL_DEADLINE_MS,remaining)),deadlineAt=performance.now()+timeoutMs;
      const expire=()=>controller.abort(Object.assign(Error("The Canvas operation exceeded its browser execution deadline."),{code:"CANVAS_OPERATION_TIMEOUT"}));
      const deadline=setTimeout(expire,timeoutMs);
      const run=async()=>{
        const started=performance.now(),mutation=["mcp_start_session","mcp_update_session","mcp_present_widget","mcp_draw","mcp_plot","mcp_close_session"].includes(message.name)&&message.arguments?.presentation?.intent!=="inspect";
        try{
          if(performance.now()>=deadlineAt)expire();
          canvasAgentAssertToolExecution(execution);
          if(mutation)mcpBeginMutation(message.arguments?.client||mcpRuntime.sessions.get(message.arguments?.sessionId)?.client,message.arguments?.documentId||mcpRuntime.sessions.get(message.arguments?.sessionId)?.documentId||null);
          const previousRegion=message.name==="mcp_edit_canvas"&&message.arguments?.action==="delete"?mcpContentUpdateRegion({documentId:message.arguments.documentId||mcpRuntime.sessions.get(message.arguments.sessionId)?.documentId},message.arguments):null;
          const operations=mcpRuntime.operations||(mcpRuntime.operations=new Set());
          if(operations.size>=8&&message.name!=="mcp_find_canvases")throw Object.assign(Error("Previous Canvas operations are still finishing."),{code:"CANVAS_BUSY"});
          const operation=typeof canvasDocumentsExecute==="function"?canvasDocumentsExecute(message.name,message.arguments||{},execution):mcpExecute(message.name,message.arguments||{},execution);
          operations.add(operation);Promise.resolve(operation).then(()=>operations.delete(operation),()=>operations.delete(operation));
          const result=await mcpWaitForExecution(operation,execution);
          canvasAgentAssertToolExecution(execution);
          if(["mcp_present_widget","mcp_draw","mcp_plot","mcp_patch_file","mcp_edit_canvas","mcp_place_image"].includes(message.name)&&message.arguments?.presentation?.intent!=="inspect"&&message.arguments?.action!=="show"&&!result.reused){
            const region=mcpContentUpdateRegion(result,message.arguments||{})||previousRegion;
            window.PenEchoStudioNavigator?.noteMcpContentUpdate?.(result.documentId,region);
          }
          if(mutation){const session=mcpRuntime.sessions.get(message.arguments?.sessionId);if(session)session.updatedAt=Date.now();}
          socket.send(JSON.stringify({type:"result",requestId:message.requestId,ok:true,result:{...result,browserElapsedMs:Math.round(performance.now()-started)}}));
        }catch(error){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"result",requestId:message.requestId,ok:false,error:{code:error.code||"CANVAS_TOOL_FAILED",message:String(error.message||error),...(error.details?{details:error.details}:{})}}));}
        finally{try{if(generation===mcpRuntime.generation){mcpRuntime.queued--;if(mcpRuntime.controllers.get(message.requestId)===controller)mcpRuntime.controllers.delete(message.requestId);}if(mutation&&socket===mcpRuntime.socket){mcpEndMutation();mcpRenderSettings();}if(socket===mcpRuntime.socket) {
            // Following new content is presentation work, outside the RPC queue.
            // One follow is enough; the navigator already coalesces pending targets.
            if(!mcpRuntime.followOperation&&typeof window.PenEchoStudioNavigator?.flushMcpFollow==="function") {
              const followController=new AbortController(),follow={kind:"mcp",socket,generation,controller:followController,preserveView:true};
              mcpRuntime.controllers.set("mcp-follow",followController);
              const followTimer=setTimeout(()=>followController.abort(Object.assign(Error("Canvas follow timed out."),{code:"CANVAS_OPERATION_TIMEOUT"})),MCP_BROWSER_CALL_DEADLINE_MS);
              const followOperation=Promise.resolve().then(()=>window.PenEchoStudioNavigator.flushMcpFollow(follow));
              mcpRuntime.followOperation=followOperation;
              followOperation.catch(()=>{}).finally(()=>{
                clearTimeout(followTimer);
                if(mcpRuntime.controllers.get("mcp-follow")===followController)mcpRuntime.controllers.delete("mcp-follow");
                if(mcpRuntime.followOperation===followOperation)mcpRuntime.followOperation=null;
              });
            }
          }}finally{clearTimeout(deadline);}}
      };
      if(message.name==="mcp_find_canvases")void run();
      else mcpRuntime.queue=mcpRuntime.queue.catch(()=>{}).then(run);
    });
    socket.addEventListener("close",event=>{if(socket!==mcpRuntime.socket)return;if(window.PENECHO_CONFIG?.runtime==="cloud"&&event?.code===4401){mcpDisconnect();mcpRuntime.authRequired=true;mcpRuntime.connectionLost=true;setStatus(mcpText("cloudSignInRequired"));mcpRenderSettings();return;}mcpDisconnect(true);});
    socket.addEventListener("error",()=>{if(socket===mcpRuntime.socket)mcpDisconnect(true);});
    mcpRenderSettings();
  }
  function mcpEscape(text) { return String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  // Record committed user input only. Never scan pixels or consume Canvas dirty state here.
  function mcpRecordFeedback(kind,bounds,item=null) {
    if(!mcpRuntime||!bounds||(!mcpRuntime.socket&&!mcpHasInternalSession()&&!(typeof canvasDocumentsExternal==="function"&&canvasDocumentsExternal())))return;
    if(![bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite))return;
    const entry={cursor:++mcpRuntime.feedbackSequence,kind,bounds:{x:bounds.x,y:bounds.y,w:Math.max(1,bounds.w),h:Math.max(1,bounds.h)},createdAt:Date.now()};
    if(item?.id)entry.objectId=String(item.id);
    if(kind==="text"){entry.text=String(item?.text||"").slice(0,4000);entry.textTruncated=String(item?.text||"").length>4000;}
    mcpRuntime.feedback.push(entry);
    if(mcpRuntime.feedback.length>200)mcpRuntime.feedback.splice(0,mcpRuntime.feedback.length-200);
    if(typeof canvasDocumentsCurrent==="function"){const doc=canvasDocumentsCurrent();doc.feedback=mcpRuntime.feedback;doc.feedbackSequence=mcpRuntime.feedbackSequence;doc.changes.push({cursor:++doc.changeSequence,kind,objectId:item?.id||null,bounds:entry.bounds,createdAt:entry.createdAt});if(doc.changes.length>200)doc.changes.shift();}
  }
  async function mcpReadFeedback(session,args,execution) {
    const after=Math.max(session.feedbackStart,args.after??session.feedbackStart),latestCursor=mcpRuntime.feedbackSequence;
    if(!Number.isSafeInteger(after)||after>latestCursor)throw Error("Feedback cursor is invalid for this canvas connection.");
    const pending=mcpRuntime.feedback.filter(entry=>entry.cursor>after),entries=[];
    let dirtyRegion=null;
    for(const entry of pending.slice(0,args.limit??20)){
      const expanded=unionDirtyBounds(dirtyRegion,entry.bounds);
      // Spatial pagination keeps distant remarks readable without skipping their cursors.
      if(entries.length&&Math.max(expanded.w,expanded.h)>2048)break;
      entries.push({...entry,bounds:{...entry.bounds}});dirtyRegion=expanded;
    }
    const result={sessionId:session.sessionId,after,nextCursor:entries.at(-1)?.cursor??after,latestCursor,hasMore:pending.length>entries.length,truncated:after<(mcpRuntime.feedback[0]?.cursor??latestCursor+1)-1,entries};
    if(args.capture===false||!entries.length)return result;
    if(state.drawing)throw Error("Finish the current stroke before capturing feedback, then retry with the same cursor.");
    // Preserve nearby design context, independently of where the user has since panned.
    const margin=120,x=Math.max(0,dirtyRegion.x-margin),y=Math.max(0,dirtyRegion.y-margin),
      region={x,y,width:Math.min(SIZE,dirtyRegion.x+dirtyRegion.w+margin)-x,height:Math.min(SIZE,dirtyRegion.y+dirtyRegion.h+margin)-y};
    const captured=await canvasAgentCapture({target:"region",region,quality:"basic",coordinates:"metadata"},{execution,signal:execution.controller?.signal,assertCurrent:()=>canvasAgentAssertToolExecution(execution)});
    canvasAgentAssertToolExecution(execution);
    if(state.drawing)throw Error("Finish the current stroke before capturing feedback, then retry with the same cursor.");
    return {...result,...captured,visualContext:"current-canvas-with-nearby-design"};
  }

  function mcpProgressData(session) { return {title:session.title,client:session.client,status:session.status,statusLabel:mcpText(session.status),summary:session.summary||"",steps:session.steps||[],events:session.events||[]}; }
  function mcpBoardHtml(session) {
    const data=mcpProgressData(session),json=JSON.stringify(data).replace(/</g,"\\u003c");
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24272d;background:#fafafa}*{box-sizing:border-box}body{margin:0;padding:24px;font-size:15px;line-height:1.5;height:100vh;display:flex;flex-direction:column}header{display:flex;gap:16px;align-items:flex-start;border-bottom:1px solid #d9dbde;padding-bottom:18px;flex-shrink:0;max-height:32vh;overflow:auto}h1{font-size:22px;line-height:1.25;margin:0;font-weight:600;overflow-wrap:anywhere}#identity{flex:1;min-width:0}#client{font-size:12px;color:#626973}#status{font-size:12px;white-space:nowrap;color:#0f766e}#summary{margin:18px 0;overflow-wrap:anywhere;max-height:25vh;overflow:auto;flex-shrink:0}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;min-height:0;overflow:auto;flex:1}section{min-width:0}h2{font-size:13px;font-weight:600;margin:0 0 10px;color:#626973}ol,ul{margin:0;padding:0;list-style:none}li{padding:8px 0;border-bottom:1px solid #e8e9eb;overflow-wrap:anywhere}#steps li{display:flex;gap:10px;align-items:baseline}.mark{font-size:12px;flex:0 0 20px;color:#626973}.done .mark{color:#0f766e}.working{font-weight:600}.error .mark{color:#be3434}#events li{font-size:13px}footer{margin-top:18px;font-size:12px;color:#626973}@media(max-width:580px){main{grid-template-columns:1fr}body{padding:18px}header{flex-wrap:wrap}}@media(prefers-color-scheme:dark){:root{color:#e8e9ec;background:#222326}header,li{border-color:#42454b}#client,h2,.mark,footer{color:#adb2bb}#status,.done .mark{color:#70cdb7}}
      </style></head><body><header><div id="identity"><div id="client"></div><h1 id="title"></h1></div><span id="status"></span></header><p id="summary"></p><main><section><h2>${state.language==="zh"?"工作步骤":"Work plan"}</h2><ol id="steps"></ol></section><section><h2>${state.language==="zh"?"最新进展":"Latest progress"}</h2><ul id="events"></ul></section></main><footer>${state.language==="zh"?"外部 AI 提供的计划、进展与结果":"Plans, progress and results shared by your AI"}</footer><script>
      function render(d){for(const k of ['title','client','summary'])document.getElementById(k).textContent=d[k]||'';document.getElementById('status').textContent=d.statusLabel||d.status;const steps=document.getElementById('steps');steps.replaceChildren();(d.steps||[]).forEach((s,i)=>{const li=document.createElement('li'),mark=document.createElement('span'),label=document.createElement('span');li.className=s.status||'';mark.className='mark';mark.textContent=s.status==='done'?'✓':String(i+1);label.textContent=s.label;li.append(mark,label);steps.append(li)});const events=document.getElementById('events');events.replaceChildren();(d.events||[]).slice(-8).forEach(e=>{const li=document.createElement('li');li.textContent=e.text;events.append(li)})}render(${json});addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='penecho-mcp-progress')render(e.data.progress)});
      <\/script></body></html>`;
  }
  function syncMcpWidgetProgress(widget) {
    if(!widget.mcpProgress||!widget.hostReady||widget.renderActive===false||widget.mcpSentVersion===widget.contentVersion)return;
    widget.frame?.contentWindow?.postMessage({type:"penecho-mcp-progress",progress:widget.mcpProgress},widget.hostOrigin||location.origin);
    widget.mcpSentVersion=widget.contentVersion;
  }
  async function mcpCreateWidget(item,execution) {
    const result=await canvasAgentCreate({baseRevision:state.userRevision,items:[{type:"widget",widgetType:"html_widget",pluginId:"general",sourceFormat:"penecho-mcp+html",...item}]},
      {...execution,widgetContentViewport:{width:item.contentWidth||item.width,height:item.contentHeight||item.height}});
    canvasAgentAssertToolExecution(execution);
    return canvasAgentObject(result.receipts[0].objectId).item;
  }
  async function mcpWaitForWidgetLoad(widget,execution) {
    const signal=execution.controller.signal;
    if(!widget.hostReady){
      let timer;
      try {
        await waitForWidgetSnapshot(Promise.race([
          widget.hostReadyPromise,
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error("Widget snapshot timed out"),{
            code:"WIDGET_READY_TIMEOUT",details:{widgetId:widget.id,stage:"host-ready",elapsedMs:WIDGET_SNAPSHOT_TIMEOUT_MS},
          })),WIDGET_SNAPSHOT_TIMEOUT_MS);}),
        ]),signal);
      } finally { clearTimeout(timer); }
    }
    canvasAgentAssertToolExecution(execution);
    widget.renderActive=true;widget.shell?.classList.remove("widget-offscreen");sendWidgetInit(widget);sendWidgetHostState(widget,undefined,undefined,true);
    if(widget.mcpDocumentLoaded)return;
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);widget.mcpLoadWaiters?.delete(finish);resolve();},
        abort=()=>{clearTimeout(timer);widget.mcpLoadWaiters?.delete(finish);reject(Error("Preview load was cancelled."));},
        timer=setTimeout(()=>{signal.removeEventListener("abort",abort);widget.mcpLoadWaiters?.delete(finish);reject(Error("Preview did not finish loading. Check external assets and retry."));},10000);
      (widget.mcpLoadWaiters||=new Set()).add(finish);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
    });
  }
  async function mcpCaptureWidget(widget,args,execution) {
      if(!widget.frame?.contentWindow)mountWidget(widget);
      if(!widget.frame?.contentWindow)throw Error("Preview could not be mounted. Check that the General Widget plugin is available.");
      const previousActive=widget.renderActive;
      try {
      await mcpWaitForWidgetLoad(widget,execution);
      const quality=args.quality||"basic",policy=quality==="detail"?CANVAS_AGENT_DETAIL_CAPTURE_POLICY:CANVAS_AGENT_LAYOUT_CAPTURE_POLICY,
        started=performance.now(),snapshot=await requestWidgetSnapshot(widget,WIDGET_SNAPSHOT_TIMEOUT_MS,true,execution.controller.signal,quality==="detail");
      canvasAgentAssertToolExecution(execution);
      const rasterMs=Math.round(performance.now()-started),scale=Math.min(1,policy.maxLongEdge/Math.max(snapshot.width,snapshot.height),Math.sqrt(policy.maxPixels/(snapshot.width*snapshot.height))),canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.floor(snapshot.width*scale));canvas.height=Math.max(1,Math.floor(snapshot.height*scale));canvas.getContext("2d").drawImage(snapshot,0,0,canvas.width,canvas.height);
      const encoded=await canvasAgentCompressedCanvas(canvas,policy,execution),dataUrl=await canvasAgentReadDataUrl(encoded.blob,execution);
      canvasAgentAssertToolExecution(execution);
      const result={dataUrl,mediaType:encoded.blob.type,width:encoded.canvas.width,height:encoded.canvas.height,encodedBytes:encoded.blob.size,quality,
        artifactId:args.artifactId,objectId:widget.id,revision:state.userRevision,viewport:{width:widget.contentW,height:widget.contentH},rasterMs,
        runtimeDiagnostics:widget.runtimeDiagnostics||null};
      canvas.width=canvas.height=1;if(encoded.canvas!==canvas)encoded.canvas.width=encoded.canvas.height=1;
      return result;
      } finally { if(previousActive===false){widget.renderActive=false;widget.shell?.classList.add("widget-offscreen");sendWidgetHostState(widget,undefined,undefined,true);} }
  }
  async function mcpInspectHtml(args,execution) {
    const size=mcpPresentationSize({...args,presentation:{...args.presentation,intent:"inspect"}}),id=`mcp-preview-${canvasClientId()}`,
      widget={id,widgetType:"html_widget",pluginId:"general",sourceFormat:"penecho-mcp+html",title:args.title,html:args.html,x:0,y:0,w:size.width,h:size.height,contentW:size.width,contentH:size.height,contentVersion:0,refreshSeconds:0,mcpEphemeral:true,mcpAssetDocumentId:mcpRuntime.sessions.get(args.sessionId)?.documentId,internalAgent:mcpRuntime.sessions.get(args.sessionId)?.internalAgent===true};
    mcpRuntime.previews.set(id,widget);
    try {
      canvasAgentAssertToolExecution(execution);mountWidget(widget);
      if(widget.shell){widget.shell.setAttribute("aria-hidden","true");widget.shell.inert=true;Object.assign(widget.shell.style,{position:"fixed",left:"-20000px",top:"0",transform:"none",pointerEvents:"none"});}
      const result=await mcpCaptureWidget(widget,args,execution);
      const {objectId,...capture}=result;
      return {...capture,ephemeral:true,presentation:mcpPresentation(args)};
    } finally {unmountWidget(widget);mcpRuntime.previews.delete(id);widget.snapshotImage=null;widget.snapshotDataUrl="";}
  }
  async function mcpExecute(name,args,execution) {
    canvasAgentAssertToolExecution(execution);
    if(name==="mcp_start_session"){
      if(mcpRuntime.sessions.has(args.sessionId))return {sessionId:args.sessionId,boardObjectId:mcpRuntime.sessions.get(args.sessionId).boardObjectId,feedbackCursor:mcpRuntime.sessions.get(args.sessionId).feedbackStart};
      const session={sessionId:args.sessionId,title:args.title,client:args.client||"",status:"working",summary:"",steps:[],events:[],artifacts:new Map(),feedbackStart:mcpRuntime.feedbackSequence};
      session.boardObjectId=null;
      mcpRuntime.sessions.set(args.sessionId,session);mcpRenderSettings();
      return {sessionId:args.sessionId,boardObjectId:null,revision:state.userRevision,feedbackCursor:session.feedbackStart};
    }
    const session=mcpRuntime.sessions.get(args.sessionId);if(!session)throw Error("MCP session is no longer connected to this canvas. Start a new session.");
    if(name==="mcp_read_feedback")return mcpReadFeedback(session,args,execution);
    const board=session.boardObjectId&&canvasAgentObject(session.boardObjectId)?.item;
    if(name==="mcp_update_session"){
      for(const key of ["title","status","summary","steps"])if(args[key]!==undefined)session[key]=args[key];
      if(args.events){const events=new Map(session.events.map(event=>[event.id,event]));for(const event of args.events)events.set(event.id,event);session.events=[...events.values()].slice(-40);}
      // Keep legacy user-owned boards usable; new sessions only update metadata.
      if(board){board.html=mcpBoardHtml(session);board.title=session.title;board.mcpProgress=mcpProgressData(session);board.contentVersion=(board.contentVersion||0)+1;
        board.shell?.setAttribute("aria-label",`${session.title}. ${t("widgetRefineHint")}`);if(board.frame)board.frame.title=session.title;
        board.snapshotVersion=-1;state.userRevision++;syncMcpWidgetProgress(board);}
      session.updatedAt=Date.now();
      if(["done","error"].includes(session.status))save();
      mcpRenderSettings();return {applied:true,visible:mcpSessionVisible(session),revision:state.userRevision};
    }
    if(name==="mcp_draw"||name==="mcp_plot")return mcpPresentPrimitives(session,args,name==="mcp_draw"?"drawing":"plot",execution);
    if(name==="mcp_present_widget"){
      if(args.presentation?.intent==="inspect")return mcpInspectHtml(args,execution);
      if(session.artifacts.get(args.artifactId)?.kind)throw Error("This artifact is a drawing or plot. Use its original tool to update it.");
      let artifact=session.artifacts.get(args.artifactId),widget=artifact&&canvasAgentObject(artifact.objectId)?.item;
      const presentation=mcpPresentation(args,artifact),size=mcpPresentationSize(args);
      if(artifact&&!widget)throw Error("This preview was removed. Use a new artifactId to create another.");
      if(widget){
        const context=widgetEditContext(widget,"agent"),expectedHash=await canvasAgentHash(context);
        canvasAgentAssertToolExecution(execution);
        const command={...context,tool:"html_widget",pluginId:"general",html:args.html,title:args.title,x:widget.x,y:widget.y,w:widget.w,h:widget.h};
        await canvasAgentReplaceWidget({baseRevision:state.userRevision,objectId:widget.id,expectedHash,command},execution);
        canvasAgentAssertToolExecution(execution);
        // Source updates preserve the user's footprint. Explicit geometry edits use
        // penecho_edit_canvas and its revision/collision checks.
      }else{
        const plan=mcpPlanPlacement(size.width,size.height,session,presentation);
        widget=await mcpCreateWidget({title:args.title,html:args.html,width:size.width,height:size.height,contentWidth:size.contentWidth,contentHeight:size.contentHeight,placement:plan.placement},{...execution,preserveView:true});
        canvasAgentAssertToolExecution(execution);
        session.layout=plan.layout;mcpQueueView(session,widget,presentation);
        artifact={objectId:widget.id,title:args.title};session.artifacts.set(args.artifactId,artifact);
      }
      artifact.title=args.title;artifact.presentation=presentation;
      if(presentation.attention==="request")mcpQueueView(session,widget,presentation);
      return {artifactId:args.artifactId,objectId:widget.id,revision:state.userRevision,feedbackCursor:mcpRuntime.feedbackSequence,viewport:{width:widget.contentW,height:widget.contentH},runtimeDiagnostics:widget.runtimeDiagnostics||null,presentation};
    }
    if(name==="mcp_capture_primitives"){
      const artifact=session.artifacts.get(args.artifactId);
      if(!artifact?.kind)throw Error("Drawing or plot not found in this session.");
      if(state.drawing)throw Error("Finish the current stroke before capturing.");
      const bounds=mcpTaskBounds(session,artifact.objectIds);if(!bounds)throw Error("Drawing was removed.");
      const x=Math.max(0,bounds.x-24),y=Math.max(0,bounds.y-24),region={x,y,width:Math.min(SIZE,bounds.x+bounds.w+24)-x,height:Math.min(SIZE,bounds.y+bounds.h+24)-y};
      const capture=await canvasAgentCapture({target:"region",region,quality:args.quality||"basic",coordinates:"metadata"},{execution,signal:execution.controller?.signal,assertCurrent:()=>canvasAgentAssertToolExecution(execution)});
      canvasAgentAssertToolExecution(execution);if(state.drawing)throw Error("Finish the current stroke before capturing.");
      return {...capture,artifactId:args.artifactId,revision:state.userRevision};
    }
    if(name==="mcp_capture_widget"){
      const artifact=session.artifacts.get(args.artifactId);if(!artifact)throw Error("Preview not found in this session. Present the Widget first.");
      const object=canvasAgentObject(artifact.objectId);if(!object)throw Error("Preview was removed.");
      if(object.kind!=="widget")throw Error("This tool captures Widgets only. Read user annotations with penecho_inbox.");
      return mcpCaptureWidget(object.item,args,execution);
    }
    if(name==="mcp_inspect_session")return {sessionId:session.sessionId,boardObjectId:board?.id||null,...mcpProgressData(session),attention:mcpAttentionState(session),artifacts:[...session.artifacts].map(([artifactId,value])=>{const object=canvasAgentObject(value.objectId);return {artifactId,title:value.title,presentation:value.presentation,kind:value.kind||"widget",objectId:value.objectId,...(value.objectIds?{objectIds:value.objectIds,elements:(value.elements||[]).map(([id,entry])=>{const child=canvasAgentObject(entry.objectId);return {id,objectId:entry.objectId,kind:entry.kind,...(child?{bounds:canvasAgentBox(child)}:{removed:true})};})}:{}),...(object?{bounds:value.objectIds?mcpTaskBounds(session,value.objectIds):canvasAgentBox(object)}:{removed:true})};}),revision:state.userRevision};
    if(name==="mcp_close_session"){session.status="done";await mcpExecute("mcp_update_session",{sessionId:args.sessionId,status:"done"},execution);canvasAgentAssertToolExecution(execution);session.closed=true;mcpRuntime.pendingView.delete(session.sessionId);mcpRenderSettings();return {closed:true,retainedOnCanvas:true};}
    throw Error(`Unsupported MCP Canvas operation: ${name}`);
  }
  mcpEl("mcpReconnectCancel")?.addEventListener("click",mcpCancelReconnect);
  addEventListener("penecho:open-cloud-mcp",()=>{if(!mcpRuntime.wanted)mcpConnect();});
  addEventListener("penecho:close-mcp",()=>mcpCancelReconnect());
  addEventListener("penecho:show-mcp-settings",()=>{openSettings();selectSettingsPage("mcp");window.PenEchoMcpSettings?.select("cloud");});
  mcpEl("mcpToolbarToggle")?.addEventListener("click",mcpToolbarClick);
  mcpEl("mcpKeepAwake")?.addEventListener("change",event=>{
    try{localStorage.setItem("penecho-mcp-keep-awake",String(event.target.checked));}catch{}
    void mcpSyncWakeLock();
  });
  mcpEl("mcpEnabled")?.addEventListener("click",event=>{
    if(mcpRuntime.wanted||mcpRuntime.socket)return mcpCancelReconnect();
    try{mcpConnect();}catch{mcpDisconnect(true);setStatus(mcpText(mcpRuntime.wanted?"toolbarCancelRetry":"toolbarRetry"));}
  });
  mcpEl("mcpCanvasNoticeButton")?.addEventListener("pointerdown",event=>event.stopPropagation());
  mcpEl("mcpCanvasNoticeButton")?.addEventListener("click",event=>{event.stopPropagation();openSettings();selectSettingsPage("mcp");});
  mcpEl("mcpShowNewContent")?.addEventListener("pointerdown",event=>event.stopPropagation());
  mcpEl("mcpShowNewContent")?.addEventListener("click",event=>{event.stopPropagation();mcpFlushView(true);});
  mcpEl("viewport")?.addEventListener("pointerdown",mcpPauseView,{capture:true,passive:true});
  mcpEl("viewport")?.addEventListener("wheel",mcpPauseView,{passive:true});
  mcpEl("viewport")?.addEventListener("keydown",event=>{if([" ","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","+","-","="].includes(event.key))mcpPauseView();});
  mcpEl("mcpResetCertificate")?.addEventListener("click",()=>{
    if(mcpRemoteBrowser()||mcpRuntime.lanBusy||!mcpRuntime.status?.http?.hostId)return;
    if(mcpEl("mcpCertificateStatus"))mcpEl("mcpCertificateStatus").textContent="";
    mcpEl("mcpCertificateDialog")?.showModal();
  });
  mcpEl("mcpCertificateCancel")?.addEventListener("click",()=>mcpEl("mcpCertificateDialog")?.close());
  mcpEl("mcpCertificateConfirm")?.addEventListener("click",async()=>{
    if(mcpRemoteBrowser()||mcpRuntime.lanBusy)return;
    const button=mcpEl("mcpCertificateConfirm");button.disabled=true;
    const ok=await mcpLanAction("reset-certificate");button.disabled=false;
    if(ok){mcpRuntime.certificateChanged=true;mcpRuntime.setupCopyCount=0;mcpRuntime.lanMessage="";if(mcpEl("mcpSetupStatus"))mcpEl("mcpSetupStatus").textContent="";mcpEl("mcpCertificateDialog")?.close();if(mcpEl("mcpManual"))mcpEl("mcpManual").open=true;mcpRenderSettings();}
    else if(mcpEl("mcpCertificateStatus"))mcpEl("mcpCertificateStatus").textContent=mcpText("lanFailed");
  });
  mcpEl("mcpRefresh")?.addEventListener("click",()=>void mcpRefreshSettings());
  mcpEl("mcpCopyTroubleshootPrompt")?.addEventListener("click",()=>mcpCopyTroubleshoot());
  mcpEl("mcpClients")?.addEventListener("change",()=>{mcpRuntime.configureResult=null;if(mcpEl("mcpManual"))mcpEl("mcpManual").open=mcpSelectedClient()==="other";mcpRenderSettings();});
  mcpEl("mcpManual")?.addEventListener("toggle",mcpRenderSetupPrompt);
  mcpEl("mcpCopyInstructions")?.addEventListener("click",async()=>{
    if(!mcpCanCopySetup())return;
    const copied=await writeClipboardText(mcpInstructions());
    if(copied)mcpRuntime.setupCopyCount=(mcpRuntime.setupCopyCount||0)+1;
    mcpEl("mcpSetupStatus").textContent=copied?mcpText(mcpRuntime.certificateChanged?"certificateCopied":"copied")+(mcpRuntime.setupCopyCount>1?` (${mcpRuntime.setupCopyCount})`:""):t("copyFailed");
  });
  mcpEl("mcpExamples")?.addEventListener("click",async event=>{
    const button=event.target?.closest?.("[data-mcp-example]");
    if(!button)return;
    const copied=await writeClipboardText(mcpText(button.dataset.mcpExample));
    const status=mcpEl("mcpExampleStatus");
    if(status){status.textContent=copied?mcpText("exampleCopied"):t("copyFailed");clearTimeout(mcpRuntime.exampleStatusTimer);mcpRuntime.exampleStatusTimer=setTimeout(()=>{if(status.textContent===mcpText("exampleCopied"))status.textContent="";},2400);}
    if(copied){button.classList.add("done");setTimeout(()=>button.classList.remove("done"),1600);}
  });
  mcpEl("mcpConfigure")?.addEventListener("click",async()=>{
    if(mcpRuntime.configuring||mcpRemoteBrowser())return;
    const client=mcpSelectedClient(),clientName=client==="codex"?"Codex":client==="claude"?"Claude Code":"Other";
    mcpRuntime.configuring=true;mcpRuntime.configureResult=null;mcpRenderSettings();mcpEl("mcpConfigureStatus")?.scrollIntoView?.({block:"nearest"});
    try{
      const result=await mcpApi("configure",{client});
      if(result.configured===true)mcpRememberSetup();
      mcpRuntime.configureResult={client:clientName,kind:result.configured===true?(result.trustRequired?"trust":result.updated?"updated":"saved"):result.existing?"existing":"uncertain"};
    }catch(error){
      const kind=error.existing?"existing":!error.status?"uncertain":"failed";
      mcpRuntime.configureResult={client:clientName,kind,detail:kind==="failed"?String(error.message):""};
    }finally{mcpRuntime.configuring=false;if(!["saved","updated"].includes(mcpRuntime.configureResult?.kind)&&mcpEl("mcpManual"))mcpEl("mcpManual").open=true;mcpRenderSettings();if(mcpEl("settingsPageMcp")?.hidden===false)mcpEl("mcpConfigureStatus")?.scrollIntoView?.({block:"nearest"});}
  });
  addEventListener("visibilitychange",()=>{void mcpSyncWakeLock();if(!document.hidden&&mcpRuntime.socket){mcpRuntime.lastPong=Date.now();clearTimeout(mcpRuntime.heartbeatTimer);mcpHeartbeat(mcpRuntime.socket);}});
  addEventListener("offline",()=>{if(mcpRuntime.socket)mcpDisconnect(true);});
  addEventListener("pagehide",()=>mcpDisconnect());
