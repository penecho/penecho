import { ClayCanvas } from './clay';
const root=document.getElementById('liveclay-root')!;
const status=document.getElementById('liveclay-status')!;
try {
 const clay=new ClayCanvas(root);
 const initial=JSON.parse(document.getElementById('liveclay-data')!.textContent!);
 clay.setWorld(initial.world);
 const pause=document.getElementById('liveclay-pause')!;
 const label=()=>{pause.textContent=clay.paused?'▶':'Ⅱ';pause.setAttribute('aria-label',clay.paused?'Play / 播放':'Pause / 暂停');pause.setAttribute('aria-pressed',String(clay.paused));};
 pause.onclick=()=>{clay.paused=!clay.paused;label();};label();
 document.getElementById('liveclay-reset')!.onclick=()=>{clay.resetView();clay.restartSimulation();};
 let hostActive=true;const visibility=()=>clay.setActive(hostActive&&!document.hidden);
 document.addEventListener('visibilitychange',visibility);visibility();
 addEventListener('message',event=>{if(event.source!==parent)return;if(event.data?.type==='penecho-widget-state'){hostActive=event.data.active!==false;visibility();return;}if(event.data?.type!=='penecho-liveclay-update')return;clay.setWorld(event.data.document.world);document.getElementById('liveclay-data')!.textContent=JSON.stringify(event.data.document);});
 addEventListener('pagehide',()=>clay.dispose(),{once:true});
 status.hidden=true;
} catch(error){status.textContent='Unable to display 3D. Try a browser with WebGL enabled. / 无法显示 3D，请使用已启用 WebGL 的浏览器。';}
