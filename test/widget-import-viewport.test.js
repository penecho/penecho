"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/client/app/canvas-runtime.js"), "utf8");
const importer = source.slice(source.indexOf("  async function importCommunityWidgetArtifact("), source.indexOf("  function widgetHostUrl("));

for (const visible of [null, {x:200,y:400,w:1000,h:800}]) {
  test(`Community and Favorites imports preserve content with ${visible ? "a visible" : "an off-canvas"} viewport`, async () => {
    for (const favoriteState of [null, {selected:true,sourceWidgetId:"12345678-1234-1234-1234-123456789abc"}]) {
      const existing = {id:"widget-1",html:"original"};
      const state = {widgets:[existing],userRevision:2,autoEligible:true};
      let saves = 0;
      const context = vm.createContext({
        state, SIZE:20000, viewportRect:()=>visible, window:{},
        PRIVATE_WIDGET_FAVORITE_ID:/^[0-9a-f-]{36}$/i,
        enableSnapshotWidgetPlugins:async()=>{},
        widgetRecord:item=>({...item,id:"widget-2"}), recordWidgetsBefore(){},
        pluginEnabled:()=>false,saveUserCanvasChange(){saves++;},requestRender(){},
      });
      const artifact = {format:"penecho-widget",formatVersion:1,widget:{id:"widget-1",title:"Imported",w:400,h:300,html:"<p>content</p>",favorite:true}};
      const original = JSON.stringify(artifact);
      const result = await vm.runInContext(`(${importer})`, context)(artifact,null,{favoriteState});
      const imported = state.widgets[1];
      assert.equal(result.id,"widget-2");
      assert.equal(state.widgets.length,2);
      assert.strictEqual(state.widgets[0],existing);
      assert.equal(existing.html,"original");
      assert.equal(JSON.stringify(artifact),original);
      assert.equal(imported.html,artifact.widget.html);
      assert.equal(imported.w,400);
      assert.equal(imported.h,300);
      assert.equal(imported.x,visible ? 500 : 9800);
      assert.equal(imported.y,visible ? 650 : 9850);
      assert.equal(imported.favorite,favoriteState ? true : undefined);
      assert.equal(imported.favoriteSourceId,favoriteState?.sourceWidgetId);
      assert.equal(state.userRevision,3);
      assert.equal(saves,1);
    }
  });
}
