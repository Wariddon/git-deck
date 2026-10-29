'use strict';
// Power tools (server side: lib/GitDeck.Power.ps1). All in Ctrl+K; Desks-style panels in the Dashboard.
// - Sibling autopilot: copy one commit's change to the sibling repositories (same name after the
//   prefix, src-svc-x / txi-svc-x, or the same family); each is checked first, applied only when you
//   say so, never committed.
// - Save points: save every open tab (or the ticket's repositories) as they are now, uncommitted
//   changes included; load one later to put them all back. Loading saves the current state first.
// - Config lineage: where one setting comes from in every environment (web/effective-config.js).
// - Blast radius: what the commits you are about to push change for other services (HTTP endpoints
//   they call, Kafka topics they listen to), from the API map.
// - Clipboard ticket radar (GitDeck.exe): copy a ticket key anywhere and Git Deck offers to follow it.
// - Panic button (Ctrl+Alt+Backspace): everything Git Deck changed in any repository lately, each with
//   Undo or a recovery branch.
// - Branch graveyard (Dashboard): merged, gone or long-idle local branches in every repository; bury
//   them in one go and revive any for 7 days.
// - Morning diff: on the first start of the day, what came in overnight for your open tabs and which
//   of it touches files you are editing.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The part of a repository name siblings share: src-svc-customer-request -> svc-customer-request.
  const stem=(name)=>String(name||'').toLowerCase().replace(/^[^-]+-/,'');
  // Sibling repositories of `name`: same stem with another prefix first, then the same family.
  function siblings(name,repos,familyOf){
    const own=String(name).toLowerCase();const s=stem(name);const fam=familyOf?familyOf(name):'';
    const same=[],family=[];
    for(const repo of repos){
      const other=String(repo.name).toLowerCase();if(other===own)continue;
      if(s&&s!==own&&stem(repo.name)===s)same.push(repo);else if(fam&&familyOf(repo.name)===fam)family.push(repo);
    }
    return [...same,...family];
  }
  // Long-lived environment and release branches are never offered, even when merged.
  const lasting=/^(main|master|develop|development|dev|staging|stage|uat|sit|test|qa|prod|production|preprod|pre-prod|release|hotfix|deploy)(\/|$)/i;
  // Local branches worth burying: merged, upstream gone, or idle for `days`. Never protected or current.
  function graves(branches,now=Date.now(),days=90){
    return (branches||[]).filter(branch=>!branch.remote&&!branch.protected&&!branch.current&&!lasting.test(branch.name)).map(branch=>{
      const idle=Math.floor((now-Date.parse(branch.date))/864e5);
      const why=branch.merged?'merged':branch.gone?'gone':idle>=days?'idle':'';
      return why?{...branch,why,idle}:null;
    }).filter(Boolean);
  }
  // Tombstones kept for 7 days.
  const freshTombs=(tombs,now=Date.now())=>(tombs||[]).filter(tomb=>now-Date.parse(tomb.at)<7*864e5);
  // A save point id from a date: sp-20261029-143005.
  const pointId=(date=new Date())=>`sp-${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}${String(date.getSeconds()).padStart(2,'0')}`;
  const isTicket=(text)=>/^[A-Z][A-Z0-9]{1,9}-\d{1,12}$/.test(String(text||'').trim());
  // Blast radius: endpoints and topics this repository provides from the changed files, and who uses them.
  function blast(changed,own,others,mapHelpers){
    const files=new Set((changed||[]).map(file=>String(file).replace(/\\/g,'/').toLowerCase()));
    const touched=(item)=>files.has(String(item.file||'').replace(/\\/g,'/').toLowerCase());
    const endpoints=(own?.provides||[]).filter(touched);const topics=(own?.sends||[]).filter(touched);
    const hits=[];
    for(const {repo,surface} of others){
      for(const call of surface?.calls||[])for(const endpoint of endpoints)if(mapHelpers.callMatches(call.path,endpoint.path))hits.push({repo,kind:'http',what:`${endpoint.method||''} ${endpoint.path}`.trim(),file:call.file,line:call.line});
      for(const listen of surface?.listens||[])for(const topic of topics)if(String(listen.resolved||listen.topic)===String(topic.topic))hits.push({repo,kind:'kafka',what:topic.topic,file:listen.file,line:listen.line});
    }
    return {endpoints,topics,hits};
  }
  const helpers={stem,siblings,graves,freshTombs,pointId,isTicket,blast};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function'||typeof api!=='function')return;

  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const post=(body)=>api('/api/action',{method:'POST',body:JSON.stringify(body)});
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const toast=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const repoByPath=(path)=>(state.repos||[]).find(repo=>String(repo.path).toLowerCase()===String(path).toLowerCase());
  const live=()=>(state.repos||[]).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));
  const familyOf=(name)=>window.GitDeckWeather?.familyOf?window.GitDeckWeather.familyOf(name):String(name).split('-')[0]+'-';
  const refreshAll=async()=>{try{if(typeof refresh==='function')await refresh();if(state.workspaceRepo&&typeof loadWorkspace==='function')await loadWorkspace();}catch{}};
  const dialog=(title)=>{const ui=releaseDialog(title);ui.dialog.classList.add('gd-power-dialog');return ui;};

  // ---- sibling autopilot --------------------------------------------------------------------------
  async function siblingAutopilot(){
    const repo=state.workspaceRepo;if(!repo){toast(t('Open a repository first.'),true);return;}
    const commit=document.querySelector('.commit-row.selected[data-commit]')?.dataset.commit||state.workspace?.history?.[0]?.fullHash;
    const ui=dialog(t('Copy this change to sibling repositories'));ui.body.append(el('p','fleet-muted',t('Loading…')));
    let source;try{source=(await api('/api/repo/commit-patch?'+new URLSearchParams({path:repo.path,commit}))).patch;}catch(error){ui.body.replaceChildren(el('p','',error.message));return;}
    const list=siblings(repo.name,live(),familyOf).slice(0,30);
    ui.body.replaceChildren(el('p','',`${source.commit.slice(0,7)} · ${source.subject}`),el('small','fleet-muted',t('{count} files · each sibling is checked first; Apply only changes files, nothing is committed.',{count:source.files.length})));
    if(!list.length){ui.body.append(el('p','fleet-muted',t('No sibling repositories found.')));return;}
    const rows=el('div','gd-power-rows');ui.body.append(rows);const ready=[];
    for(const sibling of list){
      const row=el('div','gd-power-row');const status=el('small','fleet-muted',t('checking…'));const apply=button(t('Apply'));apply.disabled=true;
      row.append(el('b','',sibling.name),status,apply);rows.append(row);
      apply.onclick=async()=>{apply.disabled=true;try{const result=await post({action:'sibling-patch-apply',path:sibling.path,patch:source.patch,stage:false});status.textContent=result.message;row.classList.add('is-done');}catch(error){status.textContent=error.message;apply.disabled=false;}};
      try{const check=(await post({action:'sibling-patch-check',path:sibling.path,patch:source.patch})).check;
        if(check.ok){status.textContent=check.mode==='clean'?t('fits cleanly'):t('fits with a three-way merge');apply.disabled=false;ready.push(apply);row.classList.add('is-ok');}
        else{status.textContent=t('does not fit: {reason}',{reason:String(check.output).split('\n')[0]});row.classList.add('is-no');}
      }catch(error){status.textContent=error.message;}
    }
    if(ready.length){const all=button(t('Apply to all that fit ({count})',{count:ready.length}),'primary');all.onclick=async()=>{if(!confirm(t('Apply the change to {count} repositories? Nothing is committed.',{count:ready.length})))return;for(const node of ready)if(!node.disabled)await node.onclick();void refreshAll();};ui.actions.prepend(all);}
  }

  // ---- save points ------------------------------------------------------------------------------------
  const scopeRepos=()=>{
    const ticket=window.GitDeckTicketMode?.current?.();
    if(ticket?.repos?.size)return [...ticket.repos].map(repoByPath).filter(Boolean);
    return (state.meta?.openRepos||[]).map(key=>(state.repos||[]).find(repo=>repoKey(repo)===key)).filter(Boolean);
  };
  async function createPoint(name,repos=scopeRepos()){
    if(!repos.length){toast(t('Open a repository first.'),true);return null;}
    const id=pointId();const entries=[];const failed=[];
    for(const repo of repos){try{entries.push((await post({action:'savepoint-create',path:repo.path,id})).point);}catch(error){failed.push(`${repo.name}: ${error.message}`);}}
    const point={id,name:name||t('Save point {time}',{time:new Date().toLocaleString()}),at:new Date().toISOString(),repos:entries};
    writeJson('gitdeck.savepoints',[point,...readJson('gitdeck.savepoints',[])].slice(0,30));
    toast(t('Saved {count} repositories',{count:entries.length})+(failed.length?` · ${failed.join('; ')}`:''),failed.length>0);
    return point;
  }
  async function loadPoint(point){
    const names=point.repos.map(entry=>repoByPath(entry.path)?.name||entry.path).join(', ');
    if(!confirm(t('Load "{name}"? {names} go back to that moment. Your current state is saved first as a new save point.',{name:point.name,names})))return;
    const safety=await createPoint(t('Before loading {name}',{name:point.name}),point.repos.map(entry=>repoByPath(entry.path)).filter(Boolean));if(!safety)return;
    const problems=[];
    for(const entry of point.repos){try{await post({action:'savepoint-load',path:entry.path,id:point.id,head:entry.head,branch:entry.branch,stash:entry.stash});}catch(error){problems.push(`${repoByPath(entry.path)?.name||entry.path}: ${error.message}`);}}
    toast(problems.length?problems.join('; '):t('Loaded "{name}"',{name:point.name}),problems.length>0);void refreshAll();
  }
  async function dropPoint(point){
    for(const entry of point.repos){try{await post({action:'savepoint-drop',path:entry.path,id:point.id});}catch{}}
    writeJson('gitdeck.savepoints',readJson('gitdeck.savepoints',[]).filter(item=>item.id!==point.id));
  }
  function savePoints(){
    const ui=dialog(t('Save points'));
    const draw=()=>{
      ui.body.replaceChildren(el('p','fleet-muted',t('A save point keeps each repository\'s branch, commit and uncommitted changes to tracked files (new untracked files are not included). It covers the ticket\'s repositories in ticket mode, else your open tabs.')));
      const make=button(t('Save now'),'primary');make.onclick=async()=>{const name=prompt(t('Name this save point'),t('Before {time}',{time:new Date().toLocaleTimeString()}));if(name===null)return;make.disabled=true;await createPoint(name);draw();};
      ui.body.append(make);
      for(const point of readJson('gitdeck.savepoints',[])){
        const row=el('div','gd-power-row');const load=button(t('Load'));const drop=button(t('Delete'));
        load.onclick=async()=>{await loadPoint(point);draw();};drop.onclick=async()=>{if(confirm(t('Delete "{name}"?',{name:point.name}))){await dropPoint(point);draw();}};
        row.append(el('b','',point.name),el('small','fleet-muted',`${new Date(point.at).toLocaleString()} · ${point.repos.map(entry=>`${repoByPath(entry.path)?.name||'?'}@${entry.branch||entry.head.slice(0,7)}${entry.stash?' +':''}`).join(', ')}`),load,drop);
        ui.body.append(row);
      }
    };
    draw();
  }

  // ---- config lineage --------------------------------------------------------------------------------
  async function configLineage(){
    const repo=state.workspaceRepo;const E=window.GitDeckEffectiveConfig;if(!repo||!E?.lineage){toast(t('Open a repository first.'),true);return;}
    const key=prompt(t('Which setting? For example spring.redis.host'));if(!key)return;
    const ui=dialog(t('Where {key} comes from',{key}));ui.body.append(el('p','fleet-muted',t('Loading…')));
    try{
      const rows=await E.lineage(repo.path,key.trim());ui.body.replaceChildren();
      if(!rows.length){ui.body.append(el('p','fleet-muted',t('No environments found (no application-{env}.yml).')));return;}
      const tableNode=el('table','multi-repo-table');const head=el('tr');for(const label of [t('Environment'),t('Value'),t('Wins from'),t('Also set in')])head.append(el('th','',label));tableNode.append(head);
      for(const item of rows){const tr=el('tr',item.kind==='overridden'?'gd-power-warn':'');tr.append(el('td','',item.env),el('td','',item.value===undefined?t('(not set)'):String(item.value)),el('td','',item.from||''),el('td','',item.layers.filter(layer=>layer.label!==item.from).map(layer=>`${layer.label} = ${layer.value}`).join('\n')));tableNode.append(tr);}
      ui.body.append(tableNode,el('small','fleet-muted',t('Highlighted rows: a file sets it, but the deployment overrides it.')));
    }catch(error){ui.body.replaceChildren(el('p','',error.message));}
  }

  // ---- blast radius ----------------------------------------------------------------------------------
  async function blastRadius(){
    const repo=state.workspaceRepo;const M=window.GitDeckApiMap;if(!repo||!M){toast(t('Open a repository first.'),true);return;}
    const ui=dialog(t('Blast radius of your push'));ui.body.append(el('p','fleet-muted',t('Reading what you are about to push…')));
    try{
      const outgoing=(state.workspace?.sync?.outgoing||[]).map(line=>String(line).split(' ')[0]).filter(Boolean).slice(0,30);
      const changed=new Set((state.workspace?.files||[]).map(file=>file.path));
      for(const hash of outgoing){const commit=(await api('/api/repo/commit?'+new URLSearchParams({path:repo.path,commit:hash}))).commit;for(const file of commit.files||[])changed.add(file.path);}
      const own=(await api('/api/repo/api-surface?'+new URLSearchParams({path:repo.path}))).surface;
      const parent=String(repo.path).replace(/[\\/][^\\/]+$/,'').toLowerCase();
      const pool=live().filter(item=>item.path!==repo.path&&String(item.path).toLowerCase().startsWith(parent)).slice(0,80);
      ui.body.replaceChildren(el('p','fleet-muted',t('Scanning {count} services next to it…',{count:pool.length})));
      const others=[];const queue=[...pool];
      await Promise.all(Array.from({length:6},async()=>{while(queue.length){const item=queue.shift();try{others.push({repo:item,surface:(await api('/api/repo/api-surface?'+new URLSearchParams({path:item.path}))).surface});}catch{}}}));
      const result=blast([...changed],own,others,M);ui.body.replaceChildren();
      ui.body.append(el('p','',t('{files} changed files · {endpoints} endpoints and {topics} Kafka topics of this service are in them',{files:changed.size,endpoints:result.endpoints.length,topics:result.topics.length})));
      if(!result.hits.length){ui.body.append(el('p','gd-power-ok',t('No other service here calls what you changed. Safe to push as far as the API map can tell.')));return;}
      const byRepo=new Map();for(const hit of result.hits){if(!byRepo.has(hit.repo.path))byRepo.set(hit.repo.path,{repo:hit.repo,hits:[]});byRepo.get(hit.repo.path).hits.push(hit);}
      ui.body.append(el('p','gd-power-warn',t('{count} services use what you changed:',{count:byRepo.size})));
      for(const {repo:other,hits} of byRepo.values()){const row=el('div','gd-power-row');const open=button(t('Open'));open.onclick=()=>{ui.dialog.close();void openWorkspace(other,'changes');};row.append(el('b','',other.name),el('small','fleet-muted',[...new Set(hits.map(hit=>`${hit.kind==='kafka'?'Kafka':'HTTP'} ${hit.what} (${hit.file}:${hit.line})`))].slice(0,6).join('\n')),open);ui.body.append(row);}
    }catch(error){ui.body.replaceChildren(el('p','',error.message));}
  }

  // ---- clipboard ticket radar (GitDeck.exe sends "ticket:KEY") ------------------------------------------
  let lastTicket='';
  function offerTicket(key){
    key=String(key||'').trim().toUpperCase();if(!isTicket(key)||key===lastTicket||window.GitDeckTicketMode?.current?.()?.key===key)return;lastTicket=key;
    document.querySelector('.gd-radar')?.remove();
    const card=el('div','gd-radar');card.setAttribute('role','status');const go=button(t('Follow {key}',{key}),'primary');const no=button(t('Not now'));
    go.onclick=()=>{card.remove();window.GitDeckTicketMode?.enter?.(key);};no.onclick=()=>card.remove();
    card.append(el('strong','',`🎫 ${key}`),el('small','',t('You copied a ticket key. Follow it in every repository?')),go,no);document.body.append(card);
    setTimeout(()=>card.remove(),20000);
  }
  window.chrome?.webview?.addEventListener?.('message',(event)=>{const text=String(event.data||'');if(text.startsWith('ticket:'))offerTicket(text.slice(7));});
  document.addEventListener('paste',(event)=>{if(event.target.closest?.('input, textarea, [contenteditable="true"]'))return;const text=event.clipboardData?.getData('text')||'';if(isTicket(text.trim()))offerTicket(text);});

  // ---- panic button ------------------------------------------------------------------------------------
  async function panic(minutes=30){
    const ui=dialog(t('What did I just do?'));
    const pick=document.createElement('select');for(const [value,label] of [[30,t('Last 30 minutes')],[120,t('Last 2 hours')],[1440,t('Today')]])pick.append(new Option(label,value));pick.value=String(minutes);
    const list=el('div','gd-power-rows');ui.body.append(el('p','fleet-muted',t('Everything Git Deck changed in any repository. Undo puts that repository back as it was before (only when nothing newer happened there); a recovery branch keeps the old commit without moving anything.')),pick,list);
    const draw=async()=>{
      list.replaceChildren(el('small','fleet-muted',t('Loading…')));
      let items=[];try{items=(await api('/api/journal/recent?minutes='+pick.value)).journal||[];}catch(error){list.replaceChildren(el('p','',error.message));return;}
      list.replaceChildren();if(!items.length){list.append(el('p','gd-power-ok',t('Nothing changed in that time.')));return;}
      for(const item of items){
        const row=el('div','gd-power-row');const undo=button(t('Undo'));const keep=button(t('Recovery branch'));
        undo.onclick=async()=>{if(!confirm(t('Undo {action} in {repo}?',{action:item.action,repo:item.repository})))return;try{toast((await post({action:'journal-restore-head',path:item.path,id:item.id})).message);void refreshAll();void draw();}catch(error){toast(error.message,true);}};
        keep.onclick=async()=>{const branch=prompt(t('Name of the recovery branch'),`recover/${item.action}-${String(item.beforeHead).slice(0,7)}`);if(!branch)return;try{toast((await post({action:'journal-recovery-branch',path:item.path,id:item.id,branch})).message);}catch(error){toast(error.message,true);}};
        row.append(el('b','',`${new Date(item.createdAt).toLocaleTimeString()} · ${item.repository} · ${item.action}`),el('small','fleet-muted',`${item.beforeBranch||'?'}@${String(item.beforeHead).slice(0,7)} → ${item.afterBranch||'?'}@${String(item.afterHead).slice(0,7)}`),undo,keep);
        list.append(row);
      }
    };
    pick.onchange=draw;void draw();
  }
  document.addEventListener('keydown',(event)=>{if(event.ctrlKey&&event.altKey&&!event.shiftKey&&event.key==='Backspace'){event.preventDefault();void panic();}});

  // ---- morning diff ----------------------------------------------------------------------------------
  async function morning(force=false){
    const today=new Date().toDateString();if(!force&&readJson('gitdeck.morningDay','')===today)return;writeJson('gitdeck.morningDay',today);
    const repos=(state.meta?.openRepos||[]).map(key=>(state.repos||[]).find(repo=>repoKey(repo)===key)).filter(Boolean);if(!repos.length)return;
    const found=[];
    for(const repo of repos){try{const pull=(await api('/api/repo/pull-preview?'+new URLSearchParams({path:repo.path}))).pull;if(pull.behind>0)found.push({repo,pull});}catch{}}
    if(!found.length){if(force)toast(t('Nothing new came in for your open tabs.'));return;}
    document.querySelector('.gd-morning')?.remove();
    const card=el('section','gd-morning');card.setAttribute('aria-label',t('Morning diff'));
    const close=button('✕');close.onclick=()=>card.remove();
    card.append(el('strong','',t('While you were away')),close);
    for(const {repo,pull} of found){
      const row=el('div','gd-power-row');const open=button(t('Open'));open.onclick=()=>{card.remove();void openWorkspace(repo,'history');};
      row.append(el('b','',repo.name),el('small',pull.overlap.length?'gd-power-warn':'fleet-muted',t('{count} new commits from {target}',{count:pull.behind,target:pull.target})+(pull.overlap.length?` · ${t('touch files you are editing: {files}',{files:pull.overlap.slice(0,4).join(', ')})}`:'')),open);
      card.append(row);
    }
    const fetchAll=button(t('Fetch these and check again'));fetchAll.onclick=async()=>{fetchAll.disabled=true;for(const {repo} of found){try{await post({action:'fetch',path:repo.path});}catch{}}card.remove();void morning(true);};
    card.append(fetchAll);document.body.append(card);
  }
  setTimeout(()=>{if(!document.hidden)void morning(false);},9000);

  // ---- branch graveyard (Dashboard) --------------------------------------------------------------------
  const F=window.GitDeckFleet;
  if(F&&document.querySelector('.operations-tabs'))F.addPanel('graveyard',t('Branch graveyard'),(panel)=>{
    const bar=el('div','operations-toolbar');const folder=F.folderSelect();const scan=button(t('Find graves'),'primary');bar.append(folder,scan);
    const status=el('small','multi-repo-status');const list=el('div','gd-power-rows');const tombs=el('div','gd-power-rows');
    panel.append(bar,el('p','multi-repo-explain',t('Local branches that are merged into the main line, whose remote branch is gone, or that have not moved for 90 days, in every repository. Bury the ones you tick; each can be revived here for 7 days. Remote branches, protected and current branches are never touched.')),status,list,el('h4','',t('Recently buried')),tombs);
    const drawTombs=()=>{
      const kept=freshTombs(readJson('gitdeck.graveyard',[]));writeJson('gitdeck.graveyard',kept);tombs.replaceChildren();
      if(!kept.length){tombs.append(el('small','fleet-muted',t('Nothing buried in the last 7 days.')));return;}
      for(const tomb of kept){const row=el('div','gd-power-row');const revive=button(t('Revive'));
        revive.onclick=async()=>{try{await post({action:'branch-create-at',path:tomb.path,branch:tomb.branch,commit:tomb.hash});writeJson('gitdeck.graveyard',readJson('gitdeck.graveyard',[]).filter(item=>!(item.path===tomb.path&&item.branch===tomb.branch)));toast(t('{branch} is back in {repo}',{branch:tomb.branch,repo:tomb.repo}));drawTombs();}catch(error){toast(error.message,true);}};
        row.append(el('b','',`🪦 ${tomb.repo} · ${tomb.branch}`),el('small','fleet-muted',`${String(tomb.hash).slice(0,7)} · ${new Date(tomb.at).toLocaleString()}`),revive);tombs.append(row);}
    };
    scan.onclick=async()=>{
      scan.disabled=true;list.replaceChildren();const repos=F.reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));const found=[];let done=0;
      const queue=[...repos];
      await Promise.all(Array.from({length:6},async()=>{while(queue.length){const repo=queue.shift();try{const cleanup=(await api('/api/repo/branch-cleanup?'+new URLSearchParams({path:repo.path}))).cleanup;for(const grave of graves(cleanup.branches))found.push({repo,grave});}catch{}done++;status.textContent=t('Checked {done} of {count}',{done,count:repos.length});}}));
      scan.disabled=false;status.textContent=t('{count} graves in {repos} repositories',{count:found.length,repos:new Set(found.map(item=>item.repo.path)).size});
      const boxes=[];
      for(const {repo,grave} of found.sort((a,b)=>a.repo.name.localeCompare(b.repo.name))){
        const row=el('label','gd-power-row');const box=document.createElement('input');box.type='checkbox';box.checked=grave.why!=='idle';boxes.push({box,repo,grave});
        row.append(box,el('b','',`${repo.name} · ${grave.name}`),el('small','fleet-muted',{merged:t('merged'),gone:t('remote branch gone'),idle:t('idle {days} days',{days:grave.idle})}[grave.why]));list.append(row);
      }
      if(!boxes.length)return;
      const bury=button(t('Bury ticked'),'primary');list.prepend(bury);
      bury.onclick=async()=>{
        const chosen=boxes.filter(item=>item.box.checked);if(!chosen.length||!confirm(t('Delete {count} local branches? You can revive them here for 7 days.',{count:chosen.length})))return;
        bury.disabled=true;let ok=0;
        for(const {box,repo,grave} of chosen){try{await post({action:'branch-delete',path:repo.path,branch:grave.name,force:true});writeJson('gitdeck.graveyard',[{path:repo.path,repo:repo.name,branch:grave.name,hash:grave.hash,at:new Date().toISOString()},...readJson('gitdeck.graveyard',[])]);box.closest('label').remove();ok++;}catch(error){box.closest('label').append(el('small','gd-power-warn',error.message));}}
        toast(t('Buried {count} branches',{count:ok}));drawTombs();bury.disabled=false;
      };
    };
    drawTombs();
  });

  // ---- Ctrl+K -------------------------------------------------------------------------------------
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;const group=t('Power');
    commandPaletteEntries=function(...args){
      const extra=[[t('Copy this change to sibling repositories'),siblingAutopilot,'sibling autopilot patch'],[t('Save point: save now'),()=>void createPoint(prompt(t('Name this save point'),t('Before {time}',{time:new Date().toLocaleTimeString()}))||''),'savepoint'],[t('Save points…'),savePoints,'savepoint load'],[t('Where does a setting come from?'),configLineage,'config lineage effective'],[t('Blast radius of my push'),blastRadius,'blast radius impact'],[t('What did I just do? (panic)'),()=>void panic(),'panic undo journal'],[t('Morning diff: what came in'),()=>void morning(true),'morning overnight incoming'],[t('Branch graveyard'),()=>{if(typeof showOperationsCenter==='function')showOperationsCenter('inbox');setTimeout(()=>switchOperationsView?.('graveyard'),400);},'cleanup branches']];
      return [...base.apply(this,args),...extra.map(([label,run,words])=>({label,group,shortcut:words.startsWith('panic')?'Ctrl+Alt+Backspace':'',run,search:`${label} ${group} ${words}`}))];
    };
  }
  window.GitDeckPower={...helpers,siblingAutopilot,savePoints,createPoint,configLineage,blastRadius,offerTicket,panic,morning};
})();
