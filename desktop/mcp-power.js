"use strict";

// A renewable renderer lease prevents a crashed or disconnected MCP page from
// keeping the machine awake indefinitely. Ordinary Canvas use never starts it.
function createMcpPowerLease(blocker, { setTimer=setTimeout, clearTimer=clearTimeout, leaseMs=60_000 }={}) {
  let id=null,timer=null,contents=null,previousThrottling=true;
  function release() {
    clearTimer(timer);timer=null;
    if(id!==null){blocker.stop(id);id=null;}
    if(contents&&!contents.isDestroyed())contents.setBackgroundThrottling?.(previousThrottling);
    contents=null;
  }
  function set(enabled,sender) {
    if(!enabled){release();return false;}
    if(sender?.isDestroyed())return false;
    if(contents&&contents!==sender)release();
    if(id===null){
      id=blocker.start("prevent-app-suspension");contents=sender;
      previousThrottling=sender?.getBackgroundThrottling?.()??true;
      sender?.setBackgroundThrottling?.(false);
    }
    clearTimer(timer);timer=setTimer(release,leaseMs);timer?.unref?.();return true;
  }
  return {set,release};
}
module.exports={createMcpPowerLease};
