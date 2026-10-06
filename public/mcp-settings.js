(() => {
  'use strict';
  function mountIpDirect(root) {
    root.innerHTML = `
      <header class="mcp-ip-heading"><div><h2 data-ip-label="heading"></h2><p data-ip-label="description" class="mcp-hint"></p></div><span id="mcpIpBadge" class="mcp-pill" role="status" aria-live="polite"></span></header>
      <div class="mcp-ip-flow">
        <section class="mcp-ip-step"><span class="mcp-step-badge">1</span><div>
          <div class="mcp-ip-title"><h3 data-ip-label="address"></h3><button id="mcpIpEdit" data-pe-button="ghost" data-pe-density="compact" type="button" data-ip-label="edit" hidden></button></div>
          <p class="mcp-hint" data-ip-label="addressHelp"></p>
          <div id="mcpIpFields" class="mcp-ip-fields"><label><span data-ip-label="protocol"></span><input value="HTTPS" data-pe-control="input" readonly aria-label="Protocol"></label><label><span data-ip-label="ip"></span><input id="mcpIpHost" data-pe-control="input" autocomplete="off" inputmode="decimal" placeholder="192.168.1.80" aria-describedby="mcpIpAddressHint"></label><label><span data-ip-label="port"></span><input id="mcpIpPort" data-pe-control="input" inputmode="numeric" autocomplete="off"></label></div>
          <div class="mcp-ip-endpoint"><div><small data-ip-label="url"></small><code id="mcpIpUrl"></code></div><button id="mcpIpCopyUrl" type="button" data-pe-button="ghost" data-pe-density="compact" data-ip-label="copy"></button></div>
          <p id="mcpIpAddressHint" class="mcp-hint" data-ip-label="addressNote"></p>
          <p id="mcpIpChanged" class="mcp-ip-notice" data-ip-label="addressChanged" hidden></p>
        </div></section>
        <section class="mcp-ip-step"><span class="mcp-step-badge">2</span><div>
          <div class="mcp-ip-title"><h3>Access Token</h3><small id="mcpIpTokenState"></small></div><p class="mcp-hint" data-ip-label="tokenHelp"></p>
          <div id="mcpIpTokenEmpty" class="mcp-ip-actions"><button id="mcpIpGenerate" type="button" data-pe-button="primary" data-pe-density="standard" data-ip-label="generate"></button></div>
          <div id="mcpIpTokenReady" hidden><div class="mcp-ip-token"><input id="mcpIpToken" type="password" readonly autocomplete="off" data-pe-control="input" aria-label="Access Token"><button id="mcpIpShowToken" type="button" data-pe-button="ghost" data-pe-density="compact"></button><button id="mcpIpCopyToken" type="button" data-pe-button="secondary" data-pe-density="standard" data-ip-label="copyToken"></button></div><div class="mcp-ip-title"><p class="mcp-hint" data-ip-label="tokenNote"></p><button id="mcpIpRotate" type="button" data-pe-button="ghost" data-pe-density="compact" data-ip-label="rotate"></button></div></div>
        </div></section>
        <section class="mcp-ip-step"><span class="mcp-step-badge">3</span><div>
          <h3 data-ip-label="setup"></h3><p id="mcpIpSetupHelp" class="mcp-hint"></p>
          <div class="mcp-ip-actions"><button id="mcpIpCopySetup" type="button" data-pe-button="primary" data-pe-density="standard"></button><button id="mcpIpOpen" type="button" data-pe-button="secondary" data-pe-density="standard" data-ip-label="open"></button></div>
          <p class="mcp-hint" data-ip-label="conversation"></p>
          <details class="mcp-ip-details"><summary data-ip-label="manual"></summary><dl><dt data-ip-label="transport"></dt><dd>Streamable HTTP</dd><dt data-ip-label="url"></dt><dd><code id="mcpIpManualUrl"></code></dd><dt data-ip-label="authentication"></dt><dd>Authorization: Bearer &lt;Access Token&gt;</dd><dt data-ip-label="serverName"></dt><dd>penecho-local</dd></dl><button id="mcpIpCopyConfig" type="button" data-pe-button="secondary" data-pe-density="standard" data-ip-label="copyConfig"></button></details>
        </div></section>
      </div>
      <div class="mcp-ip-service"><div><strong data-ip-label="service"></strong><p id="mcpIpServiceHelp" class="mcp-hint"></p></div><button id="mcpIpEnabled" type="button" role="switch" aria-checked="false" data-pe-control="switch"><span class="settings-switch-thumb" aria-hidden="true"></span></button></div>
      <p id="mcpIpHostOnly" class="mcp-ip-notice" data-ip-label="hostOnly" hidden></p>
      <div class="mcp-ip-feedback"><p id="mcpIpStatus" role="status" aria-live="polite"></p><button id="mcpIpRefresh" type="button" data-pe-button="ghost" data-pe-density="compact" data-ip-label="refresh"></button></div>
      <details class="mcp-ip-details"><summary data-ip-label="requirements"></summary><p class="mcp-hint" data-ip-label="network"></p><p class="mcp-hint" data-ip-label="certificate"></p><div class="mcp-ip-actions"><button id="mcpIpCopyCa" type="button" data-pe-button="secondary" data-pe-density="standard" data-ip-label="copyCa"></button></div><p id="mcpIpListener" class="mcp-hint"></p></details>
      <dialog id="mcpIpEditDialog" data-pe-surface="alert" data-pe-size="s" data-pe-layout="single" data-pe-presentation="modal" data-pe-material="opaque" class="studio-session-delete-dialog mcp-ip-dialog" aria-modal="true" aria-labelledby="mcpIpEditTitle" aria-describedby="mcpIpEditDescription"><div class="studio-session-delete-copy" data-pe-region="body"><h2 id="mcpIpEditTitle" data-ip-label="editTitle"></h2><p id="mcpIpEditDescription" data-ip-label="editHelp"></p><div class="mcp-ip-fields edit"><label><span data-ip-label="ip"></span><input id="mcpIpNewHost" data-pe-control="input" autocomplete="off" inputmode="decimal"></label><label><span data-ip-label="port"></span><input id="mcpIpNewPort" data-pe-control="input" inputmode="numeric" autocomplete="off"></label></div><p class="mcp-ip-notice" data-ip-label="editNotice"></p><p id="mcpIpEditError" role="alert"></p></div><footer class="studio-session-delete-actions" data-pe-region="footer"><button type="button" id="mcpIpEditCancel" data-pe-button="secondary" data-pe-density="standard" data-ip-label="cancel"></button><button type="button" id="mcpIpSave" data-pe-button="primary" data-pe-density="standard" data-ip-label="save"></button></footer></dialog>
      <dialog id="mcpIpRotateDialog" data-pe-surface="alert" data-pe-size="s" data-pe-layout="single" data-pe-presentation="modal" data-pe-material="opaque" class="studio-session-delete-dialog mcp-ip-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mcpIpRotateTitle" aria-describedby="mcpIpRotateDescription"><div class="studio-session-delete-copy" data-pe-region="body"><h2 id="mcpIpRotateTitle" data-ip-label="rotateTitle"></h2><p id="mcpIpRotateDescription" data-ip-label="rotateHelp"></p><p id="mcpIpRotateError" role="alert"></p></div><footer class="studio-session-delete-actions" data-pe-region="footer"><button type="button" id="mcpIpRotateCancel" data-pe-button="secondary" data-pe-density="standard" data-ip-label="cancel"></button><button type="button" id="mcpIpRotateConfirm" data-pe-button="danger-primary" data-pe-density="standard" data-ip-label="rotateConfirm"></button></footer></dialog>`;
    const el = id => root.querySelector('#' + id);
    const strings = {
      heading:['Connect your AI by IP','通过 IP 连接你的 AI'],
      description:['For a fixed-IP computer or server. Connect using an address and Access Token.','适合固定 IP 的电脑或服务器。使用地址和 Access Token 直接连接。'],
      address:['Confirm the access address','确认访问地址'], addressHelp:['Enter the address where your AI can reach this PenEcho host.','填写 AI 客户端可以访问到的 PenEcho 主机地址。'],
      edit:['Change IP','修改 IP'], protocol:['Protocol','协议'], ip:['IP address','IP 地址'], port:['Port','端口'], url:['MCP address','MCP 地址'], copy:['Copy','复制'],
      addressNote:['This saves the connection address; it does not change your network settings.','这里仅保存连接地址，不会修改电脑的网络设置。'],
      addressChanged:['Address updated. Your token stays valid. Copy the update prompt below for existing AI clients.','地址已更新，Access Token 保持有效。请复制下方更新提示词，让已有 AI 客户端使用新地址。'],
      tokenHelp:['Authorize AI to access canvases enabled for MCP on this host. No Cloud account is required.','授权 AI 访问这台主机上已开启 MCP 的画布，无需登录云端账户。'],
      generate:['Generate token and enable service','生成令牌并开启服务'], copyToken:['Copy token','复制令牌'], tokenNote:['Never expires · Changing IP keeps this token','永久有效 · 修改 IP 不影响令牌'], rotate:['Regenerate…','重新生成…'],
      setup:['Let your AI configure the connection','交给 AI 配置'], open:['Open MCP Canvas ↗','打开 MCP 画布 ↗'], conversation:['After configuration, start a new AI conversation. Keep PenEcho and the Canvas open while AI works.','配置后在 AI 客户端新开对话；AI 工作时保持 PenEcho 和画布开启。'],
      manual:['Configure manually','手动配置'], transport:['Connection type','连接类型'], authentication:['Authentication','身份验证'], serverName:['Server name','服务名'], copyConfig:['Copy configuration','复制配置'],
      service:['IP direct service','IP 直连服务'], hostOnly:['Manage this connection on the PenEcho host. You can copy an existing connection from this trusted LAN device.','请在运行 PenEcho 的主机上管理此连接。当前可信局域网设备可以复制已有连接配置。'], refresh:['Check again','重新检查'],
      requirements:['Connection requirements and HTTPS certificate','连接要求与 HTTPS 证书'],
      network:['The AI device must reach this IP and port, over LAN, VPN, or your configured public network entry. Use an IPv4 address belonging to this PenEcho host.','AI 所在设备需要能通过局域网、VPN 或已配置的公网入口访问此 IP 和端口。请填写属于这台 PenEcho 主机的 IPv4 地址。'],
      certificate:['First connection requires trusting this host’s HTTPS CA in your AI client. The setup prompt includes the certificate. Clients without private CA support require a trusted HTTPS entry.','首次连接需要在 AI 客户端信任此主机的 HTTPS 证书，安装提示词已包含证书。不支持私有证书的客户端需要受信任的 HTTPS 入口。'], copyCa:['Copy CA certificate','复制 CA 证书'],
      editTitle:['Change the connection address','修改连接地址'], editHelp:['Update the address for the same PenEcho host. The Access Token stays valid.','更新同一台 PenEcho 主机的地址，Access Token 保持有效。'], editNotice:['Existing AI clients need the new address. Their fixed-IP sessions will disconnect until they reconnect.','已有 AI 客户端需要更新地址。当前 IP 直连会话会断开，更新后重新连接。'], cancel:['Cancel','取消'], save:['Save new address','保存新地址'],
      rotateTitle:['Regenerate Access Token?','重新生成 Access Token？'], rotateHelp:['The old IP direct token stops working immediately. Update all clients using it. Automatic discovery connections keep working.','旧的 IP 直连令牌将立即失效。请更新所有使用它的 AI 客户端；自动发现连接可继续使用。'], rotateConfirm:['Regenerate token','重新生成令牌'],
    };
    let status = null, busy = false, visible = false, edited = false, tokenVisible = false, editRevision = 0, rotateRevision = 0;
    let language = document.documentElement.lang || 'en';
    const t = (en,zh) => language.startsWith('zh') ? zh : en;
    const token = () => status?.http?.ipDirect?.accessToken || '';
    const fixed = () => status?.http?.ipDirect;
    const url = () => (!edited && fixed()?.url) || (el('mcpIpHost').value && el('mcpIpPort').value ? `https://${el('mcpIpHost').value.trim()}:${el('mcpIpPort').value.trim()}/mcp` : '');
    const hostApi = () => window.PenEchoLocalMcp;
    const canEdit = () => status?.canConfigureLocalClients === true;
    const controls = ['mcpIpGenerate','mcpIpEdit','mcpIpRotate','mcpIpEnabled','mcpIpSave','mcpIpRotateConfirm'];
    function errorText(error) {
      if(error.code==='invalid_ip_address')return t('Enter a valid IPv4 address.','请输入有效的 IPv4 地址。');
      if(error.code==='invalid_ip_port')return t('The port must be between 1 and 65535.','端口范围为 1–65535。');
      if(error.code==='ip_settings_changed')return t('Settings changed in another window. Cancel and reopen this dialog before saving.','配置已被其他窗口修改，请取消并重新打开后再保存。');
      if(error.code==='local_host_required')return t('Manage this connection on the PenEcho host.','请在运行 PenEcho 的主机上管理此连接。');
      if(error.code==='ip_token_required')return t('Generate an IP direct token first.','请先生成 IP 直连令牌。');
      return t('Connection settings could not be saved or loaded. Try again.','连接设置保存或加载失败，请重试。');
    }
    function feedback(text,error=false) {el('mcpIpStatus').textContent=text;el('mcpIpStatus').classList.toggle('error',error);}
    function render() {
      for(const node of root.querySelectorAll('[data-ip-label]')) {const pair=strings[node.dataset.ipLabel];if(pair)node.textContent=t(...pair);}
      const data=fixed(),ready=Boolean(token()),enabled=Boolean(data?.enabled),available=Boolean(data?.serviceAvailable);
      const initial=data?.host || (()=>{try{return new URL(status?.http?.urls?.[0] || status?.http?.localUrl).hostname;}catch{return '';}})();
      if(!edited){el('mcpIpHost').value=initial;el('mcpIpPort').value=String(data?.port || data?.listenerPort || '');}
      el('mcpIpFields').hidden=ready;el('mcpIpEdit').hidden=!ready;
      el('mcpIpTokenEmpty').hidden=ready;el('mcpIpTokenReady').hidden=!ready;
      el('mcpIpToken').value=token();el('mcpIpToken').type=tokenVisible?'text':'password';
      el('mcpIpShowToken').textContent=tokenVisible?t('Hide','隐藏'):t('Show','显示');
      el('mcpIpTokenState').textContent=ready?t('Generated','已生成'):t('Not generated','未生成');
      el('mcpIpUrl').textContent=url() || t('Waiting for the host service','等待主机服务');el('mcpIpManualUrl').textContent=url();
      el('mcpIpChanged').hidden=!data?.previousUrl;
      el('mcpIpCopySetup').textContent=data?.previousUrl?t('Copy address update prompt','复制更新地址提示词'):t('Copy installation prompt','复制安装提示词');
      el('mcpIpSetupHelp').textContent=!ready?t('Generate a token, then copy the setup prompt to your AI.','生成令牌后，复制安装提示词到你的 AI 对话。'):data?.previousUrl?t('Update the client address and keep its current token.','只更新客户端地址，继续使用当前令牌。'):t('The prompt includes your address, token and certificate. Paste it into your AI conversation.','地址、令牌和证书已包含在提示词中，粘贴给 AI 即可。');
      const badge=el('mcpIpBadge'),count=data?.sessionCount || 0;
      badge.textContent=!status?t('Loading…','正在加载…'):!available?t('Service unavailable','服务不可用'):!ready?t('Not configured','尚未配置'):!enabled?t('Service off','服务已关闭'):count?t(`${count} AI connected`,`${count} 个 AI 已连接`):t('Waiting for AI','等待 AI 连接');
      badge.dataset.state=count&&enabled?'on':enabled?'pending':'off';
      for(const id of controls)el(id).disabled=busy||!canEdit()||!available;
      for(const id of ['mcpIpCopySetup','mcpIpCopyConfig','mcpIpOpen'])el(id).disabled=busy||!ready||!enabled||!available;
      el('mcpIpCopyToken').disabled=busy||!ready;el('mcpIpCopyCa').disabled=busy||!status?.http?.certificatePem;
      el('mcpIpCopyUrl').disabled=busy||!url();el('mcpIpRefresh').disabled=busy;
      el('mcpIpHost').disabled=busy||!canEdit();el('mcpIpPort').disabled=busy||!canEdit();
      el('mcpIpEnabled').disabled||=!ready;el('mcpIpEnabled').setAttribute('aria-checked',String(enabled));el('mcpIpEnabled').setAttribute('aria-label',t(...strings.service));
      el('mcpIpHostOnly').hidden=!status||canEdit();
      el('mcpIpServiceHelp').textContent=enabled?t('Service enabled. Only IP direct clients use this switch.','服务已开启。此开关仅控制 IP 直连客户端。'):ready?t('Service off. Your address and token are saved.','服务已关闭，地址和令牌已保留。'):t('Generate a token to enable IP direct.','生成令牌后开启 IP 直连。');
      el('mcpIpListener').textContent=data?.listenerPort?t(`Host listening port: ${data.listenerPort}. For NAT, forward your external port to this port.`,`主机监听端口：${data.listenerPort}。使用公网转发时，将外部端口转发到此端口。`):'';
      el('mcpIpHost').setAttribute('aria-label',t(...strings.ip));el('mcpIpPort').setAttribute('aria-label',t(...strings.port));
    }
    function setStatus(value) {
      if(!value)return;
      // A status request sent before a mutation may finish afterward. Preserve
      // the newer saved configuration while accepting other host status fields.
      if(value.http?.ipDirect&&fixed()&&value.http.ipDirect.revision<fixed().revision)value={...value,http:{...value.http,ipDirect:fixed()}};
      status=value;render();
    }
    async function refresh() {
      if(busy||!hostApi())return;
      busy=true;render();
      try {setStatus(await hostApi().api('status'));feedback(t('Host status checked. Verify network reachability from your AI device.','已检查本机服务状态，请从 AI 所在设备确认网络可达。'));}
      catch(error){feedback(errorText(error),true);}finally{busy=false;render();}
    }
    async function action(body,dialogError) {
      if(busy)return false;
      busy=true;render();
      try {
        const result=await hostApi().api('ip-direct',{...body,revision:body.revision ?? fixed()?.revision ?? 0});
        edited=false;status={...status,http:result.http};render();feedback(t('Saved.','已保存。'));void hostApi().refresh();return true;
      } catch(error) {feedback(errorText(error),true);if(dialogError)el(dialogError).textContent=errorText(error);return false;}
      finally {busy=false;render();}
    }
    function config() {return {mcpServers:{'penecho-local':{type:'http',url:url(),headers:{Authorization:`Bearer ${token()}`}}}};}
    function setupPrompt() {
      const update=fixed()?.previousUrl?`Update only the existing penecho-local MCP connection from ${fixed().previousUrl} to ${url()}. Keep its current Access Token and private CA trust. If the entry is missing, configure the new connection using the current credentials below. If it belongs to a different PenEcho host or token, ask before replacing it. Preserve unrelated MCP entries.\n\n`:'';
      return `${update}Connect this AI client directly to my PenEcho host with Streamable HTTP. Server name: penecho-local. URL: ${url()}. Access Token: ${token()}.

Use the Authorization HTTP header with Bearer authentication. Save the token in this client's supported secure credential or HTTP header configuration. Preserve all unrelated MCP entries; update a matching penecho-local entry rather than creating duplicates. Enable the MCP server. This fixed-IP connection uses the address above directly and does not require a local discovery connector. Never commit or print the token.

This host uses a private HTTPS CA. Save the following public CA certificate to a local PEM file and configure trust using this client's supported launch or certificate settings. Do not disable TLS certificate validation. NODE_EXTRA_CA_CERTS applies to the actual Node client process; it is not a per-server HTTP setting. A client without private CA support needs a trusted HTTPS entry; report that limitation promptly.

${status.http.certificatePem}

Reload the client through its supported flow. Verify initialize and tools/list; report the actual result without creating or changing Canvas content. Create or update a small penecho-mcp skill in this client's supported local skill format: use this penecho-local server for PenEcho Canvas requests and read penecho://guidance/skill for current tool instructions. Do not store tokens or certificates in the skill. Keep other skills. After configuration, open a NEW AI conversation and keep a PenEcho MCP Canvas open on the host. When the IP changes, update only this server's URL and retain its token and CA trust. A different PenEcho host requires that host's own credentials.`;
    }
    async function copy(value) {
      try {const ok=await hostApi().copy(value);if(ok===false)throw Error();feedback(t('Copied.','已复制。'));}
      catch{feedback(t('Could not copy. Allow clipboard access and retry.','复制失败，请允许剪贴板访问后重试。'),true);}
    }
    for(const id of ['mcpIpHost','mcpIpPort'])el(id).addEventListener('input',()=>{edited=true;el('mcpIpUrl').textContent=url();});
    el('mcpIpRefresh').addEventListener('click',refresh);
    el('mcpIpGenerate').addEventListener('click',async()=>{if(await action({action:'generate-token',host:el('mcpIpHost').value.trim(),port:Number(el('mcpIpPort').value)}))hostApi().enable();});
    el('mcpIpCopyUrl').addEventListener('click',()=>copy(url()));el('mcpIpCopyToken').addEventListener('click',()=>copy(token()));
    el('mcpIpCopySetup').addEventListener('click',()=>copy(setupPrompt()));el('mcpIpCopyConfig').addEventListener('click',()=>copy(JSON.stringify(config(),null,2)));el('mcpIpCopyCa').addEventListener('click',()=>copy(status.http.certificatePem));
    el('mcpIpShowToken').addEventListener('click',()=>{tokenVisible=!tokenVisible;render();});
    el('mcpIpOpen').addEventListener('click',()=>hostApi().openCanvas());
    el('mcpIpEnabled').addEventListener('click',async()=>{const enabled=!fixed().enabled;if(await action({action:'set-enabled',enabled})&&enabled)hostApi().enable();});
    el('mcpIpEdit').addEventListener('click',()=>{editRevision=fixed().revision;el('mcpIpNewHost').value=fixed().host;el('mcpIpNewPort').value=String(fixed().port);el('mcpIpEditError').textContent='';el('mcpIpEditDialog').showModal();});
    el('mcpIpEditCancel').addEventListener('click',()=>el('mcpIpEditDialog').close());
    el('mcpIpSave').addEventListener('click',async()=>{if(await action({action:'save-address',revision:editRevision,host:el('mcpIpNewHost').value.trim(),port:Number(el('mcpIpNewPort').value)},'mcpIpEditError'))el('mcpIpEditDialog').close();});
    el('mcpIpRotate').addEventListener('click',()=>{rotateRevision=fixed().revision;el('mcpIpRotateError').textContent='';el('mcpIpRotateDialog').showModal();});
    el('mcpIpRotateCancel').addEventListener('click',()=>el('mcpIpRotateDialog').close());
    el('mcpIpRotateConfirm').addEventListener('click',async()=>{if(await action({action:'rotate-token',revision:rotateRevision},'mcpIpRotateError'))el('mcpIpRotateDialog').close();});
    render();
    return {refresh,setStatus,setLanguage:value=>{language=value;render();},setVisible:value=>{visible=value;tokenVisible=false;render();if(visible){setStatus(hostApi()?.status());void refresh();}}};
  }
  const root=document.getElementById('mcpCloudSettings');if(!root)return;
  let mounted=null,ipMounted=null,active='cloud',localMethod='auto',localStatus=null,connection={enabled:false,connected:false},deviceStatus=null;
  const cloud=()=>window.PENECHO_CONFIG?.runtime==='cloud';
  function language(){return document.documentElement.lang||'en';}
  const localAvailable=()=>!cloud()||window.PENECHO_REMOTE_CLOUD_STATUS?.deviceOnline===true;
  function selectLocal(value,{refresh=false}={}) {
    localMethod=value==='ip'&&!cloud()?'ip':'auto';
    const zh=language().startsWith('zh');
    document.getElementById('mcpLocalMethods').hidden=cloud();
    for(const kind of ['auto','ip']) {
      const id=kind==='auto'?'Auto':'Ip',button=document.getElementById(`mcp${id}Tab`),panel=document.getElementById(`mcp${id}Panel`);
      button.textContent=kind==='auto'?(zh?'自动发现':'Automatic discovery'):(zh?'IP 直连':'IP direct');
      button.setAttribute('aria-selected',String(kind===localMethod));button.tabIndex=kind===localMethod?0:-1;
      panel.hidden=cloud()||kind!==localMethod;
    }
    if(localMethod==='ip'&&active==='local') {
      if(!ipMounted)ipMounted=mountIpDirect(document.getElementById('mcpIpPanel'));
      ipMounted.setLanguage(language());ipMounted.setStatus(localStatus);
      if(refresh)ipMounted.setVisible(true);
    } else ipMounted?.setVisible(false);
  }
  function select(value,{refresh=true}={}) {
    const wasLocal=active==='local';
    active=value==='local'&&localAvailable()?'local':'cloud';
    const help=document.getElementById('mcpLocalCloudHelp'),zh=language().startsWith('zh');
    help.hidden=!cloud();
    help.querySelector('h2').textContent=zh?'在本机配置本地 MCP':'Set up local MCP on your computer';
    help.querySelectorAll('p')[0].textContent=zh?'在本机 PenEcho 中打开「设置 → MCP → 本地 MCP」，复制安装提示词给你的编程助手。本地 MCP 和本地模型 API 无需注册或登录。':'Open Settings → MCP → Local MCP in PenEcho on your computer, then copy its installation prompt to your coding assistant. Local MCP and local model APIs work without an account.';
    help.querySelectorAll('p')[1].textContent=zh?'已有云端 MCP 连接时，在本机开启「云端 MCP」即可操作本地画布，无需再配置一个 MCP。启用 Linked Device 后，本地 MCP 也能与这里打开的云端画布交互。':'With an existing Cloud MCP connection, enable Cloud MCP on your computer to reach its local Canvas without another client configuration. Linked Device also lets your local MCP work with the Cloud Canvas open here.';
    for(const kind of ['cloud','local']) {
      const id=kind==='cloud'?'Cloud':'Local',button=document.getElementById(`mcp${id}Tab`),panel=document.getElementById(`mcp${id}Panel`);
      button.hidden=kind==='local'&&!localAvailable();
      button.textContent=language().startsWith('zh')?(kind==='cloud'?'云端 MCP':'本地 MCP'):(kind==='cloud'?'Cloud MCP':'Local MCP');
      button.setAttribute('aria-selected',String(kind===active));button.setAttribute('aria-pressed',String(kind===active));button.tabIndex=kind===active?0:-1;panel.hidden=kind!==active;
    }
    if(wasLocal&&active==='cloud'&&document.activeElement===document.getElementById('mcpLocalTab'))document.getElementById('mcpCloudTab').focus();
    selectLocal(localMethod,{refresh:refresh&&active==='local'});
    if(refresh&&active==='cloud'&&!document.getElementById('settingsPageMcp').hidden)open();
  }
  function open() {
    const host=window.PenEchoCloudSettings;if(!host)return;
    select(active,{refresh:false});
    if(!mounted)mounted=window.PenEchoCloudMcp.mount(root,{
      api:host.api,origin:host.origin(),language:language(),runtime:cloud()?'cloud':'local',
      signIn:()=>host.signIn(()=>mounted?.refresh().catch(()=>{})),signInState:host.signInState,connection:()=>connection,
      enable:async enabled=>{
        if(!cloud())await host.api('/api/cloud/mcp/access',{method:'POST',body:JSON.stringify({enabled})});
        if(enabled)window.dispatchEvent(new CustomEvent('penecho:open-cloud-mcp'));
        else if(cloud())window.dispatchEvent(new CustomEvent('penecho:close-mcp'));
        window.dispatchEvent(new CustomEvent('penecho:cloud-account-changed'));
      },
    });
    else mounted.refresh().catch(()=>{});
    mounted.setLanguage(language());if(deviceStatus)mounted.updateDeviceStatus(deviceStatus);
  }
  for(const kind of ['Cloud','Local'])document.getElementById(`mcp${kind}Tab`).addEventListener('click',()=>select(kind.toLowerCase()));
  for(const kind of ['Auto','Ip'])document.getElementById(`mcp${kind}Tab`).addEventListener('click',()=>selectLocal(kind==='Ip'?'ip':'auto',{refresh:true}));
  document.getElementById('mcpLocalMethods').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||cloud())return;
    event.preventDefault();selectLocal(event.key==='Home'?'auto':event.key==='End'?'ip':localMethod==='auto'?'ip':'auto',{refresh:true});
    document.getElementById(localMethod==='auto'?'mcpAutoTab':'mcpIpTab').focus();
  });
  document.querySelector('.mcp-settings-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();if(!localAvailable()){select('cloud');document.getElementById('mcpCloudTab').focus();return;}select(event.key==='Home'?'cloud':event.key==='End'?'local':active==='cloud'?'local':'cloud');
    document.getElementById(active==='cloud'?'mcpCloudTab':'mcpLocalTab').focus();
  });
  window.PenEchoMcpSettings={open,select,setLocalStatus:value=>{localStatus=value;ipMounted?.setLanguage(language());ipMounted?.setStatus(value);},setDeviceStatus:value=>{deviceStatus=value;mounted?.updateDeviceStatus(value);},setConnection:value=>{connection=value;mounted?.updateConnection();}};
  window.addEventListener('penecho:cloud-account-changed',()=>{if(!document.getElementById('settingsPageMcp').hidden)mounted?.refresh().catch(()=>{});});
  window.addEventListener('penecho:remote-cloud-status',()=>select(active,{refresh:false}));
  // Keep login and credentials fresh when returning from external authorization.
  window.addEventListener('focus',()=>{if(!document.getElementById('settingsPageMcp').hidden)open();});
  select('cloud');
})();
