"use strict";

(() => {
  const cloudButton = document.getElementById("cloudAccountBtn");
  const shareCanvasButton = document.getElementById("shareCanvasBtn");
  if (!cloudButton || !shareCanvasButton) return;
  // The read-only viewer shell has its own minimal header; the Cloud Center and
  // its local-server API calls must stay silent there.
  if (window.PENECHO_CONFIG?.runtime === "viewer") return;

  const CATEGORIES = ["education", "productivity", "data", "design", "developer", "science", "business", "lifestyle", "other", "guidance", "collaboration", "learning"];
  const CATEGORY_LABEL_KEYS = {
    education:"categoryEducation",
    productivity:"categoryProductivity",
    data:"categoryData",
    design:"categoryDesign",
    developer:"categoryDeveloper",
    science:"categoryScience",
    business:"categoryBusiness",
    lifestyle:"categoryLifestyle",
    other:"categoryOther",
    guidance:"categoryGuidance",
    collaboration:"categoryCollaboration",
    learning:"categoryLearning",
  };
  const PUBLICATION_TERMS_VERSION = "2026-08-12";
  const sessionToken = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || "");
  const configuredCloudOrigin = String(window.PENECHO_CONFIG?.runtime === "cloud" ? location.origin : window.PENECHO_CONFIG?.cloudOrigin || "https://penecho.ai");
  const configuredCloudEnvironment = String(window.PENECHO_CONFIG?.cloudEnvironment || "prod");
  const localHostControlsAvailable = window.PENECHO_CONFIG?.runtime !== "cloud";
  const BROWSER_SIGN_IN_POLL_MS = 800;
  const BROWSER_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
  const DEVICE_CONNECTION_POLL_MS = 2_000;
  const CLOUD_COPY = Object.freeze({
    en:Object.freeze({
      close:"Close",
      cloudSubtitle:"Private canvases and favorites, synced to your account.",
      cloudArea:"PenEcho Cloud area",
      cloudProjects:"Projects",
      cloudProjectsHint:"Private, versioned canvases",
      favorites:"Favorites",
      favoritesHint:"Open a Canvas here or add a Widget to this Canvas.",
      all:"All",
      canvases:"Canvases",
      widgets:"Widgets",
      favoriteCanvases:"Favorite Canvases",
      favoriteCanvasesHint:"Public Canvases in Favorites",
      favoriteWidgets:"Favorite Widgets",
      favoriteWidgetsHint:"Add one to this Canvas",
      explore:"Echoes",
      exploreHint:"Browse public Canvases and Widgets.",
      cloudNavLibrary:"Library",
      cloudAccount:"Cloud account",
      accountHint:"Manage your identity, Cloud storage, and project activity.",
      accountOverview:"Account overview",
      accountProjects:"Projects",
      accountCanvases:"Canvases",
      signIn:"Sign in",
      openAccount:"Open account",
      cloudUser:"PenEcho user",
      credits:"{count} credits",
      subscriptionValidUntil:"Subscription valid until {date}",
      refreshAccount:"Refresh account",
      openDashboard:"Cloud Dashboard ↗",
      signOutHost:"Sign out on this host",
      signOutConfirm:"Sign out on this PenEcho host? The device link will remain available.",
      localSignInHelp:"Sign in for private projects and favorites; API keys stay on this device.",
      waitingBrowser:"Waiting for browser…",
      continueBrowser:"Continue in browser",
      signInBrowser:"Sign in with browser",
      openSignIn:"Open sign-in page ↗",
      openAgain:"Open again ↗",
      browserComplete:"Complete sign-in there; PenEcho will connect here automatically.",
      desktopBrowserOpen:"Your default browser is open. ",
      browserBlocked:"Your browser blocked the sign-in window. Select Open sign-in page below; PenEcho will still connect automatically.",
      signedInReady:"Signed in. Your Cloud account is ready.",
      browserExpired:"Browser sign-in expired. Select Sign in with browser to try again.",
      linkThisDevice:"Link device",
      linkDeviceHint:"Use this computer’s model connections, folders and local canvases from Cloud. Enabling this link replaces the previous linked device; no pairing code is needed.",
      linkSignInFirst:"Sign in, then enable Linked Device with one click.",
      thisDevice:"This device",
      connected:"Connected",
      deviceLinked:"Device linked",
      notLinked:"Not linked",
      connecting:"Connecting",
      connectionFailed:"Connection failed",
      statusUnavailable:"Status unavailable",
      paused:"Disconnected",
      pauseLink:"Disconnect",
      reconnectLink:"Reconnect",
      disconnectLinkHint:"Disconnect keeps your login and connection settings. You can reconnect without changing your MCP configuration.",
      enableLink:"Enable link",
      removeThisLink:"Remove this link",
      removeLinkConfirm:"Remove this device link? Remote access will stop, but you can enable it again later without a pairing code.",
      generatePairingBefore:"Generate a pairing key in ",
      penechoDevices:"PenEcho Cloud → Devices",
      generatePairingAfter:", then enter it below.",
      pairingKey:"Pairing key",
      deviceName:"Device name",
      myPenEcho:"My PenEcho",
      linkDevice:"Link device",
      requestFailed:"PenEcho Cloud request failed.",
      signInProjects:"Sign in to view private projects and pick up your work on any device.",
      cloudSavingNotReady:"Cloud project saving is not ready yet.",
      used:"{size} used",
      of:" of {size}",
      storageUsed:"Cloud storage used",
      storageHelp:"Saved versions are never overwritten.",
      currentProject:"Current Cloud project",
      untitledProject:"Untitled project",
      project:"Project",
      projectName:"Project name",
      newProjectName:"New Cloud project name",
      create:"Create",
      enterProjectName:"Enter a project name.",
      newProject:"+ New project",
      saveCurrentHere:"Save current Canvas here",
      canvasesCount:"{count} Canvas{suffix}",
      noCanvases:"Nothing here yet. Save the current canvas to this project.",
      untitledCanvas:"Untitled Canvas",
      updated:"Updated {date} · {size}",
      openNewPage:"Open in new page →",
      openCanvasHere:"Open Canvas",
      openingCanvas:"Opening…",
      noProjects:"No projects yet. Create one to keep this canvas on every device.",
      manageWeb:"Manage revisions, Trash and recovery on the web ↗",
      loadingProjects:"Loading Cloud projects…",
      syncUnsupported:"This Cloud does not support the required project sync protocol.",
      signInFavorites:"Sign in to view favorites saved to your account.",
      loadingFavorites:"Loading favorites…",
      loadMoreFavorites:"Load more",
      retryFavorites:"Retry",
      noFavorites:"No favorites yet. Favorite a Craft in Echoes to keep it here.",
      noFavoriteCanvases:"No favorite Canvases yet. Favorite one in Echoes to keep it here.",
      noFavoriteWidgets:"No favorite Widgets yet. Favorite one in Echoes or from a Canvas.",
      byAuthor:"by {name}",
      creator:"PenEcho creator",
      addToCanvas:"Add to this Canvas",
      addingToCanvas:"Adding…",
      viewDetails:"Details ↗",
      favoriteLoadFailed:"Could not load favorites.",
      untitledWidget:"Untitled Widget",
      communityWidget:"Favorite Widget",
      widgetImportUnavailable:"This PenEcho version cannot import Widgets yet.",
      communityWidgetImportUnavailable:"This PenEcho version cannot import community Widgets yet.",
      communityCanvasImportUnavailable:"This PenEcho version cannot import community Canvases yet.",
      incompatibleCraft:"This Craft is not compatible with this PenEcho version.",
      signInTakeFurther:"Sign in to Echo this Craft.",
      shareTitle:"Preserve this moment",
      shareCanvasCloud:"Share Canvas",
      sharedCanvasCloud:"Canvas shared",
      shareSubtitle:"It does not need to be finished. It only needs to invite understanding or an Echo.",
      widgetKind:"Widget",
      canvasKind:"Canvas",
      widgetNamePlaceholder:"Widget name",
      canvasNamePlaceholder:"Canvas name",
      shareDescriptionPlaceholder:"A short, useful introduction",
      selectCategory:"Select a category…",
      categoryEducation:"Education",
      categoryProductivity:"Productivity",
      categoryData:"Data",
      categoryDesign:"Design",
      categoryDeveloper:"Developer",
      categoryScience:"Science",
      categoryBusiness:"Business",
      categoryLifestyle:"Lifestyle",
      categoryOther:"Other",
      categoryGuidance:"Sharing & Guidance",
      categoryCollaboration:"Co-creation",
      categoryLearning:"Learning Notes",
      shareTagsPlaceholder:"planning, dashboard, learning",
      tagCount:"{count} / 8 tags",
      generatingPreview:"Generating preview…",
      automaticSharePreview:"Automatic {kind} share preview",
      autoFillCurrentAi:"Auto-fill with current AI",
      contributionPlaceholder:"What did you move forward?",
      continuationPlaceholder:"What question, detail, or direction should the next Crafter Echo?",
      publicationAgreementBeforeLink:"I have the right to publish this work and accept the ",
      publicationAgreementLink:"Publication Agreement",
      publicationAgreementAfterLink:".",
      shareSignInRequired:"Please sign in to PenEcho Cloud before sharing.",
      tagLimit:"Use no more than 8 tags.",
      tagLength:"Each tag must be 32 characters or fewer.",
      tagStart:"Tags must start with a letter or number.",
      shareNote:"A rough sketch can be the first surviving record of a great idea. PenEcho captures this {kind} automatically—no image upload—and preserves every attributed step. The validated WebP is at most 2048 × 2048 and 4 MB.",
      usesCurrentAi:"Uses the AI connection currently active on this device.",
      nameLabel:"Title",
      descriptionLabel:"Description",
      categoryLabel:"Category",
      tagsLabel:"Tags (up to 8, comma separated)",
      continuationLabel:"What should the next Crafter Echo? (optional)",
      publishAndSave:"Publish + Favorite",
      publishStroke:"Publish this stroke",
      validatingUploading:"Validating and uploading…",
      waitPreview:"Wait for the automatic preview to finish.",
      publishNameRequired:"Enter a title before publishing.",
      publishDescriptionRequired:"Enter a description before publishing.",
      publishCategoryRequired:"Choose a category before publishing.",
      publishAgreementRequired:"Accept the Publication Agreement before publishing.",
      addingLineage:"Adding your step to the Craft lineage…",
      publishingFirstStep:"Publishing the first step of this Craft…",
      publishedCraftMissing:"PenEcho Cloud did not return the published Craft.",
      publishedLocalLinkAttention:"Craft published safely, but its local continuation link needs attention below. Do not publish again.",
      publishedFavoriteRetry:"Craft published safely. Saving it to Favorites can be retried from its public page.",
      publishedAndSaved:"Craft published and added to Favorites.",
      publishedContinues:"Craft published. Your local work now continues from this step.",
      originRetryMessage:"The public Craft is safe. Retry linking this local {kind} so its next publish extends Step {step}.",
      originLinkedMessage:"{step} is now this local {kind}'s source. Your next publish will extend it, not create a sibling branch.",
      firstStroke:"First stroke",
      stepNumber:"Step {number}",
      retryLocalLink:"Retry local link",
      localSourceLinked:"Local source linked to Step {step}. Your next publish will extend it.",
      publishedLinkRestored:"Craft published and local continuation link restored.",
      localLinkRestoreFailed:"The local link still could not be restored.",
      copyLink:"Copy link",
      publicLinkCopied:"Public link copied.",
      viewPublicPage:"View public page ↗",
      done:"Done",
      publicCommonsTitle:"Your Craft is now part of Echoes",
      publicCommunityLink:"Public community link",
      publishedDialogTitle:"Published to Echoes",
      publishedDialogSubtitle:"Share this Craft or open its public page.",
      shareAsLink:"Share as link",
      shareAsImage:"Share as image",
      shareImageEmbedTitle:"Copy linked image embed code",
      shareLinkShared:"Link shared.",
      shareLinkCancelled:"Link sharing was cancelled.",
      shareLinkFailed:"Could not share the public link.",
      shareImageEmbedCopied:"Linked image embed code copied.",
      shareImageEmbedFailed:"Could not copy the image embed code.",
      nativeShareText:"View and Echo this {kind} on PenEcho.",
      shareFailed:"Could not share this item.",
      secureUploadUnavailable:"Secure upload checksums are unavailable in this browser.",
      artifactUploadFailed:"Artifact upload failed (HTTP {status}).",
      cancel:"Cancel",
      askingAi:"Asking your current AI to improve the listing…",
      listingOptimized:"Listing optimized. Review it, then publish.",
      aiAutoFillFailed:"AI auto-fill failed.",
      communityBridgeNotReady:"The Canvas community bridge is not ready.",
      contributionLabel:"Your contribution to this Craft (optional)",
      publishedStep:"a published step",
      lineageNotice:"Building on {step}{name}. The original attribution and this new step will stay connected.",
      automaticPreviewMissing:"The automatic preview was not created.",
      previewRestored:"Preview ready. Your unfinished listing was restored.",
      previewReady:"Preview ready.",
      previewFailed:"Could not generate the preview.",
      sharingUnavailable:"Sharing is unavailable until the preview is valid.",
      favoriteUnsupported:"This PenEcho version does not support widget favorites.",
      favoriteLocalOnlyQuota:"Cloud storage is full. Saved locally only.",
    }),
    zh:Object.freeze({
      close:"关闭",
      cloudSubtitle:"私有画布与收藏，已同步到你的账号。",
      cloudArea:"PenEcho Cloud 区域",
      cloudProjects:"项目",
      cloudProjectsHint:"私有的版本化画布",
      favorites:"收藏",
      favoritesHint:"在本机打开画布，或将组件加入当前画布。",
      all:"全部",
      canvases:"画布",
      widgets:"组件",
      favoriteCanvases:"收藏的画布",
      favoriteCanvasesHint:"收藏中的公开画布",
      favoriteWidgets:"收藏的组件",
      favoriteWidgetsHint:"加入当前画布",
      explore:"Echoes",
      exploreHint:"浏览公开画布与组件。",
      cloudNavLibrary:"内容库",
      cloudAccount:"Cloud 账户",
      accountHint:"管理账户身份、Cloud 空间与项目活动。",
      accountOverview:"账户概览",
      accountProjects:"项目",
      accountCanvases:"画布",
      signIn:"登录",
      openAccount:"前往账户",
      cloudUser:"PenEcho 用户",
      credits:"{count} 积分",
      subscriptionValidUntil:"订阅有效期至 {date}",
      refreshAccount:"刷新账户",
      openDashboard:"云端 Dashboard ↗",
      signOutHost:"在此主机退出",
      signOutConfirm:"要在此 PenEcho 主机退出吗？设备连接会继续保留。",
      localSignInHelp:"登录后即可使用私有项目和收藏；API 密钥仍保存在此设备。",
      waitingBrowser:"等待浏览器登录…",
      continueBrowser:"在浏览器中继续",
      signInBrowser:"通过浏览器登录",
      openSignIn:"打开登录页面 ↗",
      openAgain:"再次打开 ↗",
      browserComplete:"请在浏览器中完成登录，PenEcho 会自动在这里连接。",
      desktopBrowserOpen:"默认浏览器已打开。",
      browserBlocked:"浏览器阻止了登录窗口。请选择下方“打开登录页面”，PenEcho 仍会自动连接。",
      signedInReady:"登录成功，PenEcho Cloud 账户已就绪。",
      browserExpired:"浏览器登录已过期，请重新选择“通过浏览器登录”。",
      linkThisDevice:"连接设备",
      linkDeviceHint:"在 Cloud 使用本机模型配置、文件夹和本地画布。一键启用，无需配对码；之前连接的设备将立即失效。",
      linkSignInFirst:"登录后即可一键启用 Linked Device。",
      thisDevice:"此设备",
      connected:"已连接",
      deviceLinked:"设备已连接",
      notLinked:"未连接",
      connecting:"连接中",
      connectionFailed:"连接失败",
      statusUnavailable:"状态暂不可用",
      paused:"已断开",
      pauseLink:"断开连接",
      reconnectLink:"重新连接",
      disconnectLinkHint:"断开连接会保留登录和连接设置；再次连接无需修改 MCP 配置。",
      enableLink:"启用连接",
      removeThisLink:"移除此连接",
      removeLinkConfirm:"要移除此设备连接吗？远程访问会停止，之后可直接再次启用，无需配对码。",
      generatePairingBefore:"请在 ",
      penechoDevices:"PenEcho Cloud → 设备",
      generatePairingAfter:" 生成配对密钥，然后在下方输入。",
      pairingKey:"配对密钥",
      deviceName:"设备名称",
      myPenEcho:"我的 PenEcho",
      linkDevice:"连接设备",
      requestFailed:"PenEcho Cloud 请求失败。",
      signInProjects:"登录后查看私有项目，在任意设备上继续创作。",
      cloudSavingNotReady:"Cloud 项目保存功能尚未就绪。",
      used:"已使用 {size}",
      of:"，共 {size}",
      storageUsed:"Cloud 存储用量",
      storageHelp:"已保存版本不会被覆盖。",
      currentProject:"当前 Cloud 项目",
      untitledProject:"未命名项目",
      project:"项目",
      projectName:"项目名称",
      newProjectName:"新 Cloud 项目名称",
      create:"创建",
      enterProjectName:"请输入项目名称。",
      newProject:"+ 新建项目",
      saveCurrentHere:"将当前画布保存到这里",
      canvasesCount:"{count} 个画布",
      noCanvases:"这里还没有画布，先把当前画布保存到此项目。",
      untitledCanvas:"未命名画布",
      updated:"更新于 {date} · {size}",
      openNewPage:"在新页面打开 →",
      openCanvasHere:"打开画布",
      openingCanvas:"正在打开…",
      noProjects:"还没有项目。创建一个，让当前画布在每台设备上可用。",
      manageWeb:"在网页端管理版本、回收站与恢复 ↗",
      loadingProjects:"正在加载 Cloud 项目…",
      syncUnsupported:"此 Cloud 不支持当前所需的项目同步协议。",
      signInFavorites:"登录后查看保存在账号中的收藏。",
      loadingFavorites:"正在加载收藏…",
      loadMoreFavorites:"加载更多",
      retryFavorites:"重试",
      noFavorites:"还没有收藏。可在 Echoes 中收藏后回到这里使用。",
      noFavoriteCanvases:"还没有收藏的画布。可在 Echoes 中收藏后回到这里打开。",
      noFavoriteWidgets:"还没有收藏的组件。可在 Echoes 或画布中收藏。",
      byAuthor:"作者：{name}",
      creator:"PenEcho 创作者",
      addToCanvas:"加入当前画布",
      addingToCanvas:"加入中…",
      viewDetails:"详情 ↗",
      favoriteLoadFailed:"无法加载收藏。",
      untitledWidget:"未命名组件",
      communityWidget:"收藏的组件",
      widgetImportUnavailable:"此 PenEcho 版本暂不支持导入组件。",
      communityWidgetImportUnavailable:"此 PenEcho 版本暂不支持导入社区组件。",
      communityCanvasImportUnavailable:"此 PenEcho 版本暂不支持导入社区画布。",
      incompatibleCraft:"此创作与当前 PenEcho 版本不兼容。",
      signInTakeFurther:"请先登录，再 Echo 此创作。",
      shareTitle:"保存这一刻",
      shareCanvasCloud:"分享 Canvas",
      sharedCanvasCloud:"Canvas 已分享",
      shareSubtitle:"它不必已经完成，只需值得理解或 Echo。",
      widgetKind:"组件",
      canvasKind:"画布",
      widgetNamePlaceholder:"组件名称",
      canvasNamePlaceholder:"画布名称",
      shareDescriptionPlaceholder:"写一段简短、实用的介绍",
      selectCategory:"选择分类…",
      categoryEducation:"教育",
      categoryProductivity:"效率",
      categoryData:"数据",
      categoryDesign:"设计",
      categoryDeveloper:"开发",
      categoryScience:"科学",
      categoryBusiness:"商业",
      categoryLifestyle:"生活方式",
      categoryOther:"其他",
      categoryGuidance:"分享与指导",
      categoryCollaboration:"协作共创",
      categoryLearning:"学习笔记",
      shareTagsPlaceholder:"规划, 仪表板, 学习",
      tagCount:"{count} / 8 个标签",
      generatingPreview:"正在生成预览…",
      automaticSharePreview:"自动生成的{kind}分享预览",
      autoFillCurrentAi:"使用当前 AI 自动填写",
      contributionPlaceholder:"你推进了哪些内容？",
      continuationPlaceholder:"下一位创作者应该 Echo 哪个问题、细节或方向？",
      publicationAgreementBeforeLink:"我有权发布此作品，并接受",
      publicationAgreementLink:"《发布协议》",
      publicationAgreementAfterLink:"。",
      shareSignInRequired:"请先登录 PenEcho Cloud，再进行分享。",
      tagLimit:"标签不能超过 8 个。",
      tagLength:"每个标签不能超过 32 个字符。",
      tagStart:"标签必须以字母或数字开头。",
      shareNote:"一张草图也可能成为伟大想法最早保留下来的记录。PenEcho 会自动捕获此{kind}，无需上传图片，并保留每一步的署名。经验证的 WebP 最大为 2048 × 2048、4 MB。",
      usesCurrentAi:"使用此设备上当前启用的 AI 连接。",
      nameLabel:"标题",
      descriptionLabel:"描述",
      categoryLabel:"分类",
      tagsLabel:"标签（最多 8 个，用逗号分隔）",
      continuationLabel:"下一位创作者应该 Echo 什么？（可选）",
      publishAndSave:"发布并收藏",
      publishStroke:"发布此笔触",
      validatingUploading:"正在验证并上传…",
      waitPreview:"请等待自动预览生成完成。",
      publishNameRequired:"请先填写标题再发布。",
      publishDescriptionRequired:"请先填写描述再发布。",
      publishCategoryRequired:"请先选择分类再发布。",
      publishAgreementRequired:"发布前请接受《发布协议》。",
      addingLineage:"正在将你的步骤加入创作谱系…",
      publishingFirstStep:"正在发布此创作的第一步…",
      publishedCraftMissing:"PenEcho Cloud 未返回已发布的创作。",
      publishedLocalLinkAttention:"创作已安全发布，但本地续作连接需要在下方处理。请勿重复发布。",
      publishedFavoriteRetry:"创作已安全发布。可在公开页面重试收藏。",
      publishedAndSaved:"创作已发布并加入收藏。",
      publishedContinues:"创作已发布。本地内容现在会从此步骤继续。",
      originRetryMessage:"公开创作已安全发布。请重试连接此本地{kind}，以便下次发布接续第 {step} 步。",
      originLinkedMessage:"{step}现在是此本地{kind}的来源。下次发布会接续它，而不会创建同级分支。",
      firstStroke:"第一笔",
      stepNumber:"第 {number} 步",
      retryLocalLink:"重试本地连接",
      localSourceLinked:"本地来源已连接到第 {step} 步。下次发布会接续它。",
      publishedLinkRestored:"创作已发布，本地续作连接也已恢复。",
      localLinkRestoreFailed:"仍无法恢复本地连接。",
      copyLink:"复制链接",
      publicLinkCopied:"公开链接已复制。",
      viewPublicPage:"查看公开页面 ↗",
      done:"完成",
      publicCommonsTitle:"你的创作现已加入 Echoes",
      publicCommunityLink:"公开社区链接",
      publishedDialogTitle:"已发布到 Echoes",
      publishedDialogSubtitle:"分享此 Craft，或打开公开页面。",
      shareAsLink:"分享链接",
      shareAsImage:"分享为图片",
      shareImageEmbedTitle:"复制带链接的图片嵌入代码",
      shareLinkShared:"链接已分享。",
      shareLinkCancelled:"已取消分享链接。",
      shareLinkFailed:"无法分享公开链接。",
      shareImageEmbedCopied:"带链接的图片嵌入代码已复制。",
      shareImageEmbedFailed:"无法复制图片嵌入代码。",
      nativeShareText:"在 PenEcho 查看并 Echo 此{kind}。",
      shareFailed:"无法分享此内容。",
      secureUploadUnavailable:"此浏览器无法生成安全的上传校验值。",
      artifactUploadFailed:"作品上传失败（HTTP {status}）。",
      cancel:"取消",
      askingAi:"正在请当前 AI 优化发布信息…",
      listingOptimized:"发布信息已优化，请检查后发布。",
      aiAutoFillFailed:"AI 自动填写失败。",
      communityBridgeNotReady:"画布社区连接尚未就绪。",
      contributionLabel:"你对此创作的贡献（可选）",
      publishedStep:"一个已发布步骤",
      lineageNotice:"正在基于{step}{name}继续创作。原始署名与此新步骤会保持关联。",
      automaticPreviewMissing:"未能创建自动预览。",
      previewRestored:"预览已就绪，未完成的发布信息已恢复。",
      previewReady:"预览已就绪。",
      previewFailed:"无法生成预览。",
      sharingUnavailable:"预览验证通过后才能分享。",
      favoriteUnsupported:"此 PenEcho 版本不支持收藏组件。",
      favoriteLocalOnlyQuota:"云端空间已满，已仅保存在本地。",
    }),
  });
  const state = {
    status:null,
    library:null,
    selectedProjectId:null,
    cloudSection:"projects",
    cloudFavoriteKind:"all",
    accountRequestId:0,
    projectRequestId:0,
    favoriteRequestId:0,
    busy:false,
    favoriteWidgetOperations:new Set(),
    browserSignIn:{ id:0, timer:0, poll:null, polling:false, active:false, expiresAt:0, popup:null, authorizationUrl:"", popupBlocked:false, tone:"", message:"" },
    deviceConnectionWatch:{ id:0, timer:0, polling:false, active:false, expiresAt:0 },
  };

  function cloudT(key, replacements = {}) {
    const shared = window.PenEchoI18n?.t?.(key);
    let value = shared && shared !== key ? shared : (document.documentElement.lang || "").toLowerCase().startsWith("zh")
      ? CLOUD_COPY.zh[key] || CLOUD_COPY.en[key] || key
      : CLOUD_COPY.en[key] || key;
    for (const [name, replacement] of Object.entries(replacements)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  }

  function cloudOrigin() {
    return configuredCloudOrigin.replace(/\/$/, "");
  }

  function isCloudRuntime() {
    return window.PENECHO_CONFIG?.runtime === "cloud";
  }

  function runtimeApiPath(path, method = "GET") {
    if (!isCloudRuntime()) return path;
    const source = new URL(path, `${location.origin}/`), requestMethod = String(method || "GET").toUpperCase();
    if (/^\/api\/cloud\/canvases\/[0-9a-f-]{36}\/share$/i.test(source.pathname)) return source.pathname.replace("/api/cloud/", "/api/v1/") + source.search;
    if (/^\/api\/cloud\/mcp(?:\/|$)/.test(source.pathname)) return source.pathname.replace("/api/cloud/mcp","/api/v1/mcp") + source.search;
    if (requestMethod === "GET" && source.pathname === "/api/cloud/library") return `/api/v1/library${source.search ? `${source.search}&` : "?"}previews=0`;
    if (requestMethod === "POST" && source.pathname === "/api/cloud/projects") return "/api/v1/projects";
    if (/^\/api\/cloud\/favorites(?:\/feed|\/[0-9a-f-]{36}(?:\/thumbnail)?)?$/i.test(source.pathname)) return `${source.pathname.replace("/api/cloud/favorites", "/api/v1/favorites")}${source.search}`;
    if (source.pathname === "/api/cloud/community" && requestMethod === "GET") return `/api/v1/community/items${source.search}`;
    if (/^\/api\/cloud\/community\/[0-9a-f-]{36}(?:\/(?:favorite|redeem))?$/i.test(source.pathname)) {
      return `${source.pathname.replace("/api/cloud/community/", "/api/v1/community/items/")}${source.search}`;
    }
    return path;
  }

  function communityUrl(item) {
    return new URL(String(item?.shareUrl || `/community/${item?.id || ""}`), `${cloudOrigin()}/`).toString();
  }

  function communitySocialCardUrl(item) {
    return new URL(`/api/v1/community/items/${encodeURIComponent(String(item?.id || ""))}/social-card.png`, `${cloudOrigin()}/`).toString();
  }

  function htmlAttribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function linkedImageEmbed(item, name) {
    const href = htmlAttribute(communityUrl(item));
    const src = htmlAttribute(communitySocialCardUrl(item));
    const alt = htmlAttribute(`${String(name || item?.name || "PenEcho Craft")} — PenEcho Echoes`);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img src="${src}" alt="${alt}" width="1200" height="630" loading="lazy" decoding="async" style="max-width:100%;height:auto"></a>`;
  }

  function cloudDevicesUrl() {
    return new URL("/dashboard.html#devices", `${cloudOrigin()}/`).toString();
  }

  function cloudDevicesLink(text) {
    return el("a", { href:cloudDevicesUrl(), target:"_blank", rel:"noopener", text });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = el("input", { readonly:"", value });
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  function apiHeaders(json = false) {
    const csrf = window.PENECHO_CONFIG?.runtime === "cloud"
      ? document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("penecho_csrf="))?.slice("penecho_csrf=".length) || ""
      : "";
    return {
      accept:"application/json",
      ...(json ? { "content-type":"application/json" } : {}),
      ...(sessionToken ? { "x-penecho-session":sessionToken } : {}),
      ...(csrf ? { "x-penecho-csrf":decodeURIComponent(csrf) } : {}),
    };
  }

  async function api(path, options = {}) {
    const requestPath = runtimeApiPath(path, options.method || "GET");
    const response = await fetch(requestPath, {
      ...options,
      headers:{ ...apiHeaders(options.body !== undefined), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_description || payload.message || payload.error || `Cloud request failed (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = payload.code || null;
      throw error;
    }
    if (isCloudRuntime() && path === "/api/cloud/library" && !payload.sync) {
      payload.sync = { bundleVersion:2, conflictPolicy:"base-revision-required" };
    }
    return payload;
  }

  async function sha256Hex(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle?.digest) throw new Error(cloudT("secureUploadUnavailable"));
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function publishCommunityArtifact(payload) {
    if (!isCloudRuntime()) return api("/api/cloud/community/share", { method:"POST", body:JSON.stringify(payload) });
    const artifactBytes = new TextEncoder().encode(JSON.stringify(payload.artifact));
    const artifactSha256 = await sha256Hex(artifactBytes);
    const { artifact, ...metadata } = payload;
    const reservation = await api("/api/v1/community/items", {
      method:"POST",
      body:JSON.stringify({
        ...metadata,
        priceCredits:0,
        formatVersion:Number(artifact?.formatVersion || 1),
        artifact:{
          sha256:artifactSha256,
          sizeBytes:artifactBytes.byteLength,
          contentType:"application/json",
        },
      }),
    });
    const itemId = reservation.item?.id, upload = reservation.upload;
    if (!itemId || !upload?.url) throw new Error(cloudT("publishedCraftMissing"));
    const uploadResponse = await fetch(upload.url, {
      method:"PUT",
      headers:{ ...(upload.headers || {}) },
      body:artifactBytes,
    });
    if (!uploadResponse.ok) {
      const failure = await uploadResponse.json().catch(() => ({}));
      throw new Error(failure.error_description || failure.message || failure.error || cloudT("artifactUploadFailed", { status:uploadResponse.status }));
    }
    return api(`/api/v1/community/items/${encodeURIComponent(itemId)}/complete`, { method:"POST", body:"{}" });
  }

  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    const isPublicationLink = tag === "a" && String(node.className || "").split(/\s+/).includes("cloud-publication-link");
    if ((tag === "button" || tag === "a") && !node.dataset.peButton && !node.dataset.peHit && !isPublicationLink) {
      if (node.classList.contains("cloud-dialog-close")) {
        node.dataset.peButton = "icon";
        node.dataset.peDensity = "compact";
      } else if (node.classList.contains("cloud-section-tab")) {
        // Cloud's master navigation follows the Canvas Library row contract,
        // not the horizontal tab or outlined-button contracts.
      } else if (node.classList.contains("cloud-canvas-row")) {
        node.dataset.peHit = "choice";
      } else if (node.classList.contains("cloud-favorite-filter")) {
        node.dataset.peButton = "segment";
        node.dataset.peDensity = "segment";
      } else if (node.classList.contains("cloud-button")) {
        node.dataset.peButton = node.classList.contains("primary") ? "primary" : node.classList.contains("danger") ? "danger" : node.classList.contains("cloud-row-action") ? "ghost" : "secondary";
        node.dataset.peDensity = node.classList.contains("cloud-row-action") ? "compact" : "standard";
      } else if (node.getAttribute("role") !== "tab") {
        node.dataset.peButton = "secondary";
        node.dataset.peDensity = "compact";
      }
    }
    for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
    return node;
  }

  function lineIcon(paths) {
    const createSvgNode = (name) => typeof document.createElementNS === "function"
      ? document.createElementNS("http://www.w3.org/2000/svg", name)
      : document.createElement(name);
    const svg = createSvgNode("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const data of paths) {
      const path = createSvgNode("path");
      path.setAttribute("d", data);
      svg.append(path);
    }
    return svg;
  }

  function focusableElements(dialog) {
    return [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.getClientRects().length);
  }

  let activeCloudOverlay = null;
  let cloudDialogSequence = 0;

  function closeOverlay(overlay) {
    const restoreFocus = overlay?._restoreFocus;
    overlay?.remove();
    if (overlay === activeCloudOverlay) {
      activeCloudOverlay = null;
      stopDeviceConnectionWatch();
    }
    cloudButton.setAttribute("aria-expanded", "false");
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll:true });
  }

  function dialogShell({ title, subtitle = "", share = false, variant = "" }) {
    const overlay = el("div", { class:"penecho-cloud-overlay" });
    overlay._restoreFocus = document.activeElement;
    const dialogId = ++cloudDialogSequence;
    const titleId = `penecho-cloud-dialog-title-${dialogId}`;
    const subtitleId = `penecho-cloud-dialog-subtitle-${dialogId}`;
    const isCloudCenter = variant === "cloud-center";
    const dialog = el("section", {
      class:["penecho-cloud-dialog", share ? "share" : "", variant, isCloudCenter ? "penecho-workbench-dialog" : ""].filter(Boolean).join(" "),
      role:"dialog",
      "aria-modal":"true",
      "aria-labelledby":titleId,
      ...(subtitle ? { "aria-describedby":subtitleId } : {}),
    });
    const close = el("button", { class:"cloud-dialog-close", type:"button", "aria-label":cloudT("close"), onclick:() => closeOverlay(overlay) }, lineIcon(["M6 6l12 12M18 6 6 18"]));
    const heading = el("div", { class:`cloud-dialog-heading${isCloudCenter ? " penecho-workbench-heading" : ""}` }, [
      el("h2", { id:titleId, text:title }),
      subtitle ? el("p", { id:subtitleId, text:subtitle }) : null,
    ]);
    const mark = el("span", { class:`cloud-dialog-mark${isCloudCenter ? " penecho-workbench-icon" : ""}`, "aria-hidden":"true", ...(isCloudCenter ? {} : { text:"P" }) });
    if (isCloudCenter) mark.append(lineIcon(["M7 18.5h10.5a4 4 0 0 0 .4-8A6.2 6.2 0 0 0 6 9.2 4.7 4.7 0 0 0 7 18.5Z"]));
    const identity = el("div", { class:`cloud-dialog-identity${isCloudCenter ? " penecho-workbench-identity" : ""}` }, [
      mark,
      heading,
    ]);
    dialog.append(el("header", { class:`cloud-dialog-titlebar${isCloudCenter ? " penecho-workbench-header" : ""}` }, [identity, close]));
    const body = el("div", { class:"penecho-cloud-body" });
    dialog.append(body);
    overlay.append(dialog);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) closeOverlay(overlay); });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay(overlay);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.append(overlay);
    close.focus();
    return { overlay, dialog, body };
  }

  function accountSignedIn() {
    return isCloudRuntime()
      ? Boolean(window.PENECHO_REMOTE_CLOUD_STATUS?.accountName)
      : Boolean(state.status?.accountSession?.signedIn);
  }

  const liveShareStates = new Map();
  const canvasViewShareButton = document.getElementById("canvasViewShareBtn");
  let activeLiveShareContextKey = "";
  function liveShareKey(canvasId, widgetId = "") {
    const accountId = isCloudRuntime() ? window.PENECHO_REMOTE_CLOUD_STATUS?.accountId : state.status?.account?.id;
    return `${cloudOrigin()}:${accountId || "signed-in"}:${canvasId}:${widgetId}`;
  }
  function currentLiveShareCanvasId() {
    return accountSignedIn() ? window.PenEchoCloudProjects?.currentCanvasId?.() || null : null;
  }
  function notifyLiveShareChange() {
    renderCanvasShareStatus();
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("penecho:live-share-status-changed"));
  }
  function renderCanvasShareStatus() {
    const canvasId = currentLiveShareCanvasId();
    const shared = Boolean(canvasId && liveShareStates.get(liveShareKey(canvasId))?.shared);
    const label = cloudT(shared ? "sharedCanvasCloud" : "shareCanvasCloud");
    for (const button of [shareCanvasButton, canvasViewShareButton]) {
      if (!button) continue;
      button.dataset.liveShared = String(shared);
      button.dataset.peState = "default";
      button.classList.remove("active");
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  }
  function rememberLiveShare(canvasId, widgetId, share) {
    const key = liveShareKey(canvasId, widgetId);
    liveShareStates.set(key, { shared:Boolean(share) });
    notifyLiveShareChange();
  }
  function requestLiveShareStatus(canvasId, widgetId = "") {
    if (!canvasId || !accountSignedIn()) return;
    const key = liveShareKey(canvasId, widgetId);
    if (liveShareStates.has(key)) return;
    const entry = { shared:false };
    liveShareStates.set(key, entry);
    const suffix = widgetId ? `?widgetId=${encodeURIComponent(widgetId)}` : "";
    void api(`/api/cloud/canvases/${canvasId}/share${suffix}`).then(({ share }) => {
      if (liveShareStates.get(key) !== entry) return;
      entry.shared = Boolean(share);
      notifyLiveShareChange();
    }).catch(() => { entry.failed = true; });
  }
  function refreshCanvasShareStatus() {
    const canvasId = currentLiveShareCanvasId();
    const contextKey = canvasId ? liveShareKey(canvasId) : "";
    if (contextKey !== activeLiveShareContextKey) {
      if (!contextKey) liveShareStates.clear();
      activeLiveShareContextKey = contextKey;
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("penecho:live-share-status-changed"));
    }
    renderCanvasShareStatus();
    if (canvasId) {
      const key = liveShareKey(canvasId);
      if (liveShareStates.get(key)?.failed) liveShareStates.delete(key);
      requestLiveShareStatus(canvasId);
    }
  }
  window.PenEchoLiveShareStatus = Object.freeze({
    widgetShared:(_widgetId, sourceId) => {
      const canvasId = currentLiveShareCanvasId();
      if (!canvasId || !sourceId) return false;
      requestLiveShareStatus(canvasId, sourceId);
      return liveShareStates.get(liveShareKey(canvasId, sourceId))?.shared === true;
    },
  });
  window.addEventListener("penecho:live-share-context-changed", refreshCanvasShareStatus);

  function cloudDeviceConnectionStatus(status = state.status) {
    const device = status?.device || {};
    if (state.statusUnavailable) return { state:"failed", label:cloudT("statusUnavailable") };
    if (!device.configured) return { state:"unconfigured", label:cloudT("notLinked") };
    if (!device.enabled) return { state:"paused", label:cloudT("paused") };
    if (device.connected) return { state:"connected", label:cloudT("connected") };
    const relayState = String(device.state || status?.state || "").toLowerCase();
    const failed = Boolean(device.lastError || status?.lastError) || ["disconnected", "invalid", "waiting"].includes(relayState);
    return failed
      ? { state:"failed", label:cloudT("connectionFailed") }
      : { state:"connecting", label:cloudT("connecting") };
  }

  function updateCloudButton() {
    const account = state.status?.account;
    const remote = window.PENECHO_CONFIG?.runtime === "cloud" ? window.PENECHO_REMOTE_CLOUD_STATUS : null;
    const connected = remote ? Boolean(remote.deviceReady) : Boolean(state.status?.device?.connected && !state.statusUnavailable);
    const signedIn = remote ? Boolean(remote.accountName) : accountSignedIn();
    const accountName = String(remote?.accountName || account?.name || "");
    const credits = account?.credits ?? remote?.credits;
    cloudButton.dataset.state = connected ? "connected" : signedIn ? "signed-in" : "signed-out";
    cloudButton.querySelector(".cloud-account-label").textContent = accountName ? accountName.split(/\s+/)[0] : "Cloud";
    cloudButton.title = remote?.deviceOnline && !remote.deviceReady ? `PenEcho Cloud · ${cloudT("connecting")}` : connected
      ? `PenEcho Cloud · ${cloudT("deviceLinked")}`
      : signedIn
        ? `PenEcho Cloud · ${cloudT("credits", { count:credits == null ? "—" : Number(credits).toLocaleString(undefined,{maximumFractionDigits:1}) })}`
        : cloudT("openPenEchoCloud", { fallback:"Connect PenEcho Cloud" });
  }

  let statusRequestSeq = 0;

  async function refreshStatus(force = false) {
    if (isCloudRuntime()) {
      const remote = window.PENECHO_REMOTE_CLOUD_STATUS || {};
      state.status = {
        ...(state.status || {}),
        account:remote.accountName ? { ...(state.status?.account || {}), name:remote.accountName } : null,
        accountSession:{ ...(state.status?.accountSession || {}), signedIn:Boolean(remote.accountName) },
        device:{ ...(state.status?.device || {}), connected:Boolean(remote.deviceReady) },
      };
      updateCloudButton();
      refreshCanvasShareStatus();
      return state.status;
    }
    const seq = ++statusRequestSeq;
    const previouslySignedIn = accountSignedIn();
    try {
      const status = await api(force ? "/api/cloud/account" : "/api/cloud/status");
      // A newer request already superseded this one; never let a stale,
      // slower response overwrite fresher status.
      if (seq !== statusRequestSeq) return state.status;
      state.status = status;
      state.statusUnavailable = false;
      if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("penecho:cloud-account-changed"));
      if (previouslySignedIn !== accountSignedIn()) {
        state.library = null;
        state.favoriteCanvases = null;
        state.favoriteWidgets = null;
      }
      if (previouslySignedIn && !accountSignedIn()) browserSignInMessage("", "");
      updateCloudButton();
      refreshCanvasShareStatus();
      return state.status;
    } catch (error) {
      if (seq !== statusRequestSeq) return state.status;
      state.statusUnavailable = true;
      if (force) throw error;
      // A transient status failure is not evidence that the account session
      // ended. Keep the last confirmed state so tab renders cannot turn a
      // signed-in Cloud Center into a sign-in prompt while connectivity heals.
      if (state.status) updateCloudButton();
      else cloudButton.dataset.state = "signed-out";
      return state.status;
    }
  }

  function stopDeviceConnectionWatch() {
    state.deviceConnectionWatch.id++;
    clearTimeout(state.deviceConnectionWatch.timer);
    state.deviceConnectionWatch.timer = 0;
    state.deviceConnectionWatch.polling = false;
    state.deviceConnectionWatch.active = false;
    state.deviceConnectionWatch.expiresAt = 0;
  }

  function deviceStatusRevision() {
    const device = state.status?.device || {};
    return JSON.stringify([state.statusUnavailable, device.configured, device.enabled, device.connected, device.state, device.id, device.name, state.status?.lastError]);
  }

  function startDeviceConnectionWatch(render, overlay = activeCloudOverlay) {
    stopDeviceConnectionWatch();
    if (isCloudRuntime() || !overlay?.isConnected || state.cloudSection !== "device" || document.visibilityState === "hidden") return;
    const watch = state.deviceConnectionWatch;
    const id = watch.id;
    watch.active = true;
    const poll = async () => {
      if (id !== watch.id || !watch.active || watch.polling) return;
      if (!overlay.isConnected || state.cloudSection !== "device" || document.visibilityState === "hidden") return stopDeviceConnectionWatch();
      watch.polling = true;
      const before = deviceStatusRevision();
      try {
        await refreshStatus();
        if (id !== watch.id) return;
        if (overlay.isConnected && before !== deviceStatusRevision()) render?.();
      } finally {
        if (id === watch.id) {
          watch.polling = false;
          watch.timer = setTimeout(poll, DEVICE_CONNECTION_POLL_MS);
        }
      }
    };
    watch.timer = setTimeout(poll, DEVICE_CONNECTION_POLL_MS);
  }

  function stopBrowserSignInWatch() {
    state.browserSignIn.id++;
    clearTimeout(state.browserSignIn.timer);
    state.browserSignIn.timer = 0;
    state.browserSignIn.poll = null;
    state.browserSignIn.polling = false;
    state.browserSignIn.active = false;
    state.browserSignIn.expiresAt = 0;
    state.browserSignIn.popup = null;
    state.browserSignIn.authorizationUrl = "";
    state.browserSignIn.popupBlocked = false;
  }

  function browserSignInMessage(message, tone = "") {
    state.browserSignIn.message = message;
    state.browserSignIn.tone = tone;
  }

  function finishSuccessfulBrowserSignIn(overlay = activeCloudOverlay) {
    const popupWindow = state.browserSignIn.popup;
    stopBrowserSignInWatch();
    browserSignInMessage(cloudT("signedInReady"), "success");
    try { if (popupWindow && !popupWindow.closed) popupWindow.close(); } catch {}
    if (overlay?.isConnected) closeOverlay(overlay);
  }

  function startBrowserSignInWatch({ started, popup, externalOpened = false, render }) {
    stopBrowserSignInWatch();
    const id = state.browserSignIn.id;
    const signedInAtStart = accountSignedIn();
    const serverExpiry = Number(started?.expiresAt || 0);
    state.browserSignIn.active = true;
    state.browserSignIn.expiresAt = Math.min(
      Number.isFinite(serverExpiry) && serverExpiry > Date.now() ? serverExpiry : Date.now() + BROWSER_SIGN_IN_TIMEOUT_MS,
      Date.now() + BROWSER_SIGN_IN_TIMEOUT_MS,
    );
    state.browserSignIn.popup = popup || null;
    state.browserSignIn.authorizationUrl = String(started?.authorizationUrl || "");
    state.browserSignIn.popupBlocked = !popup && !externalOpened;
    browserSignInMessage(popup || externalOpened
      ? `${window.penechoDesktop ? cloudT("desktopBrowserOpen") : ""}${cloudT("browserComplete")}`
      : cloudT("browserBlocked"), popup || externalOpened ? "" : "error");

    const renderIfOpen = () => {
      if (document.querySelector(".penecho-cloud-overlay") || document.querySelector('#settingsPageMcp:not([hidden])')) render?.();
    };
    const poll = async () => {
      if (id !== state.browserSignIn.id || !state.browserSignIn.active || state.browserSignIn.polling) return;
      state.browserSignIn.polling = true;
      try {
        await refreshStatus();
        if (id !== state.browserSignIn.id) return;
        if (!signedInAtStart && accountSignedIn()) {
          finishSuccessfulBrowserSignIn(activeCloudOverlay);
          return;
        }
        if (Date.now() >= state.browserSignIn.expiresAt) {
          stopBrowserSignInWatch();
          browserSignInMessage(cloudT("browserExpired"), "error");
          renderIfOpen();
          return;
        }
        const delay = document.visibilityState === "visible" ? BROWSER_SIGN_IN_POLL_MS : 1500;
        state.browserSignIn.timer = setTimeout(poll, delay);
      } finally {
        if (id === state.browserSignIn.id) state.browserSignIn.polling = false;
      }
    };
    state.browserSignIn.poll = poll;
    state.browserSignIn.timer = setTimeout(poll, BROWSER_SIGN_IN_POLL_MS);
  }

  function pageHeading(title, description) {
    return el("header", { class:"cloud-content-heading" }, [
      el("h3", { text:title }),
      description ? el("p", { text:description }) : null,
    ]);
  }

  function accountPanel(render, setRefreshing) {
    const panel = el("section", { class:"penecho-cloud-panel cloud-account-panel" });
    panel.append(pageHeading(cloudT("cloudAccount"), accountSignedIn() ? cloudT("accountHint") : cloudT("localSignInHelp")));
    if (accountSignedIn()) {
      const account = state.status.account || {};
      const membership = account.membership;
      const hasMembership = ["plus", "pro"].includes(membership?.tier) && Number.isFinite(membership?.expiresAt) && membership.expiresAt > Date.now();
      const membershipDate = hasMembership ? new Date(membership.expiresAt).toLocaleDateString((document.documentElement.lang || "en").startsWith("zh") ? "zh-CN" : "en-US", { year:"numeric", month:"long", day:"numeric" }) : "";
      const identity = el("div", { class:"cloud-settings-group cloud-account-profile" }, [
        el("div", { class:"cloud-setting-row cloud-account-identity" }, [
          el("div", { class:"cloud-avatar", text:String(account.name || "P").slice(0, 1).toUpperCase() }),
          el("div", { class:"cloud-account-copy" }, [
            el("div", { class:"cloud-account-title" }, [
              el("strong", { class:"cloud-account-name", text:account.name || cloudT("cloudUser") }),
              hasMembership ? el("span", { class:`cloud-membership-badge cloud-membership-${membership.tier}`, text:membership.tier.toUpperCase(), "aria-label":`PenEcho ${membership.tier === "pro" ? "Pro" : "Plus"}` }) : null,
            ]),
            el("span", { text:cloudT("credits", { count:Number(account.credits || 0).toLocaleString() }) }),
            hasMembership ? el("span", { class:"cloud-subscription-expiry", text:cloudT("subscriptionValidUntil", { date:membershipDate }) }) : null,
          ]),
        ]),
      ]);
      const overview = el("section", { class:"cloud-account-overview", "aria-live":"polite", "aria-busy":"true" });
      const renderOverview = () => {
        const library = state.library;
        if (!library) {
          overview.replaceChildren(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingProjects") }));
          return;
        }
        const workspace = library.workspace || {};
        const projects = Array.isArray(library.projects) ? library.projects.filter((project) => project.systemKey !== "uncategorized") : [];
        const canvases = Array.isArray(library.canvases) ? library.canvases : [];
        const used = Number(workspace.storageUsedBytes || 0) + Number(workspace.storageReservedBytes || 0);
        const limit = Number(workspace.storageLimitBytes || 0);
        const storageCopy = limit
          ? `${cloudT("used", { size:formatBytes(used) })}${cloudT("of", { size:formatBytes(limit) })}`
          : cloudT("used", { size:formatBytes(used) });
        overview.replaceChildren(
          el("h4", { class:"cloud-section-heading", text:cloudT("accountOverview") }),
          el("div", { class:"cloud-settings-group cloud-account-stats" }, [
            el("div", { class:"cloud-setting-row" }, [el("span", { text:cloudT("accountProjects") }), el("strong", { text:String(projects.length) })]),
            el("div", { class:"cloud-setting-row" }, [el("span", { text:cloudT("accountCanvases") }), el("strong", { text:String(canvases.length) })]),
            el("div", { class:"cloud-setting-row cloud-storage-row" }, [
              el("div", { class:"cloud-setting-copy" }, [el("span", { text:cloudT("storageUsed") }), el("small", { text:storageCopy })]),
              el("progress", { class:"cloud-storage-track", max:String(Math.max(1, limit)), value:String(Math.min(used, Math.max(1, limit))), "aria-label":cloudT("storageUsed") }),
            ]),
          ]),
        );
        overview.setAttribute("aria-busy", "false");
      };
      renderOverview();
      const actions = el("div", { class:"cloud-button-row cloud-page-actions" }, [
        el("a", { class:"cloud-button", href:new URL("/dashboard.html", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:cloudT("openDashboard") }),
        el("button", { class:"cloud-button", type:"button", text:cloudT("refreshAccount"), onclick:async () => action(render, async () => {
          await refreshStatus(true);
          state.library = await loadCloudLibrary();
        }) }),
        el("button", { class:"cloud-button danger", type:"button", text:cloudT("signOutHost"), onclick:async () => {
          if (!window.confirm(cloudT("signOutConfirm"))) return;
          await action(render, async () => {
            await api("/api/cloud/sign-out", { method:"POST", body:"{}" });
            state.library = null;
            await refreshStatus();
          });
        } }),
      ]);
      panel.append(identity, overview, actions);
      const requestId = ++state.accountRequestId;
      setRefreshing(true);
      queueMicrotask(async () => {
        try {
          const library = await loadCloudLibrary();
          if (requestId !== state.accountRequestId) return;
          state.library = library;
          if (panel.isConnected) renderOverview();
        } catch (error) {
          if (requestId !== state.accountRequestId) return;
          if (!state.library && panel.isConnected) overview.replaceChildren(el("div", { class:"cloud-message error", role:"alert", text:error.message }));
        } finally {
          if (requestId === state.accountRequestId) {
            overview.setAttribute("aria-busy", "false");
            setRefreshing(false);
          }
        }
      });
      return panel;
    }

    if (configuredCloudEnvironment === "uat") panel.append(el("div", { class:"cloud-environment" }, [el("span", { text:"UAT" }), el("code", { text:cloudOrigin() })]));
    const browserSignIn = state.browserSignIn;
    const message = el("div", {
      class:`cloud-message${browserSignIn.tone ? ` ${browserSignIn.tone}` : ""}`,
      text:browserSignIn.message,
      role:browserSignIn.tone === "error" ? "alert" : "status",
      "aria-live":browserSignIn.tone === "error" ? "assertive" : "polite",
    });
    const signIn = el("button", { class:"cloud-button primary cloud-account-sign-in", type:"button", text:browserSignIn.active ? cloudT("waitingBrowser") : window.penechoDesktop ? cloudT("continueBrowser") : cloudT("signInBrowser"), ...(browserSignIn.active ? { disabled:"" } : {}), onclick:async () => {
      await beginCloudSignIn(render);
    } });
    const browserActions = el("div", { class:"cloud-button-row" }, signIn);
    if (browserSignIn.active && browserSignIn.authorizationUrl) {
      browserActions.append(el("a", { class:"cloud-button", href:browserSignIn.authorizationUrl, target:"_blank", rel:"noopener", text:browserSignIn.popupBlocked ? cloudT("openSignIn") : cloudT("openAgain") }));
    }
    panel.append(el("div", { class:"cloud-settings-group cloud-sign-in-group" }, browserActions));
    if (browserSignIn.message) panel.append(message);
    return panel;
  }

  async function beginCloudSignIn(render) {
      const desktopApp = Boolean(window.penechoDesktop);
      const popup = desktopApp ? null : window.open("about:blank", "penecho-cloud-sign-in", "popup,width=760,height=760");
      await action(render, async () => {
        try {
          const started = await api("/api/cloud/sign-in/start", { method:"POST", body:JSON.stringify({ origin:cloudOrigin() }) });
          if (desktopApp) window.open(started.authorizationUrl, "_blank", "noopener");
          else if (popup) popup.location.replace(started.authorizationUrl);
          startBrowserSignInWatch({ started, popup, externalOpened:desktopApp, render });
        } catch (error) {
          try { popup?.close(); } catch {}
          throw error;
        }
      });
  }

  window.PenEchoCloudSettings = {
    api, origin:cloudOrigin,
    cacheIdentity:()=>{
      // Cloud status is published by the Remote Canvas gate; local status may
      // never be initialized there. Scope cached pages to the same authority.
      const accountId = isCloudRuntime() ? window.PENECHO_REMOTE_CLOUD_STATUS?.accountId : state.status?.account?.id;
      return accountSignedIn() && accountId ? `${cloudOrigin()}:${accountId}` : "";
    },
    signInState:()=>({active:state.browserSignIn.active,url:state.browserSignIn.authorizationUrl,message:state.browserSignIn.message}),
    signIn:refresh=>window.PENECHO_CONFIG?.browserDraftId ? window.PenEchoBrowserDraft.signIn() : isCloudRuntime() ? window.open(new URL('/auth.html',cloudOrigin()).toString(),'_blank','noopener') : beginCloudSignIn(refresh),
  };

  function devicePanel(render) {
    const panel = el("section", { class:"penecho-cloud-panel cloud-device-panel" });
    panel.append(pageHeading(cloudT("linkThisDevice"), cloudT("linkDeviceHint")));
    const device = state.status?.device || {};
    if (device.configured) {
      const connection = cloudDeviceConnectionStatus();
      panel.append(el("div", { class:"cloud-settings-group" }, [
        el("div", { class:"cloud-setting-row cloud-device-summary" }, [
          el("div", { class:"cloud-setting-copy" }, [
            el("strong", { class:"cloud-device-name", text:device.name || cloudT("thisDevice") }),
            el("small", { text:cloudT("thisDevice") }),
          ]),
          el("span", {
            class:"cloud-device-state",
            "data-state":connection.state,
            text:connection.label,
          }),
        ]),
      ]));
      const actions = el("div", { class:"cloud-button-row cloud-page-actions" });
      actions.append(el("button", { class:"cloud-button", type:"button", text:device.enabled ? cloudT("pauseLink") : cloudT("reconnectLink"), onclick:async () => action(render, async () => {
        await api(`/api/cloud/device/${device.enabled ? "disable" : "enable"}`, { method:"POST", body:"{}" });
        await refreshStatus();
        if (!device.enabled) startDeviceConnectionWatch(render);
      }) }));
      actions.append(el("button", { class:"cloud-button danger", type:"button", text:cloudT("removeThisLink"), onclick:async () => {
        if (!window.confirm(cloudT("removeLinkConfirm"))) return;
        await action(render, async () => { await api("/api/cloud/device/revoke", { method:"POST", body:"{}" }); await refreshStatus(); });
      } }));
      panel.append(actions, el("p", { text:cloudT("disconnectLinkHint") }));
      return panel;
    }
    if (!accountSignedIn()) {
      panel.append(el("p", { text:cloudT("linkSignInFirst") }));
      panel.append(el("button", { class:"cloud-button", type:"button", text:cloudT("openAccount"), onclick:() => {
        state.cloudSection = "account";
        render();
        queueMicrotask(() => document.querySelector("#cloud-tab-account")?.focus());
      } }));
      return panel;
    }
    panel.append(el("div", { class:"cloud-button-row cloud-page-actions" }, el("button", { class:"cloud-button primary", type:"button", text:cloudT("enableLink"), onclick:async () => action(render, async () => {
      await api("/api/cloud/device/enable", { method:"POST", body:"{}" });
      await refreshStatus();
      startDeviceConnectionWatch(render);
    }) })));
    return panel;
  }

  function field(label, input) {
    return el("label", { class:"cloud-field" }, [el("span", { text:label }), input]);
  }

  async function action(render, task) {
    if (state.busy) return;
    state.busy = true;
    try { await task(); }
    catch (error) { window.alert(error.message || cloudT("requestFailed")); }
    finally { state.busy = false; render?.(); }
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0));
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = bytes / 1024, unit = units[0];
    for (let index = 1; index < units.length && size >= 1024; index++) { size /= 1024; unit = units[index]; }
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
  }

  async function loadCloudLibrary() {
    const library = await api("/api/cloud/library");
    if (library?.sync?.bundleVersion !== 2 || library.sync.conflictPolicy !== "base-revision-required") throw Error(cloudT("syncUnsupported"));
    return library;
  }

  async function openProjectCanvasHere(canvasId, owner, control) {
    const bridge = window.PenEchoCloudProjects;
    if (!bridge?.openCanvas) return window.alert(cloudT("cloudSavingNotReady"));
    if (state.busy) return false;
    state.busy = true;
    if (control) control.disabled = true;
    closeOverlay(owner?.closest?.(".penecho-cloud-overlay") || document.querySelector(".penecho-cloud-overlay"));
    try {
      await bridge.openCanvas(canvasId);
      return true;
    } catch (error) {
      window.alert(error?.message || cloudT("requestFailed"));
      return false;
    } finally {
      state.busy = false;
      if (control) control.disabled = false;
    }
  }

  function cloudSignInEmpty(messageKey) {
    return el("div", { class:"cloud-empty cloud-auth-empty" }, el("p", { text:cloudT(messageKey) }));
  }

  function cloudProjectsPanel(setRefreshing) {
    const panel = el("section", { class:"penecho-cloud-panel cloud-projects-panel" });
    if (!accountSignedIn()) {
      panel.append(cloudSignInEmpty("signInProjects"));
      return panel;
    }
    const content = el("div", { class:"cloud-project-content", "aria-live":"polite", "aria-busy":"true" });
    panel.append(content);

    function rememberProject(projectId) {
      state.selectedProjectId = projectId || null;
      try {
        if (state.selectedProjectId) sessionStorage.setItem("penecho-cloud-center-project", state.selectedProjectId);
        else sessionStorage.removeItem("penecho-cloud-center-project");
      } catch {}
    }

    function selectedProject(projects) {
      if (!state.selectedProjectId) {
        try { state.selectedProjectId = sessionStorage.getItem("penecho-cloud-center-project"); } catch {}
      }
      const selected = projects.find((project) => project.id === state.selectedProjectId)
        || projects.find((project) => project.systemKey !== "uncategorized")
        || projects[0]
        || null;
      if (selected?.id !== state.selectedProjectId) rememberProject(selected?.id || null);
      return selected;
    }

    async function openProjectHistory(projectId) {
      const bridge = window.PenEchoCloudProjects;
      if (!bridge?.openHistory) return window.alert(cloudT("cloudSavingNotReady"));
      closeOverlay(panel.closest(".penecho-cloud-overlay"));
      await bridge.openHistory(projectId || null);
    }

    function renderLibrary() {
      const library = state.library || {}, projects = Array.isArray(library.projects) ? library.projects : [], canvases = Array.isArray(library.canvases) ? library.canvases : [];
      const pageHeader = el("header", { class:"cloud-content-heading cloud-project-page-header" }, [
        el("h3", { text:cloudT("cloudProjects") }),
        el("p", { text:cloudT("cloudProjectsHint") }),
      ]);
      const project = selectedProject(projects);
      const selector = el("select", { "aria-label":cloudT("currentProject"), onchange:(event) => {
        rememberProject(event.currentTarget.value);
        renderLibrary();
      } }, projects.map((candidate) => el("option", {
        value:candidate.id,
        text:candidate.name || cloudT("untitledProject"),
        ...(candidate.id === project?.id ? { selected:"" } : {}),
      })));
      const picker = el("label", { class:"cloud-project-picker" }, [el("span", { text:cloudT("project") }), selector]);
      const createName = el("input", { type:"text", maxlength:"160", placeholder:cloudT("projectName"), "aria-label":cloudT("newProjectName") });
      const createDetails = el("details", { class:"cloud-project-create" });
      const createButton = el("button", { class:"cloud-button primary", type:"button", text:cloudT("create"), onclick:async () => action(load, async () => {
        const name = createName.value.trim();
        if (!name) throw Error(cloudT("enterProjectName"));
        const created = await api("/api/cloud/projects", { method:"POST", body:JSON.stringify({ name }) });
        rememberProject(created?.project?.id || null);
        createName.value = "";
        createDetails.open = false;
      }) });
      createDetails.append(
        el("summary", { class:"cloud-button", text:cloudT("newProject") }),
        el("div", { class:"cloud-project-create-form" }, [createName, createButton]),
      );
      const projectActions = el("div", { class:"cloud-project-actions" }, [
        project ? el("button", { class:"cloud-button primary", type:"button", text:cloudT("saveCurrentHere"), onclick:() => openProjectHistory(project.id) }) : null,
        createDetails,
      ]);
      const commandBar = el("div", { class:"cloud-project-toolbar" }, [picker, projectActions]);
      const card = el("article", { class:"cloud-project-card" });
      if (project) {
        const projectCanvases = canvases.filter((canvas) => canvas.projectId === project.id);
        card.append(el("div", { class:"cloud-project-card-head" }, [
          el("div", {}, [el("h4", { text:project.name || cloudT("untitledProject") }), el("span", { text:cloudT("canvasesCount", { count:projectCanvases.length, suffix:projectCanvases.length === 1 ? "" : "es" }) })]),
        ]));
        const list = el("div", { class:"cloud-canvas-list" });
        if (!projectCanvases.length) list.append(el("div", { class:"cloud-project-empty", text:cloudT("noCanvases") }));
        for (const canvas of projectCanvases.slice(0, 12)) {
          const revision = String(canvas.currentRevisionId || "").trim();
          const thumbnailUrl = canvas.previewDataUrl || (isCloudRuntime() && revision
            ? `/api/v1/canvases/${encodeURIComponent(canvas.id)}/thumbnail?revision=${encodeURIComponent(revision)}`
            : "");
          const row = el("button", { class:"cloud-canvas-row", type:"button", onclick:() => openProjectCanvasHere(canvas.id, panel, row) }, [
            thumbnailUrl ? el("img", { src:thumbnailUrl, alt:"", loading:"lazy" }) : el("span", { class:"cloud-canvas-placeholder", text:"P" }),
            el("span", { class:"cloud-canvas-copy" }, [
              el("strong", { text:canvas.name || cloudT("untitledCanvas") }),
              el("small", { text:cloudT("updated", { date:new Intl.DateTimeFormat(document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en", { dateStyle:"medium", timeStyle:"short" }).format(canvas.updatedAt || canvas.createdAt || Date.now()), size:formatBytes(canvas.sizeBytes) }) }),
            ]),
            el("span", { class:"cloud-canvas-open", text:cloudT("openCanvasHere") }),
          ]);
          list.append(row);
        }
        card.append(list);
      }
      const projectArea = project ? card : el("div", { class:"cloud-empty", text:cloudT("noProjects") });
      content.replaceChildren(pageHeader, commandBar, projectArea, el("a", { class:"cloud-project-web-link", href:new URL("/dashboard.html#projects", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:cloudT("manageWeb") }));
    }
    async function load() {
      const requestId = ++state.projectRequestId;
      content.setAttribute("aria-busy", "true");
      setRefreshing(true);
      if (!state.library) content.replaceChildren(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingProjects") }));
      try {
        const library = await loadCloudLibrary();
        if (requestId !== state.projectRequestId) return;
        state.library = library;
        if (panel.isConnected) renderLibrary();
      } catch (error) {
        if (requestId !== state.projectRequestId) return;
        if (!state.library) content.replaceChildren(el("div", { class:"cloud-message error", role:"alert", text:error.message }));
      } finally {
        if (requestId === state.projectRequestId) {
          content.setAttribute("aria-busy", "false");
          setRefreshing(false);
        }
      }
    }
    if (state.library) {
      renderLibrary();
    }
    queueMicrotask(load);
    return panel;
  }

  function favoriteThumbnail(source, fallback, communityId = null) {
    const url = thumbnailDataUrl(source) || (communityId ? communityThumbnailUrl(communityId) : "");
    if (!url) return el("span", { class:"cloud-library-thumb-fallback", text:fallback });
    const image = el("img", { class:"cloud-library-thumb", src:url, alt:"", loading:"lazy" });
    image.addEventListener("error", () => image.replaceWith(el("span", { class:"cloud-library-thumb-fallback", text:fallback })));
    return image;
  }

  function favoriteCanvasRow(item, owner) {
    const open = el("button", { class:"cloud-button cloud-row-action", type:"button", text:cloudT("openCanvasHere"), onclick:async () => {
      if (state.busy) return;
      state.busy = true;
      open.disabled = true;
      open.textContent = cloudT("openingCanvas");
      try {
        await takeFurther(item.id);
      } catch (error) {
        open.disabled = false;
        open.textContent = cloudT("openCanvasHere");
        window.alert(error?.message || cloudT("favoriteLoadFailed"));
      } finally {
        state.busy = false;
      }
    } });
    const actions = el("span", { class:"cloud-library-actions" }, [
      open,
    ]);
    return el("article", { class:"cloud-library-row" }, [
      favoriteThumbnail(item, "C", item.id),
      el("span", { class:"cloud-library-copy" }, [
        el("strong", { text:item.name || cloudT("untitledCanvas") }),
        el("small", { text:cloudT("byAuthor", { name:item.author?.name || cloudT("creator") }) }),
      ]),
      actions,
    ]);
  }

  function favoriteWidgetRow(merged, owner) {
    const community = merged.sources.find((source) => source.type === "community")?.entry || null;
    const source = community || merged.sources.find((entry) => entry.type === "cloud")?.entry || merged.sources[0]?.entry || {};
    const add = el("button", { class:"cloud-button cloud-row-action", type:"button", text:cloudT("addToCanvas"), onclick:async () => {
      if (state.busy) return;
      state.busy = true;
      add.disabled = true;
      add.textContent = cloudT("addingToCanvas");
      try {
        await addCraftToCanvas(merged);
        closeOverlay(owner.closest(".penecho-cloud-overlay"));
      } catch (error) {
        add.disabled = false;
        add.textContent = cloudT("addToCanvas");
        window.alert(error?.message || cloudT("favoriteLoadFailed"));
      } finally {
        state.busy = false;
      }
    } });
    const actions = el("span", { class:"cloud-library-actions" }, [
      add,
    ]);
    return el("article", { class:"cloud-library-row" }, [
      favoriteThumbnail(source, "W", community?.id || null),
      el("span", { class:"cloud-library-copy" }, [
        el("strong", { text:source.name || source.artifact?.widget?.title || cloudT("untitledWidget") }),
        el("small", { text:community?.author?.name ? cloudT("byAuthor", { name:community.author.name }) : source.artifact?.widget?.title || cloudT("communityWidget") }),
      ]),
      actions,
    ]);
  }

  function cloudFavoritesPanel(setRefreshing) {
    const panel = el("section", { class:"penecho-cloud-panel cloud-favorites-panel" });
    panel.append(el("header", { class:"cloud-content-heading" }, [
      el("h3", { "data-pe-region":"title", text:cloudT("favorites") }),
      el("p", { class:"cloud-favorites-hint", text:cloudT("favoritesHint") }),
    ]));
    if (!accountSignedIn()) {
      panel.append(cloudSignInEmpty("signInFavorites"));
      return panel;
    }
    const filters = el("div", { class:"cloud-favorite-filters", role:"group", "aria-label":cloudT("favorites"), "data-pe-control":"segmented" });
    const content = el("div", { class:"cloud-library-list", "aria-live":"polite", "aria-busy":"true" });
    panel.append(filters, content);
    let pager = favoritePagerForKind(state.cloudFavoriteKind);
    let observer = null;
    function renderFavorites() {
      filters.replaceChildren(...[
        ["all", "all"],
        ["canvas", "canvases"],
        ["widget", "widgets"],
      ].map(([value, label]) => el("button", {
        class:`cloud-favorite-filter${state.cloudFavoriteKind === value ? " active" : ""}`,
        type:"button",
        "aria-pressed":String(state.cloudFavoriteKind === value),
        text:cloudT(label),
        onclick:() => {
          if (state.cloudFavoriteKind === value) return;
          state.cloudFavoriteKind = value;
          pager = favoritePagerForKind(value);
          renderFavorites();
          void load(true);
        },
      })));
      observer?.disconnect();
      observer = null;
      const entries = favoritePagerEntries(pager), rows = entries.map((entry) => entry.kind === "canvas"
        ? favoriteCanvasRow(entry.sources.find((source) => source.type === "community")?.entry || entry.sources[0]?.entry || {}, panel)
        : favoriteWidgetRow(entry, panel));
      const emptyKey = state.cloudFavoriteKind === "canvas" ? "noFavoriteCanvases" : state.cloudFavoriteKind === "widget" ? "noFavoriteWidgets" : "noFavorites";
      if (!rows.length && pager.loading) rows.push(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingFavorites") }));
      else if (!rows.length && pager.error) rows.push(el("div", { class:"cloud-message error", role:"alert", text:pager.error?.message || cloudT("favoriteLoadFailed") }));
      else if (!rows.length) rows.push(el("div", { class:"cloud-empty", text:cloudT(emptyKey) }));
      if (pager.error || favoritePagerHasMore(pager)) {
        const retrying = Boolean(pager.error);
        const more = el("button", {
          class:"cloud-button cloud-favorites-load-more",
          type:"button",
          disabled:Boolean(pager.loading),
          text:pager.loading ? cloudT("loadingFavorites") : pager.error ? cloudT("retryFavorites") : cloudT("loadMoreFavorites"),
          onclick:() => void load(retrying),
        });
        rows.push(more);
        if (!retrying && !pager.loading) observer = observeFavoritePagerSentinel(more, null, () => load(false));
      }
      content.replaceChildren(...rows);
    }
    const load = async (reset = false) => {
      const requestId = ++state.favoriteRequestId;
      content.setAttribute("aria-busy", "true");
      setRefreshing(true);
      if (reset) {
        pager.kind = state.cloudFavoriteKind;
        if (!favoritePagerEntries(pager).length) content.replaceChildren(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingFavorites") }));
      }
      try {
        await loadFavoritePager(pager, { reset, onUpdate:() => {
          if (requestId === state.favoriteRequestId && panel.isConnected) renderFavorites();
        } });
        if (requestId !== state.favoriteRequestId) return;
        if (panel.isConnected) renderFavorites();
      } catch (error) {
        if (requestId !== state.favoriteRequestId) return;
        pager.error = error;
        if (panel.isConnected) renderFavorites();
      } finally {
        if (requestId === state.favoriteRequestId) {
          content.setAttribute("aria-busy", "false");
          setRefreshing(false);
        }
      }
    };
    renderFavorites();
    queueMicrotask(() => load(true));
    return panel;
  }

  function cloudSectionPanel(render, setRefreshing) {
    if (state.cloudSection === "account") return accountPanel(render, setRefreshing);
    if (state.cloudSection === "device") return devicePanel(render);
    if (state.cloudSection === "favorites") return cloudFavoritesPanel(setRefreshing);
    return cloudProjectsPanel(setRefreshing);
  }

  async function openCloud() {
    if(window.PENECHO_CONFIG?.guestCanvas){await window.PenEchoBrowserDraft?.signIn();return;}
    cloudButton.setAttribute("aria-expanded", "true");
    const shell = dialogShell({ title:"PenEcho Cloud", subtitle:cloudT("cloudSubtitle"), variant:"cloud-center" });
    shell.dialog.dataset.peSurface = "manager";
    shell.dialog.dataset.peSize = "xl";
    shell.dialog.dataset.peLayout = "nav-content";
    shell.dialog.dataset.peMaterial = "opaque";
    shell.dialog.querySelector(".cloud-dialog-titlebar")?.setAttribute("data-pe-region", "header");
    shell.body.dataset.peRegion = "body";
    activeCloudOverlay = shell.overlay;
    const layout = el("div", { class:"penecho-cloud-layout" });
    shell.body.append(layout);
    function render() {
      const workspace = el("div", { class:"cloud-workspace" });
      workspace.dataset.peRegion = "content";
      if (!localHostControlsAvailable && !["projects", "favorites"].includes(state.cloudSection)) state.cloudSection = "projects";
      const sections = el("nav", { class:"cloud-section-tabs", role:"tablist", "aria-label":cloudT("cloudArea"), "aria-orientation":"vertical" });
      const appendSection = (value, label, meta = "", navHeading = "", trailing = null) => {
        const active = state.cloudSection === value;
        const localOnly = value === "account" || value === "device";
        const copy = el("span", { class:"cloud-nav-copy" }, [
          el("strong", { text:cloudT(label) }),
          meta ? el("span", { class:"cloud-nav-meta", text:meta }) : null,
        ]);
        if (navHeading) sections.append(el("span", { class:"cloud-nav-heading", role:"presentation", text:navHeading }));
        sections.append(el("button", {
          id:`cloud-tab-${value}`,
          class:`cloud-section-tab cloud-section-tab-${value}${localOnly ? " cloud-local-controls" : ""}${active ? " active" : ""}`,
          type:"button",
          role:"tab",
          "data-pe-button":"menu-item",
          "data-pe-state":active ? "selected" : "default",
          "data-cloud-section":value,
          "aria-selected":String(active),
          "aria-controls":"cloud-section-panel",
          tabindex:active ? "0" : "-1",
          onclick:() => {
            if(value==="mcp") { closeOverlay(shell.overlay); window.dispatchEvent(new CustomEvent("penecho:show-mcp-settings")); return; }
            state.cloudSection = value;
            render();
            startDeviceConnectionWatch(render, shell.overlay);
            queueMicrotask(() => document.querySelector(`#cloud-tab-${value}`)?.focus());
          },
        }, [el("span", { class:"cloud-nav-icon", "aria-hidden":"true" }), copy, trailing]));
      };
      if (localHostControlsAvailable) {
        const accountName = accountSignedIn() ? String(state.status?.account?.name || cloudT("cloudUser")) : cloudT("signIn");
        appendSection("account", "cloudAccount", accountName);
        const device = state.status?.device || {};
        const deviceMeta = device.configured
          ? String(device.name || (device.connected ? cloudT("connected") : device.enabled ? cloudT("connecting") : cloudT("paused")))
          : accountSignedIn() ? cloudT("notLinked") : cloudT("signIn");
        const connection = cloudDeviceConnectionStatus();
        appendSection("device", "linkThisDevice", deviceMeta, "", el("span", {
          class:"cloud-device-status-dot",
          "data-state":connection.state,
          role:"img",
          "aria-label":connection.label,
          title:connection.label,
        }));
      }
      const definitions = [
        ["projects", "cloudProjects"],
        ["favorites", "favorites"],
      ];
      appendSection("mcp", "MCP");
      definitions.forEach(([value, label], index) => appendSection(value, label, "", index === 0 ? cloudT("cloudNavLibrary") : ""));
      sections.append(el("a", {
        class:"cloud-section-tab cloud-explore-link",
        href:new URL("/community.html", `${cloudOrigin()}/`).toString(),
        target:"_blank",
        rel:"noopener",
        "data-cloud-section":"echoes",
        "data-pe-button":"menu-item",
        "data-pe-state":"default",
      }, [el("span", { class:"cloud-nav-icon", "aria-hidden":"true" }), el("span", { class:"cloud-nav-copy" }, el("strong", { text:`${cloudT("explore")} ↗` }))]));
      sections.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || event.target?.getAttribute?.("role") !== "tab") return;
        const tabs = [...sections.querySelectorAll('[role="tab"]')], current = tabs.indexOf(event.target);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
      const refreshIndicator = el("span", {
        class:"cloud-section-refresh-indicator",
        role:"status",
        "aria-label":cloudT(state.cloudSection === "favorites" ? "loadingFavorites" : "loadingProjects"),
        hidden:"",
      }, el("span", { "aria-hidden":"true", text:"↻" }));
      refreshIndicator.hidden = true;
      const setRefreshing = (refreshing) => { refreshIndicator.hidden = !refreshing; };
      const sectionToolbar = el("div", { class:"cloud-section-toolbar" }, [sections, refreshIndicator]);
      const sectionPanel = cloudSectionPanel(render, setRefreshing);
      sectionPanel.id = "cloud-section-panel";
      sectionPanel.setAttribute("role", "tabpanel");
      sectionPanel.setAttribute("aria-labelledby", `cloud-tab-${state.cloudSection}`);
      workspace.append(sectionPanel);
      const navigation = el("aside", { class:"cloud-navigation penecho-workbench-navigation", "aria-label":cloudT("cloudArea") });
      navigation.dataset.peRegion = "navigator";
      layout.classList.toggle("remote-cloud-runtime", !localHostControlsAvailable);
      navigation.append(sectionToolbar);
      layout.replaceChildren(navigation, workspace);
    }
    shell.overlay._cloudRender = render;
    render();
    if (isCloudRuntime()) {
      void refreshStatus();
      return;
    }
    const hadStatus = Boolean(state.status), wasSignedIn = accountSignedIn(), previousDevice = deviceStatusRevision();
    cloudButton.setAttribute("aria-busy", "true");
    void refreshStatus().then(() => {
      if (shell.overlay.isConnected && (!hadStatus || wasSignedIn !== accountSignedIn() || previousDevice !== deviceStatusRevision())) render();
      startDeviceConnectionWatch(render, shell.overlay);
    }).finally(() => cloudButton.setAttribute("aria-busy", "false"));
  }

  function publishedCraftDialog({ item, kind, kindLabel, artifact, bridge, originError, favoriteError, favoriteAfterShare }) {
    const url = communityUrl(item), publishedName = String(item.name || cloudT(kind === "widget" ? "widgetKind" : "canvasKind"));
    const shell = dialogShell({ title:cloudT("publishedDialogTitle"), subtitle:cloudT("publishedDialogSubtitle") });
    shell.dialog.classList.add("publish-success");
    const status = el("p", { class:`cloud-published-status ${originError || favoriteError ? "error" : "success"}`, role:"status", "aria-live":"polite", text:originError
      ? cloudT("publishedLocalLinkAttention")
      : favoriteError
        ? cloudT("publishedFavoriteRetry")
        : cloudT(favoriteAfterShare ? "publishedAndSaved" : "publishedContinues") });
    const localSourceMessage = el("p", { class:"cloud-published-source", text:originError
      ? cloudT("originRetryMessage", { kind:kindLabel, step:Number(item.generation || 0) + 1 })
      : cloudT("originLinkedMessage", { kind:kindLabel, step:item.generation ? cloudT("stepNumber", { number:Number(item.generation) + 1 }) : cloudT("firstStroke") }) });
    const actions = el("div", { class:"cloud-published-actions" });
    let busy = false;
    const shareLink = el("button", { class:"cloud-button primary", type:"button", text:cloudT("shareAsLink"), onclick:async () => {
      if (busy) return;
      busy = true;
      shareLink.disabled = shareImage.disabled = true;
      try {
        if (navigator.share) {
          await navigator.share({ title:publishedName, text:cloudT("nativeShareText", { kind:kindLabel }), url });
          status.className = "cloud-published-status success";
          status.textContent = cloudT("shareLinkShared");
        } else {
          await copyText(url);
          status.className = "cloud-published-status success";
          status.textContent = cloudT("publicLinkCopied");
        }
      } catch (error) {
        status.className = `cloud-published-status${error?.name === "AbortError" ? "" : " error"}`;
        status.textContent = cloudT(error?.name === "AbortError" ? "shareLinkCancelled" : "shareLinkFailed");
      } finally {
        busy = false;
        shareLink.disabled = shareImage.disabled = false;
      }
    } });
    const shareImage = el("button", { class:"cloud-button", type:"button", text:cloudT("shareAsImage"), title:cloudT("shareImageEmbedTitle"), onclick:async () => {
      if (busy) return;
      busy = true;
      shareLink.disabled = shareImage.disabled = true;
      try {
        await copyText(linkedImageEmbed(item, publishedName));
        status.className = "cloud-published-status success";
        status.textContent = cloudT("shareImageEmbedCopied");
      } catch {
        status.className = "cloud-published-status error";
        status.textContent = cloudT("shareImageEmbedFailed");
      } finally {
        busy = false;
        shareLink.disabled = shareImage.disabled = false;
      }
    } });
    actions.append(shareLink, shareImage);
    if (originError) {
      const retryOrigin = el("button", { class:"cloud-button", type:"button", text:cloudT("retryLocalLink"), onclick:async () => {
        retryOrigin.disabled = true;
        try {
          await bridge.markPublishedOrigin?.(kind, artifact, item);
          localSourceMessage.textContent = cloudT("localSourceLinked", { step:Number(item.generation || 0) + 1 });
          status.className = "cloud-published-status success";
          status.textContent = cloudT("publishedLinkRestored");
          retryOrigin.remove();
        } catch {
          status.className = "cloud-published-status error";
          status.textContent = cloudT("localLinkRestoreFailed");
          retryOrigin.disabled = false;
        }
      } });
      actions.append(retryOrigin);
    }
    actions.append(
      el("a", { class:"cloud-button", href:url, target:"_blank", rel:"noopener", text:cloudT("viewPublicPage") }),
      el("button", { class:"cloud-button", type:"button", text:cloudT("done"), onclick:() => closeOverlay(shell.overlay) }),
    );
    shell.body.append(
      el("div", { class:"cloud-published-summary" }, [
        el("span", { class:"cloud-published-mark", "aria-hidden":"true", text:"✓" }),
        localSourceMessage,
      ]),
      el("input", { class:"cloud-published-url", value:url, readonly:"", "aria-label":cloudT("publicCommunityLink") }),
      actions,
      status,
    );
    queueMicrotask(() => shareLink.focus());
    return shell;
  }

  async function liveShareDialog({ kind, widgetId = null }) {
    const zh = (document.documentElement.lang || "").startsWith("zh"), text = (en,cn) => zh ? cn : en;
    const bridge = window.PenEchoCloudProjects;
    const sourceId = widgetId ? bridge?.shareWidgetId(widgetId) : null;
    if (widgetId && !sourceId) return;
    const emptyCanvas = kind === "canvas" && bridge?.hasShareableContent?.() === false;
    let canvasId = bridge?.currentCanvasId(), currentShare = null, busy = false;
    const shell = dialogShell({ title:text(`Share ${kind === "widget" ? "Widget" : "Canvas"}`, `分享 ${kind === "widget" ? "Widget" : "Canvas"}`) });
    // Canonical #dialogs M / single sequential form; existing shell owns focus.
    shell.dialog.className = "penecho-live-share-dialog";
    shell.dialog.querySelector(".cloud-dialog-mark")?.remove();
    Object.assign(shell.dialog.dataset, {peSurface:"form",peSize:"m",peLayout:"single",pePresentation:"modal",peMaterial:"opaque"});
    const header = shell.dialog.querySelector("header"); header.className=""; header.dataset.peRegion = "header";
    shell.dialog.querySelector(".cloud-dialog-identity").className="";
    shell.dialog.querySelector(".cloud-dialog-heading").className="";
    shell.body.className = ""; shell.body.dataset.peRegion = "body";
    const note = el("p", {text:text("Anyone with the link can view this content and future changes saved to Cloud, with no expiry. Visitors can copy it to their own space to edit. Sharing does not publish to Echoes or keep a separate snapshot.", "任何持有链接的人都能查看此内容及之后保存到云端的改动，链接没有有效期。访客可复制到自己的空间编辑。分享不会发布到 Echoes，也不保留独立快照。")});
    const storageNote = el("p", {text:text("This Canvas must be saved to Cloud first. Future saves must go to this Cloud Canvas to update the link.", "需要先将此 Canvas 保存到云端。后续请继续保存到这份云端 Canvas，链接才会更新。")});
    const emptyMessage = text("Add content to the Canvas before sharing.","请先在画布上添加内容，再开启分享。");
    const status = el("p", {role:"status","aria-live":"polite",text:emptyCanvas ? emptyMessage : ""});
    const field = el("label", {"data-pe-region":"field"}, [el("span",{text:text("Share link","分享链接")})]);
    const link = el("input", {readonly:"","data-pe-control":"input","aria-label":text("Share link","分享链接")}); field.append(link); field.hidden=true;
    const enable = el("button", {type:"button","data-pe-button":"primary","data-pe-density":"standard"});
    const revoke = el("button", {type:"button","data-pe-button":"secondary","data-pe-density":"standard",text:text("Turn off sharing","关闭分享")});
    const footer = el("footer", {"data-pe-region":"footer"}, [revoke,enable]);
    shell.body.append(note,storageNote,field,status); shell.dialog.append(footer);
    const selection = sourceId ? {widgetId:sourceId} : {};
    const endpoint = () => `/api/cloud/canvases/${canvasId}/share`;
    function render() {
      field.hidden=!currentShare; revoke.hidden=!currentShare;
      storageNote.hidden=Boolean(canvasId);
      link.value=currentShare ? new URL(currentShare.url,cloudOrigin()).href : "";
      enable.textContent=currentShare ? text("Copy link","复制链接") : !accountSignedIn() ? text("Sign in / Register","登录 / 注册") : canvasId ? text("Save and enable sharing","保存并开启分享") : text("Save to Cloud and share","保存到云端并开启分享");
      enable.disabled=busy || emptyCanvas; revoke.disabled=busy;
    }
    async function run(action) { if(busy)return; busy=true;status.textContent=text("Working…","正在处理…");render();try{await action();}catch(error){status.textContent=error.message;}finally{busy=false;render();} }
    enable.addEventListener("click",()=>run(async()=>{
      if(!accountSignedIn()){closeOverlay(shell.overlay);state.cloudSection="account";await openCloud();return;}
      if(currentShare){await copyText(link.value);status.textContent=text("Link copied.","链接已复制。");return;}
      canvasId=await bridge.saveForShare(widgetId);
      currentShare=(await api(endpoint(),{method:"POST",body:JSON.stringify(selection)})).share;
      rememberLiveShare(canvasId, sourceId || "", currentShare);
      status.textContent=text("Sharing is on.","已开启分享。");
    }));
    revoke.addEventListener("click",()=>run(async()=>{
      await api(endpoint(),{method:"DELETE",body:JSON.stringify(selection)});currentShare=null;
      rememberLiveShare(canvasId, sourceId || "", null);
      status.textContent=text("Sharing is off. The old link no longer works. Copies already saved by visitors remain theirs.","已关闭分享，旧链接已失效。访客之前保存的副本仍归访客所有。");
    }));
    render();
    if(canvasId && accountSignedIn()) await run(async()=>{currentShare=(await api(endpoint()+(sourceId?`?widgetId=${encodeURIComponent(sourceId)}`:""))).share;rememberLiveShare(canvasId, sourceId || "", currentShare);status.textContent=emptyCanvas ? emptyMessage : "";});
  }

  function shareDialog({ kind, widgetId = null, favoriteAfterShare = false }) {
    if (!accountSignedIn()) {
      browserSignInMessage(cloudT("shareSignInRequired"));
      state.cloudSection = "account";
      void openCloud();
      return;
    }
    const title = cloudT("shareTitle"), bridge=window.PenEchoCommunityCanvas;
    const kindLabel = cloudT(kind === "widget" ? "widgetKind" : "canvasKind");
    const shell = dialogShell({ title, subtitle:cloudT("shareSubtitle"), share:true });
    const name = el("input", { type:"text", maxlength:"160", required:"", "aria-required":"true", placeholder:cloudT(kind === "widget" ? "widgetNamePlaceholder" : "canvasNamePlaceholder") });
    const description = el("textarea", { rows:"3", maxlength:"1200", required:"", "aria-required":"true", placeholder:cloudT("shareDescriptionPlaceholder") });
    const nameError = el("small", { class:"cloud-field-error", role:"alert", text:cloudT("publishNameRequired") });
    const descriptionError = el("small", { class:"cloud-field-error", role:"alert", text:cloudT("publishDescriptionRequired") });
    nameError.hidden = descriptionError.hidden = true;
    const category = el("select", {}, [el("option", { value:"", text:cloudT("selectCategory") }), ...CATEGORIES.map(value => el("option", { value, text:cloudT(CATEGORY_LABEL_KEYS[value]) }))]);
    category.value = "";
    const tags = el("input", { type:"text", maxlength:"260", placeholder:cloudT("shareTagsPlaceholder") }),tagCount=el("small", { class:"cloud-tag-count", text:cloudT("tagCount", { count:0 }) });
    const status = el("span", { class:"cloud-share-status", role:"status", "aria-live":"polite", text:cloudT("generatingPreview") }),previewImage=el("img", { alt:cloudT("automaticSharePreview", { kind:kindLabel }) }),previewPanel=el("div", { class:"cloud-share-preview", "aria-busy":"true" }, [previewImage]);
    const autoFill=el("button", { class:"cloud-button cloud-ai-fill", type:"button", text:cloudT("autoFillCurrentAi"), disabled:"" });
    const contribution = el("textarea", { rows:"3", maxlength:"500", placeholder:cloudT("contributionPlaceholder") });
    const continuation = el("textarea", { rows:"3", maxlength:"500", placeholder:cloudT("continuationPlaceholder") });
    const permission = el("input", { type:"checkbox", "data-pe-control":"checkbox" });
    const permissionLabel = el("label", { class:"cloud-publication-consent", "data-pe-hit":"choice" }, [permission, el("span", {}, [
      document.createTextNode(cloudT("publicationAgreementBeforeLink")),
      el("a", { class:"cloud-publication-link", href:new URL("/terms.html#public-crafts",`${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener" }, [
        document.createTextNode(cloudT("publicationAgreementLink")),
        el("span", { class:"cloud-external-link-mark", "aria-hidden":"true", text:"↗" }),
      ]),
      document.createTextNode(cloudT("publicationAgreementAfterLink")),
    ])]);
    let artifact=null,lineage=null,draftKey=null,publish=null,publishing=false,validationAttempted=false;
    function parsedTags(){const seen=new Set();return tags.value.split(",").map(value=>value.trim()).filter(value=>{const key=value.toLocaleLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;});}
    function tagIssue(){const values=parsedTags();if(values.length>8)return cloudT("tagLimit");if(values.some(value=>value.length>32))return cloudT("tagLength");if(values.some(value=>!/^\p{L}[\p{L}\p{N} ._+-]*$/u.test(value)&&!/^\p{N}[\p{L}\p{N} ._+-]*$/u.test(value)))return cloudT("tagStart");return "";}
    function updatePublishAvailability(){if(publish)publish.disabled=!artifact||publishing;}
    function setRequiredError(input, error, invalid){input.setAttribute("aria-invalid",String(invalid));error.hidden=!invalid;}
    function validateRequiredFields({ focus = false } = {}) {
      const missingName=!name.value.trim(),missingDescription=!description.value.trim();
      setRequiredError(name,nameError,missingName);
      setRequiredError(description,descriptionError,missingDescription);
      if (focus && (missingName || missingDescription)) (missingName ? name : description).focus();
      return !missingName && !missingDescription;
    }
    function refreshTagCount(){const values=parsedTags(),issue=tagIssue();tagCount.textContent=issue||cloudT("tagCount", { count:values.length });tagCount.classList.toggle("error",Boolean(issue));updatePublishAvailability();}
    function draftPayload(){return{name:name.value,description:description.value,category:category.value,tags:tags.value,contribution:contribution.value};}
    function saveDraft(){if(!draftKey)return;try{sessionStorage.setItem(draftKey,JSON.stringify(draftPayload()));}catch{}}
    function restoreDraft(){if(!draftKey)return false;try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||"null");if(!saved||typeof saved!=="object")return false;name.value=String(saved.name||"").slice(0,160);description.value=String(saved.description||"").slice(0,1200);category.value=CATEGORIES.includes(saved.category)?saved.category:"";tags.value=String(saved.tags||"").slice(0,260);contribution.value=String(saved.contribution||"").slice(0,500);continuation.value="";refreshTagCount();return true;}catch{return false;}}
    function clearDraft(){if(!draftKey)return;try{sessionStorage.removeItem(draftKey);}catch{}}
    for(const input of [name,description,tags,contribution,continuation])input.addEventListener("input",()=>{if(validationAttempted&&(input===name||input===description))validateRequiredFields();saveDraft();updatePublishAvailability();});
    category.addEventListener("change",()=>{saveDraft();updatePublishAvailability();});
    tags.addEventListener("input",refreshTagCount);
    shell.body.append(el("div", { class:"cloud-share-note", text:cloudT("shareNote", { kind:kindLabel }) }),previewPanel);
    shell.body.append(el("div", { class:"cloud-share-ai-row" }, [autoFill,el("span", { text:cloudT("usesCurrentAi") })]),field(cloudT("nameLabel"), el("div", { class:"cloud-required-field" }, [name,nameError])), field(cloudT("descriptionLabel"), el("div", { class:"cloud-required-field" }, [description,descriptionError])), field(cloudT("categoryLabel"), category),field(cloudT("tagsLabel"), el("div", { class:"cloud-tags-input" }, [tags,tagCount])));
    shell.body.append(field(cloudT("continuationLabel"),continuation));
    publish = el("button", { class:"cloud-button primary", type:"button", text:cloudT(favoriteAfterShare ? "publishAndSave" : "publishStroke"), onclick:async () => {
      publishing = true;
      updatePublishAvailability();
      status.className = "cloud-share-status";
      status.textContent = cloudT("validatingUploading");
      try {
        if (!artifact) throw new Error(cloudT("waitPreview"));
        validationAttempted=true;
        if (!validateRequiredFields({ focus:true })) throw new Error(!name.value.trim()?cloudT("publishNameRequired"):cloudT("publishDescriptionRequired"));
        const payload = {
          kind,
          name:name.value.trim(),
          description:description.value.trim(),
          category:category.value,
          tags:parsedTags(),
          artifact,
          parentItemId:lineage?.parentItemId || null,
          contributionNote:lineage ? contribution.value.trim() : "",
          continuationPrompt:continuation.value.trim(),
          publicationTermsAccepted:permission.checked,
          publicationRightsAccepted:permission.checked,
          modelTrainingAccepted:permission.checked,
          publicationTermsVersion:PUBLICATION_TERMS_VERSION,
        };
        if (!payload.name) throw new Error(cloudT("publishNameRequired"));
        if (!payload.description) throw new Error(cloudT("publishDescriptionRequired"));
        if (!CATEGORIES.includes(payload.category)) throw new Error(cloudT("publishCategoryRequired"));
        if (tagIssue()) throw new Error(tagIssue());
        if (!permission.checked) throw new Error(cloudT("publishAgreementRequired"));
        status.textContent = cloudT(lineage ? "addingLineage" : "publishingFirstStep");
        const result=await publishCommunityArtifact(payload);
        if (!result.item?.id) throw new Error(cloudT("publishedCraftMissing"));
        clearDraft();
        let originError=null,favoriteError=null;
        try { await bridge.markPublishedOrigin?.(kind, artifact, result.item); }
        catch (error) { originError=error; }
        if (favoriteAfterShare) {
          try { await api(`/api/cloud/community/${result.item.id}/favorite`, { method:"POST", body:"{}" }); }
          catch (error) { favoriteError=error; }
        }
        closeOverlay(shell.overlay);
        publishedCraftDialog({ item:{ ...result.item, name:result.item.name || payload.name }, kind, kindLabel, artifact, bridge, originError, favoriteError, favoriteAfterShare });
      } catch (error) {
        status.className = "cloud-share-status error";
        status.textContent = error.message || cloudT("shareFailed");
        publishing = false;
        updatePublishAvailability();
      }
    } });
    shell.body.append(permissionLabel, el("div", { class:"cloud-share-actions" }, [status, el("button", { class:"cloud-button", type:"button", text:cloudT("cancel"), onclick:() => closeOverlay(shell.overlay) }), publish]));
    publish.disabled=true;
    autoFill.addEventListener("click",async()=>{
      autoFill.disabled=true;
      status.className="cloud-share-status";
      status.textContent=cloudT("askingAi");
      try{
        const metadata=await bridge.suggestMetadata({kind,artifact,current:{name:name.value,description:description.value,category:category.value,tags:parsedTags(),continuationPrompt:continuation.value}});
        name.value=metadata.name;
        description.value=metadata.description;
        category.value=CATEGORIES.includes(metadata.category)?metadata.category:"productivity";
        tags.value=(metadata.tags||[]).slice(0,8).join(", ");
        continuation.value=String(metadata.continuationPrompt||continuation.value).slice(0,500);
        refreshTagCount();
        if(validationAttempted)validateRequiredFields();
        saveDraft();
        status.className="cloud-share-status success";
        status.textContent=cloudT("listingOptimized");
      }catch(error){status.className="cloud-share-status error";status.textContent=error.message||cloudT("aiAutoFillFailed");}
      finally{autoFill.disabled=!artifact;}
    });
    queueMicrotask(async()=>{
      try{
        if(!bridge)throw new Error(cloudT("communityBridgeNotReady"));
        artifact=kind==="widget"?await bridge.widgetArtifact(widgetId):await bridge.canvasArtifact();
        lineage=bridge.lineageForArtifact?.(kind,artifact)||null;
        const draftIdentity=lineage?.parentItemId||(kind==="widget"?artifact.widget?.id:artifact.name)||"current";
        draftKey=`penecho.community.publish.${kind}.${String(draftIdentity).slice(0,180)}`;
        if(lineage){
          shell.body.insertBefore(field(cloudT("contributionLabel"),contribution),permissionLabel);
          const parentStep=Number.isInteger(lineage.parentGeneration)?cloudT("stepNumber", { number:lineage.parentGeneration+1 }):cloudT("publishedStep"), parentName=lineage.parentName?` “${lineage.parentName}”`:"";
          shell.body.insertBefore(el("div", { class:"cloud-lineage-notice", text:cloudT("lineageNotice", { step:parentStep, name:parentName }) }),contribution.closest("label"));
        }
        const preview=artifact.communityPreview,base64=preview?.dataBase64;
        if(!base64)throw new Error(cloudT("automaticPreviewMissing"));
        previewImage.src=`data:image/webp;base64,${base64}`;
        previewPanel.setAttribute("aria-busy","false");
        const recovered=restoreDraft();
        updatePublishAvailability();
        autoFill.disabled=false;
        status.textContent=cloudT(recovered?"previewRestored":"previewReady");
      }catch(error){previewPanel.classList.add("error");previewPanel.setAttribute("aria-busy","false");status.className="cloud-share-status error";status.textContent=error.message||cloudT("sharingUnavailable");}
    });
    permission.addEventListener("change",updatePublishAvailability);
  }

  async function takeFurther(itemId, importOptions = null) {
    const encodedItemId = encodeURIComponent(itemId);
    let downloaded;
    if (window.PENECHO_CONFIG?.runtime === "cloud") {
      // The browser is already authenticated to PenEcho Cloud. Fetch the
      // published Craft from Cloud itself, then import it through the linked
      // host bridge; requiring a second account session on that host makes a
      // valid Remote Canvas deep link fail with a misleading sign-in error.
      const [details, artifact] = await Promise.all([
        // Register this explicit copy so a later publication can cite its parent.
        api(`/api/v1/community/items/${encodedItemId}/artifact`),
        api(`/api/v1/community/items/${encodedItemId}/view`),
      ]);
      downloaded = { item:details.item, artifact };
    } else {
      await refreshStatus();
      if (!accountSignedIn()) { openCloud(); throw new Error(cloudT("signInTakeFurther")); }
      downloaded = await api(`/api/cloud/community/${encodedItemId}/artifact`);
    }
    const item = downloaded.item;
    if (item?.kind === "widget") {
      if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error(cloudT("communityWidgetImportUnavailable"));
      await window.PenEchoCommunityCanvas.importWidget(downloaded.artifact, item, importOptions);
    } else if (item?.kind === "canvas") {
      if (!window.PenEchoCommunityCanvas?.importCanvas) throw new Error(cloudT("communityCanvasImportUnavailable"));
      await window.PenEchoCommunityCanvas.importCanvas(downloaded.artifact, item);
    } else throw new Error(cloudT("incompatibleCraft"));
    closeOverlay(document.querySelector(".penecho-cloud-overlay"));
    return item;
  }

  window.PenEchoCommunityUI = Object.freeze({
    takeFurther,
    label: (key) => window.PenEchoI18n?.t?.(key) || key,
  });

  /* Favorites picker: the toolbar ➕ lists favorited Canvases and Widgets. */
  const craftsButton = document.getElementById("craftsButton");
  const craftsPopover = document.getElementById("craftsPopover");
  const craftsClose = document.getElementById("craftsClose");
  const craftsList = document.getElementById("craftsList");
  const craftsSearch = document.getElementById("craftsSearch");
  const craftsCount = document.getElementById("craftsCount");
  const craftsRefreshStatus = document.getElementById("craftsRefreshStatus");
  const craftsFilters = document.getElementById("craftsFilters");
  const craftsViewSwitch = document.getElementById("craftsViewSwitch");
  const craftsEchoesLink = document.getElementById("craftsEchoesLink");
  const craftsRemoveDialog = document.getElementById("craftsRemoveDialog");
  const craftsRemoveTitle = document.getElementById("craftsRemoveTitle");
  const craftsRemoveDescription = document.getElementById("craftsRemoveDescription");
  const craftsRemoveCancel = document.getElementById("craftsRemoveCancel");
  const craftsRemoveConfirm = document.getElementById("craftsRemoveConfirm");
  const craftFilterOptions = [
    { kind:"all", button:document.getElementById("craftsFilterAll"), label:"all", fallback:"All" },
    { kind:"widget", button:document.getElementById("craftsFilterWidgets"), label:"widgets", fallback:"Widgets" },
    { kind:"canvas", button:document.getElementById("craftsFilterCanvases"), label:"canvases", fallback:"Canvases" },
  ].filter((option) => option.button);
  const craftViewOptions = [
    { view:"list", button:document.getElementById("craftsViewList"), label:"savedListView", fallback:"List view" },
    { view:"grid", button:document.getElementById("craftsViewGrid"), label:"savedGridView", fallback:"Grid view" },
  ].filter((option) => option.button);
  let craftsPager = null;
  let craftsObserver = null;
  let craftsRefreshGeneration = 0;
  let selectedCraftKind = "all";
  let selectedCraftView = "list";
  let craftsRestoreFocus = null;
  const savedT = (key, fallback) => {
    const translated = window.PenEchoI18n?.t?.(key);
    if (translated && translated !== key) return translated;
    return document.documentElement.lang.startsWith("zh") ? (window.PENECHO_LOCALES?.zh || {})[key] || fallback : fallback;
  };

  function updateCraftFilterTabs() {
    for (const option of craftFilterOptions) {
      const selected = option.kind === selectedCraftKind;
      const label = option.button.querySelector?.("[data-crafts-filter-label]");
      if (label) label.textContent = savedT(option.label, option.fallback);
      option.button.classList.toggle("active", selected);
      option.button.setAttribute("aria-selected", String(selected));
      option.button.setAttribute("tabindex", selected ? "0" : "-1");
    }
  }

  function craftSearchLocale() {
    return document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en";
  }

  function craftSearchQuery() {
    return String(craftsSearch?.value || "").trim().toLocaleLowerCase(craftSearchLocale());
  }

  function favoriteCraftSearchText(craft) {
    const fields = [savedT(craft.kind === "canvas" ? "savedCanvas" : "savedWidget", craft.kind === "canvas" ? "Canvas" : "Widget")];
    for (const source of craft.sources || []) {
      const entry = source.entry || {};
      fields.push(entry.name, entry.description, entry.artifact?.widget?.title);
    }
    return fields.filter(Boolean).join("\n").toLocaleLowerCase(craftSearchLocale());
  }

  function filteredFavoriteCrafts(entries) {
    const query = craftSearchQuery();
    return entries.filter((entry) => (selectedCraftKind === "all" || entry.kind === selectedCraftKind)
      && (!query || favoriteCraftSearchText(entry).includes(query)));
  }

  function updateCraftView() {
    const grid = selectedCraftView === "grid";
    craftsList?.classList.toggle("is-grid", grid);
    if (craftsList) craftsList.dataset.view = selectedCraftView;
    for (const option of craftViewOptions) {
      const selected = option.view === selectedCraftView;
      const label = savedT(option.label, option.fallback);
      option.button.classList.toggle("active", selected);
      option.button.setAttribute("aria-pressed", String(selected));
      option.button.setAttribute("aria-label", label);
      option.button.title = label;
    }
    craftsViewSwitch?.setAttribute("aria-label", savedT("savedView", "View"));
  }

  function updateCraftsEchoesLink() {
    if (!craftsEchoesLink) return;
    craftsEchoesLink.setAttribute("href", new URL("/community.html", `${cloudOrigin()}/`).toString());
    const label = craftsEchoesLink.querySelector?.(".crafts-echoes-label");
    if (label) label.textContent = savedT("browseEchoes", "Browse Echoes");
  }

  function selectCraftKind(kind, focus = false) {
    if (!craftFilterOptions.some((option) => option.kind === kind)) return;
    selectedCraftKind = kind;
    updateCraftFilterTabs();
    craftsPager = favoritePagerForKind(kind);
    renderCraftsList(favoritePagerEntries(craftsPager));
    if (!craftsPopover?.hidden) void refreshCraftsList({ reset:true });
    if (focus) craftFilterOptions.find((option) => option.kind === kind)?.button.focus();
  }

  for (const option of craftFilterOptions) option.button.addEventListener("click", () => selectCraftKind(option.kind));
  craftsSearch?.addEventListener("input", () => {
    if (craftsPager) renderCraftsList(favoritePagerEntries(craftsPager));
  });
  craftsFilters?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const current = Math.max(0, craftFilterOptions.findIndex((option) => option.kind === selectedCraftKind));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? craftFilterOptions.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + craftFilterOptions.length) % craftFilterOptions.length;
    event.preventDefault();
    selectCraftKind(craftFilterOptions[next].kind, true);
  });

  for (const option of craftViewOptions) option.button.addEventListener("click", () => {
    selectedCraftView = option.view;
    updateCraftView();
  });

  function setCraftsOpen(open) {
    if (!craftsPopover) return;
    const wasOpen = !craftsPopover.hidden;
    if (open && !wasOpen) craftsRestoreFocus = document.activeElement || craftsButton;
    craftsPopover.hidden = !open;
    craftsPopover.setAttribute("aria-hidden", String(!open));
    craftsButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      document.body.classList.add("plugin-open");
      if (!wasOpen) craftFilterOptions.find((option) => option.kind === selectedCraftKind)?.button.focus();
    }
    else {
      document.body.classList.remove("plugin-open");
      craftsObserver?.disconnect();
      craftsObserver = null;
      if (wasOpen) {
        const restore = craftsRestoreFocus;
        craftsRestoreFocus = null;
        restore?.focus?.();
      }
    }
  }

  function setCraftsRefreshing(refreshing) {
    if (!craftsRefreshStatus) return;
    craftsRefreshStatus.hidden = !refreshing;
    craftsList?.setAttribute("aria-busy", String(refreshing));
    const copy = craftsRefreshStatus.lastElementChild;
    if (copy) copy.textContent = savedT("savedRefreshing", "Refreshing…");
  }

  async function localFavorites() {
    try { return (await api("/api/favorites?view=summary")).favorites || []; }
    catch { return []; }
  }

  async function fullLocalFavorite(entry) {
    if (entry?.artifact) return entry;
    if (!entry?.artifactSha256) throw new Error(cloudT("favoriteLoadFailed"));
    return (await api(`/api/favorites/${encodeURIComponent(entry.artifactSha256)}`)).favorite;
  }

  async function fullCloudFavorite(entry) {
    if (entry?.artifact) return entry;
    if (!entry?.id) throw new Error(cloudT("favoriteLoadFailed"));
    return (await api(`/api/cloud/favorites/${encodeURIComponent(entry.id)}`)).favorite;
  }

  async function saveLocalFavorite(favorite, includeCreated = false) {
    const response = await fetch("/api/favorites", {
      method:"PUT",
      headers:apiHeaders(true),
      body:JSON.stringify(favorite),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_description || payload.message || payload.error || savedT("savedErrorToggle", "Could not update this favorite."));
      error.status = response.status;
      error.code = payload.code || null;
      throw error;
    }
    return includeCreated ? { favorite:payload.favorite, created:response.status === 201 } : payload.favorite;
  }

  async function removeLocalFavorite(sha256) {
    try { await api(`/api/favorites/${encodeURIComponent(sha256)}`, { method:"DELETE" }); } catch {}
  }

  async function linkLocalFavoriteToCloud(sha256, cloudId) {
    return (await api(`/api/favorites/${encodeURIComponent(sha256)}/cloud`, { method:"PATCH", body:JSON.stringify({ cloudId }) })).favorite;
  }

  const FAVORITE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function favoriteUuid(value) {
    return FAVORITE_UUID.test(String(value || "")) ? String(value).toLowerCase() : null;
  }

  function privateFavoriteCraftKey(entry) {
    const sourceWidgetId = favoriteUuid(entry?.sourceWidgetId);
    return `widget:${sourceWidgetId ? `source:${sourceWidgetId}` : `artifact:${entry?.artifactSha256 || entry?.id}`}`;
  }

  function favoriteWidgetImportOptions(favorite, { cloudFavoriteId = null, communityItemId = null } = {}) {
    const cloudId = favoriteUuid(cloudFavoriteId || favorite?.cloudId),
      communityId = favoriteUuid(communityItemId),
      sourceWidgetId = favoriteUuid(favorite?.sourceWidgetId) || favoriteUuid(favorite?.id) || communityId || cloudId,
      artifactSha256 = /^[0-9a-f]{64}$/i.test(String(favorite?.artifactSha256 || "")) ? String(favorite.artifactSha256).toLowerCase() : null;
    return { favoriteState:{ selected:true, sourceWidgetId, artifactSha256, cloudFavoriteId:cloudId, communityItemId:communityId } };
  }

  function thumbnailDataUrl(favorite, communityId = null) {
    const base64 = favorite.thumbnail || favorite.artifact?.communityThumbnail?.dataBase64 || favorite.artifact?.communityPreview?.dataBase64;
    const contentType = favorite.thumbnail ? "image/webp" : (favorite.artifact?.communityThumbnail || favorite.artifact?.communityPreview)?.contentType || "image/webp";
    if (base64) return `data:${contentType};base64,${base64}`;
    const remoteThumbnail = String(favorite.thumbnailUrl || ""),
      cloudFavoriteId = remoteThumbnail.match(/^\/api\/v1\/favorites\/([0-9a-f-]{36})\/thumbnail(?:[?#].*)?$/i)?.[1],
      remoteItemId = remoteThumbnail.match(/^\/api\/v1\/community\/items\/([0-9a-f-]{36})\/thumbnail(?:[?#].*)?$/i)?.[1],
      itemId = communityId || remoteItemId;
    if (cloudFavoriteId) return isCloudRuntime() ? remoteThumbnail : `/api/cloud/favorites/${encodeURIComponent(cloudFavoriteId)}/thumbnail`;
    if (/^\/api\/favorites\/[0-9a-f]{64}\/thumbnail(?:[?#].*)?$/i.test(remoteThumbnail)) return remoteThumbnail;
    // Community API paths belong to PenEcho Cloud. A relative Cloud URL on a
    // local Canvas resolves against 192.168/localhost and returns 404, so every
    // community image must use the approved local/Remote Canvas proxy.
    return itemId ? communityThumbnailUrl(itemId) : null;
  }

  function communityThumbnailUrl(itemId) {
    return isCloudRuntime()
      ? `/api/v1/community/items/${encodeURIComponent(itemId)}/thumbnail`
      : `/api/cloud/community/${encodeURIComponent(itemId)}/thumbnail`;
  }

  /* One-click favorite on a widget: local snapshot always, cloud copy when signed in. */
  async function toggleWidgetFavorite(widgetId, current = null) {
    const bridge = window.PenEchoCommunityCanvas;
    if (!bridge?.widgetArtifact || !bridge.setWidgetFavorite) throw new Error(cloudT("favoriteUnsupported"));
    if (current?.favorite === true) {
      const sha256 = /^[0-9a-f]{64}$/i.test(String(current.favoriteArtifactSha256 || ""))
          ? String(current.favoriteArtifactSha256).toLowerCase()
          : "",
        sourceWidgetId = favoriteUuid(current.sourceWidgetId),
        currentCloudId = favoriteUuid(current.favoriteCloudId),
        communityItemId = favoriteUuid(current.favoriteCommunityItemId);
      let saved = null;
      if (!isCloudRuntime() && sha256) {
        try { saved = await fullLocalFavorite({ artifactSha256:sha256 }); }
        catch (error) { if (error?.status !== 404) throw error; }
      }
      // The hash identifies a stored snapshot version, not the logical Widget.
      // If another Canvas updated that favorite, resolve its latest snapshot by
      // the stable source Widget id before removing it.
      if (!isCloudRuntime() && !saved && sourceWidgetId) {
        const summary = (await localFavorites()).find((entry) => favoriteUuid(entry.sourceWidgetId) === sourceWidgetId);
        if (summary) saved = await fullLocalFavorite(summary);
      }
      const cloudId = currentCloudId || favoriteUuid(saved?.cloudId);
      if (cloudId) await api(`/api/cloud/favorites/${encodeURIComponent(cloudId)}`, { method:"DELETE" });
      if (communityItemId) await api(`/api/cloud/community/${encodeURIComponent(communityItemId)}/favorite`, { method:"DELETE" });
      if (saved?.artifactSha256) await api(`/api/favorites/${encodeURIComponent(saved.artifactSha256)}`, { method:"DELETE" });
      bridge.setWidgetFavorite(widgetId, false, false, "", { cloudFavoriteId:null, communityItemId:null });
      return false;
    }
    const artifact = await bridge.widgetArtifact(widgetId);
    const serialized = {
      name:String(artifact.widget?.title || cloudT("untitledWidget")).slice(0, 160),
      artifact,
      thumbnail:artifact.communityThumbnail?.dataBase64 || "",
      sourceItemId:artifact.widget?.communityOriginItemId || null,
      sourceWidgetId:current?.sourceWidgetId || null,
    };
    if (isCloudRuntime()) {
      const cloudFavorite = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify(serialized) })).favorite;
      bridge.setWidgetFavorite(widgetId, true, false, cloudFavorite.artifactSha256 || "", { cloudFavoriteId:cloudFavorite.id, communityItemId:null });
      return true;
    }
    const localWrite = await saveLocalFavorite({ ...serialized, cloudId:null }, true),
      saved = localWrite.favorite;
    let cloudFavoriteId = favoriteUuid(saved.cloudId);
    if (accountSignedIn()) {
      let removedDuringUpload = false;
      try {
        const cloudFavorite = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify(serialized) })).favorite;
        cloudFavoriteId = favoriteUuid(cloudFavorite.id);
        try { await linkLocalFavoriteToCloud(saved.artifactSha256, cloudFavorite.id); }
        catch (error) {
          if (error?.status !== 404) throw error;
          removedDuringUpload = true;
          try { await api(`/api/cloud/favorites/${encodeURIComponent(cloudFavorite.id)}`, { method:"DELETE" }); } catch {}
        }
      } catch (error) {
        if (error?.code === "storage_quota_exceeded") window.alert(cloudT("favoriteLocalOnlyQuota"));
      }
      if (removedDuringUpload) {
        bridge.setWidgetFavorite(widgetId, false, false, "", { cloudFavoriteId:null, communityItemId:null });
        return false;
      }
    }
    bridge.setWidgetFavorite(widgetId, true, false, saved.artifactSha256, { cloudFavoriteId, communityItemId:null });
    return true;
  }

  /* Personal favorites have one synchronization direction: local snapshots
     upload to Cloud. Cloud-only favorites stay remote and are downloaded only
     after the user chooses Add/Open. */
  async function syncLocalFavorites({ locals:providedLocals = null } = {}) {
    if (!accountSignedIn()) return { synced: 0 };
    const locals = Array.isArray(providedLocals) ? providedLocals : await localFavorites();
    let synced = 0;
    for (const entry of locals.filter((favorite) => !favorite.cloudId)) {
      try {
        const localEntry = await fullLocalFavorite(entry), uploaded = (await api("/api/cloud/favorites", {
          method:"POST",
          body:JSON.stringify({ name:localEntry.name, artifact:localEntry.artifact, thumbnail:localEntry.thumbnail, sourceItemId:localEntry.sourceItemId, sourceWidgetId:localEntry.sourceWidgetId }),
        })).favorite;
        try { await linkLocalFavoriteToCloud(entry.artifactSha256, uploaded.id); }
        catch (error) {
          if (error?.status !== 404) throw error;
          try { await api(`/api/cloud/favorites/${encodeURIComponent(uploaded.id)}`, { method:"DELETE" }); } catch {}
          continue;
        }
        synced += 1;
      } catch (error) {
        // An account/session rejection applies to the whole batch. Continuing
        // would only send the same unauthorized request once per local item.
        if (error?.status === 401 || error?.status === 403) break;
      }
    }
    return { synced };
  }

  let favoriteSyncPromise = null;

  function scheduleLocalFavoriteSync(locals) {
    if (!accountSignedIn() || !Array.isArray(locals) || favoriteSyncPromise) return;
    favoriteSyncPromise = syncLocalFavorites({ locals }).catch(() => ({ synced:0 })).finally(() => { favoriteSyncPromise = null; });
  }

  const FAVORITE_PAGE_SIZE = 20;

  function favoriteCraftsFromLocal(locals) {
    return locals.map((entry) => ({ key:privateFavoriteCraftKey(entry), kind:"widget", sources:[{ type:"local", entry }] }));
  }

  function favoriteCraftsFromFeed(items) {
    return (items || []).map((item) => {
      if (item.source === "community") {
        const entry = { ...(item.item || {}), favoritedAt:item.favoritedAt };
        return item.kind === "canvas"
          ? { key:`canvas:${entry.id}`, kind:"canvas", sources:[{ type:"community", entry }] }
          : { key:`widget:artifact:${entry.artifactSha256 || entry.artifact?.sha256 || entry.id}`, kind:"widget", sources:[{ type:"community", entry }] };
      }
      const entry = { ...(item.favorite || {}), favoritedAt:item.favoritedAt };
      return { key:privateFavoriteCraftKey(entry), kind:"widget", sources:[{ type:"cloud", entry }] };
    }).filter((entry) => !entry.key.endsWith(":undefined"));
  }

  function mergeFavoriteCrafts(...collections) {
    const mergedMap = new Map();
    for (const craft of collections.flat()) {
      const existing = mergedMap.get(craft.key);
      if (!existing) mergedMap.set(craft.key, { ...craft, sources:[...craft.sources] });
      else for (const source of craft.sources) {
        const sourceId = source.entry?.id || source.entry?.artifactSha256 || source.entry?.artifact?.sha256;
        if (!existing.sources.some((candidate) => candidate.type === source.type && (candidate.entry?.id || candidate.entry?.artifactSha256 || candidate.entry?.artifact?.sha256) === sourceId)) existing.sources.push(source);
      }
    }
    return [...mergedMap.values()].sort((a, b) => favoriteCraftTime(b) - favoriteCraftTime(a) || String(a.key).localeCompare(String(b.key)));
  }

  async function cloudFavoritePage(kind, cursor = null) {
    if (!accountSignedIn()) return { items:[], pagination:{ hasMore:false, nextCursor:null, limit:FAVORITE_PAGE_SIZE } };
    const search = new URLSearchParams({ kind, limit:String(FAVORITE_PAGE_SIZE) });
    if (cursor) search.set("cursor", cursor);
    return api(`/api/cloud/favorites/feed?${search}`);
  }

  function createFavoritePager(kind = "all") {
    return { kind, generation:0, locals:[], remote:[], visibleLimit:0, nextCursor:null, remoteHasMore:accountSignedIn(), loading:null, error:null };
  }

  const favoritePagers = new Map();
  function favoritePagerForKind(kind = "all") {
    if (!favoritePagers.has(kind)) {
      const pager = createFavoritePager(kind), all = favoritePagers.get("all");
      if (kind !== "all" && all) {
        pager.locals = kind === "canvas" ? [] : [...all.locals];
        pager.remote = all.remote.filter((entry) => entry.kind === kind);
        pager.visibleLimit = FAVORITE_PAGE_SIZE;
      }
      favoritePagers.set(kind, pager);
    }
    return favoritePagers.get(kind);
  }

  function favoritePagerAllEntries(pager) {
    return mergeFavoriteCrafts(favoriteCraftsFromLocal(pager.locals), pager.remote);
  }

  function favoritePagerEntries(pager) {
    return favoritePagerAllEntries(pager).slice(0, pager.visibleLimit);
  }

  function favoritePagerHasMore(pager) {
    return pager.remoteHasMore || favoritePagerAllEntries(pager).length > pager.visibleLimit;
  }

  async function loadFavoritePager(pager, { reset = false, onUpdate = () => {} } = {}) {
    if (!reset && pager.loading) return pager.loading.promise;
    const generation = reset ? ++pager.generation : pager.generation, request = {};
    if (reset) pager.error = null;
    const promise = (async () => {
      if (reset) {
        if (!pager.visibleLimit) pager.visibleLimit = FAVORITE_PAGE_SIZE;
        let cloudLoaded = false;
        const localTask = (isCloudRuntime() ? Promise.resolve([]) : localFavorites()).then((locals) => {
          if (generation !== pager.generation) return;
          pager.locals = locals.filter((entry) => pager.kind !== "canvas");
          onUpdate(pager);
        }), cloudTask = cloudFavoritePage(pager.kind).then((page) => {
          if (generation !== pager.generation) return;
          cloudLoaded = true;
          pager.remote = favoriteCraftsFromFeed(page.items);
          pager.nextCursor = page.pagination?.nextCursor || null;
          pager.remoteHasMore = Boolean(page.pagination?.hasMore && pager.nextCursor);
          pager.error = null;
          onUpdate(pager);
        }, (error) => {
          if (generation !== pager.generation) return;
          pager.error = error;
          if (!pager.remote.length) pager.remoteHasMore = accountSignedIn();
          onUpdate(pager);
        });
        await Promise.all([localTask, cloudTask]);
        if (generation === pager.generation) {
          pager.visibleLimit = FAVORITE_PAGE_SIZE;
          // Do not fan a failed Cloud authorization out into one POST per
          // unsynced local favorite. A successful feed proves the account
          // route is available before the background upload begins.
          if (cloudLoaded) scheduleLocalFavoriteSync(pager.locals);
        }
        return pager;
      }
      if (pager.remoteHasMore) {
        const previousCursor = pager.nextCursor, page = await cloudFavoritePage(pager.kind, previousCursor);
        if (generation !== pager.generation) return pager;
        pager.remote.push(...favoriteCraftsFromFeed(page.items));
        pager.nextCursor = page.pagination?.nextCursor || null;
        pager.remoteHasMore = Boolean(page.pagination?.hasMore && pager.nextCursor && pager.nextCursor !== previousCursor);
      }
      pager.visibleLimit += FAVORITE_PAGE_SIZE;
      pager.error = null;
      return pager;
    })();
    request.promise = promise;
    pager.loading = request;
    try { return await promise; }
    catch (error) { if (generation === pager.generation) pager.error = error; throw error; }
    finally { if (pager.loading === request) pager.loading = null; }
  }

  function observeFavoritePagerSentinel(node, root, loadMore) {
    if (typeof IntersectionObserver !== "function") return null;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      // A rendered sentinel owns exactly one automatic page request. The
      // subsequent render creates the next sentinel only when another page
      // still exists, preventing repeated callbacks for the same page.
      observer.disconnect();
      loadMore();
    }, { root, rootMargin:"160px 0px" });
    observer.observe(node);
    return observer;
  }

  function favoriteCraftTime(craft) {
    let newest = 0;
    for (const source of craft.sources || []) {
      const entry = source.entry || {};
      const value = entry.favoritedAt ?? (source.type === "community"
        ? entry.favoriteCreatedAt ?? entry.publishedAt ?? entry.createdAt ?? entry.updatedAt
        : entry.createdAt ?? entry.updatedAt ?? entry.publishedAt);
      const numeric = Number(value);
      const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(value || ""));
      if (Number.isFinite(timestamp)) newest = Math.max(newest, timestamp);
    }
    return newest;
  }

  function craftsFallbackThumb(kind = "widget") {
    const node = document.createElement("span");
    node.className = "crafts-thumb-fallback";
    node.textContent = kind === "canvas" ? "C" : "W";
    return node;
  }

  function craftsSourceBadge(sources) {
    const badge = document.createElement("span");
    badge.className = "crafts-source";
    const types = sources.map((source) => source.type), local = types.includes("local"),
      cloud = types.includes("cloud") || types.includes("community") || sources.some((source) => source.type === "local" && source.entry?.cloudId);
    if (cloud && local) { badge.textContent = savedT("savedSourceSynced", "Cloud + local"); badge.title = savedT("savedSourceSyncedTitle", "On PenEcho Cloud and this device"); }
    else if (cloud) { badge.textContent = types.includes("community") ? savedT("savedSourceCommunity", "Cloud community") : savedT("savedSourceCloud", "Cloud"); badge.title = savedT("savedSourceCloudTitle", "On PenEcho Cloud"); }
    else { badge.textContent = savedT("savedSourceLocal", "local"); badge.title = savedT("savedSourceLocalTitle", "On this device only — it uploads to PenEcho Cloud once you sign in"); }
    return badge;
  }

  async function addCraftToCanvas(merged) {
    const local = merged.sources.find((entry) => entry.type === "local"),
      cloud = merged.sources.find((entry) => entry.type === "cloud"),
      community = merged.sources.find((entry) => entry.type === "community");
    if (local) {
      if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error(cloudT("widgetImportUnavailable"));
      const favorite = await fullLocalFavorite(local.entry);
      await window.PenEchoCommunityCanvas.importWidget(
        favorite.artifact,
        favorite.sourceItemId ? { id:favorite.sourceItemId, name:favorite.name } : null,
        favoriteWidgetImportOptions(favorite, { cloudFavoriteId:favorite.cloudId || cloud?.entry?.id, communityItemId:community?.entry?.id }),
      );
      return;
    }
    if (community) return takeFurther(community.entry.id, favoriteWidgetImportOptions(community.entry, { communityItemId:community.entry.id }));
    const cloudEntry = cloud?.entry;
    if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error(cloudT("widgetImportUnavailable"));
    const favorite = await fullCloudFavorite(cloudEntry);
    await window.PenEchoCommunityCanvas.importWidget(
      favorite.artifact,
      favorite.sourceItemId ? { id:favorite.sourceItemId, name:favorite.name } : null,
      favoriteWidgetImportOptions(favorite, { cloudFavoriteId:favorite.id }),
    );
  }

  async function activateFavoriteCraft(merged) {
    if (merged.kind !== "canvas") return addCraftToCanvas(merged);
    const community = merged.sources.find((entry) => entry.type === "community")?.entry;
    if (!community?.id) throw new Error(savedT("savedErrorOpen", "This Canvas could not be opened."));
    return takeFurther(community.id);
  }

  async function removeCraft(merged) {
    const deletedCloudIds = new Set();
    for (const source of merged.sources) {
      if (source.type === "local") {
        await removeLocalFavorite(source.entry.artifactSha256);
        if (source.entry.cloudId) {
          deletedCloudIds.add(source.entry.cloudId);
          try { await api(`/api/cloud/favorites/${encodeURIComponent(source.entry.cloudId)}`, { method:"DELETE" }); } catch {}
        }
      }
      else if (source.type === "cloud" && !deletedCloudIds.has(source.entry.id)) { try { await api(`/api/cloud/favorites/${encodeURIComponent(source.entry.id)}`, { method:"DELETE" }); } catch {} }
      else if (source.type === "community") { try { await api(`/api/cloud/community/${encodeURIComponent(source.entry.id)}/favorite`, { method:"DELETE" }); } catch {} }
    }
  }

  function confirmCraftRemoval(name) {
    if (!craftsRemoveDialog || !craftsRemoveTitle || !craftsRemoveDescription || !craftsRemoveConfirm || craftsRemoveDialog.open) {
      return Promise.resolve(false);
    }
    craftsRemoveDialog.returnValue = "cancel";
    craftsRemoveTitle.textContent = savedT("savedRemoveConfirmTitle", "Remove from favorites?");
    craftsRemoveDescription.textContent = savedT("savedRemoveConfirmDescription", "“{name}” will no longer appear in Favorites.").replace("{name}", name);
    craftsRemoveConfirm.textContent = savedT("savedRemoveAction", "Remove");
    return new Promise((resolve) => {
      craftsRemoveDialog.addEventListener("close", () => resolve(craftsRemoveDialog.returnValue === "remove"), { once:true });
      craftsRemoveDialog.showModal();
      requestAnimationFrame(() => craftsRemoveCancel?.focus({ preventScroll:true }));
    });
  }

  function craftsRow(merged, removeFromCache) {
    const row = document.createElement("div");
    row.className = "crafts-row";
    const source = merged.sources[0].entry;
    const media = document.createElement("span");
    media.className = "crafts-thumb-wrap";
    const thumb = document.createElement("img");
    thumb.className = "crafts-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    const community = merged.sources.find((entry) => entry.type === "community")?.entry || null,
      url = thumbnailDataUrl(source, community?.id || null);
    if (url) { thumb.src = url; thumb.addEventListener("error", () => thumb.replaceWith(craftsFallbackThumb(merged.kind))); media.append(thumb); }
    else media.append(craftsFallbackThumb(merged.kind));
    const kindBadge = document.createElement("span");
    kindBadge.className = `crafts-kind-badge ${merged.kind}`;
    kindBadge.textContent = savedT(merged.kind === "canvas" ? "savedCanvas" : "savedWidget", merged.kind === "canvas" ? "Canvas" : "Widget");
    const copy = document.createElement("div");
    copy.className = "crafts-copy";
    const title = document.createElement("span");
    title.className = "crafts-card-title";
    const isCanvas = merged.kind === "canvas";
    title.textContent = source.name || savedT(isCanvas ? "untitledCanvas" : "untitledWidget", cloudT(isCanvas ? "untitledCanvas" : "untitledWidget"));
    title.title = title.textContent;
    const detail = String(source.description || source.artifact?.widget?.title || "").trim();
    const meta = document.createElement("div");
    meta.className = "crafts-meta";
    meta.append(kindBadge, craftsSourceBadge(merged.sources));
    copy.append(title);
    if (detail && detail !== title.textContent) {
      const byline = document.createElement("small");
      byline.textContent = detail;
      byline.title = detail;
      copy.append(byline);
    }
    const actions = document.createElement("div");
    actions.className = "crafts-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = isCanvas ? "crafts-open" : "crafts-add";
    add.dataset.peButton = "secondary";
    add.dataset.peDensity = "compact";
    add.textContent = savedT(isCanvas ? "savedOpen" : "savedAdd", isCanvas ? "Open" : "Add");
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = savedT(isCanvas ? "savedOpening" : "savedAdding", isCanvas ? "Opening…" : "Adding…");
      try { await activateFavoriteCraft(merged); setCraftsOpen(false); }
      catch (error) {
        add.textContent = savedT(isCanvas ? "savedOpen" : "savedAdd", isCanvas ? "Open" : "Add");
        add.disabled = false;
        alert(error?.message || savedT(isCanvas ? "savedErrorOpen" : "savedErrorAdd", isCanvas ? "This Canvas could not be opened." : "Could not add this Widget."));
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "crafts-remove";
    remove.dataset.peButton = "toolbar";
    remove.dataset.peDensity = "compact";
    remove.textContent = "";
    remove.title = savedT("savedRemoveTitle", "Remove from Favorites");
    remove.setAttribute("aria-label", `${savedT("savedRemoveTitle", "Remove from Favorites")}: ${source.name || ""}`);
    remove.addEventListener("click", async () => {
      if (!await confirmCraftRemoval(title.textContent)) return;
      remove.disabled = true;
      try {
        await removeCraft(merged);
        removeFromCache(merged.key);
      } catch (error) {
        remove.disabled = false;
        alert(error?.message || savedT("savedErrorToggle", "Could not update this favorite."));
      }
    });
    actions.append(add, remove);
    const footer = document.createElement("div");
    footer.className = "crafts-footer";
    footer.append(meta, actions);
    row.append(media, copy, footer);
    return row;
  }

  function renderCraftsList(entries) {
    craftsObserver?.disconnect();
    craftsObserver = null;
    const visibleEntries = filteredFavoriteCrafts(entries);
    if (craftsCount) craftsCount.textContent = savedT("savedCount", "{count} favorites").replace("{count}", String(visibleEntries.length));
    const rows = [];
    if (!visibleEntries.length && craftsPager?.loading) {
      rows.push(el("p", { class:"crafts-empty", text:savedT("savedLoading", "Loading favorites…") }));
    } else if (!visibleEntries.length) {
      const emptyText = craftSearchQuery()
        ? savedT("savedNoMatches", "No matching favorites.")
        : selectedCraftKind === "canvas"
          ? savedT("noFavoriteCanvases", cloudT("noFavoriteCanvases"))
          : selectedCraftKind === "widget"
            ? savedT("noFavoriteWidgets", cloudT("noFavoriteWidgets"))
            : accountSignedIn()
              ? savedT("savedEmptyIn", "No favorite Canvases or Widgets yet.")
              : savedT("savedEmptyOut", "No local favorite Widgets yet. Sign in to see Cloud favorites.");
      rows.push(el("p", { class:"crafts-empty", text:craftsPager?.error?.message || emptyText }));
    }
    const removeFromCache = (key) => {
      if (craftsPager) {
        craftsPager.locals = craftsPager.locals.filter((entry) => privateFavoriteCraftKey(entry) !== key);
        craftsPager.remote = craftsPager.remote.filter((entry) => entry.key !== key);
        renderCraftsList(favoritePagerEntries(craftsPager));
      }
      void refreshCraftsList({ reset:true });
    };
    rows.push(...visibleEntries.map((entry) => craftsRow(entry, removeFromCache)));
    if (craftsPager?.error) {
      const retry = el("button", {
        class:"cloud-button crafts-retry",
        type:"button",
        text:cloudT("retryFavorites"),
      });
      retry.addEventListener("click", () => {
        if (retry.disabled) return;
        retry.disabled = true;
        void refreshCraftsList({ reset:true });
      });
      rows.push(el("div", { class:"crafts-retry-row", role:"status" }, [retry]));
    } else if (craftsPager && favoritePagerHasMore(craftsPager)) {
      const sentinel = el("div", { class:"crafts-page-sentinel", "aria-hidden":"true" });
      rows.push(sentinel);
      if (!craftsPager.loading) craftsObserver = observeFavoritePagerSentinel(sentinel, craftsList, () => refreshCraftsList());
    }
    craftsList.replaceChildren(...rows);
  }

  async function refreshCraftsList({ reset = false } = {}) {
    const generation = ++craftsRefreshGeneration;
    setCraftsRefreshing(true);
    try {
      if (!isCloudRuntime() && !state.status) await refreshStatus();
      else void refreshStatus();
      if (!craftsPager || craftsPager.kind !== selectedCraftKind) craftsPager = favoritePagerForKind(selectedCraftKind);
      await loadFavoritePager(craftsPager, { reset, onUpdate:() => {
        if (generation === craftsRefreshGeneration && !craftsPopover?.hidden) renderCraftsList(favoritePagerEntries(craftsPager));
      } });
      if (generation !== craftsRefreshGeneration) return;
      renderCraftsList(favoritePagerEntries(craftsPager));
    } catch (error) {
      if (generation !== craftsRefreshGeneration) return;
      if (craftsPager) {
        craftsPager.error = error;
        renderCraftsList(favoritePagerEntries(craftsPager));
      } else craftsList.replaceChildren(el("p", { class:"crafts-empty", text:error?.message || savedT("savedErrorAdd", "Favorites are unavailable right now.") }));
    } finally {
      if (generation === craftsRefreshGeneration) setCraftsRefreshing(false);
    }
  }

  function openCrafts() {
    if (!craftsPopover) return;
    if (craftsPopover.hidden) selectedCraftKind = "all";
    craftsPager = favoritePagerForKind(selectedCraftKind);
    setCraftsOpen(true);
    updateCraftFilterTabs();
    updateCraftView();
    updateCraftsEchoesLink();
    if (favoritePagerEntries(craftsPager).length) renderCraftsList(favoritePagerEntries(craftsPager));
    else craftsList.replaceChildren(el("p", { class:"crafts-empty", text:savedT("savedLoading", "Loading favorites…") }));
    void refreshCraftsList({ reset:true });
  }

  craftsButton?.addEventListener("click", openCrafts);
  craftsClose?.addEventListener("click", () => setCraftsOpen(false));
  craftsPopover?.addEventListener("mousedown", (event) => { if (event.target === craftsPopover) setCraftsOpen(false); });
  document.addEventListener("keydown", (event) => {
    if (craftsPopover?.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setCraftsOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = craftsPopover.querySelector?.(".crafts-modal");
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener("penecho:languagechange", () => {
    updateCloudButton();
    renderCanvasShareStatus();
    const overlay = document.querySelector(".penecho-cloud-overlay");
    if (overlay?._cloudRender) {
      const subtitle = overlay.querySelector("header p"), close = overlay.querySelector(".cloud-dialog-close");
      if (subtitle) subtitle.textContent = cloudT("cloudSubtitle");
      close?.setAttribute("aria-label", cloudT("close"));
      overlay._cloudRender();
    }
    if (craftsPopover && !craftsPopover.hidden) void openCrafts();
  });
  window.addEventListener("penecho:remote-cloud-status", () => { updateCloudButton(); refreshCanvasShareStatus(); });

  cloudButton.addEventListener("click", openCloud);
  document.getElementById("settingsCloudSetupLink")?.addEventListener("click", (event) => {
    if (!localHostControlsAvailable) return;
    event.preventDefault();
    state.cloudSection = "account";
    void openCloud();
  });
  shareCanvasButton.addEventListener("click", async () => { await refreshStatus(); await liveShareDialog({ kind:"canvas" }); });
  document.getElementById("echoCanvasBtn")?.addEventListener("click", async () => { await refreshStatus(); shareDialog({kind:"canvas"}); });
  window.addEventListener("penecho:community-widget-action", async (event) => {
    const actionName = event.detail?.action;
    const widgetId = event.detail?.widgetId;
    if (!widgetId || !["favorite", "share", "echo"].includes(actionName)) return;
    if (actionName === "share" || actionName === "echo") {
      await refreshStatus();
      if (actionName === "echo") shareDialog({ kind:"widget", widgetId });
      else await liveShareDialog({ kind:"widget", widgetId });
      return;
    }
    if (state.favoriteWidgetOperations.has(widgetId)) return;
    state.favoriteWidgetOperations.add(widgetId);
    const bridge = window.PenEchoCommunityCanvas;
    bridge?.setWidgetFavorite?.(widgetId, undefined, true);
    let completed = false;
    try {
      await refreshStatus();
      await toggleWidgetFavorite(widgetId, {
        favorite:event.detail?.favorite === true,
        favoriteArtifactSha256:event.detail?.favoriteArtifactSha256,
        sourceWidgetId:event.detail?.sourceWidgetId,
        favoriteCloudId:event.detail?.favoriteCloudId,
        favoriteCommunityItemId:event.detail?.favoriteCommunityItemId,
      });
      completed = true;
    } catch (error) {
      window.alert(error?.message || savedT("savedErrorToggle", "Could not update this favorite."));
    } finally {
      if (!completed) bridge?.setWidgetFavorite?.(widgetId, undefined, false);
      state.favoriteWidgetOperations.delete(widgetId);
    }
  });
  window.addEventListener("message", async (event) => {
    if (event.origin !== location.origin || event.data?.type !== "penecho:cloud-sign-in-result") return;
    const previouslySignedIn = accountSignedIn();
    await refreshStatus();
    if (!previouslySignedIn && accountSignedIn()) {
      finishSuccessfulBrowserSignIn(activeCloudOverlay);
      return;
    }
    if (event.data.ok) return;
    stopBrowserSignInWatch();
    browserSignInMessage(cloudT("requestFailed"), "error");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") { stopDeviceConnectionWatch(); return; }
    if (activeCloudOverlay?.isConnected && state.cloudSection === "device") {
      const overlay = activeCloudOverlay;
      const before = deviceStatusRevision();
      void refreshStatus().then(() => {
        if (overlay !== activeCloudOverlay || !overlay.isConnected) return;
        if (before !== deviceStatusRevision()) overlay._cloudRender?.();
        startDeviceConnectionWatch(overlay._cloudRender, overlay);
      });
    }
    if (state.browserSignIn.active && state.browserSignIn.poll) {
      clearTimeout(state.browserSignIn.timer);
      state.browserSignIn.timer = 0;
      void state.browserSignIn.poll();
    }
  });
  // Remote Canvas has its own Cloud account/device gate. Avoid relaying a
  // redundant local /api/cloud/status request while that gate is opening.
  if (window.PENECHO_CONFIG?.runtime === "cloud") updateCloudButton();
  else void refreshStatus();
})();
