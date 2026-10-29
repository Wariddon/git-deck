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
  // Keep the 30 most recent ticket contexts.
  function trimContexts(all,limit=30){return Object.fromEntries(Object.entries(all||{}).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,limit));}
  const recentTickets=(all,exclude='',limit=8)=>Object.entries(all||{}).filter(([key])=>key!==exclude).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,limit).map(([key,value])=>({key,...value}));
  const helpers={keyOf,dayOf,addMinutes,totals,duration,trimContexts,recentTickets};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const storageKey='gitdeck.ticketTime';
  const load=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{return {};}};
  const save=(log)=>{try{localStorage.setItem(storageKey,JSON.stringify(log));}catch{}};
  const current=()=>{const mode=window.GitDeckTicketMode?.current?.();if(mode)return String(mode).toUpperCase();try{return keyOf(typeof state!=='undefined'?state.workspace?.branch:'');}catch{return '';}};
  let lastInput=Date.now();
  for(const type of ['keydown','pointerdown','wheel'])document.addEventListener(type,()=>{lastInput=Date.now();},{passive:true,capture:true});
  const pill=typeof el==='function'?el('button','gd-ticket-time'):null;if(pill)pill.type='button';
  const draw=()=>{
    if(!pill)return;const key=current();const minutes=key?(load()[dayOf(new Date())]||{})[key]||0:0;
    // Off a ticket, the button stays as "Resume" while there are tickets to go back to.
    if(!key){const saved=Object.keys(contexts()).length;pill.hidden=!saved;pill.textContent=saved?t('⏱ Resume a ticket'):'';pill.title=t('Tickets you can go back to where you left them');return;}
    pill.hidden=false;pill.textContent=`⏱ ${key} · ${duration(minutes)}`;
    pill.title=t('Time on {key} today: counted while Git Deck is in front and in use',{key})+' · '+t('Click: a note for where you are, and tickets to resume');
  };
  if(pill){const bar=document.getElementById('workspace-statusbar');const live=bar?.querySelector('.gd-status-live');if(live)live.before(pill);else bar?.append(pill);}
  setInterval(()=>{
    if(document.hidden||!document.hasFocus()||Date.now()-lastInput>5*60000)return;
    const key=current();if(key)save(addMinutes(load(),key,1));draw();
  },60000);
  // ---- resume a ticket where you left it --------------------------------------------------------
  // For each ticket: the repository and view you were in, and a short note you leave for yourself.
  // Switching to a ticket with a note shows it; the ⏱ button lists recent tickets to resume.
  const contextKey='gitdeck.ticketContext';
  const contexts=()=>{try{return JSON.parse(localStorage.getItem(contextKey)||'{}')||{};}catch{return {};}};
  const saveContexts=(value)=>{try{localStorage.setItem(contextKey,JSON.stringify(trimContexts(value)));}catch{}};
  let lastKey='';
  function remember(){
    const key=current();
    if(key&&key!==lastKey){const saved=contexts()[key];if(lastKey&&saved?.note&&typeof showActionFeedback==='function')showActionFeedback(t('📌 {key}: {note}',{key,note:saved.note}));}
    lastKey=key;if(!key)return;
    try{const repo=state.workspaceRepo;if(!repo)return;const all=contexts();all[key]={...(all[key]||{}),repo:repo.path,repoName:repo.name,tab:state.workspaceTab||'changes',at:Date.now()};saveContexts(all);}catch{}
  }
  function resume(key){
    const saved=contexts()[key];if(!saved)return;
    const repo=(state.repos||[]).find(item=>String(item.path).toLowerCase()===String(saved.repo).toLowerCase());
    if(repo&&typeof openWorkspace==='function'){document.getElementById('operations-close')?.click();void openWorkspace(repo,saved.tab||'changes');}
    window.GitDeckSavings?.add('ticket-resume');
    if(saved.note&&typeof showActionFeedback==='function')showActionFeedback(t('📌 {key}: {note}',{key,note:saved.note}));
  }
  function openResume(){
    if(typeof releaseDialog!=='function')return;
    const key=current();const ui=releaseDialog(t('Tickets'));
    if(key){
      const note=el('textarea','workflow-input');note.rows=3;note.placeholder=t('Where you are, for next time (for example: waiting for SIT config; next: retest findByProxy)');note.setAttribute('aria-label',t('Note for {key}',{key}));
      note.value=contexts()[key]?.note||'';note.oninput=()=>{const all=contexts();all[key]={...(all[key]||{}),note:note.value.slice(0,300),at:Date.now()};saveContexts(all);};
      ui.body.append(el('h3','',t('Now: {key}',{key})),note);
    }
    const others=recentTickets(contexts(),key);
    if(others.length){ui.body.append(el('h3','',t('Resume')));for(const item of others){const row=el('div','resume-row');const go=el('button','',t('Resume'));go.type='button';go.onclick=()=>{ui.dialog.close();resume(item.key);};row.append(el('strong','mono',item.key),el('span','',`${item.repoName||''} · ${item.tab||''}`),item.note?el('small','fleet-muted',item.note):'',go);ui.body.append(row);}}
    else if(!key)ui.body.append(el('p','fleet-muted',t('Open a ticket branch or ticket mode; Git Deck remembers where you were for each ticket.')));
  }
  if(pill)pill.onclick=openResume;
  setInterval(()=>{if(document.hidden)return;remember();draw();},5000);draw();
  window.GitDeckTicketTime={...helpers,since:(fromDay)=>totals(load(),fromDay),noteFor:(key)=>contexts()[key]?.note||'',resume,openResume};
})();
