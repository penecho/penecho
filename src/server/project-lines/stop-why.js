"use strict";
// Why a Work stopped without finishing (N5): the agent's usage limit, an error, or the person pressed Stop.
// A limit is told by the agent's own words. Every pattern lives here, with tests from real strings in test/project-line-carry-on.test.js.
const LIMIT = [
  // Claude Code: "You've hit your 5-hour limit · resets 2:10pm (Europe/London)", "You've hit your weekly limit". Codex: "You've hit your usage limit."
  /\byou(?:'|’)?ve (?:hit|reached) your (?:[\w-]+ ){0,3}limit/i,
  /\byou have (?:hit|reached) your (?:[\w-]+ ){0,3}limit/i,
  // Claude Code before: "Claude AI usage limit reached|1731427200". Others: "usage limit exceeded", "Usage limit reached for this period".
  /\busage limit\b/i,
  // "rate limit", "rate-limited", "rate_limit_error" (Anthropic's API), "Rate limit reached for gpt-…" (OpenAI's).
  /\brate[-_ ]?limit/i,
  /\b(?:5|five)-hour limit\b|\bweekly limit\b|\bsession limit\b/i,
  /\btoo many requests\b/i,
  /\bexceeded your (?:current )?quota\b|\bquota (?:exceeded|exhausted)\b|\binsufficient_quota\b/i,
];
const isLimit = text => LIMIT.some(re => re.test(String(text || "")));
// A run that ended calmly is a stop only when its whole answer is the limit notice itself, so an answer about rate limits stays an answer.
const OWN_NOTICE = /^\s*(?:claude ai usage limit reached|you(?:'|’)?ve (?:hit|reached) your (?:[\w-]+ ){0,3}limit|(?:[\w-]+ )?limit reached\s*[∙·|])/i;
const isLimitNotice = text => String(text || "").trim().length < 300 && OWN_NOTICE.test(String(text || ""));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const hour24 = (h, ampm) => { h = Number(h); const half = String(ampm || "").toLowerCase(); return half === "pm" && h < 12 ? h + 12 : half === "am" && h === 12 ? 0 : h; };
// How far a time zone's clock is ahead of UTC at a moment, in ms. An unknown zone throws.
function zoneAhead(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone:zone, hourCycle:"h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit" }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
}
// The next moment the clock reads h:m, in that zone or, with none, this computer's own.
function nextClock(now, h, m, zone) {
  if (zone) {
    try {
      const day = new Date(now + zoneAhead(now, zone));
      const at = (y, mo, d) => { const wall = Date.UTC(y, mo, d, h, m); let t = wall - zoneAhead(wall, zone); t = wall - zoneAhead(t, zone); return t; };
      let t = at(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      if (t < now - 60000) t = at(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
      return t;
    } catch { /* Not a zone this computer knows: its own clock instead. */ }
  }
  const d = new Date(now); d.setHours(h, m, 0, 0);
  if (d.getTime() < now - 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
// When the agent says it can go on again, as a moment, or 0 when it does not say.
function resetsAtOf(text, now = Date.now()) {
  const t = String(text || "");
  // "usage limit reached|1731427200": the moment itself, in seconds.
  let m = /limit reached\|(\d{9,13})\b/i.exec(t);
  if (m) { const n = Number(m[1]); return n < 1e12 ? n * 1000 : n; }
  // Codex, on another day: "try again at Nov 14th, 2026 9:00 AM".
  m = /\b(?:try again|resets?|reset) (?:at|on) ([A-Z][a-z]{2})[a-z]* (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? (\d{1,2})(?::(\d\d))?\s*([ap]\.?m\.?)?/i.exec(t);
  if (m && MONTHS.includes(m[1].toLowerCase())) return new Date(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2], hour24(m[4], m[6]?.replace(/\./g, "")), +(m[5] || 0)).getTime();
  // Claude Code: "resets 2:10pm (Europe/London)", "resets 2pm", "Your limit will reset at 2pm (Europe/London)". Codex, the same day: "try again at 3:05 PM".
  m = /\b(?:resets?|try again)(?: at)? (\d{1,2})(?::(\d\d))?\s*([ap]\.?m\.?)?(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\))?/i.exec(t);
  if (m && (m[2] || m[3])) return nextClock(now, hour24(m[1], m[3]?.replace(/\./g, "")), +(m[2] || 0), m[4] || "");
  // "try again in 2 hours 5 minutes", "in 4 days 3 hours 2 minutes".
  m = /\btry again in ((?:\d+\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)[\s,]*(?:and\s+)?)+)/i.exec(t);
  if (m) {
    const unit = { d:86400000, h:3600000, m:60000, s:1000 };
    const ms = [...m[1].matchAll(/(\d+)\s*([dhms])/gi)].reduce((sum, [, n, u]) => sum + Number(n) * unit[u.toLowerCase()], 0);
    if (ms) return now + ms;
  }
  return 0;
}
// "limit" with when it resets, or "error". Stop pressed by the person is said where it happens (stopWork), never guessed from words.
function stopWhyOf(text, now = Date.now()) {
  if (!isLimit(text)) return { why:"error", resetsAt:0 };
  return { why:"limit", resetsAt:resetsAtOf(text, now) };
}
// The words an agent is told, and a person reads, for each.
const WHY_WORDS = { limit:"it hit its usage limit", error:"it stopped with an error", stopped:"the person stopped it" };
const whyWords = why => WHY_WORDS[why] || WHY_WORDS.error;

module.exports = { LIMIT, isLimit, isLimitNotice, resetsAtOf, stopWhyOf, whyWords, nextClock };
