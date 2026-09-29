'use strict';
// Modern look, structural part (styles: web/modern.css, icons: web/icons.js).
// Only acts while html.ui-modern is set; everything it adds carries the
// .modern-made class and everything it hides is hidden by modern.css, so
// switching to Classic removes it all.
// - Header: "repo / branch ▾" breadcrumb and one smart primary button.
// - Left icon rail for the main views.
// - Toolbar icons, History avatars, relative dates and ref chip colours.
// - Empty states get an icon (and a next step where there is an obvious one).
(function(){
  if(typeof selectWorkspaceTab!=='function'||!window.GitDeckIcons)return;
  const icon=GitDeckIcons.svg;
  const isModern=()=>document.documentElement.classList.contains('ui-modern');
  const $id=(id)=>document.getElementById(id);

  // ---- Smart primary action -------------------------------------------------------------------
  // The one thing most likely to be next, from the same data the status bar uses.
  function primaryAction(data){
    if(!data)return null;
    const files=data.files||[];const sync=data.sync||{};const op=data.operation||{};
    const conflicts=Array.isArray(op.conflicts)?op.conflicts.length:Number(op.conflicts)||0;
    const staged=files.filter(file=>file.staged).length;
    if(op.active&&conflicts)return {kind:'conflicts',icon:'conflict',label:t('Resolve {count} conflict(s)',{count:conflicts}),title:t('Open Conflict Center')};
    if(staged)return {kind:'commit',icon:'check',label:t('Commit {count}',{count:staged}),title:t('Write a message and commit the staged files')};
    if(files.length)return {kind:'review',icon:'changes',label:t('Review {count} change(s)',{count:files.length}),title:t('Open File Status to stage and commit')};
    if(sync.behind>0)return {kind:'pull',icon:'pull',label:t('Pull {count}',{count:sync.behind}),title:t('Bring {count} incoming commit(s) into this branch',{count:sync.behind})};
    if(sync.ahead>0)return {kind:'push',icon:'push',label:t('Push {count}',{count:sync.ahead}),title:t('Publish {count} commit(s)',{count:sync.ahead})};
    if(data.branch&&!sync.upstream&&(data.remotes||[]).length)return {kind:'push',icon:'push',label:t('Publish branch'),title:t('Push this branch and set its upstream')};
    return {kind:'fetch',icon:'fetch',label:t('Fetch'),title:t('Check the remote for new commits')};
  }
  function runPrimary(kind){
    const click=(selector)=>document.querySelector(selector)?.click();
    if(kind==='conflicts')selectWorkspaceTab('conflicts');
    else if(kind==='review')selectWorkspaceTab('changes');
    else if(kind==='commit'){
      if(state.workspaceTab!=='changes')selectWorkspaceTab('changes');
      // The Changes view may still be rendering; try for up to a second.
      const focus=(tries)=>{const box=document.querySelector('#workspace-content .commit-composer textarea');if(box&&box.isConnected){box.focus();return;}if(tries)setTimeout(()=>focus(tries-1),50);};
      setTimeout(()=>focus(20),0);
    }
    else click(`.sync-actions [data-git-action="${kind}"]`);
  }

  // ---- Header: breadcrumb + primary ------------------------------------------------------------
  let crumbs,repoButton,branchButton,primary;
  function buildHeader(){
    const head=document.querySelector('.workspace-modal-head');if(!head||head.querySelector('.modern-crumbs'))return;
    crumbs=el('nav','modern-crumbs modern-made');crumbs.setAttribute('aria-label',t('Repository and branch'));
    repoButton=el('button','modern-crumb');repoButton.type='button';repoButton.title=t('Switch repository (Ctrl+P)');
    repoButton.addEventListener('click',()=>typeof showRepoSwitcher==='function'&&showRepoSwitcher());
    branchButton=el('button','modern-crumb modern-crumb-branch');branchButton.type='button';branchButton.title=t('Switch branch');
    branchButton.setAttribute('aria-haspopup','dialog');branchButton.addEventListener('click',(event)=>{event.stopPropagation();toggleBranchMenu();});
    crumbs.append(repoButton,el('span','modern-crumb-sep','/'),branchButton);
    head.prepend(crumbs);
    const sync=document.querySelector('.sync-actions');
    primary=el('button','modern-primary modern-made');primary.type='button';primary.addEventListener('click',()=>runPrimary(primary.dataset.kind));
    if(sync)sync.prepend(primary);
  }
  function renderHeader(){
    if(!crumbs)return;const data=state.workspace;const repo=state.workspaceRepo;
    repoButton.replaceChildren(icon('folder'),el('span','',repo?.name||t('Select a repository')));
    branchButton.hidden=!repo;
    branchButton.replaceChildren(icon('branch'),el('span','',data?.branch||t('Detached HEAD')),icon('chevron',14));
    const action=repo?primaryAction(data):null;primary.hidden=!action;
    if(action){primary.dataset.kind=action.kind;primary.title=action.title;primary.replaceChildren(icon(action.icon),el('span','',action.label));}
  }

  // ---- Branch menu -----------------------------------------------------------------------------
  let branchMenu=null;
  function closeBranchMenu(){branchMenu?.remove();branchMenu=null;branchButton?.setAttribute('aria-expanded','false');}
  function toggleBranchMenu(){
    if(branchMenu){closeBranchMenu();return;}
    const data=state.workspace;if(!data)return;
    branchMenu=el('section','modern-branch-menu modern-made');branchMenu.setAttribute('role','dialog');branchMenu.setAttribute('aria-label',t('Switch branch'));
    const search=el('input','');search.type='search';search.placeholder=t('Find a branch…');search.setAttribute('aria-label',t('Find a branch…'));
    const list=el('div','modern-branch-list');
    const draw=()=>{
      const term=search.value.trim().toLowerCase();list.replaceChildren();
      const branches=(data.branches||[]).filter(branch=>!term||branch.name.toLowerCase().includes(term)).slice(0,60);
      if(!branches.length)list.append(el('p','modern-branch-empty',t('No matching branches')));
      for(const branch of branches){
        const row=el('button','modern-branch-row');row.type='button';row.disabled=branch.current;
        const sync=[branch.ahead>0?'↑'+branch.ahead:'',branch.behind>0?'↓'+branch.behind:''].filter(Boolean).join(' ');
        row.append(branch.current?icon('check',14):el('span','modern-branch-spacer'),el('span','modern-branch-name',branch.name),el('small','',sync));
        row.addEventListener('click',()=>{closeBranchMenu();runWorkspaceAction('branch-switch',{branch:branch.name},t('Switch from {from} to branch {to}?',{from:data.branch||t('Detached HEAD'),to:branch.name}));});
        list.append(row);
      }
    };
    const foot=el('div','modern-branch-foot');
    const create=el('button','');create.type='button';create.append(icon('plus',14),el('span','',t('New branch…')));
    create.addEventListener('click',()=>{closeBranchMenu();$id('toolbar-create-branch')?.click();});
    const all=el('button','');all.type='button';all.append(icon('branch',14),el('span','',t('All branches')));
    all.addEventListener('click',()=>{closeBranchMenu();selectWorkspaceTab('branches');});
    foot.append(create,all);
    search.addEventListener('input',draw);
    search.addEventListener('keydown',(event)=>{
      if(event.key==='Escape'){closeBranchMenu();branchButton.focus();}
      if(event.key==='Enter'){list.querySelector('.modern-branch-row:not(:disabled)')?.click();}
    });
    branchMenu.append(search,list,foot);draw();
    const box=branchButton.getBoundingClientRect();branchMenu.style.left=Math.max(8,box.left)+'px';branchMenu.style.top=(box.bottom+4)+'px';
    document.body.append(branchMenu);branchButton.setAttribute('aria-expanded','true');search.focus();
  }
  document.addEventListener('mousedown',(event)=>{if(branchMenu&&!branchMenu.contains(event.target)&&!branchButton.contains(event.target))closeBranchMenu();});

  // ---- Left rail -------------------------------------------------------------------------------
  const railItems=[
    ['changes','changes',()=>t('File Status')],['history','history',()=>t('History')],['branches','branch',()=>t('Branches')],
    ['stashes','stash',()=>t('Stashes')],['tags','tag',()=>t('Tags')],['compare','compare',()=>t('Compare')],
    ['conflicts','conflict',()=>t('Conflicts')],['recovery','recovery',()=>t('Recovery')],
  ];
  const railBottom=[['tools','tools',()=>t('Tools')],['settings','settings',()=>t('Settings')]];
  let rail=null;
  function buildRail(){
    const body=document.querySelector('.workbench-body');if(!body||body.querySelector('.modern-rail'))return;
    rail=el('nav','modern-rail modern-made');rail.setAttribute('aria-label',t('Views'));
    const add=(target,[tab,name,label])=>{
      const button=el('button','modern-rail-item');button.type='button';button.dataset.tab=tab;
      button.title=label();button.setAttribute('aria-label',label());button.append(icon(name,18),el('b','modern-rail-badge'));
      button.addEventListener('click',()=>selectWorkspaceTab(tab));target.append(button);
    };
    railItems.forEach(item=>add(rail,item));
    const bottom=el('div','modern-rail-bottom');railBottom.forEach(item=>add(bottom,item));rail.append(bottom);
    body.prepend(rail);
  }
  function renderRail(){
    if(!rail)return;const data=state.workspace||{};const op=data.operation||{};
    const conflicts=Array.isArray(op.conflicts)?op.conflicts.length:Number(op.conflicts)||0;
    const counts={changes:(data.files||[]).length,stashes:(data.stashes||[]).length,conflicts};
    for(const button of rail.querySelectorAll('.modern-rail-item')){
      const active=button.dataset.tab===state.workspaceTab;button.classList.toggle('active',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      const count=counts[button.dataset.tab]||0;const badge=button.querySelector('.modern-rail-badge');
      badge.textContent=count>99?'99+':count?String(count):'';badge.hidden=!count;
      button.classList.toggle('modern-rail-alert',button.dataset.tab==='conflicts'&&count>0);
      button.hidden=button.dataset.tab==='conflicts'&&!count&&!active;
    }
  }

  // ---- Toolbar icons ---------------------------------------------------------------------------
  const toolbarIcons={fetch:'fetch',pull:'pull',push:'push'};
  function decorateToolbar(){
    for(const [action,name] of Object.entries(toolbarIcons)){
      const button=document.querySelector(`.sync-actions [data-git-action="${action}"]`);
      if(button&&!button.querySelector('.modern-made')){const node=icon(name);node.classList.add('modern-made');button.prepend(node);}
    }
    const more=document.querySelector('.sync-more > summary');
    if(more&&!more.querySelector('.modern-made')){const node=icon('more');node.classList.add('modern-made');more.prepend(node);}
    // The icon replaces the legacy glyph (↓ ⇣ ⇡ •••); the words stay. Restored by teardown().
    for(const label of document.querySelectorAll('.sync-actions [data-git-action] > strong, .sync-more > summary > strong')){
      if(label.dataset.modernText!==undefined)continue;
      const text=label.textContent;const words=text.replace(/^[^\p{L}\p{N}]+/u,'');
      if(words!==text){label.dataset.modernText=text;label.textContent=words;}
    }
  }
  function restoreToolbar(){for(const label of document.querySelectorAll('[data-modern-text]')){label.textContent=label.dataset.modernText;delete label.dataset.modernText;}}

  // ---- History: avatars, relative time, ref chips ---------------------------------------------
  function initials(name){
    const words=String(name||'?').replace(/[<(].*$/,'').trim().split(/[\s._-]+/).filter(Boolean);
    return ((words[0]?.[0]||'?')+(words.length>1?words.at(-1)[0]:'')).toUpperCase();
  }
  function hue(text){let value=0;for(const char of String(text))value=(value*31+char.charCodeAt(0))%360;return value;}
  function relativeTime(date,now=Date.now()){
    const seconds=Math.round((now-date.getTime())/1000);if(!Number.isFinite(seconds))return '';
    if(seconds<60)return t('just now');
    const minutes=Math.round(seconds/60);if(minutes<60)return t('{count}m ago',{count:minutes});
    const hours=Math.round(minutes/60);if(hours<24)return t('{count}h ago',{count:hours});
    const days=Math.round(hours/24);if(days<30)return t('{count}d ago',{count:days});
    const months=Math.round(days/30);if(months<12)return t('{count}mo ago',{count:months});
    return t('{count}y ago',{count:Math.round(days/365)});
  }
  function refKind(ref){
    if(ref.startsWith('HEAD'))return 'head';if(ref.startsWith('tag:'))return 'tag';
    if(ref.includes('/')&&(state.workspace?.remotes||[]).some(remote=>ref.startsWith((remote.name||remote)+'/')))return 'remote';
    if(ref==='refs/stash')return 'stash';return 'local';
  }
  function decorateHistory(root){
    for(const row of root.querySelectorAll('.commit-row:not([data-modern])')){
      row.dataset.modern='1';
      const author=row.querySelector('.commit-author');
      if(author&&!row.classList.contains('commit-wip')){
        const name=author.textContent;const avatar=el('span','modern-avatar modern-made',initials(name));
        avatar.style.setProperty('--avatar-hue',String(hue(name)));avatar.setAttribute('aria-hidden','true');author.prepend(avatar);
      }
      const time=row.querySelector('time[datetime]');
      if(time){const text=relativeTime(new Date(time.dateTime));if(text){time.dataset.absolute=time.textContent;time.textContent=text;}}
      for(const chip of row.querySelectorAll('.commit-refs i')){chip.dataset.ref=refKind(chip.title||chip.textContent);}
    }
  }

  // ---- Empty states ----------------------------------------------------------------------------
  const emptyIcons=[[/unavailable|failed/i,'alert'],[/^No stashes/,'stash'],[/^No (matching )?tags/,'tag'],[/branch/i,'branch'],[/commit|history/i,'history'],[/^Search|^No command|^No matching/,'search'],[/remote/i,'cloud'],[/conflict/i,'conflict'],[/diff|file/i,'changes']];
  const emptyActions={
    'No stashes':[()=>t('Review changes'),()=>selectWorkspaceTab('changes')],
    'No commits':[()=>t('Review changes'),()=>selectWorkspaceTab('changes')],
    'Select a repository':[()=>t('Switch repository'),()=>typeof showRepoSwitcher==='function'&&showRepoSwitcher()],
    'No remotes':[()=>t('Manage remotes'),()=>selectWorkspaceTab('remotes')],
  };
  if(typeof workspaceEmpty==='function'){
    const baseEmpty=workspaceEmpty;
    workspaceEmpty=function(title,description){
      const box=baseEmpty(title,description);
      if(!isModern())return box;
      const name=(emptyIcons.find(([pattern])=>pattern.test(String(title)))||[,'inbox'])[1];
      const art=el('span','modern-empty-icon modern-made');art.append(icon(name,28));box.prepend(art);
      const action=emptyActions[title];
      if(action&&!(title==='No remotes'&&state.workspaceTab==='remotes')){const button=el('button','modern-empty-action modern-made',action[0]());button.type='button';button.addEventListener('click',action[1]);box.append(button);}
      return box;
    };
  }

  // ---- Lifecycle -------------------------------------------------------------------------------
  function refresh(){if(!isModern())return;buildHeader();buildRail();decorateToolbar();renderHeader();renderRail();}
  function teardown(){closeBranchMenu();restoreToolbar();document.querySelectorAll('.modern-made').forEach(node=>node.remove());document.querySelectorAll('[data-modern]').forEach(node=>delete node.dataset.modern);crumbs=rail=primary=null;}
  if(typeof renderWorkspaceStatus==='function'){
    const baseStatus=renderWorkspaceStatus;
    renderWorkspaceStatus=function(...args){const result=baseStatus.apply(this,args);try{refresh();}catch(error){console.warn('Modern header unavailable',error);}return result;};
  }
  if(typeof selectWorkspaceTab==='function'){
    const baseSelect=selectWorkspaceTab;
    selectWorkspaceTab=function(...args){const result=baseSelect.apply(this,args);try{if(isModern())renderRail();}catch{}return result;};
  }
  const content=$id('workspace-content');let pending=false;
  // setTimeout, not requestAnimationFrame: rAF is paused while the window is hidden.
  if(content)new MutationObserver(()=>{if(pending||!isModern())return;pending=true;setTimeout(()=>{pending=false;decorateHistory(content);renderRail();},0);}).observe(content,{childList:true,subtree:true});
  const applyLook=()=>{if(isModern())refresh();else teardown();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLook);else applyLook();
  document.addEventListener('gitdeck:appearance',applyLook);
  window.GitDeckModern={primaryAction,relativeTime,initials,refKind};
})();
