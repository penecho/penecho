"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Cloud Center exposes concise Projects, Favorites, and Echoes navigation", () => {
  const html = read("public/index.html"), cloud = read("public/cloud-connect.js"), css = read("public/cloud-connect.css"), main = read("src/server/main.js");
  assert.match(html, /id="settingsBtn"/);
  assert.match(html, /id="cloudAccountBtn"/);
  assert.match(html, /id="shareCanvasBtn"/);

  assert.match(cloud, /function cloudT\(key, replacements = \{\}\)/);
  assert.match(cloud, /const definitions = \[\s*\["projects", "cloudProjects"\],\s*\["favorites", "favorites"\],\s*\]/);
  assert.match(cloud, /if \(state\.cloudSection === "favorites"\) return cloudFavoritesPanel\(setRefreshing\)/);
  assert.match(cloud, /\["all", "all"\],\s*\["canvas", "canvases"\],\s*\["widget", "widgets"\]/);
  assert.match(cloud, /class:"cloud-section-tab cloud-explore-link",\s*href:new URL\("\/community\.html", `\$\{cloudOrigin\(\)\}\/`\)\.toString\(\),\s*target:"_blank",\s*rel:"noopener"/);
  assert.match(cloud, /text:`\$\{cloudT\("explore"\)\} ↗`/);
  assert.match(cloud, /text:cloudT\(label\)/);
  assert.doesNotMatch(cloud, /text:cloudT\(hint\)/);
  assert.doesNotMatch(cloud, /class:"cloud-panel-heading"[^\n]*cloudT\("cloudProjects"\)/);
  assert.match(cloud, /class:"cloud-favorites-hint", text:cloudT\("favoritesHint"\)/);
  assert.doesNotMatch(cloud, /el\("h3", \{ text:cloudT\("favorites"\) \}\)/);
  assert.match(cloud, /favoriteCanvasesHint:"收藏中的公开画布"/);
  assert.doesNotMatch(cloud, /favoriteCanvasesHint:"Favorites 中/);
  assert.match(css, /\.cloud-section-tabs \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.cloud-favorite-filters/);
  assert.match(css, /\.cloud-workspace > \.penecho-cloud-panel \{[^}]*background: transparent[^}]*border: 0[^}]*padding: 0/);

  assert.match(cloud, /localHostControlsAvailable = window\.PENECHO_CONFIG\?\.runtime !== "cloud"/);
  assert.match(cloud, /layout\.classList\.toggle\("remote-cloud-runtime", !localHostControlsAvailable\)/);
  assert.match(cloud, /cloud-local-controls/);
  assert.match(css, /\.penecho-cloud-layout\.remote-cloud-runtime/);
  assert.match(cloud, /x-penecho-session/);
  assert.match(cloud, /\/api\/cloud\/library/);
  assert.match(cloud, /\/api\/cloud\/community\?scope=favorites&kind=canvas&sort=newest&limit=60/);
  assert.match(cloud, /\/api\/cloud\/favorites/);
  assert.match(cloud, /openProjectCanvasHere\(canvas\.id, panel, row\)/);
  assert.match(cloud, /await bridge\.openCanvas\(canvasId\)/);
  assert.match(cloud, /text:cloudT\("openCanvasHere"\)/);
  assert.match(cloud, /text:cloudT\("addToCanvas"\)/);
  assert.doesNotMatch(cloud, /openCanvasInNewPage|\/canvas\/community\//);
  assert.match(cloud, /window\.PenEchoCloudProjects/);
  assert.match(cloud, /penecho-cloud-center-project/);
  assert.match(cloud, /class:"cloud-project-picker"/);
  assert.match(cloud, /text:cloudT\("newProject"\)/);
  assert.match(cloud, /text:cloudT\("saveCurrentHere"\)/);
  assert.match(cloud, /projects\.find\(\(project\) => project\.id === state\.selectedProjectId\)/);
  assert.match(cloud, /base-revision-required/);

  for (const key of ["cloudSubtitle", "signOutHost", "removeThisLink", "autoFillCurrentAi", "shareNote", "publishedDialogTitle", "shareAsLink", "shareAsImage"]) {
    assert.match(cloud, new RegExp(`cloudT\\("${key}"`));
  }
  assert.match(cloud, /PUBLICATION_TERMS_VERSION = "2026-08-12"/);
  assert.match(cloud, /continuationPrompt/);
  assert.match(cloud, /contributionNote/);
  assert.match(cloud, /parentItemId/);
  assert.match(cloud, /window\.PenEchoCommunityUI/);
  assert.doesNotMatch(cloud, /priceCredits|Credit price|field\("Pricing"|price_low|price_high|Free \+ paid|Paid with credits/);

  assert.match(cloud, /startBrowserSignInWatch/);
  assert.match(cloud, /window\.open\("about:blank"/);
  assert.match(cloud, /popup\.location\.replace\(started\.authorizationUrl\)/);
  assert.match(cloud, /window\.open\(started\.authorizationUrl, "_blank", "noopener"\)/);
  assert.match(cloud, /externalOpened:desktopApp/);
  assert.match(cloud, /cloudT\("openSignIn"\)/);
  assert.match(cloud, /document\.visibilityState === "visible"/);
  assert.match(cloud, /visibilitychange/);
  assert.match(cloud, /event\.origin !== location\.origin/);
  assert.doesNotMatch(cloud, /startCloudStatusWatch|CLOUD_STATUS_POLL_MS|cloudStatusPoll/);
  assert.match(cloud, /cloud-section-refresh-indicator/);
  assert.doesNotMatch(cloud, /refreshCurrentView/);
  assert.match(cloud, /Boolean\(state\.status\?\.device\?\.connected\)/);
  assert.match(cloud, /if \(previouslySignedIn !== accountSignedIn\(\)\)/);
  assert.match(main, /desktopApp:process\.env\.PENECHO_DESKTOP_APP==="true"/);
  assert.match(css, /\.cloud-section-tabs \{[^}]*height: 2\.25rem/);
  assert.match(css, /\.cloud-section-tab \{[^}]*height: 1\.875rem[^}]*min-height: 1\.875rem/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.cloud-section-tab[\s\S]*?min-height: 2\.75rem/);
  assert.match(css, /\.cloud-project-card/);
  assert.match(css, /\.cloud-project-create-form/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(html, /data-i18n="sharePluginComing"/);
  assert.doesNotMatch(html, /points-priced|Share for points|earn points/);
});

test("local sign-in callback always closes its script-opened page after notifying an available opener", () => {
  const main = read("src/server/main.js");
  assert.match(main, /Sign-in complete\. You can return to PenEcho and close this page\./);
  assert.match(main, /if\(window\.opener&&!window\.opener\.closed\)window\.opener\.postMessage/);
  assert.match(main, /const closePage=\(\)=>\{try\{window\.close\(\)\}catch\{\}\};closePage\(\);setTimeout\(closePage,120\);setTimeout\(closePage,700\)/);
  assert.doesNotMatch(main, /window\.location\.replace\("\/"\)/);
});

test("Cloud sign-in selects Electron only from the renderer bridge", () => {
  const cloud = read("public/cloud-connect.js");
  assert.match(cloud, /Boolean\(window\.penechoDesktop\)/);
  assert.doesNotMatch(cloud, /PENECHO_CONFIG\?\.desktopApp/);
});

test("community artifacts have bounded WebP previews and import both Widgets and Canvases locally", () => {
  const app = read("public/app.js"), main = read("src/server/main.js");
  assert.match(app, /maximumBytes:4\*1024\*1024/);
  assert.match(app, /maximumBytes:768\*1024/);
  assert.match(app, /snapshotPreview\(2048,1365\)/);
  assert.match(app, /communityImagesForCanvas\(canvas, \.82\)/);
  assert.match(app, /communityThumbnail/);
  assert.match(app, /communitySocialCard:\{contentType:"image\/png",width:socialWidth,height:socialHeight/);
  assert.match(app, /suggestMetadata:suggestCommunityMetadata/);
  assert.match(app, /async function importCommunityCanvasArtifact/);
  assert.match(app, /importCanvas:importCommunityCanvasArtifact/);
  assert.match(app, /communityOriginItemId/);
  assert.match(app, /penechoCommunity/);
  assert.match(app, /lineageForArtifact:communityLineageForArtifact/);
  assert.match(app, /markPublishedOrigin:markPublishedCommunityOrigin/);
  assert.match(app, /communityOriginGeneration/);
  assert.match(app, /persistCurrentCanvasCommunityOrigin/);
  assert.match(main, /PENECHO_CLOUD_ENV/);
  assert.match(main, /PENECHO_CLOUD_ORIGIN/);
  assert.match(main, /https:\/\/internaltest\.penecho\.ai/);
  assert.match(main, /https:\/\/penecho\.ai/);
  assert.match(app, /Free community plugins/);
  assert.doesNotMatch(app, /points-priced|Share for points|earn points/);
});
