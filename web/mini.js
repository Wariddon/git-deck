'use strict';
// Mini mode (web/mini.html): a 400x640 window that stays beside the editor. It shows the next few
// Inbox items from the last Pending check, refreshes a repository when Git Deck reports that it
// changed, and lists what just changed. Push and Pull run here; everything else opens the main
// window. Inbox rules and the Done state are shared with the Inbox panel (web/inbox.js).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const nameOf=(path)=>String(path||'').split(/[\\/]/).filter(Boolean).pop()||String(path||'');
  // The first `limit` open items across the snapshot, most urgent first.
  function nextItems(snapshot,inboxState,{me='',now=Date.now(),limit=5,helpers}={}){
    const items=(snapshot?.items||[]).filter(item=>item&&item.path&&!/\.worktrees[\\/]/i.test(item.path))
      .flatMap(item=>helpers.itemsFor({path:item.path,name:nameOf(item.path)},item.pending,{me,now}));
    return helpers.sortItems(helpers.visibleItems(items,inboxState,now)).slice(0,limit);
  }
  // Newest first, one row per repository (a repeat moves it to the top), at most `limit`.
  function recordChange(list,change,limit=8){
    const key=String(change.path||'').toLowerCase();
    return [change,...(list||[]).filter(item=>String(item.path||'').toLowerCase()!==key)].slice(0,limit);
  }
  // Replace one repository's pending state in the snapshot (paths compare case-insensitively).
  function withPending(snapshot,path,pending){
    const key=String(path).toLowerCase();const items=(snapshot?.items||[]).filter(item=>String(item.path).toLowerCase()!==key);
    if(pending)items.push({path,pending});
    return {at:snapshot?.at||Date.now(),items};
  }
  const helpers={nextItems,recordChange,withPending,nameOf};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  const inbox=window.GitDeckInboxHelpers;
  if(!inbox||typeof document==='undefined'||!document.getElementById('mini-next'))return;

  const $=(id)=>document.getElementById(id);
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const snapshotKey='gitdeck.pendingSnapshot',stateKey='gitdeck.inboxState';
  const api=async(path,options={})=>{
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Git-Deck':'1',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error)throw new Error(data.error||response.statusText);
    return data;
  };
  const say=(text,bad=false)=>{const node=$('mini-status');node.textContent=text;node.classList.toggle('bad',bad);};
  const main=()=>{try{return window.opener&&!window.opener.closed&&window.opener.GitDeckMiniBridge?window.opener:null;}catch{return null;}};
  // Follow the main window's theme so the two look like one app.
  const syncTheme=()=>{const opener=main();const classes=opener?opener.document.body.className:'';for(const name of ['theme-dark','theme-midnight','theme-focus'])document.body.classList.toggle(name,classes.split(/\s+/).includes(name));};

  document.title=t('Git Deck Mini');
  $('mini-main').textContent=t('Main window');$('mini-main').title=t('Bring the main Git Deck window to the front');
  $('mini-next-title').textContent=t('Next');$('mini-recent-title').textContent=t('Just changed');
  const input=$('mini-command-input');input.placeholder=t('Command… e.g. push, pull, tag crs- next');input.setAttribute('aria-label',t('Command'));
  const ticket=readJson('gitdeck.ticketKey',null)||(()=>{try{return localStorage.getItem('gitdeck.ticketKey')||'';}catch{return '';}})();
  if(ticket&&typeof ticket==='string'){$('mini-ticket').hidden=false;$('mini-ticket').textContent=ticket;$('mini-ticket').title=t('Ticket you are working on');}

  let me='';let changes=[];let busy=false;
  api('/api/activity/me').then(answer=>{me=String(answer?.identity?.email||'').toLowerCase();draw();}).catch(()=>{});
  const actionLabel={push:t('Push'),pull:t('Pull')};
  async function run(item){
    if(busy)return;busy=true;draw();say(t('{action} {repo}…',{action:actionLabel[item.action],repo:item.repo.name}));
    try{
      let result=await api('/api/action',{method:'POST',body:JSON.stringify({action:item.action,path:item.repo.path,...(item.action==='pull'?{strategy:'ff-only',autostash:true}:{})})});
      if(result?.async&&result.jobId){
        for(let i=0;i<480;i++){const job=await api('/api/job?id='+encodeURIComponent(result.jobId));if(job.state==='completed')break;if(job.state==='failed'||job.state==='cancelled')throw new Error(String(job.output||job.message||t('Failed')).split('\n')[0]);await new Promise(resolve=>setTimeout(resolve,750));}
      }
      say(t('{action} {repo}: done',{action:actionLabel[item.action],repo:item.repo.name}));
      await refresh(item.repo.path);
    }catch(error){say(error.message,true);}
    finally{busy=false;draw();}
  }
  function open(item){
    const opener=main();
    if(!opener){say(t('Open the main Git Deck window first.'),true);return;}
    opener.GitDeckMiniBridge.open(item.repo.path,item.action);opener.focus();
  }
  function done(item){const state=readJson(stateKey,{});state[item.key]={...(state[item.key]||{}),doneSig:item.sig};writeJson(stateKey,state);draw();}
  function draw(){
    syncTheme();
    const list=$('mini-next');list.replaceChildren();
    const items=nextItems(readJson(snapshotKey,null),readJson(stateKey,{}),{me,helpers:inbox});
    if(!items.length)list.append(el('li','mini-empty',readJson(snapshotKey,null)?t('Nothing needs you. Nice.'):t('Run a Pending check in the main window first.')));
    for(const item of items){
      const row=el('li',`mini-item tone-${item.tone}`);
      const text=el('div','mini-text');text.append(el('strong','',item.repo.name),el('span','',item.title));
      const actions=el('div','mini-actions');
      if(actionLabel[item.action]){const go=el('button','primary',actionLabel[item.action]);go.type='button';go.disabled=busy;go.onclick=()=>run(item);actions.append(go);}
      else{const go=el('button','',t('Open'));go.type='button';go.onclick=()=>open(item);actions.append(go);}
      const ok=el('button','mini-done','✓');ok.type='button';ok.title=t('Done (comes back if it changes)');ok.setAttribute('aria-label',t('Done (comes back if it changes)'));ok.onclick=()=>done(item);actions.append(ok);
      row.append(text,actions);list.append(row);
    }
    const recent=$('mini-recent');recent.replaceChildren();
    if(!changes.length)recent.append(el('li','mini-empty',t('Commits, pushes and switches made anywhere show up here.')));
    for(const change of changes){const row=el('li','mini-change');row.append(el('strong','',nameOf(change.path)),el('small','',new Date(change.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));recent.append(row);}
  }
  async function refresh(path){
    try{const pending=(await api('/api/repo/pending?path='+encodeURIComponent(path))).pending;writeJson(snapshotKey,withPending(readJson(snapshotKey,null),path,pending));}catch{}
    draw();
  }

  $('mini-main').onclick=()=>{const opener=main();if(opener)opener.focus();else window.open('/','_blank');};
  $('mini-command').onsubmit=(event)=>{event.preventDefault();const opener=main();if(!opener){say(t('Open the main Git Deck window first.'),true);return;}opener.GitDeckMiniBridge.command(input.value.trim());opener.focus();input.value='';};
  window.addEventListener('storage',(event)=>{if(event.key===snapshotKey||event.key===stateKey)draw();});
  window.addEventListener('focus',draw);

  const live=$('mini-live');live.title=t('Not connected to Git Deck; reconnecting…');
  const source=new EventSource('/api/events');
  source.addEventListener('open',()=>{live.classList.add('on');live.title=t('Live: commits, pushes and switches made elsewhere show up by themselves');});
  source.addEventListener('error',()=>{live.classList.remove('on');live.title=t('Not connected to Git Deck; reconnecting…');});
  source.addEventListener('repo-changed',(event)=>{let data={};try{data=JSON.parse(event.data);}catch{}if(!data.path)return;changes=recordChange(changes,{path:data.path,at:Date.parse(data.at)||Date.now()});void refresh(data.path);});
  draw();
})();
