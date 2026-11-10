const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createPublicFetchService } = require('../src/server/public-fetch.js');

function fixture(responses) {
  const requests = [];
  const service = createPublicFetchService({
    dnsLookup:async () => [{address:'93.184.216.34',family:4}],
    networkFacts:{localHostnames:new Set(),localInterfaceAddresses:new Set()},
    makeRequest(url, options, done) {
      requests.push({url,options});
      const request = new EventEmitter();
      request.end = () => setImmediate(() => {
        const config=responses.shift(), response=new EventEmitter();
        Object.assign(response,{statusCode:config.status || 200,headers:config.headers || {},resume(){},destroy(error){if(error)this.emit('error',error);}});
        done(response);
        if (!config.headers?.location) setImmediate(() => {
          response.emit('data',Buffer.from('{}'));
          response.emit('end');
        });
      });
      return request;
    },
  });
  return {service,requests};
}

test('API inspection preserves pinned strict TLS and sends only validated Origin', async () => {
  const {service,requests}=fixture([
    {status:302,headers:{location:'https://other.example/api'}},
    {headers:{'content-type':'application/json','access-control-allow-origin':'https://widget.example','set-cookie':'never-return'}},
  ]);
  const result=await service.fetchPublicResource('https://example.org/api',undefined,{inspectResponse:true,origin:'https://widget.example'});
  assert.equal(result.corsAllowOrigin,'https://widget.example');
  assert.equal(result.finalUrl,'https://other.example/api');
  assert.equal(JSON.stringify(result).includes('never-return'),false);
  assert.equal(requests.length,2);
  for(const {options} of requests){
    assert.equal(options.rejectUnauthorized,true);
    assert.equal(options.headers.Origin,'https://widget.example');
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.headers.Cookie,undefined);
    assert.equal(typeof options.lookup,'function');
  }
});

test('ordinary public reads keep their response shape; malformed origins never request',async()=>{
  const {service,requests}=fixture([{headers:{'access-control-allow-origin':'*'}}]);
  for(const origin of ['https://user:pass@example.org','https://example.org/path','null','https://example.org\r\nCookie:secret']){
    await assert.rejects(service.fetchPublicResource('https://example.org/api',undefined,{origin}),/origin/);
  }
  assert.equal(requests.length,0);
  const result=await service.fetchPublicResource('https://example.org/api');
  assert.equal(Object.hasOwn(result,'corsAllowOrigin'),false);
  assert.equal(Object.hasOwn(requests[0].options.headers,'Origin'),false);
});

test('API verification cannot follow an HTTPS redirect down to HTTP',async()=>{
  const {service,requests}=fixture([{status:302,headers:{location:'http://example.org/api'}}]);
  await assert.rejects(service.fetchPublicResource('https://example.org/api',undefined,{inspectResponse:true}),/HTTPS/);
  assert.equal(requests.length,1);
});
