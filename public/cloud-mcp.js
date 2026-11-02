(() => {
  'use strict';
  const element=(tag,attributes={},children=[])=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attributes)){if(key==='text')node.textContent=value;else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else node.setAttribute(key,value);}node.append(...children.filter(Boolean));return node;};
  function mount(root,{api,language='en',origin=location.origin,runtime='dashboard',signIn,signInState=()=>({}),enable,connection=()=>({})}) {
    let zh=language.startsWith('zh');const t=(en,cn)=>zh?cn:en;
    let config=null,token='',tokenGrantId=null,busy=false,mode='token',modeChosen=false,signedOut=false,loadTask=null,manualOpen=false;
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
      root.append(element('header',{class:'cloud-mcp-heading'},[element('h2',{text:t('Connect your AI to PenEcho','连接 AI 与 PenEcho')})]));
      // One line sets up any AI agent: agents.md installs PenEcho and connects it.
      const setupPrompt=t(`Set up PenEcho for me by following ${origin}/agents.md`,`请按照 ${origin}/agents.md 为我安装 PenEcho`);
      const setup=element('div',{class:'cloud-mcp-setup'},[element('code',{class:'cloud-mcp-setup-prompt',text:setupPrompt}),copyButton(t('Copy','复制'),()=>setupPrompt,'primary')]);
      const launchArrow=document.createElementNS('http://www.w3.org/2000/svg','svg');
      launchArrow.setAttribute('viewBox','0 0 20 20');launchArrow.setAttribute('aria-hidden','true');launchArrow.setAttribute('focusable','false');
      const launchArrowPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      launchArrowPath.setAttribute('d','M5 15 15 5M5 5h10v10');launchArrow.append(launchArrowPath);
      const launch=element('a',{href:config?.canvasUrl||`${origin}/mcp-canvas.html`,target:'_blank',rel:'noopener','data-pe-button':'secondary','data-pe-density':'standard','aria-label':t('Open MCP Canvas (opens in a new tab)','打开 MCP 画布（在新标签页打开）'),text:t('Open MCP Canvas','打开 MCP 画布')},[launchArrow]);
      const actions=element('div',{class:'cloud-mcp-actions'},[launch]);
      if(enable) {
        const toggle=button('',async()=>{
          const active=runtime==='local'?config.local?.cloudMcpEnabled&&connection().enabled:connection().enabled;
          await enable(!active);await load();
        });toggle.id='mcpCloudEnable';
        actions.append(toggle,element('span',{id:'mcpCloudAvailability',class:'cloud-mcp-availability',role:'status','aria-live':'polite'}));
      }
      // Other clients connect by address, with OAuth or an access token.
      const manual=element('details',{class:'cloud-mcp-details cloud-mcp-manual',ontoggle:event=>{manualOpen=event.currentTarget.open;}},[element('summary',{text:t('Configure manually','手动配置')})]);
      manual.open=manualOpen;
      const url=element('input',{readonly:'','aria-label':'MCP URL',class:'cloud-mcp-url','data-pe-control':'input'});url.value=config?.url||`${origin}/mcp`;
      const select=element('select',{'aria-label':t('Authentication','认证方式'),'data-pe-control':'select',onchange:event=>{mode=event.target.value;modeChosen=true;render();}},[element('option',{value:'oauth',text:t('OAuth authorization','OAuth 登录授权')}),element('option',{value:'token',text:t('Access token','访问令牌')})]);select.value=mode;
      manual.append(help(t('Streamable HTTP · Server name: penecho-cloud','Streamable HTTP · 服务名：penecho-cloud')),element('div',{class:'cloud-mcp-actions'},[url,copyButton(t('Copy address','复制地址'),()=>url.value)]),select);
      if(mode==='oauth')manual.append(help(t('Sign in and approve access when your AI opens the authorization page.','AI 打开授权页后，由你登录并确认授权。')));
      else {
        const current=config.grants.find(grant=>grant.type==='token');
        const tokenAction=button(current?t('Refresh token','刷新令牌'):t('Generate token','生成令牌'),async()=>{if(current&&!await confirmAction({titleText:t('Refresh access token?','刷新访问令牌？'),descriptionText:t('The old token will stop working immediately. Update every client using it with the new token.','旧令牌将立即失效。刷新后，请为所有使用旧令牌的客户端更新配置。'),actionText:t('Refresh token','刷新令牌')}))return;const result=await api('/api/cloud/mcp/tokens',{method:'POST',body:'{}'});token=result.token;tokenGrantId=result.grant.id;await load();},current?'danger':'primary');
        manual.append(help(token?t('Never expires. Return here anytime to copy it for another AI client.','永久有效，随时回来复制以配置其他 AI 客户端。'):current?t('Keep your first AI connected: restore its existing token here to configure another AI. This does not change the token.','要保留第一个 AI 的连接，请恢复它正在使用的令牌，再配置其他 AI。恢复不会更换令牌。'):t('Generate a permanent token to connect your AI.','先生成永久令牌，再连接你的 AI。')));
        if(token){
          const visible=element('input',{readonly:'','aria-label':t('Access token','访问令牌'),class:'cloud-mcp-url','data-pe-control':'input'});visible.value=token;
          manual.append(visible,element('div',{class:'cloud-mcp-actions'},[copyButton(t('Copy token','复制令牌'),()=>token),tokenAction]),element('h3',{class:'cloud-mcp-section-title',text:t('HTTP headers','HTTP 请求头')}),field(t('HTTP headers','HTTP 请求头'),JSON.stringify({Authorization:`Bearer ${token}`},null,2)),copyButton(t('Copy headers','复制请求头'),()=>JSON.stringify({Authorization:`Bearer ${token}`},null,2)));
        }else if(current){
          const existing=element('input',{type:'text',autocomplete:'off','aria-label':t('Existing access token','已有访问令牌'),placeholder:t('Paste the token from your connected AI client','粘贴已连接 AI 客户端中的令牌'),'data-pe-control':'input',class:'cloud-mcp-url'});
          manual.append(existing,element('div',{class:'cloud-mcp-actions'},[button(t('Restore existing token','恢复已有令牌'),async()=>{if(!existing.value.trim())throw Error(t('Paste your existing token first.','请先粘贴已有令牌。'));await api('/api/cloud/mcp/tokens/restore',{method:'POST',body:JSON.stringify({token:existing.value.trim()})});existing.value='';await load();},'primary'),button(t('Check again','重新检查'),()=>load())]),help(t('You can also let your first AI make an MCP request, then check again here.','也可以让第一个 AI 发起一次 MCP 请求，然后在此重新检查。')),tokenAction);
        }else manual.append(tokenAction);
      }
      root.append(element('div',{class:'cloud-mcp-flow'},[setup,actions,manual]),status);
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
