"use strict";
const nerdamer = require("nerdamer/all.js");
const PptxGenJS = require("pptxgenjs");

// This input contract deliberately stays within small classroom expressions.
// Heavy symbolic work is additionally isolated in a terminable browser worker.
function expression(value) {
  const input=String(value).trim().replace(/^y\s*=\s*/, "");
  if(!input || input.length>160 || !/^[\w\s.+*/^(),=\-]+$/.test(input))throw Error("Use a short expression in x, a, b, c (for example a*sin(x)+b)");
  const allowed=new Set(["x","a","b","c","pi","e","sin","cos","tan","asin","acos","atan","sqrt","abs","log","exp"]);
  for(const word of input.match(/[A-Za-z_]\w*/g)||[])if(!allowed.has(word))throw Error("Unsupported name: "+word);
  if((input.match(/\^/g)||[]).length>5 || (input.match(/\(/g)||[]).length>12 || (input.match(/\d+(?:\.\d+)?/g)||[]).some(n=>Number(n)>1000))throw Error("Expression is too complex for the local demo");
  if((input.match(/\^\s*\(?\s*[+-]?\d+(?:\.\d+)?/g)||[]).some(power=>Math.abs(Number(power.replace(/[^\d.+-]/g,"")))>12))throw Error("Use powers between -12 and 12 in the local demo");
  return input;
}
function calculate(input, action, parameters={a:1,b:0,c:0}) {
  const source=expression(input);
  if(action==="solve")return nerdamer.solveEquations(source,"x").map(String).join(", ")||"No roots returned";
  if(source.includes("="))throw Error("Use an expression without = for this operation");
  if(action==="derivative")return nerdamer.diff(source,"x").toString();
  if(action==="integral")return nerdamer.integrate(source,"x").toString()+" + C";
  if(action==="simplify")return nerdamer(source).expand().toString();
  return nerdamer(source,parameters).evaluate().text();
}
function compile(input,parameters) {
  const source=expression(input);if(source.includes("="))throw Error("Use y = f(x) or f(x) for a plot");
  const fn=nerdamer(source,parameters).buildFunction(["x"]);
  return x=>{try{const y=fn(x);return typeof y==="number"&&Number.isFinite(y)?y:NaN;}catch{return NaN;}};
}
function dataset(text) {
  const lines=String(text).trim().split(/\r?\n/);if(lines.length>50)throw Error("Use at most 50 rows");
  return lines.filter(Boolean).map((line,index)=>{const parts=line.trim().split(/[,\t]/);if(parts.length!==2||!parts[0].trim()||!parts[1].trim()||!Number.isFinite(Number(parts[1])))throw Error("Expected label,value on row "+(index+1));return {label:parts[0].trim().slice(0,40),value:Number(parts[1])};});
}
const api={nerdamer,PptxGenJS,expression,calculate,compile,dataset};
if(typeof globalThis!=="undefined")globalThis.PENECHO_INK_TOOLS=api;
module.exports=api;
