"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("toolbar ships a left-navigation Favorites workbench with list and grid views", () => {
  const page = read("public/index.html"), app = read("src/client/app/core.js"), script = read("public/cloud-connect.js"), locale = read("public/locales/zh.js"), css = read("public/style.css");

  assert.match(page, /id="craftsButton"[^>]*aria-controls="craftsPopover"/);
  assert.match(page, /id="craftsButton"[^>]*data-i18n-aria="savedCrafts"/);
  assert.match(page, /id="craftsPopover"[^>]*hidden/);
  assert.match(page, /class="plugin-modal crafts-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="craftsTitle"[^>]*aria-describedby="craftsSubtitle"[^>]*tabindex="-1"/);
  assert.match(page, /<aside class="crafts-sidebar">[\s\S]*?<section class="crafts-workspace">/);
  assert.match(page, /id="craftsSubtitle"[^>]*data-i18n="savedCraftsSubtitle"/);
  assert.match(page, /id="craftsRefreshStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(page, /class="crafts-head"[^>]*data-pe-region="toolbar"[\s\S]*?id="craftsSearch"[^>]*type="search"[^>]*autocomplete="off"[^>]*data-pe-control="input"[^>]*data-i18n-placeholder="savedSearch"[^>]*data-i18n-aria="savedSearchLabel"/);
  assert.doesNotMatch(page, /id="craftsSearch"[^>]*autofocus/);
  const titleRowStart = page.indexOf('<div class="crafts-title-row">');
  const countStart = page.indexOf('id="craftsCount"', titleRowStart);
  const refreshStart = page.indexOf('id="craftsRefreshStatus"', countStart);
  const headActionsStart = page.indexOf('<div class="crafts-head-actions">', refreshStart);
  const searchStart = page.indexOf('class="crafts-search"', headActionsStart);
  const viewSwitchStart = page.indexOf('id="craftsViewSwitch"', searchStart);
  const closeStart = page.indexOf('id="craftsClose"', viewSwitchStart);
  assert.ok(titleRowStart < countStart && countStart < refreshStart && refreshStart < headActionsStart, "Favorites count and refresh status should remain in the left toolbar group");
  assert.ok(headActionsStart < searchStart && searchStart < viewSwitchStart && viewSwitchStart < closeStart, "Favorites search should sit directly before the List/Grid switch in the right toolbar group");
  assert.match(page, /id="craftsFilterAll" class="crafts-nav-item active"[^>]*role="tab"[^>]*aria-selected="true"[\s\S]*?data-crafts-filter-label data-i18n="all"/);
  assert.match(page, /id="craftsFilterWidgets" class="crafts-nav-item"[^>]*role="tab"[\s\S]*?data-crafts-filter-label data-i18n="widgets"/);
  assert.match(page, /id="craftsFilterCanvases" class="crafts-nav-item"[^>]*role="tab"[\s\S]*?data-crafts-filter-label data-i18n="canvases"/);
  assert.match(page, /id="craftsViewSwitch"[^>]*role="group"[^>]*data-i18n-aria="savedView"/);
  assert.match(page, /id="craftsViewList"[^>]*aria-pressed="true"[^>]*data-i18n-aria="savedListView"/);
  assert.match(page, /id="craftsViewGrid"[^>]*aria-pressed="false"[^>]*data-i18n-aria="savedGridView"/);
  assert.match(page, /id="craftsEchoesLink"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.match(page, /id="craftsCount"[^>]*aria-live="polite"/);
  assert.match(page, /id="craftsClose"[^>]*data-i18n-aria="closeSavedCrafts"[^>]*data-i18n-title="closeSavedCrafts"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(page, /class="crafts-empty"[^>]*data-i18n="savedLoading"/);
  assert.match(page, /id="craftsRemoveDialog"[^>]*role="alertdialog"[^>]*aria-modal="true"[^>]*data-pe-surface="alert"/);
  assert.match(page, /id="craftsRemoveCancel"[^>]*value="cancel"[^>]*data-pe-button="secondary"/);
  assert.match(page, /id="craftsRemoveConfirm"[^>]*value="remove"[^>]*data-pe-button="danger-primary"/);

  assert.match(script, /const FAVORITE_PAGE_SIZE = 20/);
  assert.match(script, /\/api\/cloud\/favorites\/feed\?/);
  assert.match(script, /function toggleWidgetFavorite/);
  assert.match(script, /function syncLocalFavorites/);
  assert.match(script, /scheduleLocalFavoriteSync/);
  assert.match(script, /function activateFavoriteCraft/);
  assert.match(script, /merged\.kind !== "canvas"/);
  assert.match(script, /return takeFurther\(community\.id\)/);
  assert.match(script, /let selectedCraftKind = "all"/);
  assert.match(script, /let selectedCraftView = "list"/);
  assert.match(script, /function filteredFavoriteCrafts/);
  assert.match(script, /function craftSearchQuery/);
  assert.match(script, /function favoriteCraftSearchText/);
  assert.match(script, /craftsSearch\?\.addEventListener\("input"/);
  assert.doesNotMatch(script, /craftsSearch[^\n]*\.focus/);
  assert.match(script, /function updateCraftView/);
  assert.match(script, /function updateCraftsEchoesLink/);
  assert.match(script, /function favoriteCraftTime/);
  assert.match(script, /favoriteCraftTime\(b\) - favoriteCraftTime\(a\)/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(script, /let craftsRestoreFocus = null/);
  assert.match(script, /const focusable = focusableElements\(dialog\)/);
  assert.match(script, /restore\?\.focus\?\.\(\)/);
  assert.match(script, /craftsList\?\.setAttribute\("aria-busy", String\(refreshing\)\)/);
  assert.match(script, /data-crafts-filter-label/);
  assert.match(script, /meta\.append\(kindBadge, craftsSourceBadge\(merged\.sources\)\)/);
  assert.doesNotMatch(script, /media\.append\(kindBadge\)/);
  assert.match(script, /title\.className = "crafts-card-title"/);
  assert.match(script, /footer\.append\(meta, actions\);[\s\S]*?row\.append\(media, copy, footer\)/);
  assert.match(script, /add\.dataset\.peButton = "secondary"/);
  assert.match(script, /function confirmCraftRemoval\(name\)/);
  assert.match(script, /craftsRemoveDialog\.showModal\(\)/);
  assert.match(script, /if \(!await confirmCraftRemoval\(title\.textContent\)\) return;[\s\S]*?await removeCraft\(merged\)/);
  assert.match(script, /craftsCount\.textContent = savedT\("savedCount"/);

  assert.match(locale, /savedCrafts: "收藏"/);
  assert.match(locale, /savedCraftsTitle: "收藏"/);
  assert.match(locale, /savedCraftsSubtitle: "画布与组件"/);
  assert.match(locale, /savedGridView: "网格视图"/);
  assert.match(locale, /browseEchoes: "浏览公开分享"/);
  assert.match(locale, /savedCount: "\{count\} 个收藏"/);
  assert.match(locale, /savedSourceSynced: "云端 \+ 本机"/);
  assert.match(locale, /savedRemoveConfirmTitle: "从收藏中移除？"/);
  assert.match(locale, /savedRemoveConfirmDescription: "“\{name\}”将不再出现在收藏中。"/);
  assert.match(locale, /savedLoading: "正在加载收藏…"/);
  assert.match(locale, /savedRefreshing: "正在刷新…"/);
  assert.match(locale, /savedSearchLabel: "搜索收藏"/);
  assert.match(locale, /savedNoMatches: "没有匹配的收藏。"/);

  const craftsCss = css.slice(css.indexOf("/* Favorite Crafts picker"), css.indexOf("/* Harness-backed PenEcho Agent"));
  assert.notEqual(craftsCss, "");
  assert.doesNotMatch(craftsCss, /Favorites keeps its original title \+ tabs \+ list structure/);
  const modalRule = craftsCss.match(/\.crafts-modal\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(modalRule, /width:\s*min\(960px,\s*100%\)/);
  assert.match(modalRule, /height:\s*min\(680px,\s*calc\(100dvh - 48px\)\)/);
  assert.match(modalRule, /grid-template-columns:\s*228px minmax\(0,\s*1fr\)/);
  assert.match(modalRule, /background:\s*var\(--penecho-large-dialog-surface\)/);
  assert.match(modalRule, /box-shadow:\s*var\(--penecho-large-dialog-shadow\)/);
  assert.match(modalRule, /backdrop-filter:\s*var\(--penecho-large-dialog-surface-filter\)/);
  assert.match(craftsCss, /\.crafts-sidebar\s*\{[^}]*border-right:\s*1px solid/);
  assert.match(craftsCss, /\.crafts-sidebar\s*\{[^}]*background:\s*var\(--penecho-workbench-navigation-surface\)[^}]*backdrop-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(craftsCss, /\.crafts-workspace\s*\{[^}]*grid-template-rows:\s*50px minmax\(0,\s*1fr\)/);
  assert.match(craftsCss, /\.crafts-workspace\s*\{[^}]*background:\s*var\(--penecho-workbench-content-surface\)/);
  assert.match(craftsCss, /\.crafts-head\s*\{[^}]*background:\s*var\(--penecho-workbench-navigation-surface\)[^}]*backdrop-filter:\s*var\(--penecho-workbench-navigation-filter\)/);
  assert.match(craftsCss, /\.crafts-search\s*\{[^}]*height:\s*30px[^}]*border-radius:\s*5px/);
  assert.match(craftsCss, /\.crafts-head-actions\s*\{[^}]*min-width:\s*0[^}]*flex:\s*0 1 384px/);
  assert.match(craftsCss, /\.crafts-search input\[data-pe-control="input"\]\s*\{[^}]*height:\s*28px[^}]*border:\s*0/);
  assert.match(craftsCss, /\.crafts-nav-item\s*\{[^}]*min-height:\s*34px[^}]*color:\s*var\(--pe-ink, var\(--ink\)\)[^}]*font-weight:\s*500/);
  assert.match(craftsCss, /\.crafts-nav-item:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold-bright\)/);
  assert.match(craftsCss, /\.crafts-view-switch\s*\{[^}]*height:\s*32px/);
  assert.match(craftsCss, /\.crafts-view-option\s*\{[^}]*width:\s*27px[^}]*height:\s*26px/);
  assert.match(craftsCss, /\.crafts-view-option\.active\s*\{[^}]*color:\s*var\(--gold-bright\)/);
  assert.match(craftsCss, /\.crafts-modal \.cloud-dialog-close\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\)\s*\{[^}]*grid-auto-rows:\s*max-content[^}]*gap:\s*0[^}]*padding:\s*0[^}]*background:\s*var\(--panel-raised\)/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\) \.crafts-row\s*\{[^}]*grid-template-areas:\s*"preview copy actions"\s*"preview meta actions"[^}]*grid-template-columns:\s*96px minmax\(0,\s*1fr\) auto[^}]*min-height:\s*80px[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\) \.crafts-row:last-child\s*\{[^}]*border-bottom:\s*0/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\) \.crafts-thumb-wrap\s*\{[^}]*width:\s*96px[^}]*height:\s*64px[^}]*border-radius:\s*6px/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\) \.crafts-footer\s*\{[^}]*display:\s*contents/);
  assert.match(craftsCss, /\.crafts-list:not\(\.is-grid\) \.crafts-actions\s*\{[^}]*grid-area:\s*actions[^}]*align-self:\s*center[^}]*justify-self:\s*end/);
  assert.doesNotMatch(craftsCss, /\.crafts-kind-badge\s*\{[^}]*position:\s*absolute/);
  assert.match(craftsCss, /\.crafts-kind-badge, \.crafts-source\s*\{[^}]*min-height:\s*20px[^}]*border-radius:\s*5px[^}]*font-size:\s*11\.5px[^}]*font-weight:\s*400/);
  assert.match(craftsCss, /\.crafts-add, \.crafts-open\s*\{[^}]*height:\s*28px[^}]*border-radius:\s*5px[^}]*background:\s*transparent[^}]*font-weight:\s*400/);
  assert.match(craftsCss, /\.crafts-remove::before\s*\{[^}]*mask:/s);
  assert.match(craftsCss, /\.crafts-remove::before\s*\{[^}]*M6%206l12%2012M18%206%206%2018/s);
  assert.match(script, /remove\.dataset\.peButton = "toolbar";[\s\S]*?remove\.textContent = "";/);
  assert.doesNotMatch(script, /remove\.textContent = "×";/);
  assert.match(craftsCss, /\.crafts-list\.is-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(216px,\s*1fr\)\)[^}]*grid-auto-rows:\s*max-content/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-row\s*\{[^}]*grid-template-areas:\s*"preview" "title" "footer"[^}]*grid-template-rows:\s*auto 18px auto/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-card-title\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-copy small\s*\{[^}]*display:\s*none/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto[^}]*align-items:\s*center[^}]*gap:\s*6px/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-meta\s*\{[^}]*flex-wrap:\s*nowrap[^}]*gap:\s*4px[^}]*overflow:\s*hidden/);
  assert.match(craftsCss, /:is\(#pe-type-contract, \.crafts-list\.is-grid\) :is\(\.crafts-kind-badge, \.crafts-source\)\s*\{[^}]*padding-inline:\s*4px[^}]*font-size:\s*10\.5px/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-source\s*\{[^}]*min-width:\s*0[^}]*flex:\s*0 1 auto/);
  assert.match(craftsCss, /\.crafts-list\.is-grid \.crafts-actions\s*\{[^}]*justify-self:\s*end[^}]*gap:\s*4px/);
  assert.match(craftsCss, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.crafts-sidebar\s*\{[^}]*grid-template-areas:\s*"brand echoes" "filters filters"/);
  assert.match(craftsCss, /@media \(max-width: 760px\)\s*\{[\s\S]*?:is\(#pe-button-contract, \.crafts-modal\) \.crafts-nav-item\s*\{[^}]*display:\s*flex[^}]*flex:\s*1 1 0[^}]*line-height:\s*30px/);
  assert.match(craftsCss, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.crafts-list:not\(\.is-grid\) \.crafts-row\s*\{[^}]*grid-template-columns:\s*80px minmax\(0,\s*1fr\) auto[^}]*column-gap:\s*10px[^}]*row-gap:\s*4px/);
  assert.match(craftsCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.crafts-refresh-spinner\s*\{[^}]*animation:\s*none/);
  assert.match(css, /:is\(#pe-type-contract, \.crafts-modal, \.crafts-remove-dialog\) :where\(\*\)\s*\{\s*font-weight:\s*400;/);
  assert.match(css, /:is\(#pe-type-contract, \.crafts-modal\) :is\([\s\S]*?\.crafts-nav-item > span,[\s\S]*?\.crafts-echoes-link > span[\s\S]*?\)\s*\{\s*font-weight:\s*500;/);

  const bilingualKeys = [
    "savedCrafts", "savedCraftsTitle", "savedCraftsSubtitle", "savedType", "savedSearch", "savedSearchLabel", "savedView", "savedListView", "savedGridView", "browseEchoes", "savedCount", "savedLoading", "savedRefreshing", "savedNoMatches", "savedEmptyIn", "savedEmptyOut",
    "savedAdd", "savedAdding", "savedOpen", "savedOpening", "savedCanvas", "savedWidget", "savedRemoveTitle", "savedRemoveConfirmTitle", "savedRemoveConfirmDescription", "savedRemoveAction", "savedSourceLocal", "savedSourceCloud", "savedSourceCommunity",
    "savedSourceSynced", "savedSourceSyncedTitle", "savedSourceLocalTitle", "savedSourceCloudTitle", "savedErrorAdd", "savedErrorOpen", "savedErrorToggle",
    "closeSavedCrafts", "shareCanvasCloud", "shareWidget", "snapshotCloudSignInRequired", "snapshotCloudSignInHint",
    "openPenEchoCloud", "openPenEchoCloudExternal", "opensInNewTab", "openCloudCanvasUnsaved", "openInNewPage",
    "openCanvas", "addToCanvas", "favorites", "all", "canvases", "widgets", "favoriteCanvases", "favoriteWidgets", "projects", "explore",
  ];
  for (const key of bilingualKeys) {
    assert.match(app, new RegExp(`\\b${key}:`), `English locale is missing ${key}`);
    assert.match(locale, new RegExp(`\\b${key}:`), `Chinese locale is missing ${key}`);
  }
  assert.match(app, /const t = \(key\) => I18N\[state\.language\]\?\.\[key\] \|\| I18N\.en\[key\] \|\| key;/);
  assert.match(app, /window\.PenEchoI18n = Object\.freeze\(\{[\s\S]*?\bt,[\s\S]*?currentLanguage:\(\) => state\.language/);
});

test("personal favorite synchronization is local-to-Cloud only", () => {
  const script = read("public/cloud-connect.js");
  const synchronization = script.slice(script.indexOf("async function syncLocalFavorites"), script.indexOf("const FAVORITE_PAGE_SIZE"));
  assert.match(synchronization, /localFavorites\(\)/);
  assert.match(synchronization, /method:"POST"/);
  assert.doesNotMatch(synchronization, /fullCloudFavorite|saveLocalFavorite\(\{ name:fullEntry|removeLocalFavorite/);
  assert.doesNotMatch(script, /favoriteTombstones|rememberFavoriteTombstone/);
  assert.match(script, /if \(source\.entry\.cloudId\)[\s\S]*?method:"DELETE"/, "removing a local favorite also removes its associated private Cloud copy");
});
