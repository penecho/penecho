"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context=vm.createContext({URL});
vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/client/app/mcp-troubleshoot.js"),"utf8"),context);
const {mcpTroubleshootPrompt:prompt}=context;
test("clipboard prompt names only the PenEcho inbound TCP ports",()=>{
  const text=prompt();
  assert.equal(text,"On the computer running PenEcho, allow inbound TCP connections on ports 3922, 13922, and 23922.");
  assert.equal(prompt({http:{localUrl:"https://stale:1234/mcp"},accessToken:"SECRET"}),text);
  assert.match(text,/3922/);assert.match(text,/13922/);assert.match(text,/23922/);
  assert.doesNotMatch(text,/PowerShell|repair command|firewall rule|SECRET|1234/);
  assert.equal(typeof context.mcpWindowsFirewallCommand,"undefined");
});
