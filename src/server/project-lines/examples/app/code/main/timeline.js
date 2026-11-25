// Draws each line as a row: its name, then its steps as dots on the working day, with the time under each dot.
const DAY_START = 8, DAY_END = 18, TRACK = 640;
const minutes = time => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const xOf = time => Math.round((minutes(time) - DAY_START * 60) / ((DAY_END - DAY_START) * 60) * TRACK);

function lineRow(line) {
  const row = document.createElement("section");
  row.className = "line";
  const dots = line.steps.map(([kind, time, who]) => `<i class="dot ${kind}" style="left:${xOf(time)}px" title="${who || kind} · ${time}"></i>`).join("");
  const times = line.steps.map(([, time]) => `<span class="time" style="left:${xOf(time)}px">${time}</span>`).join("");
  const first = xOf(line.steps[0][1]), last = xOf(line.steps[line.steps.length - 1][1]);
  row.innerHTML = `<div class="name"><b>${line.title}</b><span>${line.day}</span></div>
    <div class="track"><i class="rail" style="left:${first}px;width:${last - first}px"></i>${dots}${times}</div>`;
  return row;
}

document.getElementById("project").textContent = PROJECT.name;
const hours = [];
for (let h = DAY_START; h <= DAY_END; h += 2) hours.push(`<span style="left:${xOf(`${h}:00`)}px">${String(h).padStart(2, "0")}:00</span>`);
document.getElementById("lines").innerHTML = `<div class="hours"><div></div><div class="track">${hours.join("")}</div></div>`;
for (const line of LINES) document.getElementById("lines").append(lineRow(line));
