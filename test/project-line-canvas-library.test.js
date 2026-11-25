const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Bring in from the Library: one Canvas that cannot come in is named, and Bring in all goes on to the rest.
test("Bring in all names a Canvas it cannot bring in and still brings in the others", async () => {
  const { document } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  const dialogProto = Object.getPrototypeOf(document.createElement("dialog"));
  dialogProto.showModal = function () { this.open = true; };
  dialogProto.close = function () { this.open = false; };
  const library = [{ from:"cloud:a", title:"First" }, { from:"cloud:old", title:"Untitled canvasasdf" }, { from:"cloud:c", title:"Third" }];
  const sent = [];
  const c = vm.createContext({
    document, S:{ projects:[], cur:"my" }, ACT:{}, setTimeout,
    $:(selector, root = document) => root.querySelector(selector), $$:(selector, root = document) => [...root.querySelectorAll(selector)],
    project:() => ({ id:"my", myCanvases:true }), pathFor:id => `/projects/${id}`, esc:String, ic:() => "",
    api:async (url, init = {}) => {
      if (url === "/library") return { canvases:library };
      sent.push(init.body.from);
      if (init.body.from === "cloud:old") throw Object.assign(new Error("That is not a Canvas PenEcho can keep."), { status:400 });
      return { source:`files/${init.body.from}/canvas.penecho.json` };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/canvases.js"), "utf8"), c, { filename:"canvases.js" });
  await c.ACT["canvas-library"](null);
  await new Promise(resolve => setImmediate(resolve));
  const dialog = document.querySelector("dialog.cv-library"), all = dialog.querySelector("[data-all]");
  assert.equal(all.hidden, false);
  await all.onclick();
  assert.deepEqual(sent, ["cloud:a", "cloud:old", "cloud:c"]);
  const rows = [...dialog.querySelectorAll(".cv-lib-row")].map(row => [row.dataset.from, row.classList.contains("done"), row.classList.contains("failed")]);
  assert.deepEqual(rows, [["cloud:a", true, false], ["cloud:old", false, true], ["cloud:c", true, false]]);
  assert.equal(dialog.querySelector(".command-error").textContent, "Untitled canvasasdf: That is not a Canvas PenEcho can keep.");
  assert.equal(all.hidden, true, "nothing left that Bring in all could bring in");
});
