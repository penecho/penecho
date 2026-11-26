// Pure rules shared by the home, Find, and the server's search. No browser or file access.
const LINE_STATUS = (() => {
  const states = { notes:'notes', working:'working', waiting:'wait', ready:'ready', stopped:'error', landed:'landed', done:'landed', closed:'landed', 'not-started':'backlog' };
  const lineState = l => states[l.status] || (l.status === 'paused' ? 'error' : 'working');
  const isYours = s => ['ask', 'note', 'canvas', 'meeting'].includes(s.kind);
  const isWork = s => !isYours(s) && s.kind !== 'merge' && s.kind !== 'deliver' && s.kind !== 'orch-review';
  // A Work that finished, or one you stopped, is what the Line finished with, so both can be reviewed. Discarded or carried-on Work has nothing left to read.
  const canReview = s => isWork(s) && typeof s.reviewed === 'boolean' && (s.state === 'done' || (s.state === 'off' && s.off === 'stopped'));
  const nextToReview = l => (l?.stations || []).find(s => canReview(s) && !s.reviewed);
  // A Line is working only while a job is: PenEcho's own run, a conversation in another app, or a Work shown at work. A stopped Work is not working.
  const lineWorking = l => Boolean(l && (l.running || l.elsewhere || (Array.isArray(l.stations) ? l.stations.some(s => isWork(s) && s.state === 'active') : lineState(l) === 'working')));
  // An Orchestrator background review job is currently running on a Work in this active Line.
  const lineReviewing = l => Boolean(l && !l.archived && !l.closed && Array.isArray(l.stations) && l.stations.some(s => (isWork(s) || s.kind === 'orch-review') && s.reviewing));
  // Needs you: the work is not done until you answer. The agent asked you something, left you prototypes or options to choose from, or stopped for you.
  const lineNeedsYou = l => !l.archived && (lineState(l) === 'wait' || Boolean(l.asking) || (l.questions || []).length > 0);
  // Todo is the person's pending disposition of finished work, separate from execution and review records.
  const canTodo = l => ['ready', 'landed'].includes(lineState(l)) && !l.archived && !l.commit && !lineWorking(l) && !lineNeedsYou(l)
    && !(l.stations || []).some(s => s.unsent || (isWork(s) && !s.off && !['done', 'off'].includes(s.state))) && (l.stations || []).some(canReview);
  const isTodo = l => l.todo === true && canTodo(l);
  // Mark todo: offered alongside Mark reviewed whenever no job is working on an active Line with work to keep pending.
  const canMarkTodo = l => {
    if (!l || l.archived || l.closed || l.commit || lineWorking(l)) return false;
    if (canTodo(l)) return true;
    const state = lineState(l);
    if (state === 'notes' || state === 'backlog' || l.queued) return false;
    const stations = Array.isArray(l.stations) ? l.stations : [];
    if (stations.some(s => s.unsent)) return false;
    if (!stations.some(isWork)) return false;
    return state === 'error' || state === 'working' || lineNeedsYou(l)
      || stations.some(s => isWork(s) && (s.state === 'error' || s.state === 'wait'));
  };
  // While an unreviewed Work is still under background review, the Line stays working rather than switching to To review.
  const isReviewPending = l => ['ready', 'landed'].includes(lineState(l)) && !lineNeedsYou(l) && !isTodo(l) && Boolean(nextToReview(l)) && lineReviewing(l);
  // To review: finished or stopped Works not yet marked Reviewed while no job is working or reviewing. A line that needs you says that first, so you answer it before you review.
  const toReview = l => ['ready', 'landed'].includes(lineState(l)) && !l.archived && !l.closed && !lineWorking(l) && !lineReviewing(l) && Boolean(nextToReview(l)) && !lineNeedsYou(l) && !isTodo(l);
  const lineReviewed = l => Boolean(l && !l.archived && !l.closed && ['ready', 'landed'].includes(lineState(l)) && !lineWorking(l) && !lineNeedsYou(l)
    && !isTodo(l) && !nextToReview(l) && (l.stations || []).some(s => canReview(s) || s.finishedAsk));
  // Mark reviewed: always an option unless a job is working in the Line, whenever anything still needs review, Todo, or ending (stopped, waiting on you).
  const canMarkReviewed = l => {
    if (!l || l.archived || l.closed || lineWorking(l)) return false;
    const state = lineState(l);
    if (Boolean(nextToReview(l)) || isTodo(l)) return true;
    if (state === 'error' || state === 'working') return true;
    const stations = Array.isArray(l.stations) ? l.stations : [];
    if (stations.some(s => isWork(s) && (s.state === 'error' || s.state === 'wait'))) return true;
    if (lineNeedsYou(l) && (stations.some(isWork) || (l.questions || []).length > 0)) return true;
    return false;
  };
  const toLookAt = l => toReview(l) || lineNeedsYou(l) || isTodo(l);
  // What a line says about itself. lineState is what it can do.
  const shownState = l => (lineNeedsYou(l) ? 'wait' : isTodo(l) ? 'todo' : toReview(l) ? 'review' : isReviewPending(l) ? 'working' : lineState(l));
  const filters = {
    working:l => lineState(l) === 'working' || isReviewPending(l),
    stopped:l => lineState(l) === 'error',
    you:lineNeedsYou,
    todo:isTodo,
    review:toReview,
    send:l => l.stations.some(s => s.unsent),
  };
  const matches = (l, status) => !Object.hasOwn(filters, status) || Boolean(l && filters[status](l));
  const QUESTION_REPLY_TAG = /<send_user_message_question_reply\b[^>]*>([\s\S]*?)(?:<\/send_user_message_question_reply>|$)/gi;
  // Structured agent question replies carry the user's answer inside JSON; unwrap them before stripping XML wrappers.
  function replyAnswers(raw) {
    let items;
    try { items = JSON.parse(String(raw || '').trim()); } catch { return ''; }
    if (!Array.isArray(items)) items = items && typeof items === 'object' ? [items] : [];
    const out = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const ans = Array.isArray(item.answers) ? item.answers.map(x => String(x ?? '').trim()).filter(Boolean).join(', ') : String(item.answer ?? '').trim();
      if (ans) out.push(ans);
    }
    return out.join('\n\n');
  }
  function unwrapReplies(text) {
    return String(text ?? '').replace(QUESTION_REPLY_TAG, (_, body) => {
      const ans = replyAnswers(body);
      return ans ? `\n${ans}\n` : ' ';
    });
  }
  // What apps add around your words when a conversation is read back: their own context blocks, an interrupted marker, attachment notes. None of it is what you asked. A tag you typed yourself, like <b>, has no dash in it and stays.
  const askOnly = text => unwrapReplies(text)
    .replace(/<\/?pasted_content\b[^>]*>/g, ' ')
    .replace(/<[a-z]+[-_][\w-]*\b[^>]*\/>/gi, ' ')
    .replace(/<([a-z]+[-_][\w-]*)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, ' ')
    .replace(/\[Request interrupted by user[^\]]*\]/g, ' ')
    .replace(/#+\s*My request(?: for Codex)?:\s*/gi, ' ')
    .replace(/\[Attached:[^\]]*\]/g, ' ')
    .trim();
  // An Ask with no visible text, attachments, or references (and not held/certified) has nothing to draw as a bubble.
  const askVisible = s => Boolean(s && (s.unsent || s.finishedAsk || askOnly(s.text) || (s.refers || []).length || (s.files || []).length));
  // Numbered filenames often contain parentheses. Walk the destination until the
  // matching close, including links written before PenEcho escaped literal parentheses.
  function markdownLinks(text) {
    const source = String(text || ""), opening = /(!?)\[((?:\\.|[^\]\\\n])*)\]\(/g, found = [];
    if (!source.includes("](")) return found;
    for (let match; (match = opening.exec(source));) {
      const offset = opening.lastIndex, angled = source[offset] === "<";
      let end = opening.lastIndex, depth = 1;
      for (; end < source.length && source[end] !== "\n"; end++) {
        if (source[end] === "\\" && end + 1 < source.length) { end++; continue; }
        if (angled) {
          if (source[end] === ">" && source[end + 1] === ")") { end++; depth = 0; break; }
          continue;
        }
        if (source[end] === "(") depth++;
        if (source[end] === ")" && --depth === 0) break;
      }
      if (depth !== 0) continue;
      const unescape = value => value.replace(/\\([\\()[\]])/g, "$1");
      found.push({ start:match.index, end:end + 1, image:match[1] === "!", name:unescape(match[2]), href:unescape(angled ? source.slice(offset + 1, end - 1) : source.slice(offset, end)) });
      opening.lastIndex = end + 1;
    }
    return found;
  }
  // File references in agent replies can use Markdown paths, local file URLs or a source line suffix.
  function linkedFilePath(href) {
    let value = String(href || '').trim();
    if (/^file:\/\/\//i.test(value)) value = value.slice(7).replace(/^\/([a-z]:\/)/i, '$1');
    else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return '';
    try { value = decodeURIComponent(value.split(/[?#]/)[0]); } catch { return ''; }
    value = value.replace(/\\/g, '/').replace(/:\d+(?::\d+)?$/, '');
    return !value || /[\x00-\x1f]/.test(value) || value.startsWith('//') ? '' : value;
  }
  // These Work links are served as plain text, including source normally treated as executable by browsers.
  const workSourceFile = name => /\.(?:[cm]?[jt]sx?|css|py|sh|rb|rs|go|java|kt|swift|ya?ml|toml)$/i.test(name);
  return { lineState, isYours, isWork, canReview, nextToReview, lineWorking, lineReviewing, isReviewPending, canTodo, canMarkTodo, isTodo, toReview, lineReviewed, canMarkReviewed, lineNeedsYou, toLookAt, shownState, filters, matches, markdownLinks, linkedFilePath, workSourceFile, unwrapReplies, askOnly, askVisible };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LINE_STATUS;
