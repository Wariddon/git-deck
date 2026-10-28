'use strict';
// Ticket time: roughly how long you worked on each ticket, without a timer to start. Every minute
// Git Deck is in front and you used it in the last 5 minutes, one minute goes to the ticket you are
// on: ticket mode if it is on, otherwise the ticket key in the open repository's branch. The status
// bar shows today's time for that ticket; the Standup draft lists time per ticket since the last
// working day. Kept on this computer for 60 days; nothing is sent anywhere.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const keyRe=/(?:^|[/_\s(\[])([A-Za-z][A-Za-z0-9]{1,9}-[1-9]\d{0,11})(?![A-Za-z0-9])/;
  const keyOf=(text)=>(String(text||'').match(keyRe)?.[1]||'').toUpperCase();
  const dayOf=(date)=>{const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  // Add minutes to {day:{KEY:minutes}}, dropping days older than `keepDays`.
  function addMinutes(log,key,minutes,now=new Date(),keepDays=60){
    const next={...(log||{})};if(!key)return next;const today=dayOf(now);
    next[today]={...(next[today]||{}),[key]:((next[today]||{})[key]||0)+minutes};
    const oldest=dayOf(new Date(now.getTime()-keepDays*864e5));
    for(const day of Object.keys(next))if(day<oldest)delete next[day];
    return next;
  }
  // [{key,minutes}] from `fromDay` (YYYY-MM-DD) to today, most time first.
  function totals(log,fromDay){
    const sum=new Map();
    for(const [day,keys] of Object.entries(log||{}))if(day>=fromDay)for(const [key,minutes] of Object.entries(keys))sum.set(key,(sum.get(key)||0)+minutes);
    return [...sum].map(([key,minutes])=>({key,minutes})).sort((a,b)=>b.minutes-a.minutes||a.key.localeCompare(b.key));
  }
  const duration=(minutes)=>{const h=Math.floor(minutes/60),m=minutes%60;return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;};
  const helpers={keyOf,dayOf,addMinutes,totals,duration};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const storageKey='gitdeck.ticketTime';
  const load=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{return {};}};
  const save=(log)=>{try{localStorage.setItem(storageKey,JSON.stringify(log));}catch{}};
  const current=()=>{const mode=window.GitDeckTicketMode?.current?.();if(mode)return String(mode).toUpperCase();try{return keyOf(typeof state!=='undefined'?state.workspace?.branch:'');}catch{return '';}};
  let lastInput=Date.now();
  for(const type of ['keydown','pointerdown','wheel'])document.addEventListener(type,()=>{lastInput=Date.now();},{passive:true,capture:true});
  const pill=typeof el==='function'?el('span','gd-ticket-time'):null;
  const draw=()=>{
    if(!pill)return;const key=current();const minutes=key?(load()[dayOf(new Date())]||{})[key]||0:0;
    pill.hidden=!key;pill.textContent=key?`⏱ ${key} · ${duration(minutes)}`:'';
    pill.title=t('Time on {key} today: counted while Git Deck is in front and in use',{key});
  };
  if(pill){const bar=document.getElementById('workspace-statusbar');const live=bar?.querySelector('.gd-status-live');if(live)live.before(pill);else bar?.append(pill);}
  setInterval(()=>{
    if(document.hidden||!document.hasFocus()||Date.now()-lastInput>5*60000)return;
    const key=current();if(key)save(addMinutes(load(),key,1));draw();
  },60000);
  setInterval(draw,5000);draw();
  window.GitDeckTicketTime={...helpers,since:(fromDay)=>totals(load(),fromDay)};
})();
