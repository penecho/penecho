#!/usr/bin/env node
'use strict';
// Reproducible estimate, NOT a provider-tokenizer measurement. No credentials,
// live model calls or optional tokenizer downloads are needed.
const {TOOLS,COMMON_TOOL_NAMES}=require('../src/server/mcp/schema.js');
const {INSTRUCTIONS}=require('../src/server/mcp/stdio.js');
const estimate=value=>Math.ceil((typeof value==='string'?value:JSON.stringify(value)).length/4);
const common=TOOLS.filter(tool=>COMMON_TOOL_NAMES.includes(tool.name));
const report={method:'ceil(serialized UTF-16 characters / 4); estimate only',tools:TOOLS.length,commonTools:common.length,publicInstructions:{estimatedTokens:estimate(INSTRUCTIONS),target:250},allTools:{estimatedTokens:estimate(TOOLS),target:6000},commonSchema:{estimatedTokens:estimate(common),target:3000},perTool:TOOLS.map(tool=>({name:tool.name,estimatedTokens:estimate(tool)}))};
console.log(JSON.stringify(report,null,2));
if(TOOLS.length!==19||common.length!==6||estimate(INSTRUCTIONS)>250)process.exitCode=1;
// Full registry/common budgets are goals: never drop validation constraints to
// manufacture a pass. --strict makes budget overshoots fail for CI experiments.
if(process.argv.includes('--strict')&&(estimate(TOOLS)>6000||estimate(common)>3000))process.exitCode=1;
