// Actual PenEcho server acceptance, isolated state; no user configuration/model calls.
const path=require('node:path');
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join('/tmp','penecho-architecture-20260918'),HOST:'127.0.0.1',PORT:'8771',AI_PROVIDER:'api',AI_API_KEY:'test-only',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
// Override the dependency only in this test process: discovery records and
// credentials must stay in the explicit acceptance directory, not the user's registry.
require('../../../src/server/mcp/records.js').registryStateDirectory=()=>process.env.PENECHO_STATE_DIR;
require('../../../server.js');
