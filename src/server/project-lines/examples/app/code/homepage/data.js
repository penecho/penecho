// The projects and their week. A step is [kind, time, who]: an ask, a drawing (canvas), an agent's work, or the end of a line.
const PROJECTS = [
  { id:"bakery", name:"Bakery website", color:"#2563eb" },
  { id:"recipes", name:"Recipe app", color:"#0d9488" },
  { id:"shop", name:"Online shop", color:"#d97706" },
];
const LINES = [
  { project:"bakery", title:"Menu page", day:"Mon", steps:[["canvas", "09:05"], ["ask", "09:12"], ["work", "09:40", "Claude"], ["ask", "11:02"], ["work", "11:31", "Codex"], ["done", "14:10"]] },
  { project:"bakery", title:"Opening hours", day:"Mon", steps:[["ask", "10:20"], ["work", "10:31", "Codex"], ["done", "10:45"]] },
  { project:"bakery", title:"Order form", day:"Tue", steps:[["ask", "09:30"], ["work", "09:38", "Claude"], ["ask", "09:44"], ["work", "09:52", "Claude"], ["ask", "15:10"], ["work", "15:40", "Codex"]] },
  { project:"bakery", title:"Photos of the cakes", day:"Wed", steps:[["canvas", "13:00"], ["ask", "13:05"], ["work", "13:20", "Claude"], ["done", "16:30"]] },
  { project:"bakery", title:"Contact page", day:"Thu", steps:[["ask", "11:15"], ["work", "11:24", "OpenCode"]] },
  { project:"bakery", title:"Gift cards", day:"Fri", steps:[["ask", "09:20"], ["work", "09:46", "Codex"], ["ask", "13:30"], ["work", "13:52", "Claude"]] },
  { project:"recipes", title:"Shopping list", day:"Tue", steps:[["canvas", "10:00"], ["ask", "10:06"], ["work", "10:30", "Claude"], ["done", "12:00"]] },
  { project:"recipes", title:"Search by ingredient", day:"Thu", steps:[["ask", "14:00"], ["work", "14:25", "Codex"]] },
  { project:"shop", title:"Checkout", day:"Wed", steps:[["ask", "09:00"], ["work", "09:41", "Codex"], ["ask", "11:00"], ["work", "11:18", "Codex"], ["done", "17:00"]] },
];
const FILES = [
  { project:"bakery", name:"gift-card.png", line:"Gift cards", day:"Fri" },
  { project:"bakery", name:"contact-form.html", line:"Contact page", day:"Thu" },
  { project:"bakery", name:"cakes.png", line:"Photos of the cakes", day:"Wed" },
  { project:"bakery", name:"menu-sketch.png", line:"Menu page", day:"Mon" },
  { project:"recipes", name:"list-sketch.png", line:"Shopping list", day:"Tue" },
  { project:"shop", name:"checkout-flow.png", line:"Checkout", day:"Wed" },
];
