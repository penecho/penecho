"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("toolbar ships a mixed Canvas and Widget Favorites picker", () => {
  const page = read("public/index.html"), app = read("src/client/app/core.js"), script = read("public/cloud-connect.js"), locale = read("public/locales/zh.js"), css = read("public/style.css");

  assert.match(page, /id="craftsButton"[^>]*aria-controls="craftsPopover"/);
  assert.match(page, /id="craftsButton"[^>]*data-i18n-aria="savedCrafts"/);
  assert.match(page, /id="craftsPopover"[^>]*hidden/);
  assert.match(page, /id="craftsList"/);
  assert.match(page, /id="craftsRefreshStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(page, /id="craftsFilters"[^>]*role="tablist"/);
  assert.match(page, /id="craftsFilterAll"[^>]*role="tab"[^>]*aria-selected="true"[^>]*data-i18n="all"/);
  assert.match(page, /id="craftsFilterWidgets"[^>]*role="tab"[^>]*data-i18n="widgets"/);
  assert.match(page, /id="craftsFilterCanvases"[^>]*role="tab"[^>]*data-i18n="canvases"/);
  assert.doesNotMatch(page, /savedCraftsHint|Your favorite Widgets|Select Add to place one on this Canvas/);
  assert.match(page, /id="craftsClose"[^>]*data-i18n-aria="closeSavedCrafts"[^>]*data-i18n-title="closeSavedCrafts"/);
  assert.match(page, /class="crafts-empty"[^>]*data-i18n="savedLoading"/);
  assert.match(page, /id="shareCanvasBtn"[^>]*data-i18n-aria="shareCanvasCloud"[^>]*data-i18n-title="shareCanvasCloud"/);

  assert.match(script, /const FAVORITE_PAGE_SIZE = 20/);
  assert.match(script, /\/api\/cloud\/favorites\/feed\?/);
  assert.match(script, /cursor/);
  assert.match(script, /\/api\/cloud\/community\/\$\{encodeURIComponent\(itemId\)\}\/thumbnail/);
  assert.match(script, /remoteThumbnail\.match\(\/\^\\\/api\\\/v1\\\/community\\\/items/);
  assert.match(script, /thumbnailDataUrl\(source, community\?\.id \|\| null\)/);
  assert.match(script, /return takeFurther\(cloudEntry\.id\)/);
  assert.match(script, /function toggleWidgetFavorite/);
  assert.match(script, /function syncLocalFavorites/);
  assert.match(script, /scheduleLocalFavoriteSync/);
  assert.match(script, /crafts-source/);
  assert.match(script, /No favorite Canvases or Widgets yet/);
  assert.match(script, /Sign in to see Cloud favorites/);
  assert.match(script, /function activateFavoriteCraft/);
  assert.match(script, /merged\.kind !== "canvas"/);
  assert.match(script, /return takeFurther\(community\.id\)/);
  assert.match(script, /setCraftsOpen\(false\)/);
  assert.match(script, /craftsButton\?\.addEventListener\("click", openCrafts\)/);
  assert.match(script, /let craftsPager = null/);
  assert.match(script, /let craftsRefreshGeneration = 0/);
  assert.match(script, /loadFavoritePager\(craftsPager/);
  assert.match(script, /generation !== craftsRefreshGeneration/);
  assert.match(script, /let selectedCraftKind = "all"/);
  assert.match(script, /function filteredFavoriteCrafts/);
  assert.match(script, /function favoriteCraftTime/);
  assert.match(script, /favoriteCraftTime\(b\) - favoriteCraftTime\(a\)/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);

  assert.match(locale, /savedCrafts: "收藏"/);
  assert.match(locale, /savedCraftsTitle: "收藏"/);
  assert.match(locale, /savedSourceSynced: "云端 \+ 本机"/);
  assert.match(locale, /savedLoading: "正在加载收藏…"/);
  assert.match(locale, /savedRefreshing: "正在刷新…"/);
  assert.match(locale, /shareWidget: "分享组件"/);
  assert.match(locale, /snapshotCloudSignInRequired: "登录后查看云端画布"/);
  assert.match(css, /\.crafts-row/);
  assert.doesNotMatch(page, /id="craftsButton"[^>]*>[\s\S]*?<span data-i18n="savedCrafts">/);
  assert.match(script, /function savedT|const savedT/);
  assert.match(script, /isCanvas \? "savedOpen" : "savedAdd"/);
  assert.match(script, /savedT\("savedSourceLocal"/);
  assert.match(css, /\.crafts-modal/);
  assert.match(css, /\.crafts-modal\s*\{[^}]*color-scheme:\s*light[^}]*--ink:\s*#1c1f27[^}]*--panel-raised:\s*#ffffff[^}]*--gold-bright:\s*#4338ca[^}]*background:\s*#ffffff/s);
  assert.match(css, /\.crafts-modal \.cloud-dialog-close\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*color:\s*var\(--muted\)/s);
  assert.match(css, /\.crafts-modal \.cloud-dialog-close:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold-bright\)/s);
  assert.match(css, /\.crafts-refresh-spinner\s*\{[^}]*animation:\s*crafts-refresh-spin/);
  assert.match(css, /\.crafts-filter-tab\s*\{[^}]*height:\s*28px/);
  assert.match(css, /\.crafts-filter-tab:focus-visible/);

  const bilingualKeys = [
    "savedCrafts", "savedCraftsTitle", "savedLoading", "savedRefreshing", "savedEmptyIn", "savedEmptyOut",
    "savedAdd", "savedAdding", "savedOpen", "savedOpening", "savedCanvas", "savedWidget", "savedRemoveTitle", "savedSourceLocal", "savedSourceCloud", "savedSourceCommunity",
    "savedSourceSynced", "savedSourceLocalTitle", "savedSourceCloudTitle", "savedErrorAdd", "savedErrorOpen", "savedErrorToggle",
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
  assert.match(app, /new CustomEvent\("penecho:languagechange", \{ detail:\{ language:state\.language \} \}\)/);
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
