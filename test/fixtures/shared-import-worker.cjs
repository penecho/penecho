"use strict";
const { Service } = require("../../src/server/project-lines/service.js");
const fs = require("node:fs");
const agents = { available:() => [], list:() => [], get:() => null, has:() => false, defaultId:() => "" };
process.once("message", async ({ docs, directory, home, action = "import", count = 1 }) => {
  try {
    fs.mkdirSync(directory, { recursive:true });
    const s = new Service({ directory, agents, autoWatch:false, conversations:{ home } });
    const p = s.store.importFolder({ docsPath:docs }); p.followSince = 1;
    process.send({ ready:true });
    process.once("message", async () => {
      try {
        if (action === "ids") {
          const ids = Array.from({ length:count }, () => s.store.nextId(p));
          s.close(); process.send({ ids });
        } else {
          await s.conversations.tick();
          await new Promise(resolve => setTimeout(resolve, 30));
          await s.conversations.tick();
          s.close(); process.send({ done:true });
        }
        process.disconnect();
      } catch (e) { process.send({ error:e.stack }); process.disconnect(); }
    });
  } catch (e) { process.send({ error:e.stack }); process.disconnect(); }
});
