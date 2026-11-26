// The week of one project. A step is [kind, time, who]: an ask, a drawing (canvas), an agent's work, or the end of a line.
const PROJECT = { name:"Bakery website" };
const LINES = [
  { title:"Menu page", day:"Mon", steps:[["canvas", "09:05"], ["ask", "09:12"], ["work", "09:40", "Claude"], ["ask", "11:02"], ["work", "11:31", "Codex"], ["done", "14:10"]] },
  { title:"Opening hours", day:"Mon", steps:[["ask", "10:20"], ["work", "10:31", "Codex"], ["done", "10:45"]] },
  { title:"Order form", day:"Tue", steps:[["ask", "09:30"], ["work", "09:38", "Claude"], ["ask", "09:44"], ["work", "09:52", "Claude"], ["ask", "15:10"], ["work", "15:40", "Codex"]] },
  { title:"Photos of the cakes", day:"Wed", steps:[["canvas", "13:00"], ["ask", "13:05"], ["work", "13:20", "Claude"], ["done", "16:30"]] },
  { title:"Contact page", day:"Thu", steps:[["ask", "11:15"], ["work", "11:24", "OpenCode"]] },
];
