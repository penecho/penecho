// The homepage, as in the drawing and Claude's prototype: the projects on the left, the week across the top, every line of the
// week on one trunk, newest day first, and the latest files on the right. Clicking a day shows only that day's lines.
const DAY_START = 8, DAY_END = 18, TRACK = 500;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const NODE = { ask:{ fill:"#ffffff", ring:"#2563eb" }, canvas:{ fill:"#e9551f" }, done:{ fill:"#16a34a" } };
const AGENT = { Claude:["Cl", "#a8502a"], Codex:["Cx", "#2b303a"], OpenCode:["Oc", "#3f4754"] };
const minutes = time => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const xOf = time => Math.round((minutes(time) - DAY_START * 60) / ((DAY_END - DAY_START) * 60) * TRACK) + 12;
const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
let current = PROJECTS[0].id, picked = null;

function node([kind, time, who]) {
  const x = xOf(time), title = `<title>${esc(who || kind)} · ${time}</title>`;
  if (kind === "work") { const [initials, color] = AGENT[who] || ["Ag", "#475569"]; return `<g>${title}<circle cx="${x}" cy="22" r="10" fill="${color}" stroke="#ffffff" stroke-width="2"/><text x="${x}" y="25.5" fill="#ffffff" font-size="8.5" font-weight="650" text-anchor="middle">${initials}</text></g>`; }
  if (kind === "canvas") return `<g>${title}<rect x="${x - 5.5}" y="16.5" width="11" height="11" rx="3" fill="${NODE.canvas.fill}"/></g>`;
  if (kind === "done") return `<g>${title}<circle cx="${x}" cy="22" r="8" fill="${NODE.done.fill}"/><path d="M${x - 3.5} 22l2.5 2.5 4.5-5" fill="none" stroke="#ffffff" stroke-width="1.8"/></g>`;
  return `<g>${title}<circle cx="${x}" cy="22" r="5" fill="${NODE.ask.fill}" stroke="${NODE.ask.ring}" stroke-width="2.5"/></g>`;
}
function row(line) {
  const xs = line.steps.map(([, time]) => xOf(time)), first = xs[0], last = xs[xs.length - 1];
  // A time that would run into the one before it is left to its dot, which says it when you point at it.
  let end = -Infinity;
  const times = line.steps.map(([, time], i) => { if (xs[i] - 17 < end + 4) return ""; end = xs[i] + 17; return `<text x="${xs[i]}" y="46" class="time" text-anchor="middle">${time}</text>`; }).join("");
  return `<div class="row"><i class="elbow"></i><b class="title">${esc(line.title)}</b>
    <svg class="track" width="${TRACK + 24}" height="64" viewBox="0 0 ${TRACK + 24} 64"><line x1="${first}" y1="22" x2="${last}" y2="22" stroke="#94a3b8" stroke-width="2"/>${line.steps.map(node).join("")}${times}</svg></div>`;
}
function draw() {
  const project = PROJECTS.find(p => p.id === current), lines = LINES.filter(l => l.project === current);
  document.getElementById("name").textContent = project.name;
  document.getElementById("range").textContent = `${lines.length} lines this week`;
  document.getElementById("projects").innerHTML = PROJECTS.map(p => `<button type="button" class="project${p.id === current ? " on" : ""}" data-project="${p.id}"><i style="background:${p.color}"></i>${esc(p.name)}<span>${LINES.filter(l => l.project === p.id).length}</span></button>`).join("");
  document.getElementById("week").innerHTML = DAYS.map(day => { const n = lines.filter(l => l.day === day).length; return `<button type="button" class="day${picked === day ? " on" : ""}${n ? "" : " empty"}" data-day="${day}"><b>${day}</b><span>${n || ""}</span><i style="height:${n * 9}px"></i></button>`; }).join("");
  const days = [...DAYS].reverse().filter(day => (!picked || picked === day) && lines.some(l => l.day === day));
  const clock = [9, 12, 15, 18].map(h => `<span style="left:${xOf(`${h}:00`)}px">${String(h).padStart(2, "0")}:00</span>`).join("");
  document.getElementById("lines").innerHTML = `<i class="trunk"></i>${days.map(day => `<div class="dayhead"><b>${day}</b><div class="clock">${clock}</div></div>${lines.filter(l => l.day === day).map(row).join("")}`).join("")}`;
  document.getElementById("files").innerHTML = FILES.filter(f => f.project === current).map(f => `<li><span class="thumb">${f.name.endsWith(".png") ? "▦" : "‹›"}</span><span><b>${esc(f.name)}</b><em>${esc(f.line)} · ${f.day}</em></span></li>`).join("");
}
document.addEventListener("click", event => {
  const project = event.target.closest("[data-project]"), day = event.target.closest("[data-day]");
  if (project) { current = project.dataset.project; picked = null; draw(); }
  if (day) { picked = picked === day.dataset.day ? null : day.dataset.day; draw(); }
});
draw();
