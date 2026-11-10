'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMcpPowerLease}=require('../desktop/mcp-power.js');
test('MCP desktop wake lease is optional, renewable and restores throttling on expiry',()=>{
  const starts=[],stops=[],throttling=[],timers=new Map();let seq=0;
  const lease=createMcpPowerLease({start:type=>{starts.push(type);return 0;},stop:id=>stops.push(id)}, {setTimer:fn=>{timers.set(++seq,fn);return seq;},clearTimer:id=>timers.delete(id)});
  const sender={isDestroyed:()=>false,getBackgroundThrottling:()=>true,setBackgroundThrottling:value=>throttling.push(value)};
  assert.equal(starts.length,0);lease.set(true,sender);lease.set(true,sender);
  assert.deepEqual(starts,['prevent-app-suspension']);assert.equal(timers.size,1);
  [...timers.values()][0]();assert.deepEqual(stops,[0]);assert.deepEqual(throttling,[false,true]);
  lease.release();assert.equal(stops.length,1);
});
