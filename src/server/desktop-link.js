"use strict";
// The desktop app runs this server in a process of its own, so however busy the server is, the window scrolls and clicks at once.
// What needs the window's process (page pictures, the agents' browser) and what the window needs from the server (file picker
// grants, network access, quitting) goes over the channel Node keeps between a process and its child. Both sides are this link:
// request() asks the other side and waits for its answer, notify() only tells it, handle() answers it.

const MARK = 1;

function toWire(error) {
  return { message:String(error?.message || error || "Unknown error"), ...(error?.code ? { code:String(error.code) } : {}), ...(Number.isInteger(error?.status) ? { status:error.status } : {}) };
}
function fromWire(value) {
  const error = new Error(String(value?.message || "The other PenEcho process could not do that."));
  if (value?.code) error.code = value.code;
  if (value?.status) error.status = value.status;
  return error;
}
const closedError = () => Object.assign(new Error("PenEcho's window and its server are no longer connected."), { code:"DESKTOP_LINK_CLOSED", status:503 });
const abortedError = () => Object.assign(new Error("The request was cancelled."), { code:"ABORTED", status:499 });

// send(message, callback) is process.send or child.send; received messages are passed to receive().
function createLink({ send }) {
  const pending = new Map(), handlers = new Map(), answering = new Map(), closers = new Set();
  let serial = 0, closed = false;

  function post(message) {
    if (closed) return false;
    try { send({ penecho:MARK, ...message }, error => { if (error) close(); }); return true; }
    catch (error) {
      if (error?.code === "ERR_IPC_CHANNEL_CLOSED") { close(); return false; }
      throw error;
    }
  }
  // No time limit of its own: the side that does the work has its limits, and a closed link ends every wait.
  function request(method, params = null, { signal = null } = {}) {
    if (closed) return Promise.reject(closedError());
    if (signal?.aborted) return Promise.reject(abortedError());
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const onAbort = () => { post({ abort:id }); settle(reject, abortedError()); };
      const settle = (finish, value) => { if (!pending.delete(id)) return; signal?.removeEventListener?.("abort", onAbort); finish(value); };
      pending.set(id, { resolve:value => settle(resolve, value), reject:error => settle(reject, error) });
      signal?.addEventListener?.("abort", onAbort, { once:true });
      try { if (!post({ ask:id, method, params })) pending.get(id)?.reject(closedError()); }
      catch (error) { pending.get(id)?.reject(error); }
    });
  }
  function notify(method, params = null) { try { return post({ tell:method, params }); } catch { return false; } }
  function handle(method, handler) { handlers.set(method, handler); }

  async function answer({ ask, method, params }) {
    const controller = new AbortController();
    answering.set(ask, controller);
    let reply;
    try {
      const handler = handlers.get(method);
      if (!handler) throw Object.assign(new Error(`Unknown request: ${method}`), { code:"UNKNOWN_REQUEST" });
      reply = { reply:ask, value:await handler(params, { signal:controller.signal }) };
    } catch (error) { reply = { reply:ask, error:toWire(error) }; }
    answering.delete(ask);
    // A value the channel cannot carry is an error the other side hears about, not a wait that never ends.
    try { post(reply); } catch (error) { post({ reply:ask, error:toWire(error) }); }
  }
  function receive(message) {
    if (closed || !message || typeof message !== "object" || message.penecho !== MARK) return;
    if (message.ask !== undefined) { void answer(message); return; }
    if (message.reply !== undefined) {
      const waiting = pending.get(message.reply);
      if (!waiting) return;
      if (message.error) waiting.reject(fromWire(message.error));
      else waiting.resolve(message.value);
      return;
    }
    if (message.abort !== undefined) { answering.get(message.abort)?.abort(); return; }
    if (message.tell !== undefined) { try { handlers.get(message.tell)?.(message.params, {}); } catch { /* Only told: nobody waits for an answer. */ } }
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const waiting of [...pending.values()]) waiting.reject(closedError());
    for (const controller of answering.values()) controller.abort();
    answering.clear();
    for (const closer of closers) { try { closer(); } catch { /* The others still hear it. */ } }
    closers.clear();
  }
  return { request, notify, handle, receive, close, open:() => !closed, onClose(listener) { if (closed) listener(); else closers.add(listener); } };
}

// The link to the desktop app, in the server process it started. Everywhere else there is none.
let active = null;
module.exports = { createLink, setActive:link => { active = link; }, active:() => (active?.open() ? active : null) };
