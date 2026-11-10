(() => {
  'use strict';
  const element=(tag,attributes={},children=[])=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attributes)){if(key==='text')node.textContent=value;else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else node.setAttribute(key,value);}node.append(...children.filter(Boolean));return node;};
  function mount(root,{api,language='en',origin=location.origin,runtime='dashboard',signIn,signInState=()=>({}),enable,connection=()=>({})}) {
    let zh=language.startsWith('zh');const t=(en,cn)=>zh?cn:en;
    let config=null,token='',tokenGrantId=null,busy=false,mode='token',modeChosen=false,signedOut=false,loadTask=null;
    const status=element('p',{class:'cloud-mcp-status',role:'status','aria-live':'polite'});
    let linkedDevice=null;
    const linkWarning=element('p',{class:'cloud-mcp-link-warning',role:'status','aria-live':'polite','data-pe-surface':'alert','data-pe-size':'xs','data-pe-layout':'single','data-pe-material':'opaque'});
    function updateDeviceStatus(value){
      linkedDevice=value;linkWarning.hidden=runtime!=='local'||!linkedDevice||linkedDevice.connected===true;
      linkWarning.textContent=t('Linked Device is offline. Cloud MCP cannot reach this Canvas.','Linked Device 离线，云端 MCP 无法访问此画布。');
    }
    const button=(label,run,kind='secondary')=>element('button',{type:'button','data-pe-button':kind,'data-pe-density':'standard',class:`cloud-button${kind==='primary'?' primary':''}`,text:label,onclick:async event=>{
      if(busy)return;const control=event.currentTarget;busy=true;control.disabled=true;status.textContent='';
      try{await run();}catch(error){status.textContent=error.message||t('Please retry.','请重试。');}finally{busy=false;control.disabled=false;}
    }});
    const copy=async (value,feedback)=>{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else{const field=element('textarea');field.value=value;root.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw Error(t('Select the text and copy it.','请选择文字并复制。'));}feedback.textContent=t('Copied.','已复制。');};
    const copyButton=(label,value,kind='secondary')=>{
      const feedback=element('span',{class:'cloud-mcp-copy-status',role:'status','aria-live':'polite'});
      const control=button(label,async()=>{
        root.querySelectorAll('.cloud-mcp-copy-status').forEach(node=>{node.textContent='';});
        try{await copy(value(),feedback);}catch(error){feedback.textContent=error.message||t('Please retry.','请重试。');}
      },kind);
      return element('div',{class:'cloud-mcp-copy-action'},[control,feedback]);
    };
    const field=(label,value)=>{const input=element('textarea',{readonly:'',rows:'5','aria-label':label,'data-pe-control':'textarea',class:'cloud-mcp-code'});input.value=value;return input;};
    function confirmAction({titleText,descriptionText,actionText}) {
      return new Promise(resolve=>{
        const trigger=document.activeElement;
        const cancel=element('button',{type:'button','data-pe-button':'secondary','data-pe-density':'standard',text:t('Cancel','取消'),onclick:()=>dialog.close('cancel')});
        const confirm=element('button',{type:'button','data-pe-button':'danger-primary','data-pe-density':'standard',text:actionText,onclick:()=>dialog.close('confirm')});
        const title=element('h2',{id:'cloudMcpRefreshTitle',text:titleText});
        const description=element('p',{id:'cloudMcpRefreshDescription',text:descriptionText});
        const dialog=element('dialog',{class:'cloud-mcp-confirm',role:'alertdialog','aria-modal':'true','aria-labelledby':title.id,'aria-describedby':description.id,'data-pe-surface':'alert','data-pe-size':'xs','data-pe-layout':'single','data-pe-presentation':'modal','data-pe-material':'opaque'},[
          element('div',{'data-pe-region':'body'},[element('div',{class:'cloud-mcp-confirm-layout'},[element('span',{class:'cloud-mcp-confirm-icon','aria-hidden':'true',text:'!'}),element('div',{},[title,description])])]),element('footer',{'data-pe-region':'footer'},[cancel,confirm])
        ]);
        dialog.addEventListener('close',()=>{const approved=dialog.returnValue==='confirm';dialog.remove();if(trigger?.isConnected){trigger.disabled=false;trigger.focus({preventScroll:true});}resolve(approved);},{once:true});
        document.body.append(dialog);dialog.showModal();cancel.focus({preventScroll:true});
      });
    }
    // Bootstrap guidance from app.js Settings MCP installation prompt, adapted for Cloud HTTP.
    function skillPrompt() {
      return `${t('After saving and enabling the MCP configuration, create or update the penecho-mcp skill in this Agent’s supported user skill location and format. Use the SKILL.md below; adapt only the wrapper if this client uses another skill format. Preserve unrelated skills. Never save access tokens or OAuth credentials in the skill. Report whether the skill was installed and its location. Save the skill for future conversations; do not execute its tool instructions during installation. If skills are unsupported, report that without blocking MCP setup.','保存并启用 MCP 配置后，请在当前 Agent 支持的用户级 skill 位置，以其支持的格式自动创建或更新 penecho-mcp。使用下方 SKILL.md 内容；若客户端使用其他 skill 格式，仅调整外层格式。保留其他 skill，不要把访问令牌或 OAuth 凭证写入 skill。请报告是否安装成功及保存位置；此 skill 供后续会话使用，安装时只保存内容，不执行其中的工具指令。不支持 skill 时如实说明，不阻塞 MCP 配置。')}

---
name: penecho-mcp
description: Create, read, or edit PenEcho canvases, including following the user's drawings and notes.
---

Use the penecho-cloud MCP server when the user asks to work in PenEcho or on a Canvas, including “echo一下这个想法”, “用 PenEcho 解释这个项目的架构”, “把这个计划整理到画布上”, or “按照我在画布上画的或写的内容来操作”. Ordinary shell echo commands and unrelated canvas mentions are not triggers.

When triggered, read penecho://guidance/skill from this server and follow its current guidance and tool schemas. Load further guidance only as needed for the task.`;
    }
    function prompt() {
      if(mode==='token'&&!token)return '';
      const url=config?.url||`${origin}/mcp`;
      const intro=t(`Please connect the AI client you are running in to my PenEcho Cloud account. Configure an MCP server named penecho-cloud using Streamable HTTP at ${url}. Identify your current client and use its supported MCP setup method. Preserve all other MCP entries; reuse a matching penecho-cloud entry if one already exists.`,`请帮我将你当前所在的 AI 客户端连接到我的 PenEcho Cloud 账户。使用 Streamable HTTP，地址 ${url}，MCP 服务名 penecho-cloud。请先识别当前客户端，再使用它支持的方式完成配置。保留其他所有 MCP 配置；如果已存在配置一致的 penecho-cloud，请复用。`);
      const auth=mode==='oauth'?t(`Use the client's built-in remote MCP OAuth support. Follow these steps:
1. In MCP settings, add or update this server with type HTTP (Streamable HTTP), the URL above, and OAuth enabled. Preserve unrelated entries. Do not configure a local command or a static Authorization header for this OAuth connection.
2. Connect the server. When authorization is required, use its Authorize / Open authorization action. If this requires my click, tell me exactly where to click now and wait for me.
3. I sign in to PenEcho Cloud and approve access in the browser. The client handles OAuth discovery, registration when needed, PKCE, callback, token exchange and renewal, then reconnects. No local PenEcho installation is required.
Use the current client's supported settings flow, not another client's CLI commands. Do not search for CLI executables, scan installation folders, or build a custom OAuth flow. If built-in OAuth is unavailable, report that limitation promptly so I can choose Access token instead.`,`请使用当前客户端内置的远程 MCP OAuth 支持，按以下步骤操作：
1. 在 MCP 设置中添加或更新此服务：类型 HTTP（Streamable HTTP），填写上述地址，启用 OAuth。保留其他配置。此 OAuth 连接不需要本地启动命令，也不要填写固定的 Authorization 请求头。
2. 连接服务，出现需要授权时，使用“授权 / Open authorization”入口。如果必须由我点击，请立即告诉我具体位置并等待。
3. 我在浏览器中登录 PenEcho Cloud 并确认授权。客户端负责 OAuth 发现、按需注册、PKCE、回调、凭证交换与续期，然后重新连接。无需本地安装 PenEcho。
请使用当前客户端支持的设置流程，不要套用其他客户端的 CLI 命令，不要搜索 CLI 可执行文件、扫描安装目录或自行实现 OAuth。如果客户端不支持内置 OAuth，请立即说明，让我改用访问令牌。` ):t(`Use this HTTP header: Authorization: Bearer ${token}. Save the supplied token directly in the current client's supported secure credential or header configuration, and enable the remote MCP connection. Do not ask me to assemble the configuration, commit the token to a repository, or repeat it in your response. No local PenEcho installation is required.`,`使用此 HTTP 请求头：Authorization: Bearer ${token}。请将此令牌直接保存到当前客户端支持的安全凭证或请求头配置中，并启用远程 MCP 连接。不要让我手动拼接配置，不要将令牌提交到仓库，也不要在回复中复述令牌。无需本地安装 PenEcho。`);
      return `${intro}\n\n${auth}\n\n${t('Explicitly enable the penecho-cloud server using this client’s supported configuration or MCP switch; do not leave the entry disabled. If the client supports an enabled flag, set it to true. Preserve all other MCP entries. If enabling requires a user-only action, state the exact action rather than claiming it is enabled. Save the appended skill, then finish setup without testing the connection: do not call tools/list, penecho_list_canvases, start a Canvas session, or create or modify Canvas content. Do not spend this conversation probing or troubleshooting tool availability.','请通过当前客户端支持的配置或 MCP 开关，明确启用 penecho-cloud，不要只保存一个未启用的条目。如果客户端支持 enabled 字段，将其设为 true。保留其他所有 MCP 配置。若启用必须由用户手动操作，请说明具体动作，不要声称已经启用。保存下方 skill 后结束安装，不测试连接：不要调用 tools/list、penecho_list_canvases，不启动画布会话，不创建或修改画布内容，也不要在当前会话探测或排查工具是否可用。')}\n\n${t('When finished, tell me what was configured, whether MCP is enabled, and where the skill was saved; do not claim the connection was tested. Tell me to open a NEW conversation in this AI client so it can load the MCP and skill, and open an MCP Canvas in PenEcho Cloud. Give these typical requests as examples only: “Use PenEcho to explain this project’s architecture”, “Organize this plan on my Canvas”, and “Follow what I drew or wrote on the Canvas”. Do not execute the examples during setup.','完成后告诉我已配置的内容、MCP 是否启用以及 skill 保存位置，不要声称已经测试连接。明确提醒我在当前 AI 客户端新开一个会话，以加载 MCP 和 skill，并在 PenEcho Cloud 打开 MCP 画布。介绍以下典型用法，仅作为示例：“用 PenEcho 解释这个项目的架构”“把这个计划整理到我的画布上”“按照我在画布上画的或写的内容来操作”。安装时不要执行这些示例。')}\n\n${skillPrompt()}`;
    }
    function render() {
      if(!root.isConnected)return;
      root.replaceChildren();root.classList.add('cloud-mcp-panel');updateDeviceStatus(linkedDevice);root.append(linkWarning);
      if(!config) {
        root.append(element('h2',{text:t('Cloud MCP','云端 MCP')}),element('p',{class:'cloud-mcp-help',text:signedOut?t('Sign in to connect your AI to Cloud and local canvases with one MCP address. Local MCP works without an account.','登录后，用同一个 MCP 地址连接云端和本地画布。本地 MCP 无需注册或登录。'):t('Loading Cloud settings…','正在加载云端设置…')}));
        if(signedOut){
          const login=signInState();
          root.append(element('a',{href:login.active&&login.url?login.url:`${origin}/auth.html`,target:'_blank',rel:'noopener',class:'cloud-button primary','data-pe-button':'primary','data-pe-density':'standard',text:login.active?t('Open sign-in page','打开登录页面'):t('Sign in to PenEcho Cloud','登录 PenEcho Cloud'),onclick:async event=>{if(!signIn||login.active)return;event.preventDefault();try{await signIn();render();}catch(error){status.textContent=error.message;}}}));
          if(login.message)root.append(element('p',{class:'cloud-mcp-help',role:'status',text:login.message}));
        }
        root.append(status);return;
      }
      const help=text=>element('p',{class:'cloud-mcp-help',text});
      const details=(label,children)=>element('section',{class:'cloud-mcp-details'},[element('h3',{class:'cloud-mcp-section-title',text:label}),...children]);
      const step=(number,title,children)=>element('section',{class:'cloud-mcp-step'},[
        element('h3',{class:'cloud-mcp-step-title'},[element('span',{class:'cloud-mcp-step-number',text:String(number)}),document.createTextNode(title)]),
        element('div',{class:'cloud-mcp-step-body'},children)
      ]);
      root.append(element('header',{class:'cloud-mcp-heading'},[element('div',{},[element('h2',{text:t('Connect your AI to PenEcho','连接 AI 与 PenEcho')}),help(t('Give your AI assistant a Canvas to work on.','让你的 AI 助手在画布上工作。'))])]));
      const select=element('select',{'aria-label':t('Authentication','认证方式'),'data-pe-control':'select',onchange:event=>{mode=event.target.value;modeChosen=true;render();}},[element('option',{value:'oauth',text:t('OAuth authorization','OAuth 登录授权')}),element('option',{value:'token',text:t('Access token','访问令牌')})]);select.value=mode;
      const authentication=step(1,t('Choose authentication','选择认证方式'),[select]);
      const authBody=authentication.lastElementChild;
      if(mode==='oauth')authBody.append(help(t('Sign in and approve access when your AI opens the authorization page.','AI 打开授权页后，由你登录并确认授权。')));
      else {
        const current=config.grants.find(grant=>grant.type==='token');
        const tokenAction=button(current?t('Refresh token','刷新令牌'):t('Generate token','生成令牌'),async()=>{if(current&&!await confirmAction({titleText:t('Refresh access token?','刷新访问令牌？'),descriptionText:t('The old token will stop working immediately. Update every client using it with the new token.','旧令牌将立即失效。刷新后，请为所有使用旧令牌的客户端更新配置。'),actionText:t('Refresh token','刷新令牌')}))return;const result=await api('/api/cloud/mcp/tokens',{method:'POST',body:'{}'});token=result.token;tokenGrantId=result.grant.id;await load();},current?'danger':'primary');
        authBody.append(help(token?t('Never expires. Return here anytime to copy it for another AI client.','永久有效，随时回来复制以配置其他 AI 客户端。'):current?t('Keep your first AI connected: restore its existing token here to configure another AI. This does not change the token.','要保留第一个 AI 的连接，请恢复它正在使用的令牌，再配置其他 AI。恢复不会更换令牌。'):t('Generate a permanent token to connect your AI.','先生成永久令牌，再连接你的 AI。')));
        if(token){
          const visible=element('input',{readonly:'','aria-label':t('Access token','访问令牌'),class:'cloud-mcp-url','data-pe-control':'input'});visible.value=token;
          authBody.append(visible,element('div',{class:'cloud-mcp-actions'},[copyButton(t('Copy token','复制令牌'),()=>token),tokenAction]),element('h3',{class:'cloud-mcp-section-title',text:t('HTTP headers','HTTP 请求头')}),field(t('HTTP headers','HTTP 请求头'),JSON.stringify({Authorization:`Bearer ${token}`},null,2)),copyButton(t('Copy headers','复制请求头'),()=>JSON.stringify({Authorization:`Bearer ${token}`},null,2)));
        }else if(current){
          const existing=element('input',{type:'text',autocomplete:'off','aria-label':t('Existing access token','已有访问令牌'),placeholder:t('Paste the token from your connected AI client','粘贴已连接 AI 客户端中的令牌'),'data-pe-control':'input',class:'cloud-mcp-url'});
          authBody.append(existing,element('div',{class:'cloud-mcp-actions'},[button(t('Restore existing token','恢复已有令牌'),async()=>{if(!existing.value.trim())throw Error(t('Paste your existing token first.','请先粘贴已有令牌。'));await api('/api/cloud/mcp/tokens/restore',{method:'POST',body:JSON.stringify({token:existing.value.trim()})});existing.value='';await load();},'primary'),button(t('Check again','重新检查'),()=>load())]),help(t('You can also let your first AI make an MCP request, then check again here.','也可以让第一个 AI 发起一次 MCP 请求，然后在此重新检查。')),tokenAction);
        }else authBody.append(tokenAction);
      }
      const ready=mode==='oauth'||Boolean(token);
      const setup=step(2,t('Let your AI connect','交给 AI 配置'),[]);
      const setupBody=setup.lastElementChild;
      if(ready){
        setupBody.append(help(mode==='token'?t('Paste into your AI chat. Your token is already included.','粘贴给 AI 助手即可，已包含你的令牌。'):t('Copy and paste into your AI assistant’s chat.','复制后，粘贴到 AI 助手的对话中。')),element('div',{class:'cloud-mcp-prompt'},[copyButton(t('Copy installation prompt','复制安装提示词'),prompt,'primary'),field(t('Installation prompt','安装提示词'),prompt())]));
      }else setupBody.append(help(t('Available after you generate or restore the token above.','生成或恢复上方令牌后，即可复制。')));
      const url=element('input',{readonly:'','aria-label':'MCP URL',class:'cloud-mcp-url','data-pe-control':'input'});url.value=config?.url||`${origin}/mcp`;
      setupBody.append(details(t('Configure manually','手动配置'),[help(t('Streamable HTTP · Server name: penecho-cloud','Streamable HTTP · 服务名：penecho-cloud')),element('div',{class:'cloud-mcp-actions'},[url,copyButton(t('Copy address','复制地址'),()=>url.value)])]));
      const launchArrow=document.createElementNS('http://www.w3.org/2000/svg','svg');
      launchArrow.setAttribute('viewBox','0 0 20 20');launchArrow.setAttribute('aria-hidden','true');launchArrow.setAttribute('focusable','false');
      const launchArrowPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      launchArrowPath.setAttribute('d','M5 15 15 5M5 5h10v10');launchArrow.append(launchArrowPath);
      const launch=element('a',{href:config?.canvasUrl||`${origin}/mcp-canvas.html`,target:'_blank',rel:'noopener','data-pe-button':'primary','data-pe-density':'standard','aria-label':t('Open MCP Canvas (opens in a new tab)','打开 MCP 画布（在新标签页打开）'),text:t('Open MCP Canvas','打开 MCP 画布')},[launchArrow]);
      const workspace=step(3,t('Open your Canvas','打开画布'),[help(t('Once connected, open a Canvas and keep it open while your AI works.','连接后打开画布，AI 工作期间保持画布开启。')),launch]);
      if(enable) {
        const toggle=button('',async()=>{
          const active=runtime==='local'?config.local?.cloudMcpEnabled&&connection().enabled:connection().enabled;
          await enable(!active);await load();
        });toggle.id='mcpCloudEnable';
        workspace.lastElementChild.append(element('div',{class:'cloud-mcp-actions'},[toggle,element('span',{id:'mcpCloudAvailability',class:'cloud-mcp-availability',role:'status','aria-live':'polite'})]));
      }
      root.append(element('div',{class:'cloud-mcp-flow'},[authentication,setup,workspace]),status);
      const list=details(t('Authorized connections','已授权连接'),[]);
      if(!config.grants.length)list.append(help(t('No authorized connections yet.','暂无已授权连接。')));
      for(const grant of config.grants)list.append(element('div',{class:'cloud-mcp-grant','data-pe-list':'settings'},[element('div',{'data-pe-region':'copy'},[element('strong',{text:grant.name}),element('small',{text:`${grant.type==='oauth'?'OAuth':t('Token','令牌')} · ${grant.expiresAt==null?t('Never expires','永久有效'):`${t('Expires','到期')} ${new Date(grant.expiresAt).toLocaleDateString(zh?'zh-CN':'en-US')}`} `})]),button(t('Invalidate','使授权失效'),async()=>{if(!await confirmAction({titleText:t('Invalidate this authorization?','使此授权失效？'),descriptionText:t('Clients using this authorization will disconnect. Reconnect them to grant access again.','使用此授权的客户端将断开连接，需重新授权才能继续使用。'),actionText:t('Invalidate','使授权失效')}))return;await api(`/api/cloud/mcp/grants/${encodeURIComponent(grant.id)}`,{method:'DELETE'});await load();},'danger')]));
      root.append(element('aside',{class:'cloud-mcp-support'},[list,details(t('Local canvases','本地画布'),[help(runtime==='local'?t('Enabling this Canvas through Cloud also enables Linked Device.','通过云端开启当前画布时，会同时启用 Linked Device。'):t('To use local canvases, folders and model connections, enable Linked Device on that computer.','使用本地画布、文件夹和模型配置时，请在对应电脑启用 Linked Device。'))])]));
      updateConnection();
    }
    function updateConnection(){const toggle=root.querySelector('#mcpCloudEnable');if(!toggle)return;const state=connection(),active=runtime==='local'?config?.local?.cloudMcpEnabled&&state.enabled:state.enabled;toggle.textContent=active?t('Turn off Cloud MCP','关闭云端 MCP'):t('Enable Cloud MCP','开启云端 MCP');toggle.setAttribute('aria-pressed',String(Boolean(active)));const notice=root.querySelector('#mcpCloudAvailability');notice.hidden=!state.enabled;notice.textContent=state.label||t('MCP · Connecting…','MCP · 连接中…');}
    async function load(){
      if(loadTask)return loadTask;
      loadTask=(async()=>{try{const [settings,credential]=await Promise.all([api('/api/cloud/mcp'),api('/api/cloud/mcp/tokens')]);config=settings;if(config.local?.device)updateDeviceStatus(config.local.device);token=credential.token||'';tokenGrantId=credential.grant?.id||null;if(!modeChosen&&credential.grant)mode='token';signedOut=false;status.textContent='';}catch(error){if(error.status===401||error.code==='cloud_sign_in_required'){config=null;token='';signedOut=true;updateDeviceStatus({connected:false});}else{status.textContent=error.message;throw error;}}finally{render();}})().finally(()=>{loadTask=null;});return loadTask;
    }
    render();load().catch(error=>{status.textContent=error.message;root.append(button(t('Retry','重试'),load));});
    return {refresh:load,updateConnection,updateDeviceStatus,setLanguage:value=>{zh=value.startsWith('zh');render();}};
  }
  window.PenEchoCloudMcp={mount};
})();
