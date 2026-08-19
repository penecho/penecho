"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("toolbar ships a Favorite Crafts picker wired to community favorites", () => {
  const page = read("public/index.html"), app = read("src/client/app/core.js"), script = read("public/cloud-connect.js"), locale = read("public/locales/zh.js"), css = read("public/style.css");

  assert.match(page, /id="craftsButton"[^>]*aria-controls="craftsPopover"/);
  assert.match(page, /id="craftsButton"[^>]*data-i18n-aria="savedCrafts"/);
  assert.match(page, /id="craftsPopover"[^>]*hidden/);
  assert.match(page, /id="craftsList"/);
  assert.match(page, /id="craftsClose"[^>]*data-i18n-aria="closeSavedCrafts"[^>]*data-i18n-title="closeSavedCrafts"/);
  assert.match(page, /class="crafts-empty"[^>]*data-i18n="savedLoading"/);
  assert.match(page, /id="shareCanvasBtn"[^>]*data-i18n-aria="shareCanvasCloud"[^>]*data-i18n-title="shareCanvasCloud"/);

  assert.match(script, /scope=favorites&kind=widget&sort=newest&limit=60/);
  assert.match(script, /\/api\/cloud\/community\/\$\{encodeURIComponent\(source\.id\)\}\/thumbnail/);
  assert.match(script, /return takeFurther\(cloudEntry\.id\)/);
  assert.match(script, /function toggleWidgetFavorite/);
  assert.match(script, /function syncFavorites/);
  assert.match(script, /sourceItemId:entry\.sourceItemId/);
  assert.match(script, /crafts-source/);
  assert.match(script, /No favorite Widgets yet/);
  assert.match(script, /favorites stay on this device until you sign in/);
  assert.match(script, /setCraftsOpen\(false\)/);
  assert.match(script, /craftsButton\?\.addEventListener\("click", openCrafts\)/);

  assert.match(locale, /savedCrafts: "收藏"/);
  assert.match(locale, /savedCraftsTitle: "收藏的组件"/);
  assert.match(locale, /savedSourceSynced: "云端 \+ 本机"/);
  assert.match(locale, /savedLoading: "正在加载收藏…"/);
  assert.match(locale, /shareWidget: "分享组件"/);
  assert.match(locale, /snapshotCloudSignInRequired: "请先登录 PenEcho Cloud"/);
  assert.match(css, /\.crafts-row/);
  assert.doesNotMatch(page, /id="craftsButton"[^>]*>[\s\S]*?<span data-i18n="savedCrafts">/);
  assert.match(script, /function savedT|const savedT/);
  assert.match(script, /savedT\("savedAdd"/);
  assert.match(script, /savedT\("savedSourceLocal"/);
  assert.match(css, /\.crafts-modal/);

  const bilingualKeys = [
    "savedCrafts", "savedCraftsTitle", "savedCraftsHint", "savedLoading", "savedEmptyIn", "savedEmptyOut",
    "savedAdd", "savedAdding", "savedRemoveTitle", "savedSourceLocal", "savedSourceCloud", "savedSourceCommunity",
    "savedSourceSynced", "savedSourceLocalTitle", "savedSourceCloudTitle", "savedErrorAdd", "savedErrorToggle",
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

test("favorite deletes leave a tombstone so offline removals never resurrect", () => {
  // Deleting a favorite while the cloud DELETE cannot land must not be undone
  // by the next sync mirroring the surviving cloud copy back down.
  const script = read("public/cloud-connect.js");
  assert.match(script, /rememberFavoriteTombstone\(sha256\);\s*\n\s*if \(accountSignedIn\(\) && existing\.cloudId\)/);
  assert.match(script, /if \(source\.type === "local"\) \{ await removeLocalFavorite\(source\.entry\.artifactSha256\); rememberFavoriteTombstone/);
  assert.match(script, /const tombstones = favoriteTombstones\(\);/);
  assert.match(script, /tombstones\[cloudEntry\.artifactSha256\]/);
  assert.match(script, /clearFavoriteTombstone\(cloudEntry\.artifactSha256\)/);
  assert.match(script, /Number\(cloudEntry\.createdAt\) > tombstonedAt/, "a cloud copy newer than the tombstone is a fresh favorite, not a resurrection");
});
