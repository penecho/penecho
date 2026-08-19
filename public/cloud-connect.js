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
  const configuredCloudOrigin = String(window.PENECHO_CONFIG?.cloudOrigin || "https://penecho.ai");
  const configuredCloudEnvironment = String(window.PENECHO_CONFIG?.cloudEnvironment || "prod");
  const localHostControlsAvailable = window.PENECHO_CONFIG?.runtime !== "cloud";
  const BROWSER_SIGN_IN_POLL_MS = 800;
  const BROWSER_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
  const CLOUD_STATUS_POLL_MS = 1500;
  const CLOUD_COPY = Object.freeze({
    en:Object.freeze({
      close:"Close",
      cloudSubtitle:"Private projects and favorite building blocks.",
      cloudArea:"PenEcho Cloud area",
      cloudProjects:"Projects",
      cloudProjectsHint:"Private, versioned Canvases",
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
      cloudAccount:"Cloud account",
      cloudUser:"PenEcho user",
      credits:"{count} credits",
      accountSettings:"Account settings",
      signOutHelp:"Signing out removes this account from this PenEcho host. It does not remove the existing device link.",
      refreshAccount:"Refresh account",
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
      linkSignInFirst:"After signing in, enter a one-time pairing key to reach this host securely from Cloud.",
      thisDevice:"This device",
      connected:"Connected",
      deviceLinked:"Device linked",
      connecting:"Connecting",
      paused:"Paused",
      pauseLink:"Pause link",
      enableLink:"Enable link",
      linkSettings:"Link settings",
      removeLinkHelpBefore:"Removing the link stops remote access. You can connect this host again later with a new pairing key from ",
      cloudDevices:"Cloud → Devices",
      removeLinkHelpAfter:".",
      removeThisLink:"Remove this link",
      removeLinkConfirm:"Remove this device link? Remote access will stop, but you can pair this host again later.",
      generatePairingBefore:"Generate a pairing key in ",
      penechoDevices:"PenEcho Cloud → Devices",
      generatePairingAfter:", then enter it below.",
      pairingKey:"Pairing key",
      deviceName:"Device name",
      myPenEcho:"My PenEcho",
      linkDevice:"Link device",
      requestFailed:"PenEcho Cloud request failed.",
      chooseProject:"Choose a project, then open or save a versioned Canvas.",
      signInProjects:"Sign in to view private projects and continue your work across devices.",
      cloudSavingNotReady:"Cloud project saving is not ready yet.",
      used:"{size} used",
      of:" of {size}",
      storageUsed:"Cloud storage used",
      storageHelp:"Every successful save creates an immutable revision. Concurrent edits are never silently overwritten.",
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
      noCanvases:"No Canvases yet. Save the current Canvas here to start.",
      untitledCanvas:"Untitled Canvas",
      updated:"Updated {date} · {size}",
      openNewPage:"Open in new page →",
      openCanvasHere:"Open Canvas",
      openingCanvas:"Opening…",
      noProjects:"No Cloud projects yet. Create one to keep this Canvas available across devices.",
      manageWeb:"Manage revisions, Trash and recovery on the web ↗",
      loadingProjects:"Loading Cloud projects…",
      syncUnsupported:"This Cloud does not support the required project sync protocol.",
      signInFavorites:"Sign in to view favorites saved to your PenEcho Cloud account.",
      signInAction:"Sign in",
      loadingFavorites:"Loading favorites…",
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
      previewValidating:"WebP · validating content",
      autoFillCurrentAi:"Auto-fill with current AI",
      contributionPlaceholder:"What did you move forward?",
      continuationPlaceholder:"What question, detail, or direction should the next Crafter Echo?",
      rightsBeforeCc:"I have the right to publish this work. Its visual and written content is shared under ",
      rightsBetweenCcMit:", embedded source under ",
      rightsAfterMit:", and listing metadata under CC0. Others may Echo with attribution and the same visual license; published versions and existing lineage cannot be withdrawn.",
      trainingBeforeLicense:"I understand this is required to Publish. I allow PenEcho to use this public Craft to build, train, evaluate, improve, and commercialize PenEcho models and services under the ",
      trainingAfterLicense:". Private projects, drafts, Link Device traffic, API keys, and private model requests are not included.",
      tagLimit:"Use no more than 8 tags.",
      tagLength:"Each tag must be 32 characters or fewer.",
      tagStart:"Tags must start with a letter or number.",
      shareNote:"A rough sketch can be the first surviving record of a great idea. PenEcho captures this {kind} automatically—no image upload—and preserves every attributed step. The validated WebP is at most 2048 × 2048 and 4 MB.",
      usesCurrentAi:"Uses the AI connection currently active on this device.",
      nameLabel:"Name",
      descriptionLabel:"Description",
      categoryLabel:"Category",
      tagsLabel:"Tags (up to 8, comma separated)",
      continuationLabel:"What should the next Crafter Echo?",
      publishAndSave:"Publish + Favorite",
      publishStroke:"Publish this stroke",
      validatingUploading:"Validating and uploading…",
      waitPreview:"Wait for the automatic preview to finish.",
      publishNameRequired:"Enter a name before publishing.",
      publishCategoryRequired:"Choose a category before publishing.",
      publishContributionRequired:"Tell the next Crafter what you moved forward.",
      publishContinuationRequired:"Tell the next Crafter what to Echo.",
      publishRightsRequired:"Confirm the publication rights and open licenses before publishing.",
      publishTrainingRequired:"Confirm the required public model-training permission before publishing.",
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
      publishedImageShareTitle:"Share this published Craft",
      publishedImageShareHelp:"Creates a share-ready image from the validated preview. Its visible link and share payload return to this public page.",
      shareAsImage:"Share as image",
      downloadImage:"Download image",
      preparingShareImage:"Preparing share image…",
      shareImageReady:"Share image ready.",
      shareImageShared:"Image shared.",
      shareImageDownloaded:"Image downloaded. Share it with the included public link.",
      shareImageCancelled:"Image sharing was cancelled.",
      shareImageFailed:"Could not prepare the share image.",
      shareCardEyebrow:"ECHOES",
      shareCardCallToAction:"Echo",
      shareCardLicense:"CC BY-SA 4.0 · Source and attribution:",
      nativeImageShareText:"View and Echo this {kind} on PenEcho.",
      shareFailed:"Could not share this item.",
      cancel:"Cancel",
      askingAi:"Asking your current AI to improve the listing…",
      listingOptimized:"Listing optimized. Review it, then publish.",
      aiAutoFillFailed:"AI auto-fill failed.",
      communityBridgeNotReady:"The Canvas community bridge is not ready.",
      contributionLabel:"Your contribution to this Craft",
      publishedStep:"a published step",
      lineageNotice:"Building on {step}{name}. The original attribution and this new step will stay connected.",
      automaticPreviewMissing:"The automatic preview was not created.",
      automaticPreviewMeta:"Automatic WebP · {width} × {height} · no image upload needed",
      defaultWidgetDescription:"A reusable Widget for the PenEcho community.",
      defaultCanvasDescription:"A reusable Canvas for the PenEcho community.",
      previewRestored:"Preview ready. Your unfinished listing was restored.",
      previewReady:"Preview ready.",
      previewFailed:"Could not generate the preview.",
      sharingUnavailable:"Sharing is unavailable until the preview is valid.",
      favoriteUnsupported:"This PenEcho version does not support widget favorites.",
    }),
    zh:Object.freeze({
      close:"关闭",
      cloudSubtitle:"私有项目与收藏内容。",
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
      cloudAccount:"Cloud 账户",
      cloudUser:"PenEcho 用户",
      credits:"{count} 积分",
      accountSettings:"账户设置",
      signOutHelp:"退出只会从当前 PenEcho 主机移除此账户，不会移除已有的设备连接。",
      refreshAccount:"刷新账户",
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
      linkSignInFirst:"登录后输入一次性配对密钥，即可从 Cloud 安全访问此主机。",
      thisDevice:"此设备",
      connected:"已连接",
      deviceLinked:"设备已连接",
      connecting:"连接中",
      paused:"已暂停",
      pauseLink:"暂停连接",
      enableLink:"启用连接",
      linkSettings:"连接设置",
      removeLinkHelpBefore:"移除后将停止远程访问。之后可使用新配对密钥重新连接此主机，密钥来自 ",
      cloudDevices:"Cloud → 设备",
      removeLinkHelpAfter:"。",
      removeThisLink:"移除此连接",
      removeLinkConfirm:"要移除此设备连接吗？远程访问会停止，但之后仍可重新配对。",
      generatePairingBefore:"请在 ",
      penechoDevices:"PenEcho Cloud → 设备",
      generatePairingAfter:" 生成配对密钥，然后在下方输入。",
      pairingKey:"配对密钥",
      deviceName:"设备名称",
      myPenEcho:"我的 PenEcho",
      linkDevice:"连接设备",
      requestFailed:"PenEcho Cloud 请求失败。",
      chooseProject:"选择项目，然后打开或保存版本化画布。",
      signInProjects:"登录后可查看私有项目，并在不同设备间继续工作。",
      cloudSavingNotReady:"Cloud 项目保存功能尚未就绪。",
      used:"已使用 {size}",
      of:"，共 {size}",
      storageUsed:"Cloud 存储用量",
      storageHelp:"每次成功保存都会创建不可变版本，并发编辑不会被静默覆盖。",
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
      noCanvases:"这里还没有画布。先把当前画布保存到此项目。",
      untitledCanvas:"未命名画布",
      updated:"更新于 {date} · {size}",
      openNewPage:"在新页面打开 →",
      openCanvasHere:"打开画布",
      openingCanvas:"正在打开…",
      noProjects:"还没有 Cloud 项目。创建一个项目，即可在不同设备上使用当前画布。",
      manageWeb:"在网页端管理版本、回收站与恢复 ↗",
      loadingProjects:"正在加载 Cloud 项目…",
      syncUnsupported:"此 Cloud 不支持当前所需的项目同步协议。",
      signInFavorites:"登录后可查看保存在 PenEcho Cloud 账户中的收藏。",
      signInAction:"登录",
      loadingFavorites:"正在加载收藏…",
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
      previewValidating:"WebP · 正在验证内容",
      autoFillCurrentAi:"使用当前 AI 自动填写",
      contributionPlaceholder:"你推进了哪些内容？",
      continuationPlaceholder:"下一位创作者应该 Echo 哪个问题、细节或方向？",
      rightsBeforeCc:"我有权发布此作品。其视觉与文字内容采用 ",
      rightsBetweenCcMit:"，嵌入的源代码采用 ",
      rightsAfterMit:"，列表元数据采用 CC0。其他人可以在保留署名并沿用相同视觉许可的前提下 Echo；已发布版本和现有谱系无法撤回。",
      trainingBeforeLicense:"我理解这是发布所必需的授权。我允许 PenEcho 根据 ",
      trainingAfterLicense:" 使用此公开创作来构建、训练、评估、改进和商业化 PenEcho 模型与服务。私有项目、草稿、设备连接流量、API 密钥及私有模型请求不在此范围内。",
      tagLimit:"标签不能超过 8 个。",
      tagLength:"每个标签不能超过 32 个字符。",
      tagStart:"标签必须以字母或数字开头。",
      shareNote:"一张草图也可能成为伟大想法最早保留下来的记录。PenEcho 会自动捕获此{kind}，无需上传图片，并保留每一步的署名。经验证的 WebP 最大为 2048 × 2048、4 MB。",
      usesCurrentAi:"使用此设备上当前启用的 AI 连接。",
      nameLabel:"名称",
      descriptionLabel:"描述",
      categoryLabel:"分类",
      tagsLabel:"标签（最多 8 个，用逗号分隔）",
      continuationLabel:"下一位创作者应该 Echo 什么？",
      publishAndSave:"发布并收藏",
      publishStroke:"发布此笔触",
      validatingUploading:"正在验证并上传…",
      waitPreview:"请等待自动预览生成完成。",
      publishNameRequired:"请先输入名称再发布。",
      publishCategoryRequired:"请先选择分类再发布。",
      publishContributionRequired:"请告诉下一位创作者你推进了哪些内容。",
      publishContinuationRequired:"请告诉下一位创作者应该 Echo 什么。",
      publishRightsRequired:"发布前请确认发布权利与开放许可。",
      publishTrainingRequired:"发布前请确认必需的公开模型训练授权。",
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
      publishedImageShareTitle:"分享这份已发布的创作",
      publishedImageShareHelp:"使用已验证的预览生成可分享图片。图中的可见链接与分享内容都会返回此公开页面。",
      shareAsImage:"分享为图片",
      downloadImage:"下载图片",
      preparingShareImage:"正在准备分享图片…",
      shareImageReady:"分享图片已就绪。",
      shareImageShared:"图片已分享。",
      shareImageDownloaded:"图片已下载。分享时请保留图中的公开链接。",
      shareImageCancelled:"已取消图片分享。",
      shareImageFailed:"无法准备分享图片。",
      shareCardEyebrow:"ECHOES",
      shareCardCallToAction:"Echo",
      shareCardLicense:"CC BY-SA 4.0 · 来源与署名：",
      nativeImageShareText:"在 PenEcho 查看并 Echo 此{kind}。",
      shareFailed:"无法分享此内容。",
      cancel:"取消",
      askingAi:"正在请当前 AI 优化发布信息…",
      listingOptimized:"发布信息已优化，请检查后发布。",
      aiAutoFillFailed:"AI 自动填写失败。",
      communityBridgeNotReady:"画布社区连接尚未就绪。",
      contributionLabel:"你对此创作的贡献",
      publishedStep:"一个已发布步骤",
      lineageNotice:"正在基于{step}{name}继续创作。原始署名与此新步骤会保持关联。",
      automaticPreviewMissing:"未能创建自动预览。",
      automaticPreviewMeta:"自动 WebP · {width} × {height} · 无需上传图片",
      defaultWidgetDescription:"一个可供 PenEcho 社区复用的组件。",
      defaultCanvasDescription:"一个可供 PenEcho 社区复用的画布。",
      previewRestored:"预览已就绪，未完成的发布信息已恢复。",
      previewReady:"预览已就绪。",
      previewFailed:"无法生成预览。",
      sharingUnavailable:"预览验证通过后才能分享。",
      favoriteUnsupported:"此 PenEcho 版本不支持收藏组件。",
    }),
  });
  const state = {
    status:null,
    library:null,
    selectedProjectId:null,
    cloudSection:"projects",
    cloudFavoriteKind:"all",
    busy:false,
    browserSignIn:{ id:0, timer:0, poll:null, polling:false, active:false, expiresAt:0, popup:null, authorizationUrl:"", popupBlocked:false, tone:"", message:"" },
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

  function communityUrl(item) {
    return new URL(String(item?.shareUrl || `/community/${item?.id || ""}`), `${cloudOrigin()}/`).toString();
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
    const response = await fetch(path, {
      ...options,
      headers:{ ...apiHeaders(options.body !== undefined), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || `Cloud request failed (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = payload.code || null;
      throw error;
    }
    return payload;
  }

  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
    return node;
  }

  function focusableElements(dialog) {
    return [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.getClientRects().length);
  }

  let activeCloudOverlay = null;

  function closeOverlay(overlay) {
    stopCloudStatusWatch();
    const restoreFocus = overlay?._restoreFocus;
    overlay?.remove();
    if (overlay === activeCloudOverlay) activeCloudOverlay = null;
    cloudButton.setAttribute("aria-expanded", "false");
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll:true });
  }

  function dialogShell({ title, subtitle = "", share = false }) {
    const overlay = el("div", { class:"penecho-cloud-overlay" });
    overlay._restoreFocus = document.activeElement;
    const dialog = el("section", { class:`penecho-cloud-dialog${share ? " share" : ""}`, role:"dialog", "aria-modal":"true", "aria-label":title });
    const close = el("button", { class:"cloud-dialog-close", type:"button", text:"×", "aria-label":cloudT("close"), onclick:() => closeOverlay(overlay) });
    const heading = el("div", {}, [el("h2", { text:title }), subtitle ? el("p", { text:subtitle }) : null]);
    dialog.append(el("header", {}, [heading, close]));
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

  function accountSignedIn() { return Boolean(state.status?.accountSession?.signedIn); }

  function updateCloudButton() {
    const account = state.status?.account;
    const connected = Boolean(state.status?.device?.connected);
    cloudButton.dataset.state = connected ? "connected" : accountSignedIn() ? "signed-in" : "signed-out";
    cloudButton.querySelector(".cloud-account-label").textContent = account?.name ? account.name.split(/\s+/)[0] : "Cloud";
    cloudButton.title = connected
      ? `PenEcho Cloud · ${cloudT("deviceLinked")}`
      : accountSignedIn()
        ? `PenEcho Cloud · ${cloudT("credits", { count:account?.credits || 0 })}`
        : cloudT("openPenEchoCloud", { fallback:"Connect PenEcho Cloud" });
  }

  let statusRequestSeq = 0;

  async function refreshStatus(force = false) {
    const seq = ++statusRequestSeq;
    const previouslySignedIn = accountSignedIn();
    try {
      const status = await api(force ? "/api/cloud/account" : "/api/cloud/status");
      // A newer request already superseded this one; never let a stale,
      // slower response overwrite fresher status.
      if (seq !== statusRequestSeq) return state.status;
      state.status = status;
      if (previouslySignedIn && !accountSignedIn()) browserSignInMessage("", "");
      updateCloudButton();
      return state.status;
    } catch (error) {
      if (seq !== statusRequestSeq) return state.status;
      if (force) throw error;
      // A transient status failure is not evidence that the account session
      // ended. Keep the last confirmed state so tab renders cannot turn a
      // signed-in Cloud Center into a sign-in prompt while connectivity heals.
      if (state.status) updateCloudButton();
      else cloudButton.dataset.state = "signed-out";
      return state.status;
    }
  }

  let cloudStatusTimer = 0;
  let cloudStatusPolling = false;
  let cloudStatusWatchId = 0;
  let cloudStatusPoll = null;

  function cloudStatusSignature() {
    const device = state.status?.device || {};
    const account = state.status?.account || {};
    return JSON.stringify([
      Boolean(state.status?.accountSession?.signedIn),
      account.name || "",
      Number(account.credits || 0),
      Boolean(device.configured),
      Boolean(device.enabled),
      Boolean(device.connected),
      device.state || "",
      device.id || "",
    ]);
  }

  function stopCloudStatusWatch() {
    cloudStatusWatchId++; // invalidate any in-flight poll from a previous watch
    clearTimeout(cloudStatusTimer);
    cloudStatusTimer = 0;
    cloudStatusPolling = false;
    cloudStatusPoll = null;
  }

  function startCloudStatusWatch(overlay, render) {
    stopCloudStatusWatch();
    const id = cloudStatusWatchId;
    let previous = cloudStatusSignature();
    let previouslySignedIn = accountSignedIn();
    const poll = async () => {
      // Never run two polls at once and never let a stale watch touch shared
      // flags; an in-flight poll always reschedules in its finally block.
      if (id !== cloudStatusWatchId || !overlay.isConnected || cloudStatusPolling) return;
      cloudStatusPolling = true;
      try {
        await refreshStatus();
        if (id !== cloudStatusWatchId || !overlay.isConnected) return;
        const currentlySignedIn = accountSignedIn();
        if (!previouslySignedIn && currentlySignedIn) {
          finishSuccessfulBrowserSignIn(overlay);
          return;
        }
        previouslySignedIn = currentlySignedIn;
        const current = cloudStatusSignature();
        if (current !== previous) {
          previous = current;
          render();
        }
      } finally {
        if (id !== cloudStatusWatchId) return; // a newer watch owns the timer and flags now
        cloudStatusPolling = false;
        if (overlay.isConnected) cloudStatusTimer = setTimeout(poll, document.visibilityState === "visible" ? CLOUD_STATUS_POLL_MS : 5000);
      }
    };
    cloudStatusPoll = poll;
    cloudStatusTimer = setTimeout(poll, CLOUD_STATUS_POLL_MS);
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
      if (document.querySelector(".penecho-cloud-overlay")) render?.();
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

  function accountPanel(render) {
    const panel = el("section", { class:"penecho-cloud-panel" });
    panel.append(el("h3", { text:cloudT("cloudAccount") }));
    if (accountSignedIn()) {
      const account = state.status.account || {};
      panel.append(el("div", { class:"cloud-account-summary" }, [
        el("div", { class:"cloud-avatar", text:String(account.name || "P").slice(0, 1).toUpperCase() }),
        el("div", {}, [el("strong", { text:account.name || cloudT("cloudUser") }), el("span", { text:cloudT("credits", { count:Number(account.credits || 0) }) })]),
      ]));
      const settings = el("details", { class:"cloud-secondary-settings" });
      settings.append(
        el("summary", { text:cloudT("accountSettings") }),
        el("p", { text:cloudT("signOutHelp") }),
        el("div", { class:"cloud-button-row" }, [
          el("button", { class:"cloud-button", type:"button", text:cloudT("refreshAccount"), onclick:async () => action(render, async () => refreshStatus(true)) }),
          el("button", { class:"cloud-button danger", type:"button", text:cloudT("signOutHost"), onclick:async () => {
            if (!window.confirm(cloudT("signOutConfirm"))) return;
            await action(render, async () => { await api("/api/cloud/sign-out", { method:"POST", body:"{}" }); await refreshStatus(); });
          } }),
        ]),
      );
      panel.append(settings);
      return panel;
    }

    panel.append(el("div", { class:"cloud-environment" }, [el("span", { text:configuredCloudEnvironment === "uat" ? "UAT" : "Production" }), el("code", { text:cloudOrigin() })]));
    panel.append(el("p", { text:cloudT("localSignInHelp") }));
    const browserSignIn = state.browserSignIn;
    const message = el("div", {
      class:`cloud-message${browserSignIn.tone ? ` ${browserSignIn.tone}` : ""}`,
      text:browserSignIn.message,
      role:browserSignIn.tone === "error" ? "alert" : "status",
      "aria-live":browserSignIn.tone === "error" ? "assertive" : "polite",
    });
    const signIn = el("button", { class:"cloud-button primary", type:"button", text:browserSignIn.active ? cloudT("waitingBrowser") : window.penechoDesktop ? cloudT("continueBrowser") : cloudT("signInBrowser"), ...(browserSignIn.active ? { disabled:"" } : {}), onclick:async () => {
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
    } });
    const browserActions = el("div", { class:"cloud-button-row" }, signIn);
    if (browserSignIn.active && browserSignIn.authorizationUrl) {
      browserActions.append(el("a", { class:"cloud-button", href:browserSignIn.authorizationUrl, target:"_blank", rel:"noopener", text:browserSignIn.popupBlocked ? cloudT("openSignIn") : cloudT("openAgain") }));
    }
    panel.append(browserActions);
    if (browserSignIn.message) panel.append(message);
    return panel;
  }

  function devicePanel(render) {
    const panel = el("section", { class:"penecho-cloud-panel" });
    panel.append(el("h3", { text:cloudT("linkThisDevice") }));
    const device = state.status.device || {};
    if (device.configured) {
      panel.append(el("p", { text:`${device.name || cloudT("thisDevice")} · ${device.connected ? cloudT("connected") : device.enabled ? cloudT("connecting") : cloudT("paused")}` }));
      const actions = el("div", { class:"cloud-button-row" });
      actions.append(el("button", { class:"cloud-button", type:"button", text:device.enabled ? cloudT("pauseLink") : cloudT("enableLink"), onclick:async () => action(render, async () => {
        await api(`/api/cloud/device/${device.enabled ? "disable" : "enable"}`, { method:"POST", body:"{}" });
        await refreshStatus();
      }) }));
      panel.append(actions);
      const settings = el("details", { class:"cloud-secondary-settings" });
      settings.append(
        el("summary", { text:cloudT("linkSettings") }),
        el("p", {}, [
          document.createTextNode(cloudT("removeLinkHelpBefore")),
          cloudDevicesLink(cloudT("cloudDevices")),
          document.createTextNode(cloudT("removeLinkHelpAfter")),
        ]),
        el("button", { class:"cloud-button danger", type:"button", text:cloudT("removeThisLink"), onclick:async () => {
          if (!window.confirm(cloudT("removeLinkConfirm"))) return;
          await action(render, async () => { await api("/api/cloud/device/revoke", { method:"POST", body:"{}" }); await refreshStatus(); });
        } }),
      );
      panel.append(settings);
      return panel;
    }
    if (!accountSignedIn()) {
      panel.append(el("p", { text:cloudT("linkSignInFirst") }));
      return panel;
    }
    panel.append(el("p", {}, [
      document.createTextNode(cloudT("generatePairingBefore")),
      cloudDevicesLink(cloudT("penechoDevices")),
      document.createTextNode(cloudT("generatePairingAfter")),
    ]));
    const code = el("input", { type:"text", maxlength:"32", autocomplete:"one-time-code", placeholder:cloudT("pairingKey") });
    const name = el("input", { type:"text", maxlength:"80", value:cloudT("myPenEcho"), placeholder:cloudT("deviceName") });
    panel.append(field(cloudT("pairingKey"), code), field(cloudT("deviceName"), name));
    panel.append(el("button", { class:"cloud-button primary", type:"button", text:cloudT("linkDevice"), onclick:async () => action(render, async () => {
      await api("/api/cloud/pair", { method:"POST", body:JSON.stringify({ origin:cloudOrigin(), code:code.value.trim(), name:name.value.trim() }) });
      await refreshStatus();
    }) }));
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

  function focusCloudSignIn(owner) {
    const signIn = owner?.closest?.(".penecho-cloud-overlay")?.querySelector?.(".cloud-local-controls .cloud-button.primary");
    if (signIn) signIn.focus();
    else cloudButton.focus();
  }

  function cloudSignInEmpty(owner, messageKey) {
    return el("div", { class:"cloud-empty cloud-auth-empty" }, [
      el("p", { text:cloudT(messageKey) }),
      localHostControlsAvailable ? el("button", { class:"cloud-button primary", type:"button", text:cloudT("signInAction"), onclick:() => focusCloudSignIn(owner) }) : null,
    ]);
  }

  function cloudProjectsPanel() {
    const panel = el("section", { class:"penecho-cloud-panel cloud-projects-panel" });
    panel.append(el("div", { class:"cloud-panel-heading" }, [
      el("div", {}, [el("h3", { text:cloudT("cloudProjects") }), el("p", { text:cloudT("chooseProject") })]),
    ]));
    if (!accountSignedIn()) {
      panel.append(cloudSignInEmpty(panel, "signInProjects"));
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
      const library = state.library || {}, workspace = library.workspace || {}, projects = Array.isArray(library.projects) ? library.projects : [], canvases = Array.isArray(library.canvases) ? library.canvases : [];
      const used = Number(workspace.storageUsedBytes || 0) + Number(workspace.storageReservedBytes || 0), limit = Number(workspace.storageLimitBytes || 0);
      const storage = el("div", { class:"cloud-storage-summary compact" }, [
        el("div", {}, [el("strong", { text:cloudT("used", { size:formatBytes(used) }) }), el("span", { text:limit ? cloudT("of", { size:formatBytes(limit) }) : "" })]),
        el("progress", { class:"cloud-storage-track", max:String(Math.max(1, limit)), value:String(Math.min(used, Math.max(1, limit))), "aria-label":cloudT("storageUsed") }),
        el("small", { text:cloudT("storageHelp") }),
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
      const commandBar = el("div", { class:"cloud-project-toolbar" }, [
        picker,
        project ? el("button", { class:"cloud-button primary", type:"button", text:cloudT("saveCurrentHere"), onclick:() => openProjectHistory(project.id) }) : null,
        createDetails,
      ]);
      const card = el("article", { class:"cloud-project-card" });
      if (project) {
        const projectCanvases = canvases.filter((canvas) => canvas.projectId === project.id);
        card.append(el("div", { class:"cloud-project-card-head" }, [
          el("div", {}, [el("h4", { text:project.name || cloudT("untitledProject") }), el("span", { text:cloudT("canvasesCount", { count:projectCanvases.length, suffix:projectCanvases.length === 1 ? "" : "es" }) })]),
        ]));
        const list = el("div", { class:"cloud-canvas-list" });
        if (!projectCanvases.length) list.append(el("div", { class:"cloud-project-empty", text:cloudT("noCanvases") }));
        for (const canvas of projectCanvases.slice(0, 12)) {
          const row = el("button", { class:"cloud-canvas-row", type:"button", onclick:() => openProjectCanvasHere(canvas.id, panel, row) }, [
            canvas.previewDataUrl ? el("img", { src:canvas.previewDataUrl, alt:"", loading:"lazy" }) : el("span", { class:"cloud-canvas-placeholder", text:"P" }),
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
      content.replaceChildren(storage, commandBar, projectArea, el("a", { class:"cloud-project-web-link", href:new URL("/dashboard.html#projects", `${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:cloudT("manageWeb") }));
    }
    async function load() {
      content.setAttribute("aria-busy", "true");
      content.replaceChildren(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingProjects") }));
      try {
        const library = await api("/api/cloud/library");
        if (library?.sync?.bundleVersion !== 2 || library.sync.conflictPolicy !== "base-revision-required") throw Error(cloudT("syncUnsupported"));
        state.library = library;
        renderLibrary();
      } catch (error) {
        content.replaceChildren(el("div", { class:"cloud-message error", role:"alert", text:error.message }));
      } finally {
        content.setAttribute("aria-busy", "false");
      }
    }
    queueMicrotask(load);
    return panel;
  }

  function favoriteThumbnail(source, fallback, communityId = null) {
    const url = thumbnailDataUrl(source) || (communityId ? `/api/cloud/community/${encodeURIComponent(communityId)}/thumbnail` : "");
    if (!url) return el("span", { class:"cloud-library-thumb-fallback", text:fallback });
    const image = el("img", { class:"cloud-library-thumb", src:url, alt:"", loading:"lazy" });
    image.addEventListener("error", () => image.replaceWith(el("span", { class:"cloud-library-thumb-fallback", text:fallback })));
    return image;
  }

  function favoriteCanvasRow(item, owner) {
    const open = el("button", { class:"cloud-button primary", type:"button", text:cloudT("openCanvasHere"), onclick:async () => {
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
    const add = el("button", { class:"cloud-button primary", type:"button", text:cloudT("addToCanvas"), onclick:async () => {
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

  function cloudFavoritesPanel() {
    const panel = el("section", { class:"penecho-cloud-panel cloud-favorites-panel" });
    panel.append(el("div", { class:"cloud-panel-heading" }, [el("div", {}, [
      el("h3", { text:cloudT("favorites") }),
      el("p", { text:cloudT("favoritesHint") }),
    ])]));
    if (!accountSignedIn()) {
      panel.append(cloudSignInEmpty(panel, "signInFavorites"));
      return panel;
    }
    const filters = el("div", { class:"cloud-favorite-filters", role:"group", "aria-label":cloudT("favorites") });
    const content = el("div", { class:"cloud-library-list", "aria-live":"polite", "aria-busy":"true" });
    panel.append(filters, content);
    let canvases = [], widgets = [], loaded = false;
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
        onclick:() => { state.cloudFavoriteKind = value; renderFavorites(); },
      })));
      if (!loaded) return;
      const rows = [];
      if (state.cloudFavoriteKind !== "widget") rows.push(...canvases.map((item) => favoriteCanvasRow(item, panel)));
      if (state.cloudFavoriteKind !== "canvas") rows.push(...widgets.map((entry) => favoriteWidgetRow(entry, panel)));
      const emptyKey = state.cloudFavoriteKind === "canvas" ? "noFavoriteCanvases" : state.cloudFavoriteKind === "widget" ? "noFavoriteWidgets" : "noFavorites";
      content.replaceChildren(...(rows.length ? rows : [el("div", { class:"cloud-empty", text:cloudT(emptyKey) })]));
    }
    renderFavorites();
    queueMicrotask(async () => {
      content.setAttribute("aria-busy", "true");
      content.replaceChildren(el("div", { class:"cloud-message", role:"status", text:cloudT("loadingFavorites") }));
      try {
        const [canvasResult, widgetResult] = await Promise.all([
          api("/api/cloud/community?scope=favorites&kind=canvas&sort=newest&limit=60"),
          mergedFavoriteWidgets(),
        ]);
        canvases = Array.isArray(canvasResult.items) ? canvasResult.items : [];
        widgets = widgetResult;
        loaded = true;
        renderFavorites();
      } catch (error) {
        content.replaceChildren(el("div", { class:"cloud-message error", role:"alert", text:error?.message || cloudT("favoriteLoadFailed") }));
      } finally {
        content.setAttribute("aria-busy", "false");
      }
    });
    return panel;
  }

  function cloudSectionPanel() {
    if (state.cloudSection === "favorites") return cloudFavoritesPanel();
    return cloudProjectsPanel();
  }

  async function openCloud() {
    cloudButton.setAttribute("aria-expanded", "true");
    cloudButton.setAttribute("aria-busy", "true");
    cloudButton.disabled = true;
    try { await refreshStatus(); }
    finally {
      cloudButton.disabled = false;
      cloudButton.setAttribute("aria-busy", "false");
    }
    const shell = dialogShell({ title:"PenEcho Cloud", subtitle:cloudT("cloudSubtitle") });
    activeCloudOverlay = shell.overlay;
    const layout = el("div", { class:"penecho-cloud-layout" });
    shell.body.append(layout);
    function render() {
      const workspace = el("div", { class:"cloud-workspace" });
      const sections = el("nav", { class:"cloud-section-tabs", role:"tablist", "aria-label":cloudT("cloudArea") });
      const definitions = [
        ["projects", "cloudProjects"],
        ["favorites", "favorites"],
      ];
      for (const [value, label] of definitions) {
        const active = state.cloudSection === value;
        sections.append(el("button", {
          id:`cloud-tab-${value}`,
          class:`cloud-section-tab${active ? " active" : ""}`,
          type:"button",
          role:"tab",
          "aria-selected":String(active),
          "aria-controls":"cloud-section-panel",
          tabindex:active ? "0" : "-1",
          onclick:() => {
            state.cloudSection = value;
            render();
            queueMicrotask(() => document.querySelector(`#cloud-tab-${value}`)?.focus());
          },
        }, [el("strong", { text:cloudT(label) })]));
      }
      sections.append(el("a", {
        class:"cloud-section-tab cloud-explore-link",
        href:new URL("/community.html", `${cloudOrigin()}/`).toString(),
        target:"_blank",
        rel:"noopener",
      }, [el("strong", { text:`${cloudT("explore")} ↗` })]));
      sections.addEventListener("keydown", (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target?.getAttribute?.("role") !== "tab") return;
        const tabs = [...sections.querySelectorAll('[role="tab"]')], current = tabs.indexOf(event.target);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
      const sectionPanel = cloudSectionPanel();
      sectionPanel.id = "cloud-section-panel";
      sectionPanel.setAttribute("role", "tabpanel");
      sectionPanel.setAttribute("aria-labelledby", `cloud-tab-${state.cloudSection}`);
      workspace.append(sections, sectionPanel);
      layout.classList.toggle("remote-cloud-runtime", !localHostControlsAvailable);
      if (localHostControlsAvailable) {
        const accountColumn = el("aside", { class:"cloud-local-controls", "aria-label":cloudT("thisDevice") }, [accountPanel(render), devicePanel(render)]);
        layout.replaceChildren(accountColumn, workspace);
      } else {
        layout.replaceChildren(workspace);
      }
    }
    shell.overlay._cloudRender = render;
    render();
    startCloudStatusWatch(shell.overlay, render);
  }

  function shareCardRoundedRect(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.lineTo(x + width - corner, y);
    context.quadraticCurveTo(x + width, y, x + width, y + corner);
    context.lineTo(x + width, y + height - corner);
    context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
    context.lineTo(x + corner, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - corner);
    context.lineTo(x, y + corner);
    context.quadraticCurveTo(x, y, x + corner, y);
    context.closePath();
  }

  function shareCardLines(context, value, maximumWidth) {
    const characters = Array.from(String(value || "").trim().replace(/\s+/g, " "));
    if (!characters.length) return [];
    const lines = [];
    let line = "";
    for (const character of characters) {
      const candidate = line + character;
      if (!line || context.measureText(candidate).width <= maximumWidth) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = character.trimStart();
    }
    if (line) lines.push(line.trimEnd());
    return lines;
  }

  function shareCardLimitedLines(context, value, maximumWidth, maximumLines) {
    const lines = shareCardLines(context, value, maximumWidth);
    if (lines.length <= maximumLines) return lines;
    const visible = lines.slice(0, maximumLines), suffix = "…";
    let last = visible.at(-1);
    while (last && context.measureText(`${last}${suffix}`).width > maximumWidth) last = last.slice(0, -1);
    visible[visible.length - 1] = `${last.trimEnd()}${suffix}`;
    return visible;
  }

  function shareCardImage(source, errorKey = "shareImageFailed") {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(cloudT(errorKey)));
      image.src = source;
    });
  }

  function shareCardPreviewImage(preview) {
    if (!preview?.dataBase64 || (preview.contentType && preview.contentType !== "image/webp")) return Promise.reject(new Error(cloudT("automaticPreviewMissing")));
    return shareCardImage(`data:image/webp;base64,${preview.dataBase64}`);
  }

  function shareCardBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(cloudT("shareImageFailed"))),
      "image/png",
    ));
  }

  async function publishedShareImage({ preview, name, kindLabel, url }) {
    const [image, brandMark] = await Promise.all([
      shareCardPreviewImage(preview),
      shareCardImage("/penecho-mark.png").catch(() => null),
    ]), canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) throw new Error(cloudT("shareImageFailed"));
    canvas.width = 1200;
    canvas.height = 1200;

    context.fillStyle = "#f3f6fa";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.shadowColor = "rgba(15, 23, 42, .12)";
    context.shadowBlur = 34;
    context.shadowOffsetY = 12;
    shareCardRoundedRect(context, 48, 48, 1104, 1104, 42);
    context.fillStyle = "#ffffff";
    context.fill();
    context.restore();

    if (brandMark) context.drawImage(brandMark, 80, 84, 56, 56);
    context.fillStyle = "#182230";
    context.font = "750 27px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText("PenEcho", 148, 112);
    context.fillStyle = "#687385";
    context.font = "700 18px ui-sans-serif, system-ui, sans-serif";
    context.fillText(cloudT("shareCardEyebrow"), 281, 112);

    context.font = "700 20px ui-sans-serif, system-ui, sans-serif";
    const chipWidth = Math.min(230, Math.max(112, context.measureText(kindLabel).width + 48));
    shareCardRoundedRect(context, 1096 - chipWidth, 86, chipWidth, 52, 26);
    context.fillStyle = "#edf4ff";
    context.fill();
    context.fillStyle = "#285e9e";
    context.textAlign = "center";
    context.fillText(kindLabel, 1096 - chipWidth / 2, 112);
    context.textAlign = "left";

    let titleSize = 52, titleLines;
    do {
      context.font = `750 ${titleSize}px ui-sans-serif, system-ui, sans-serif`;
      titleLines = shareCardLines(context, name, 992);
      titleSize -= 4;
    } while (titleLines.length > 2 && titleSize >= 36);
    titleLines = shareCardLimitedLines(context, name, 992, 2);
    context.fillStyle = "#182230";
    context.textBaseline = "alphabetic";
    titleLines.forEach((line, index) => context.fillText(line, 104, 188 + index * (titleSize + 12)));

    const frame = { x:104, y:286, width:992, height:644 };
    shareCardRoundedRect(context, frame.x, frame.y, frame.width, frame.height, 24);
    context.fillStyle = "#eef2f7";
    context.fill();
    context.save();
    shareCardRoundedRect(context, frame.x, frame.y, frame.width, frame.height, 24);
    context.clip();
    const sourceWidth = image.naturalWidth || image.width || preview.width || 1;
    const sourceHeight = image.naturalHeight || image.height || preview.height || 1;
    const scale = Math.min(frame.width / sourceWidth, frame.height / sourceHeight);
    const imageWidth = Math.max(1, sourceWidth * scale), imageHeight = Math.max(1, sourceHeight * scale);
    context.drawImage(image, frame.x + (frame.width - imageWidth) / 2, frame.y + (frame.height - imageHeight) / 2, imageWidth, imageHeight);
    context.restore();

    context.fillStyle = "#dbe1e9";
    context.fillRect(104, 978, 992, 2);
    context.fillStyle = "#182230";
    context.font = "700 26px ui-sans-serif, system-ui, sans-serif";
    context.fillText(cloudT("shareCardCallToAction"), 104, 1024);
    context.fillStyle = "#687385";
    context.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    context.fillText(cloudT("shareCardLicense"), 104, 1056);
    context.fillStyle = "#356fc2";
    context.font = "600 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    const urlLines = shareCardLimitedLines(context, url, 992, 3);
    urlLines.forEach((line, index) => context.fillText(line, 104, 1085 + index * 23));

    const blob = await shareCardBlob(canvas);
    canvas.width = canvas.height = 1;
    return blob;
  }

  function publishedShareFilename(kind, name, itemId) {
    const label = String(name || itemId || "craft").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "craft";
    return `penecho-${kind}-${label}.png`;
  }

  function downloadPublishedShareImage(blob, filename) {
    const objectUrl = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  async function sharePublishedImage(blob, { filename, title, text, url }) {
    if (typeof File === "function" && navigator.share) {
      const file = new File([blob], filename, { type:"image/png" });
      let filesSupported = false;
      try { filesSupported = typeof navigator.canShare === "function" && navigator.canShare({ files:[file] }); }
      catch { filesSupported = false; }
      if (filesSupported) {
        await navigator.share({ files:[file], title, text, url });
        return "shared";
      }
    }
    downloadPublishedShareImage(blob, filename);
    return "downloaded";
  }

  function shareDialog({ kind, widgetId = null, favoriteAfterShare = false }) {
    if (!accountSignedIn()) {
      openCloud();
      return;
    }
    const title = cloudT("shareTitle"), bridge=window.PenEchoCommunityCanvas;
    const kindLabel = cloudT(kind === "widget" ? "widgetKind" : "canvasKind");
    const shell = dialogShell({ title, subtitle:cloudT("shareSubtitle"), share:true });
    const name = el("input", { type:"text", maxlength:"160", placeholder:cloudT(kind === "widget" ? "widgetNamePlaceholder" : "canvasNamePlaceholder") });
    const description = el("textarea", { rows:"3", maxlength:"1200", placeholder:cloudT("shareDescriptionPlaceholder") });
    const category = el("select", {}, [el("option", { value:"", text:cloudT("selectCategory") }), ...CATEGORIES.map(value => el("option", { value, text:cloudT(CATEGORY_LABEL_KEYS[value]) }))]);
    category.value = "";
    const tags = el("input", { type:"text", maxlength:"260", placeholder:cloudT("shareTagsPlaceholder") }),tagCount=el("small", { class:"cloud-tag-count", text:cloudT("tagCount", { count:0 }) });
    const status = el("span", { class:"cloud-share-status", role:"status", "aria-live":"polite", text:cloudT("generatingPreview") }),previewImage=el("img", { alt:cloudT("automaticSharePreview", { kind:kindLabel }) }),previewMeta=el("span", { text:cloudT("previewValidating") }),previewPanel=el("div", { class:"cloud-share-preview", "aria-busy":"true" }, [previewImage,previewMeta]);
    const autoFill=el("button", { class:"cloud-button cloud-ai-fill", type:"button", text:cloudT("autoFillCurrentAi"), disabled:"" });
    const contribution = el("textarea", { rows:"3", maxlength:"500", placeholder:cloudT("contributionPlaceholder") });
    const continuation = el("textarea", { rows:"3", maxlength:"500", placeholder:cloudT("continuationPlaceholder") });
    const permission = el("input", { type:"checkbox" });
    const permissionLabel = el("label", { class:"cloud-publication-consent" }, [permission, el("span", {}, [
      document.createTextNode(cloudT("rightsBeforeCc")),
      el("a", { href:"https://creativecommons.org/licenses/by-sa/4.0/", target:"_blank", rel:"noopener", text:"CC BY-SA 4.0" }),
      document.createTextNode(cloudT("rightsBetweenCcMit")),
      el("a", { href:"https://opensource.org/license/mit", target:"_blank", rel:"noopener", text:"MIT" }),
      document.createTextNode(cloudT("rightsAfterMit")),
    ])]);
    const trainingPermission=el("input", { type:"checkbox" });
    const trainingPermissionLabel=el("label", { class:"cloud-publication-consent" }, [trainingPermission,el("span", {}, [
      document.createTextNode(cloudT("trainingBeforeLicense")),
      el("a", { href:new URL("/terms.html#public-craft-training",`${cloudOrigin()}/`).toString(), target:"_blank", rel:"noopener", text:"Public Craft ML License" }),
      document.createTextNode(cloudT("trainingAfterLicense")),
    ])]);
    let artifact=null,lineage=null,draftKey=null,publish=null;
    function parsedTags(){const seen=new Set();return tags.value.split(",").map(value=>value.trim()).filter(value=>{const key=value.toLocaleLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;});}
    function tagIssue(){const values=parsedTags();if(values.length>8)return cloudT("tagLimit");if(values.some(value=>value.length>32))return cloudT("tagLength");if(values.some(value=>!/^\p{L}[\p{L}\p{N} ._+-]*$/u.test(value)&&!/^\p{N}[\p{L}\p{N} ._+-]*$/u.test(value)))return cloudT("tagStart");return "";}
    function updatePublishAvailability(){if(publish)publish.disabled=!artifact||!CATEGORIES.includes(category.value)||!permission.checked||!trainingPermission.checked||!continuation.value.trim()||Boolean(tagIssue());}
    function refreshTagCount(){const values=parsedTags(),issue=tagIssue();tagCount.textContent=issue||cloudT("tagCount", { count:values.length });tagCount.classList.toggle("error",Boolean(issue));updatePublishAvailability();}
    function draftPayload(){return{name:name.value,description:description.value,category:category.value,tags:tags.value,contribution:contribution.value,continuation:continuation.value};}
    function saveDraft(){if(!draftKey)return;try{sessionStorage.setItem(draftKey,JSON.stringify(draftPayload()));}catch{}}
    function restoreDraft(){if(!draftKey)return false;try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||"null");if(!saved||typeof saved!=="object")return false;name.value=String(saved.name||"").slice(0,160);description.value=String(saved.description||"").slice(0,1200);category.value=CATEGORIES.includes(saved.category)?saved.category:"";tags.value=String(saved.tags||"").slice(0,260);contribution.value=String(saved.contribution||"").slice(0,500);continuation.value=String(saved.continuation||"").slice(0,500);refreshTagCount();return true;}catch{return false;}}
    function clearDraft(){if(!draftKey)return;try{sessionStorage.removeItem(draftKey);}catch{}}
    for(const input of [name,description,tags,contribution,continuation])input.addEventListener("input",()=>{saveDraft();updatePublishAvailability();});
    category.addEventListener("change",()=>{saveDraft();updatePublishAvailability();});
    tags.addEventListener("input",refreshTagCount);
    shell.body.append(el("div", { class:"cloud-share-note", text:cloudT("shareNote", { kind:kindLabel }) }),previewPanel);
    shell.body.append(el("div", { class:"cloud-share-ai-row" }, [autoFill,el("span", { text:cloudT("usesCurrentAi") })]),field(cloudT("nameLabel"), name), field(cloudT("descriptionLabel"), description), field(cloudT("categoryLabel"), category),field(cloudT("tagsLabel"), el("div", { class:"cloud-tags-input" }, [tags,tagCount])));
    shell.body.append(field(cloudT("continuationLabel"),continuation));
    publish = el("button", { class:"cloud-button primary", type:"button", text:cloudT(favoriteAfterShare ? "publishAndSave" : "publishStroke"), onclick:async () => {
      publish.disabled = true;
      status.className = "cloud-share-status";
      status.textContent = cloudT("validatingUploading");
      try {
        if (!artifact) throw new Error(cloudT("waitPreview"));
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
          modelTrainingAccepted:trainingPermission.checked,
          publicationTermsVersion:PUBLICATION_TERMS_VERSION,
        };
        if (!payload.name) throw new Error(cloudT("publishNameRequired"));
        if (!CATEGORIES.includes(payload.category)) throw new Error(cloudT("publishCategoryRequired"));
        if (tagIssue()) throw new Error(tagIssue());
        if (lineage && !payload.contributionNote) throw new Error(cloudT("publishContributionRequired"));
        if (!payload.continuationPrompt) throw new Error(cloudT("publishContinuationRequired"));
        if (!permission.checked) throw new Error(cloudT("publishRightsRequired"));
        if (!trainingPermission.checked) throw new Error(cloudT("publishTrainingRequired"));
        status.textContent = cloudT(lineage ? "addingLineage" : "publishingFirstStep");
        const result = await api("/api/cloud/community/share", { method:"POST", body:JSON.stringify(payload) });
        if (!result.item?.id) throw new Error(cloudT("publishedCraftMissing"));
        clearDraft();
        let originError=null,favoriteError=null;
        try { await bridge.markPublishedOrigin?.(kind, artifact, result.item); }
        catch (error) { originError=error; }
        if (favoriteAfterShare) {
          try { await api(`/api/cloud/community/${result.item.id}/favorite`, { method:"POST", body:"{}" }); }
          catch (error) { favoriteError=error; }
        }
        status.className = `cloud-share-status ${originError||favoriteError?"error":"success"}`;
        status.textContent = originError
          ? cloudT("publishedLocalLinkAttention")
          : favoriteError
            ? cloudT("publishedFavoriteRetry")
            : cloudT(favoriteAfterShare ? "publishedAndSaved" : "publishedContinues");
        const url = communityUrl(result.item);
        const publishedName = String(result.item.name || payload.name), imageFilename = publishedShareFilename(kind, publishedName, result.item.id);
        const imageShareStatus = el("span", { class:"cloud-published-share-status", role:"status", "aria-live":"polite" });
        const imageShareHelp = el("span", { class:"cloud-published-share-help", text:cloudT("publishedImageShareHelp") });
        const imageShareButtons = el("div", { class:"cloud-published-share-buttons" });
        const imageShareTools = el("section", { class:"cloud-published-share-tools", "aria-label":cloudT("publishedImageShareTitle"), "aria-busy":"false" }, [
          el("strong", { text:cloudT("publishedImageShareTitle") }),
          imageShareHelp,
          imageShareButtons,
          imageShareStatus,
        ]);
        let imageBlob = null, imageBlobPromise = null, imageBusy = false, shareImageButton, downloadImageButton;
        function preparePublishedImage() {
          if (imageBlob) return Promise.resolve(imageBlob);
          imageBlobPromise ||= publishedShareImage({ preview:artifact.communityPreview, name:publishedName, kindLabel, url })
            .then((blob) => { imageBlob = blob; return blob; })
            .catch((error) => { imageBlobPromise = null; throw error; });
          return imageBlobPromise;
        }
        async function warmPublishedImage() {
          imageBusy = true;
          shareImageButton.disabled = downloadImageButton.disabled = true;
          imageShareTools.setAttribute("aria-busy", "true");
          imageShareStatus.textContent = cloudT("preparingShareImage");
          try {
            await preparePublishedImage();
            imageShareStatus.className = "cloud-published-share-status success";
            imageShareStatus.textContent = cloudT("shareImageReady");
          } catch {
            imageShareStatus.className = "cloud-published-share-status error";
            imageShareStatus.textContent = cloudT("shareImageFailed");
          } finally {
            imageBusy = false;
            shareImageButton.disabled = downloadImageButton.disabled = false;
            imageShareTools.setAttribute("aria-busy", "false");
          }
        }
        async function runPublishedImageAction(action) {
          if (imageBusy) return;
          imageBusy = true;
          shareImageButton.disabled = downloadImageButton.disabled = true;
          imageShareTools.setAttribute("aria-busy", "true");
          imageShareStatus.className = "cloud-published-share-status";
          imageShareStatus.textContent = cloudT("preparingShareImage");
          try {
            const readyImageBlob = imageBlob || await preparePublishedImage();
            if (action === "download") {
              downloadPublishedShareImage(readyImageBlob, imageFilename);
              imageShareStatus.textContent = cloudT("shareImageDownloaded");
            } else {
              const outcome = await sharePublishedImage(readyImageBlob, {
                filename:imageFilename,
                title:publishedName,
                text:cloudT("nativeImageShareText", { kind:kindLabel }),
                url,
              });
              imageShareStatus.textContent = cloudT(outcome === "shared" ? "shareImageShared" : "shareImageDownloaded");
            }
            imageShareStatus.className = "cloud-published-share-status success";
          } catch (error) {
            if (error?.name === "AbortError") {
              imageShareStatus.textContent = cloudT("shareImageCancelled");
            } else {
              imageShareStatus.className = "cloud-published-share-status error";
              imageShareStatus.textContent = cloudT("shareImageFailed");
            }
          } finally {
            imageBusy = false;
            shareImageButton.disabled = downloadImageButton.disabled = false;
            imageShareTools.setAttribute("aria-busy", "false");
          }
        }
        shareImageButton = el("button", { class:"cloud-button image-share", type:"button", text:cloudT("shareAsImage"), onclick:() => runPublishedImageAction("share") });
        downloadImageButton = el("button", { class:"cloud-button", type:"button", text:cloudT("downloadImage"), onclick:() => runPublishedImageAction("download") });
        imageShareButtons.append(shareImageButton, downloadImageButton);
        const localSourceMessage=el("span", { text:originError
          ? cloudT("originRetryMessage", { kind:kindLabel, step:Number(result.item.generation || 0)+1 })
          : cloudT("originLinkedMessage", { kind:kindLabel, step:result.item.generation ? cloudT("stepNumber", { number:Number(result.item.generation) + 1 }) : cloudT("firstStroke") }) });
        const resultActions=el("div", { class:"cloud-button-row" });
        if(originError){
          const retryOrigin=el("button", { class:"cloud-button", type:"button", text:cloudT("retryLocalLink"), onclick:async()=>{
            retryOrigin.disabled=true;
            try{
              await bridge.markPublishedOrigin?.(kind,artifact,result.item);
              localSourceMessage.textContent=cloudT("localSourceLinked", { step:Number(result.item.generation||0)+1 });
              status.className="cloud-share-status success";
              status.textContent=cloudT("publishedLinkRestored");
              retryOrigin.remove();
            }catch(error){status.className="cloud-share-status error";status.textContent=error.message||cloudT("localLinkRestoreFailed");retryOrigin.disabled=false;}
          }});
          resultActions.append(retryOrigin);
        }
        resultActions.append(
          el("button", { class:"cloud-button", type:"button", text:cloudT("copyLink"), onclick:async () => { await copyText(url); status.textContent = cloudT("publicLinkCopied"); } }),
          el("a", { class:"cloud-button", href:url, target:"_blank", rel:"noopener", text:cloudT("viewPublicPage") }),
          el("button", { class:"cloud-button primary", type:"button", text:cloudT("done"), onclick:() => closeOverlay(shell.overlay) }),
        );
        const resultPanel = el("div", { class:"cloud-share-result" }, [
          el("strong", { text:cloudT("publicCommonsTitle") }),
          localSourceMessage,
          el("input", { value:url, readonly:"", "aria-label":cloudT("publicCommunityLink") }),
          imageShareTools,
          resultActions,
        ]);
        shell.body.insertBefore(resultPanel, shell.body.lastElementChild);
        void warmPublishedImage();
        publish.remove();
      } catch (error) {
        status.className = "cloud-share-status error";
        status.textContent = error.message || cloudT("shareFailed");
        publish.disabled = false;
      }
    } });
    shell.body.append(permissionLabel,trainingPermissionLabel, el("div", { class:"cloud-share-actions" }, [status, el("button", { class:"cloud-button", type:"button", text:cloudT("cancel"), onclick:() => closeOverlay(shell.overlay) }), publish]));
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
        previewMeta.textContent=cloudT("automaticPreviewMeta", { width:preview.width, height:preview.height });
        previewPanel.setAttribute("aria-busy","false");
        const suggestedName=kind==="widget"?artifact.widget?.title:artifact.name;
        if(!name.value.trim())name.value=String(suggestedName||cloudT(kind==="widget"?"untitledWidget":"untitledCanvas")).slice(0,160);
        if(!description.value.trim())description.value=cloudT(kind==="widget"?"defaultWidgetDescription":"defaultCanvasDescription");
        const recovered=restoreDraft();
        updatePublishAvailability();
        autoFill.disabled=false;
        status.textContent=cloudT(recovered?"previewRestored":"previewReady");
      }catch(error){previewPanel.classList.add("error");previewMeta.textContent=error.message||cloudT("previewFailed");status.className="cloud-share-status error";status.textContent=cloudT("sharingUnavailable");}
    });
    permission.addEventListener("change",updatePublishAvailability);
    trainingPermission.addEventListener("change",updatePublishAvailability);
  }

  async function takeFurther(itemId) {
    const encodedItemId = encodeURIComponent(itemId);
    let downloaded;
    if (window.PENECHO_CONFIG?.runtime === "cloud") {
      // The browser is already authenticated to PenEcho Cloud. Fetch the
      // published Craft from Cloud itself, then import it through the linked
      // host bridge; requiring a second account session on that host makes a
      // valid Remote Canvas deep link fail with a misleading sign-in error.
      const [details, artifact] = await Promise.all([
        api(`/api/v1/community/items/${encodedItemId}`),
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
      await window.PenEchoCommunityCanvas.importWidget(downloaded.artifact, item);
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

  /* Favorites picker: the toolbar ➕ lists favorited community Widgets. */
  const craftsButton = document.getElementById("craftsButton");
  const craftsPopover = document.getElementById("craftsPopover");
  const craftsClose = document.getElementById("craftsClose");
  const craftsList = document.getElementById("craftsList");
  const savedT = (key, fallback) => {
    const translated = window.PenEchoI18n?.t?.(key);
    if (translated && translated !== key) return translated;
    return document.documentElement.lang.startsWith("zh") ? (window.PENECHO_LOCALES?.zh || {})[key] || fallback : fallback;
  };

  function setCraftsOpen(open) {
    if (!craftsPopover) return;
    craftsPopover.hidden = !open;
    craftsPopover.setAttribute("aria-hidden", String(!open));
    craftsButton?.setAttribute("aria-expanded", String(open));
    if (open) document.body.classList.add("plugin-open");
    else document.body.classList.remove("plugin-open");
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  /* Deletion tombstones: a favorite removed while the cloud DELETE could not
     land (offline, expired session) must stay deleted. The next sync re-issues
     the DELETE for the surviving cloud copy instead of mirroring it back. */
  const FAVORITE_TOMBSTONES_KEY = "penecho-favorite-tombstones";
  function favoriteTombstones() {
    try { return JSON.parse(localStorage.getItem(FAVORITE_TOMBSTONES_KEY)) || {}; } catch { return {}; }
  }
  function writeFavoriteTombstones(tombstones) {
    try { localStorage.setItem(FAVORITE_TOMBSTONES_KEY, JSON.stringify(tombstones)); } catch {}
  }
  function rememberFavoriteTombstone(sha256) {
    if (!sha256) return;
    const entries = Object.entries({ ...favoriteTombstones(), [sha256]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 200);
    writeFavoriteTombstones(Object.fromEntries(entries));
  }
  function clearFavoriteTombstone(sha256) {
    const tombstones = favoriteTombstones();
    if (!Object.hasOwn(tombstones, sha256)) return;
    delete tombstones[sha256];
    writeFavoriteTombstones(tombstones);
  }

  async function localFavorites() {
    try { return (await api("/api/favorites")).favorites || []; }
    catch { return []; }
  }

  async function saveLocalFavorite(favorite) {
    return (await api("/api/favorites", { method:"PUT", body:JSON.stringify(favorite) })).favorite;
  }

  async function removeLocalFavorite(sha256) {
    try { await api(`/api/favorites/${encodeURIComponent(sha256)}`, { method:"DELETE" }); } catch {}
  }

  function thumbnailDataUrl(favorite) {
    if (favorite.thumbnailUrl) return favorite.thumbnailUrl;
    const base64 = favorite.thumbnail || favorite.artifact?.communityThumbnail?.dataBase64 || favorite.artifact?.communityPreview?.dataBase64;
    const contentType = favorite.thumbnail ? "image/webp" : (favorite.artifact?.communityThumbnail || favorite.artifact?.communityPreview)?.contentType || "image/webp";
    return base64 ? `data:${contentType};base64,${base64}` : null;
  }

  /* One-click favorite on a widget: local snapshot always, cloud copy when signed in. */
  async function toggleWidgetFavorite(widgetId) {
    const bridge = window.PenEchoCommunityCanvas;
    if (!bridge?.widgetArtifact || !bridge.setWidgetFavorite) throw new Error(cloudT("favoriteUnsupported"));
    const artifact = await bridge.widgetArtifact(widgetId);
    const sha256 = await sha256Hex(JSON.stringify(artifact));
    const locals = await localFavorites();
    const existing = locals.find((entry) => entry.artifactSha256 === sha256);
    const serialized = { name:String(artifact.widget?.title || cloudT("untitledWidget")).slice(0, 160), artifact, thumbnail:artifact.communityThumbnail?.dataBase64 || "", sourceItemId:artifact.widget?.communityOriginItemId || null };
    if (existing) {
      await removeLocalFavorite(sha256);
      rememberFavoriteTombstone(sha256);
      if (accountSignedIn() && existing.cloudId) { try { await api(`/api/cloud/favorites/${encodeURIComponent(existing.cloudId)}`, { method:"DELETE" }); } catch {} }
      bridge.setWidgetFavorite(widgetId, false);
      return false;
    }
    clearFavoriteTombstone(sha256);
    let saved = await saveLocalFavorite({ ...serialized, cloudId:null });
    if (accountSignedIn()) {
      try {
        const cloudFavorite = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify(serialized) })).favorite;
        saved = await saveLocalFavorite({ ...serialized, cloudId:cloudFavorite.id });
      } catch {}
    }
    bridge.setWidgetFavorite(widgetId, true);
    return true;
  }

  /* Two-way personal-favorites sync: upload offline saves, mirror cloud saves,
     and drop local mirrors whose cloud copy was removed elsewhere. */
  async function syncFavorites() {
    if (!accountSignedIn()) return { synced: 0 };
    const [locals, cloud] = await Promise.all([
      localFavorites(),
      api("/api/cloud/favorites").then((result) => result.favorites || []).catch(() => null),
    ]);
    if (!Array.isArray(cloud)) return { synced: 0 };
    const cloudBySha = new Map(cloud.map((entry) => [entry.artifactSha256, entry]));
    let synced = 0;
    for (const entry of locals) {
      const cloudEntry = cloudBySha.get(entry.artifactSha256);
      if (cloudEntry) {
        if (entry.cloudId !== cloudEntry.id) await saveLocalFavorite({ ...entry, cloudId:cloudEntry.id });
      } else if (entry.cloudId) {
        await removeLocalFavorite(entry.artifactSha256); // removed on the cloud elsewhere
      } else {
        try {
          const uploaded = (await api("/api/cloud/favorites", { method:"POST", body:JSON.stringify({ name:entry.name, artifact:entry.artifact, thumbnail:entry.thumbnail, sourceItemId:entry.sourceItemId }) })).favorite;
          await saveLocalFavorite({ ...entry, cloudId:uploaded.id });
          synced += 1;
        } catch {}
      }
    }
    const tombstones = favoriteTombstones();
    for (const cloudEntry of cloud) {
      if (locals.some((entry) => entry.artifactSha256 === cloudEntry.artifactSha256)) continue;
      const tombstonedAt = Number(tombstones[cloudEntry.artifactSha256]) || 0;
      if (tombstonedAt) {
        // A cloud copy created after the tombstone is a fresh favorite made on
        // another device — the delete intent does not cover it.
        if (Number(cloudEntry.createdAt) > tombstonedAt) clearFavoriteTombstone(cloudEntry.artifactSha256);
        else {
          try {
            await api(`/api/cloud/favorites/${encodeURIComponent(cloudEntry.id)}`, { method:"DELETE" });
            clearFavoriteTombstone(cloudEntry.artifactSha256);
          } catch { /* still offline: the tombstone retries next sync */ }
        }
        continue;
      }
      try {
        await saveLocalFavorite({ name:cloudEntry.name, artifactSha256:cloudEntry.artifactSha256, artifact:cloudEntry.artifact, thumbnail:cloudEntry.thumbnail, sourceItemId:cloudEntry.sourceItemId, cloudId:cloudEntry.id, createdAt:cloudEntry.createdAt });
        synced += 1;
      } catch {}
    }
    return { synced };
  }

  async function mergedFavoriteWidgets() {
    const locals = await localFavorites();
    let cloudPersonal = [], community = [];
    if (accountSignedIn()) {
      await syncFavorites();
      const [personal, favorites] = await Promise.all([
        api("/api/cloud/favorites").then((result) => result.favorites || []).catch(() => []),
        api("/api/cloud/community?scope=favorites&kind=widget&sort=newest&limit=60").then((result) => result.items || []).catch(() => []),
      ]);
      cloudPersonal = personal;
      community = favorites.filter((item) => item.kind === "widget");
    }
    const mergedMap = new Map();
    const offer = (type, entry, sha) => {
      const key = sha || entry.artifactSha256;
      if (!key) return;
      if (!mergedMap.has(key)) mergedMap.set(key, { key, sources:[] });
      mergedMap.get(key).sources.push({ type, entry });
    };
    for (const entry of locals) offer("local", entry);
    for (const entry of cloudPersonal) offer("cloud", entry);
    for (const item of community) offer("community", item, item.artifactSha256 || item.artifact?.sha256);
    return [...mergedMap.values()];
  }

  function craftsFallbackThumb() {
    const node = document.createElement("span");
    node.className = "crafts-thumb-fallback";
    node.textContent = "W";
    return node;
  }

  function craftsSourceBadge(sources) {
    const badge = document.createElement("span");
    badge.className = "crafts-source";
    const cloud = sources.includes("cloud") || sources.includes("community");
    if (cloud && sources.includes("local")) { badge.textContent = savedT("savedSourceSynced", "☁ + local"); badge.title = savedT("savedSourceCloudTitle", "On PenEcho Cloud and this device"); }
    else if (cloud) { badge.textContent = sources.includes("community") ? savedT("savedSourceCommunity", "☁ community") : savedT("savedSourceCloud", "☁ cloud"); badge.title = savedT("savedSourceCloudTitle", "On PenEcho Cloud"); }
    else { badge.textContent = savedT("savedSourceLocal", "local"); badge.title = savedT("savedSourceLocalTitle", "On this device only — it uploads to PenEcho Cloud once you sign in"); }
    return badge;
  }

  async function addCraftToCanvas(merged) {
    const local = merged.sources.find((entry) => entry.type === "local");
    if (local) {
      if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error(cloudT("widgetImportUnavailable"));
      await window.PenEchoCommunityCanvas.importWidget(local.entry.artifact, local.entry.sourceItemId ? { id:local.entry.sourceItemId, name:local.entry.name } : null);
      return;
    }
    const cloudEntry = (merged.sources.find((entry) => entry.type === "cloud") || merged.sources.find((entry) => entry.type === "community"))?.entry;
    if (merged.sources.some((entry) => entry.type === "community")) return takeFurther(cloudEntry.id);
    if (!window.PenEchoCommunityCanvas?.importWidget) throw new Error(cloudT("widgetImportUnavailable"));
    await window.PenEchoCommunityCanvas.importWidget(cloudEntry.artifact, cloudEntry.sourceItemId ? { id:cloudEntry.sourceItemId, name:cloudEntry.name } : null);
  }

  async function removeCraft(merged) {
    for (const source of merged.sources) {
      if (source.type === "local") { await removeLocalFavorite(source.entry.artifactSha256); rememberFavoriteTombstone(source.entry.artifactSha256); }
      else if (source.type === "cloud") { rememberFavoriteTombstone(source.entry.artifactSha256); try { await api(`/api/cloud/favorites/${encodeURIComponent(source.entry.id)}`, { method:"DELETE" }); } catch {} }
      else if (source.type === "community") { try { await api(`/api/cloud/community/${encodeURIComponent(source.entry.id)}/favorite`, { method:"DELETE" }); } catch {} }
    }
  }

  function craftsRow(merged, refresh) {
    const row = document.createElement("div");
    row.className = "crafts-row";
    const source = merged.sources[0].entry;
    const thumb = document.createElement("img");
    thumb.className = "crafts-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    const url = thumbnailDataUrl(source) || (merged.sources.some((entry) => entry.type === "community") ? `/api/cloud/community/${encodeURIComponent(source.id)}/thumbnail` : null);
    if (url) { thumb.src = url; thumb.addEventListener("error", () => thumb.replaceWith(craftsFallbackThumb())); }
    else thumb.replaceWith(craftsFallbackThumb());
    const copy = document.createElement("div");
    copy.className = "crafts-copy";
    const title = document.createElement("b");
    title.textContent = source.name || savedT("untitledWidget", cloudT("untitledWidget"));
    const byline = document.createElement("small");
    byline.textContent = source.artifact?.widget?.title || source.description || savedT("communityWidget", cloudT("communityWidget"));
    byline.append(document.createElement("br"), craftsSourceBadge(merged.sources.map((entry) => entry.type === "community" ? "community" : entry.type)));
    copy.append(title, byline);
    const actions = document.createElement("div");
    actions.className = "crafts-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "crafts-add";
    add.textContent = savedT("savedAdd", "Add");
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = savedT("savedAdding", "Adding…");
      try { await addCraftToCanvas(merged); setCraftsOpen(false); }
      catch (error) { add.textContent = savedT("savedAdd", "Add"); add.disabled = false; alert(error?.message || savedT("savedErrorAdd", "Could not add this Widget.")); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "crafts-remove";
    remove.textContent = "×";
    remove.title = savedT("savedRemoveTitle", "Remove from Favorites");
    remove.setAttribute("aria-label", `${savedT("savedRemoveTitle", "Remove from Favorites")}: ${source.name || ""}`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      await removeCraft(merged);
      await refresh();
    });
    actions.append(add, remove);
    row.append(thumb, copy, actions);
    return row;
  }

  async function openCrafts() {
    if (!craftsPopover) return;
    setCraftsOpen(true);
    craftsList.replaceChildren(el("p", { class:"crafts-empty", text:savedT("savedLoading", "Loading favorite Widgets…") }));
    const refresh = async () => { await renderCraftsList(); };
    async function renderCraftsList() {
      const merged = await mergedFavoriteWidgets();
      if (!merged.length) {
        craftsList.replaceChildren(el("p", { class:"crafts-empty", text:accountSignedIn()
          ? savedT("savedEmptyIn", "No favorite Widgets yet. Tap ★ on any Widget to keep it here.")
          : savedT("savedEmptyOut", "No favorite Widgets yet. Tap ★ on any Widget — favorites stay on this device until you sign in to PenEcho Cloud.") }));
        return;
      }
      craftsList.replaceChildren(...merged.map((entry) => craftsRow(entry, refresh)));
    }
    try {
      await refreshStatus();
      await renderCraftsList();
    } catch (error) {
      craftsList.replaceChildren(el("p", { class:"crafts-empty", text:error?.message || savedT("savedErrorAdd", "Favorite Widgets are unavailable right now.") }));
    }
  }

  craftsButton?.addEventListener("click", openCrafts);
  craftsClose?.addEventListener("click", () => setCraftsOpen(false));
  craftsPopover?.addEventListener("mousedown", (event) => { if (event.target === craftsPopover) setCraftsOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !craftsPopover?.hidden) setCraftsOpen(false); });
  window.addEventListener("penecho:languagechange", () => {
    updateCloudButton();
    const overlay = document.querySelector(".penecho-cloud-overlay");
    if (overlay?._cloudRender) {
      const subtitle = overlay.querySelector("header p"), close = overlay.querySelector(".cloud-dialog-close");
      if (subtitle) subtitle.textContent = cloudT("cloudSubtitle");
      close?.setAttribute("aria-label", cloudT("close"));
      overlay._cloudRender();
    }
    if (craftsPopover && !craftsPopover.hidden) void openCrafts();
  });

  cloudButton.addEventListener("click", openCloud);
  shareCanvasButton.addEventListener("click", async () => { await refreshStatus(); shareDialog({ kind:"canvas" }); });
  window.addEventListener("penecho:community-widget-action", async (event) => {
    const actionName = event.detail?.action;
    const widgetId = event.detail?.widgetId;
    if (!widgetId || !["favorite", "share"].includes(actionName)) return;
    await refreshStatus();
    if (actionName === "share") { shareDialog({ kind:"widget", widgetId }); return; }
    try { await toggleWidgetFavorite(widgetId); }
    catch (error) { alert(error?.message || savedT("savedErrorToggle", "Could not update this favorite.")); }
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
    if (document.visibilityState !== "visible") return;
    if (state.browserSignIn.active && state.browserSignIn.poll) {
      clearTimeout(state.browserSignIn.timer);
      state.browserSignIn.timer = 0;
      void state.browserSignIn.poll();
    }
    // Refresh the Cloud Center immediately when the page becomes visible again
    // instead of waiting out the longer hidden-tab poll interval.
    if (cloudStatusPoll) {
      clearTimeout(cloudStatusTimer);
      cloudStatusTimer = 0;
      void cloudStatusPoll();
    }
  });
  // Remote Canvas has its own Cloud account/device gate. Avoid relaying a
  // redundant local /api/cloud/status request while that gate is opening.
  if (window.PENECHO_CONFIG?.runtime !== "cloud") void refreshStatus();
})();
