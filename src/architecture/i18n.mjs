const COPY = Object.freeze({
  en:Object.freeze({
    exportNav:'Diagram export', viewNav:'Diagram view', locateNode:'Locate node', locateNodePlaceholder:'Locate node…',
    overview:'Overview', zoomOut:'Zoom out', zoomIn:'Zoom in',
    mapHelp:'Diagram; when zoomed in, use the mouse wheel, trackpad, or scrollbars to browse. Press Home to return to the overview.',
    nodeDetails:'Node details', participantDetails:'Participant details', messageDetails:'Message details', closeDetails:'Close details', related:'Related connections',
    svgEncodeFailed:'Could not encode the SVG', pngEncodeFailed:'Could not encode the PNG', exportFailed:detail=>`Export failed: ${detail}`,
    layoutModuleLoadFailed:'The local layout module could not load', layoutCancelled:'Layout was cancelled',
    layoutTimeout:'Layout timed out. Reduce the number of entities and connections in this view.',
    failedMessage:(kind,detail)=>`${kind}: ${detail}`,
    loading:Object.freeze({architecture:'Laying out architecture diagram…',sequence:'Laying out sequence diagram…',workflow:'Laying out workflow…'}),
    failed:Object.freeze({architecture:'Architecture diagram could not be completed',sequence:'Sequence diagram could not be completed',workflow:'Workflow could not be completed'}),
    moduleFailed:Object.freeze({architecture:'Architecture rendering module failed to load. Reload and try again.',sequence:'Sequence rendering module failed to load. Reload and try again.',workflow:'Workflow rendering module failed to load. Reload and try again.'}),
  }),
  zh:Object.freeze({
    exportNav:'图表导出', viewNav:'图表视图', locateNode:'定位节点', locateNodePlaceholder:'定位节点…',
    overview:'总览', zoomOut:'缩小', zoomIn:'放大',
    mapHelp:'图表；放大后使用鼠标滚轮、触控板或滚动条浏览，按 Home 返回总览。',
    nodeDetails:'节点详情', participantDetails:'参与者详情', messageDetails:'消息详情', closeDetails:'关闭详情', related:'相关关系',
    svgEncodeFailed:'无法编码 SVG', pngEncodeFailed:'PNG 编码失败', exportFailed:detail=>`导出失败：${detail}`,
    layoutModuleLoadFailed:'本地布局模块加载失败', layoutCancelled:'布局已取消',
    layoutTimeout:'布局超时，请减少当前视图中的实体和关系',
    failedMessage:(kind,detail)=>`${kind}：${detail}`,
    loading:Object.freeze({architecture:'正在布局架构图…',sequence:'正在布局时序图…',workflow:'正在布局流程图…'}),
    failed:Object.freeze({architecture:'架构图未能完成',sequence:'时序图未能完成',workflow:'流程图未能完成'}),
    moduleFailed:Object.freeze({architecture:'架构渲染模块加载失败，请重新加载。',sequence:'时序渲染模块加载失败，请重新加载。',workflow:'流程渲染模块加载失败，请重新加载。'}),
  }),
});

export function normalizeDiagramLanguage(value) {
  return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function currentDiagramLanguage() {
  return normalizeDiagramLanguage(globalThis.__penechoDiagramLanguage || globalThis.document?.documentElement?.lang);
}

export function diagramCopy(language = currentDiagramLanguage()) {
  return COPY[normalizeDiagramLanguage(language)];
}

export function diagramError(code, details = {}) {
  return Object.assign(new Error(code), {diagramErrorCode:code, diagramErrorDetails:details});
}

export function diagramErrorMessage(error, copy) {
  if (error?.diagramErrorCode && typeof copy[error.diagramErrorCode] === 'string') return copy[error.diagramErrorCode];
  if (Array.isArray(error?.diagramErrorDetails?.issues)) return error.diagramErrorDetails.issues.map(issue=>localizeLayoutIssue(issue,copy)).join('; ');
  return String(error?.message || error || '');
}

export function localizeLayoutIssue(issue, copy) {
  if (copy !== COPY.zh) return String(issue);
  const patterns = [
    [/^Nodes overlap: (.+)$/,'节点重叠：$1'],
    [/^Missing route: (.+)$/,'缺少连线：$1'],
    [/^Diagonal route: (.+)$/,'连线不是正交路径：$1'],
    [/^Route crosses node: (.+)$/,'连线穿过节点：$1'],
    [/^Label crosses node: (.+)$/,'标签覆盖节点：$1'],
    [/^Labels overlap: (.+)$/,'标签重叠：$1'],
    [/^Route crosses label: (.+)$/,'连线穿过标签：$1'],
    [/^Route crosses frame title: (.+)$/,'连线穿过分组标题：$1'],
    [/^Frame title exceeds reserved space: (.+)$/,'分组标题超出预留空间：$1'],
    [/^Frame title crosses label: (.+)$/,'分组标题覆盖标签：$1'],
  ];
  for (const [pattern,replacement] of patterns) if (pattern.test(issue)) return String(issue).replace(pattern,replacement);
  return String(issue);
}

export function applyPanelCopy(root, copy) {
  root.querySelector('.pa-header nav')?.setAttribute('aria-label',copy.exportNav);
  const controls=root.querySelector('.pa-view-controls'), select=controls?.querySelector('select');
  controls?.setAttribute('aria-label',copy.viewNav);
  select?.setAttribute('aria-label',copy.locateNode);
  const placeholder=select?.querySelector('option[value=""]'); if(placeholder)placeholder.textContent=copy.locateNodePlaceholder;
  const overview=controls?.querySelector('[data-view="fit"]'); if(overview)overview.textContent=copy.overview;
  controls?.querySelector('[data-view="out"]')?.setAttribute('aria-label',copy.zoomOut);
  controls?.querySelector('[data-view="in"]')?.setAttribute('aria-label',copy.zoomIn);
  root.querySelector('.pa-map')?.setAttribute('aria-label',copy.mapHelp);
  const popover=root.querySelector('.pa-popover');
  if(popover&&!popover.dataset.detailKind)popover.setAttribute('aria-label',copy.nodeDetails);
}
