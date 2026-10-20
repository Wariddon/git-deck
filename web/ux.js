'use strict';
// Cross-cutting look and feel (styles in web/ux.css): short explanations, the notification center,
// the live indicator, the docked Dashboard and ticket mode. Each piece is optional: if the element it
// hooks into is missing, it does nothing.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Notification history: newest first, at most `limit`, repeated messages folded with a count.
  function pushNotice(list,notice,limit=50){
    const items=[...(list||[])];const top=items[0];
    if(top&&top.text===notice.text&&top.error===notice.error){items[0]={...top,count:(top.count||1)+1,at:notice.at};return items;}
    return [{...notice,count:1},...items].slice(0,limit);
  }
  // Ticket mode: which repositories a ticket touches, from the ticket search results.
  function ticketRepos(results){return new Set((results||[]).filter(item=>item&&(item.branches?.length||item.commits?.length)).map(item=>String(item.path||'').toLowerCase()));}
  const helpers={pushNotice,ticketRepos};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const prefs=(key,value)=>{try{void api('/api/action',{method:'POST',body:JSON.stringify({action:'prefs-save',key,value})}).catch(()=>{});}catch{}};

  // ---- explanations: one line until clicked -------------------------------------------------
  const clamp=(root)=>{for(const node of (root||document).querySelectorAll?.('.multi-repo-explain:not(.gd-clamp)')||[]){node.classList.add('gd-clamp');node.tabIndex=0;node.title=t('Click to read more');}};
  document.addEventListener('click',(event)=>{const node=event.target.closest?.('.multi-repo-explain.gd-clamp');if(node){node.classList.toggle('gd-open');node.title=node.classList.contains('gd-open')?'':t('Click to read more');}});
  document.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&event.target.classList?.contains('gd-clamp'))event.target.click();});
  new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){if(node.matches?.('.multi-repo-explain'))clamp(node.parentNode);else clamp(node);}}).observe(document.body,{childList:true,subtree:true});
  clamp(document);

  // ---- notification center -------------------------------------------------------------------
  const bar=document.getElementById('workspace-statusbar');
  let notices=[];try{notices=JSON.parse(sessionStorage.getItem('gitdeck.notices')||'[]');}catch{}
  let unread=0;
  const bell=el('button','gd-bell','🔔');bell.type='button';bell.title=t('Notifications');bell.setAttribute('aria-label',t('Notifications'));
  const drawBell=()=>{bell.replaceChildren('🔔');if(unread)bell.append(el('b','',String(unread)));};
  let inbox=null;
  const closeInbox=()=>{inbox?.remove();inbox=null;};
  const openInbox=()=>{
    if(inbox){closeInbox();return;}
    unread=0;drawBell();inbox=el('section','gd-inbox');inbox.setAttribute('role','dialog');inbox.setAttribute('aria-label',t('Notifications'));
    const head=el('h3','',t('Notifications'));const clear=el('button','',t('Clear'));clear.type='button';clear.onclick=()=>{notices=[];try{sessionStorage.removeItem('gitdeck.notices');}catch{}closeInbox();};head.append(clear);inbox.append(head);
    if(!notices.length)inbox.append(el('p','gd-empty',t('Nothing yet this session.')));
    for(const notice of notices){const row=el('div',`gd-inbox-item tone-${notice.error?'bad':'ok'}`);row.append(el('span','',notice.error?'✗':'✓'),el('div','',notice.text+(notice.count>1?` ×${notice.count}`:'')),el('small','',[new Date(notice.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),notice.context].filter(Boolean).join(' · ')));inbox.append(row);}
    document.body.append(inbox);
  };
  bell.onclick=(event)=>{event.stopPropagation();openInbox();};
  document.addEventListener('click',(event)=>{if(inbox&&!inbox.contains(event.target)&&event.target!==bell)closeInbox();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeInbox();});
  if(typeof showActionFeedback==='function'){
    const base=showActionFeedback;
    showActionFeedback=function(message,options={}){
      notices=pushNotice(notices,{text:String(message||'').split(/\r?\n/)[0].slice(0,200),error:Boolean(options?.error),context:options?.context||'',at:Date.now()});
      try{sessionStorage.setItem('gitdeck.notices',JSON.stringify(notices));}catch{}
      if(!inbox){unread++;drawBell();}
      return base.apply(this,arguments);
    };
  }

  // ---- live indicator -----------------------------------------------------------------------
  const live=el('span','gd-status-live',t('Live'));live.title=t('Git Deck updates rows by itself when you commit, push or switch elsewhere');
  window.addEventListener('gitdeck:live',(event)=>{live.classList.toggle('on',Boolean(event.detail?.on));live.title=event.detail?.on?t('Live: commits, pushes and switches made elsewhere show up by themselves'):t('Not connected to Git Deck; reconnecting…');});
  if(window.gitDeckLive)window.dispatchEvent(new CustomEvent('gitdeck:live',{detail:{on:true}}));
  if(bar){const spacer=bar.querySelector('.status-spacer');if(spacer)spacer.after(live,bell);else bar.append(live,bell);}

  // ---- docked Dashboard ---------------------------------------------------------------------
  const head=document.querySelector('.operations-head');
  if(head){
    const dock=el('button','gd-dock-toggle','⇥');dock.type='button';
    const sync=()=>{const on=document.body.classList.contains('gd-docked');dock.textContent=on?'⤢':'⇥';dock.title=on?t('Full window'):t('Dock beside the repository');dock.setAttribute('aria-pressed',String(on));};
    dock.onclick=()=>{document.body.classList.toggle('gd-docked');const on=document.body.classList.contains('gd-docked');try{localStorage.setItem('gitdeck.dock',on?'1':'0');}catch{}prefs('dashboardDock',on);sync();};
    try{if(localStorage.getItem('gitdeck.dock')==='1')document.body.classList.add('gd-docked');}catch{}
    const close=document.getElementById('operations-close');if(close)close.before(dock);else head.append(dock);sync();
    // Tools close the Dashboard before opening a repository; docked, it stays (only your own click closes it).
    document.addEventListener('click',(event)=>{if(event.target?.id==='operations-close'&&!event.isTrusted&&document.body.classList.contains('gd-docked')&&window.innerWidth>=1280){event.stopImmediatePropagation();event.preventDefault();}},true);
  }

  // ---- one keyboard everywhere in the Dashboard ---------------------------------------------
  // j/k move between rows, cards and tiles of the open tool, Enter opens, / searches, ? lists keys.
  // (The Pending table handles its own rows first and marks the event as handled.)
  const shortcutList=document.querySelector('[data-about-view="shortcuts"] .shortcut-list');
  if(shortcutList)for(const [label,keys] of [[t('Dashboard: next / previous row, card or tile'),'J / K'],[t('Dashboard: open the focused item'),'Enter'],[t('Dashboard: search in the open tool'),'/'],[t('Pending: commit / push / pull the focused row'),'C / P / U']]){const line=el('span','',label+' ');line.append(el('kbd','',keys));shortcutList.append(line);}
  const dashboardOpen=()=>!document.getElementById('operations-backdrop')?.classList.contains('hidden');
  const typing=(target)=>Boolean(target&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)));
  document.addEventListener('keydown',(event)=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||!dashboardOpen()||typing(event.target))return;
    const panel=document.querySelector('[data-operations-panel]:not(.hidden)');if(!panel)return;
    if(event.key==='?'){event.preventDefault();if(typeof showAboutDialog==='function')showAboutDialog('shortcuts');return;}
    if(event.key==='/'){const box=panel.querySelector('input[type="search"],input:not([type]),textarea')||document.querySelector('.operations-tabs input');if(box){event.preventDefault();box.focus();box.select?.();}return;}
    const items=[...panel.querySelectorAll('tr.pending-row,.gd-card,.gd-tile,.pending-line,.family-edit-card')].filter(node=>node.offsetParent!==null);
    if(!items.length)return;
    for(const node of items)if(!node.matches('button')&&node.tabIndex<0)node.tabIndex=0;
    const at=items.indexOf(event.target.closest?.('tr.pending-row,.gd-card,.gd-tile,.pending-line,.family-edit-card'));
    if(event.key==='j'||event.key==='k'){event.preventDefault();const next=items[Math.max(0,Math.min(items.length-1,at<0?0:at+(event.key==='j'?1:-1)))];next.focus();next.scrollIntoView({block:'nearest'});return;}
    if(event.key==='Enter'&&at>=0&&!event.target.matches('button')){const action=items[at].querySelector('button');if(action){event.preventDefault();action.click();}}
  });

  // ---- ticket mode: every view follows one ticket ------------------------------------------
  // A chip next to the repository tabs. With a ticket chosen: tabs of other repositories are dimmed,
  // Pending work is filtered to the ticket's branches, and the Ticket view opens on it.
  const tabsNav=document.getElementById('repo-tabs');
  if(tabsNav&&typeof api==='function'){
    const chip=el('span','gd-ticket-chip');chip.hidden=true;
    const start=el('button','repo-tab-search gd-ticket-start','🎫');start.type='button';start.title=t('Ticket mode: follow one ticket in every view');start.setAttribute('aria-label',t('Ticket mode'));
    let current=null;
    const applyTabs=()=>{if(!current)return;for(const tab of tabsNav.querySelectorAll('.repo-tab')){const key=String(tab.dataset.repoKey||'').toLowerCase();const path=(state.repos||[]).find(repo=>repoKey(repo)===tab.dataset.repoKey)?.path?.toLowerCase()||key;tab.classList.toggle('gd-off-ticket',!current.repos.has(path));}};
    const draw=(text)=>{chip.replaceChildren(el('span','',text));const stop=el('button','','✕');stop.type='button';stop.title=t('Leave ticket mode');stop.onclick=leave;const open=el('button','','↗');open.type='button';open.title=t('Open the ticket view');open.onclick=()=>{if(typeof showOperationsCenter==='function'){try{localStorage.setItem('gitdeck.ticketKey',current?.key||'');}catch{}showOperationsCenter('ticket');}};chip.append(open,stop);chip.hidden=false;};
    function leave(){current=null;chip.hidden=true;document.body.classList.remove('gd-ticket-mode');for(const tab of tabsNav.querySelectorAll('.gd-off-ticket'))tab.classList.remove('gd-off-ticket');try{sessionStorage.removeItem('gitdeck.ticketMode');}catch{}window.dispatchEvent(new CustomEvent('gitdeck:ticket',{detail:null}));}
    async function enter(key){
      key=String(key||'').trim().toUpperCase();if(!/^[A-Z][A-Z0-9]{1,9}-\d{1,12}$/.test(key))return;
      current={key,repos:new Set()};document.body.classList.add('gd-ticket-mode');try{sessionStorage.setItem('gitdeck.ticketMode',key);}catch{}
      const repos=(state.repos||[]).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));let done=0;const found=[];
      draw(`${key} · ${t('searching…')}`);
      const queue=[...repos];await Promise.all(Array.from({length:6},async()=>{while(queue.length){const repo=queue.shift();try{const answer=(await api('/api/repo/ticket?path='+encodeURIComponent(repo.path)+'&key='+encodeURIComponent(key))).ticket;found.push({path:repo.path,...answer});}catch{}done++;if(current?.key===key&&done%10===0)draw(`${key} · ${done}/${repos.length}`);}}));
      if(current?.key!==key)return;
      current.repos=ticketRepos(found);draw(`🎫 ${key} · ${t('{count} repositories',{count:current.repos.size})}`);applyTabs();
      window.dispatchEvent(new CustomEvent('gitdeck:ticket',{detail:{key,repos:[...current.repos]}}));
    }
    start.onclick=()=>{const guess=String(state.workspace?.branch||'').match(/[A-Z][A-Z0-9]{1,9}-\d+/)?.[0]||'';const key=prompt(t('Ticket key, for example AP2365-3320'),current?.key||guess);if(key)void enter(key);};
    tabsNav.after(chip);
    new MutationObserver(()=>{if(!tabsNav.contains(start))tabsNav.prepend(start);applyTabs();}).observe(tabsNav,{childList:true});
    tabsNav.prepend(start);
    try{const saved=sessionStorage.getItem('gitdeck.ticketMode');if(saved)setTimeout(()=>void enter(saved),3000);}catch{}
    window.GitDeckTicketMode={enter,leave,current:()=>current};
  }

  window.GitDeckUx={...helpers};
})();
