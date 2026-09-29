'use strict';
// Modern look, structural part (styles: web/modern.css, icons: web/icons.js).
// Only acts while html.ui-modern is set; everything it adds carries the
// .modern-made class and everything it hides is hidden by modern.css, so
// switching to Classic removes it all.
// Patterns borrowed from widely used Git clients:
// - Header toolbar of labelled blocks: Repository ▾ | Branch ▾ | one sync button
//   whose label follows the branch (Fetch / Pull ↓N / Push ↑N / Publish) — GitHub Desktop.
// - Accent button only for the next local step (resolve, commit, review).
// - Activity rail with labels; its first item shows/hides the repository list — VS Code, Fork.
// - "No local changes" suggests next steps instead of an empty page — GitHub Desktop.
// - History avatars, relative dates, coloured ref chips — GitKraken, Fork, Tower.
(function(){
  if(typeof selectWorkspaceTab!=='function'||!window.GitDeckIcons)return;
  const icon=GitDeckIcons.svg;
  const isModern=()=>document.documentElement.classList.contains('ui-modern');
  const $id=(id)=>document.getElementById(id);
  const conflictCount=(data)=>{const op=data?.operation||{};return Array.isArray(op.conflicts)?op.conflicts.length:Number(op.conflicts)||0;};

  // ---- What to do next ---------------------------------------------------------------------------
  // primaryAction: the single most likely next step (local work first, then sync).
  function primaryAction(data){
    if(!data)return null;
    const files=data.files||[];const sync=data.sync||{};const op=data.operation||{};
    const conflicts=conflictCount(data);
    const staged=files.filter(file=>file.staged).length;
    if(op.active&&conflicts)return {kind:'conflicts',icon:'conflict',label:t('Resolve {count} conflict(s)',{count:conflicts}),title:t('Open Conflict Center')};
    if(staged)return {kind:'commit',icon:'check',label:t('Commit {count}',{count:staged}),title:t('Write a message and commit the staged files')};
    if(files.length)return {kind:'review',icon:'changes',label:t('Review {count} change(s)',{count:files.length}),title:t('Open File Status to stage and commit')};
    if(sync.behind>0)return {kind:'pull',icon:'pull',label:t('Pull {count}',{count:sync.behind}),title:t('Bring {count} incoming commit(s) into this branch',{count:sync.behind})};
    if(sync.ahead>0)return {kind:'push',icon:'push',label:t('Push {count}',{count:sync.ahead}),title:t('Publish {count} commit(s)',{count:sync.ahead})};
    if(data.branch&&!sync.upstream&&(data.remotes||[]).length)return {kind:'push',icon:'push',label:t('Publish branch'),title:t('Push this branch and set its upstream')};
    return {kind:'fetch',icon:'fetch',label:t('Fetch'),title:t('Check the remote for new commits')};
  }
  const localKinds=['conflicts','commit','review'];
  function remoteName(data){
    const upstream=String(data?.sync?.upstream||'');if(upstream.includes('/'))return upstream.split('/')[0];
    const first=(data?.remotes||[])[0];return (first&&(first.name||first))||'origin';
  }
  // syncAction: what the toolbar sync button does and says (null without a remote).
  function syncAction(data,now=Date.now()){
    if(!data||!(data.remotes||[]).length)return null;
    const sync=data.sync||{};const remote=remoteName(data);
    if(sync.behind>0)return {kind:'pull',icon:'pull',label:t('Pull {remote}',{remote}),caption:t('{count} incoming commit(s)',{count:sync.behind}),badge:'↓'+sync.behind};
    if(sync.ahead>0)return {kind:'push',icon:'push',label:t('Push {remote}',{remote}),caption:t('{count} commit(s) to publish',{count:sync.ahead}),badge:'↑'+sync.ahead};
    if(data.branch&&!sync.upstream)return {kind:'push',icon:'push',label:t('Publish branch'),caption:t('Not on {remote} yet',{remote})};
    const at=data.lastFetchAt||state.lastFetchAt;const when=at?relativeTime(new Date(at),now):'';
    return {kind:'fetch',icon:'fetch',label:t('Fetch {remote}',{remote}),caption:when?t('Last fetched {time}',{time:when}):t('Not fetched yet')};
  }
  const legacyClick=(kind)=>document.querySelector(`.sync-actions [data-git-action="${kind}"]`)?.click();
  function runAction(kind){
    if(kind==='conflicts')selectWorkspaceTab('conflicts');
    else if(kind==='review')selectWorkspaceTab('changes');
    else if(kind==='commit'){
      if(state.workspaceTab!=='changes')selectWorkspaceTab('changes');
      // The Changes view may still be rendering; try for up to a second.
      const focus=(tries)=>{const box=document.querySelector('#workspace-content .commit-composer textarea');if(box&&box.isConnected){box.focus();return;}if(tries)setTimeout(()=>focus(tries-1),50);};
      setTimeout(()=>focus(20),0);
    }
    else legacyClick(kind);
  }

  // ---- Popovers (branch menu, sync menu) ---------------------------------------------------------
  let popover=null,popoverAnchor=null;
  function closePopover(){popover?.remove();popover=null;popoverAnchor?.setAttribute('aria-expanded','false');popoverAnchor=null;}
  function openPopover(anchor,className,label,build){
    const same=popoverAnchor===anchor;closePopover();if(same)return;
    popover=el('section',`modern-popover ${className} modern-made`);popover.setAttribute('role','dialog');popover.setAttribute('aria-label',label);
    build(popover);document.body.append(popover);
    const box=anchor.getBoundingClientRect();const width=popover.offsetWidth;
    popover.style.left=Math.max(8,Math.min(box.left,innerWidth-width-8))+'px';popover.style.top=(box.bottom+6)+'px';
    popoverAnchor=anchor;anchor.setAttribute('aria-expanded','true');
    (popover.querySelector('input')||popover.querySelector('button:not(:disabled)'))?.focus();
  }
  document.addEventListener('mousedown',(event)=>{if(popover&&!popover.contains(event.target)&&!popoverAnchor?.contains(event.target))closePopover();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&popover){const anchor=popoverAnchor;closePopover();anchor?.focus();}});
  function menuItem(name,label,detail,run,{disabled=false,checked=false}={}){
    const button=el('button','modern-menu-item');button.type='button';button.disabled=disabled;
    const text=el('span','modern-menu-text');text.append(el('strong','',label));if(detail)text.append(el('small','',detail));
    button.append(checked?icon('check',14):name?icon(name,16):el('span','modern-menu-spacer'),text);
    button.addEventListener('click',()=>{closePopover();run();});return button;
  }

  function branchMenu(menu){
    const data=state.workspace;
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
        row.addEventListener('click',()=>{closePopover();runWorkspaceAction('branch-switch',{branch:branch.name},t('Switch from {from} to branch {to}?',{from:data.branch||t('Detached HEAD'),to:branch.name}));});
        list.append(row);
      }
    };
    const foot=el('div','modern-branch-foot');
    const create=el('button','');create.type='button';create.append(icon('plus',14),el('span','',t('New branch…')));
    create.addEventListener('click',()=>{closePopover();$id('toolbar-create-branch')?.click();});
    const all=el('button','');all.type='button';all.append(icon('branch',14),el('span','',t('All branches')));
    all.addEventListener('click',()=>{closePopover();selectWorkspaceTab('branches');});
    foot.append(create,all);
    search.addEventListener('input',draw);
    search.addEventListener('keydown',(event)=>{if(event.key==='Enter')list.querySelector('.modern-branch-row:not(:disabled)')?.click();});
    menu.append(search,list,foot);draw();
  }
  function syncMenu(menu){
    const data=state.workspace||{};const sync=data.sync||{};const remote=remoteName(data);
    menu.append(
      menuItem('fetch',t('Fetch {remote}',{remote}),t('Download new commits without changing your files'),()=>legacyClick('fetch')),
      menuItem('pull',t('Pull'),sync.behind>0?t('{count} incoming commit(s)',{count:sync.behind}):t('Bring remote commits into this branch'),()=>legacyClick('pull')),
      menuItem('push',t('Push'),sync.ahead>0?t('{count} commit(s) to publish',{count:sync.ahead}):t('Publish your commits'),()=>legacyClick('push')),
    );
    const strategy=$id('pull-strategy');
    if(strategy){
      menu.append(el('p','modern-menu-heading',t('When pulling')));
      for(const option of strategy.options){
        menu.append(menuItem('',option.textContent,'',()=>{strategy.value=option.value;strategy.dispatchEvent(new Event('change',{bubbles:true}));renderHeader();},{checked:strategy.value===option.value}));
      }
    }
  }

  // ---- Header toolbar ------------------------------------------------------------------------------
  let bar=null,repoButton,branchButton,syncButton,syncMore,primary;
  function toolbarBlock(className,caption,title){
    const button=el('button',`modern-tb ${className}`);button.type='button';button.title=title;
    const text=el('span','modern-tb-text');text.append(el('small','modern-tb-caption',caption),el('strong','modern-tb-value'));
    button.append(el('span','modern-tb-icon'),text);return button;
  }
  function setBlock(button,name,value,caption){
    button.querySelector('.modern-tb-icon').replaceChildren(icon(name,18));
    button.querySelector('.modern-tb-value').textContent=value;
    if(caption!==undefined)button.querySelector('.modern-tb-caption').textContent=caption;
  }
  function buildHeader(){
    const head=document.querySelector('.workspace-modal-head');if(!head||head.querySelector('.modern-toolbar'))return;
    bar=el('nav','modern-toolbar modern-made');bar.setAttribute('aria-label',t('Repository, branch and sync'));
    repoButton=toolbarBlock('modern-tb-repo',t('Repository'),t('Switch repository (Ctrl+P)'));
    repoButton.addEventListener('click',()=>typeof showRepoSwitcher==='function'&&showRepoSwitcher());
    branchButton=toolbarBlock('modern-tb-branch',t('Branch'),t('Switch branch'));branchButton.setAttribute('aria-haspopup','dialog');
    branchButton.addEventListener('click',()=>{if(state.workspace)openPopover(branchButton,'modern-branch-menu',t('Switch branch'),branchMenu);});
    const syncGroup=el('div','modern-tb-sync-group');
    syncButton=toolbarBlock('modern-tb-sync','','');syncButton.addEventListener('click',()=>runAction(syncButton.dataset.kind));
    syncMore=el('button','modern-tb-more');syncMore.type='button';syncMore.title=t('More sync options');syncMore.setAttribute('aria-label',t('More sync options'));syncMore.setAttribute('aria-haspopup','dialog');
    syncMore.append(icon('chevron',16));syncMore.addEventListener('click',()=>openPopover(syncMore,'modern-sync-menu',t('More sync options'),syncMenu));
    syncGroup.append(syncButton,syncMore);
    bar.append(repoButton,branchButton,syncGroup);head.prepend(bar);
    primary=el('button','modern-primary modern-made');primary.type='button';primary.addEventListener('click',()=>runAction(primary.dataset.kind));
    document.querySelector('.sync-actions')?.prepend(primary);
  }
  function renderHeader(){
    if(!bar)return;const data=state.workspace;const repo=state.workspaceRepo;
    setBlock(repoButton,'folder',repo?.name||t('Select a repository'));
    branchButton.hidden=!repo;setBlock(branchButton,'branch',data?.branch||t('Detached HEAD'));
    const sync=repo?syncAction(data):null;syncButton.parentElement.hidden=!sync;
    if(sync){
      syncButton.dataset.kind=sync.kind;syncButton.title=sync.caption;setBlock(syncButton,sync.icon,sync.label,sync.caption);
      syncButton.querySelector('.modern-tb-badge')?.remove();if(sync.badge)syncButton.append(el('b','modern-tb-badge',sync.badge));
    }
    const action=repo?primaryAction(data):null;const local=action&&localKinds.includes(action.kind);primary.hidden=!local;
    if(local){primary.dataset.kind=action.kind;primary.title=action.title;primary.replaceChildren(icon(action.icon),el('span','',action.label));}
  }

  // ---- Left rail -------------------------------------------------------------------------------
  const railItems=[
    ['changes','changes',()=>t('Changes')],['history','history',()=>t('History')],['branches','branch',()=>t('Branches')],
    ['stashes','stash',()=>t('Stashes')],['tags','tag',()=>t('Tags')],['compare','compare',()=>t('Compare')],
    ['conflicts','conflict',()=>t('Conflicts')],['recovery','recovery',()=>t('Recovery')],
  ];
  const railBottom=[['tools','tools',()=>t('Tools')],['settings','settings',()=>t('Settings')]];
  let rail=null;
  const libraryOpen=()=>!document.body.classList.contains('library-collapsed');
  function toggleLibrary(){(libraryOpen()?$id('library-collapse'):$id('library-open'))?.click();setTimeout(renderRail,0);}
  function railButton([tab,name,label]){
    const button=el('button','modern-rail-item');button.type='button';button.dataset.tab=tab;
    button.title=label();button.append(icon(name,18),el('span','modern-rail-label',label()),el('b','modern-rail-badge'));
    button.addEventListener('click',()=>tab==='repos'?toggleLibrary():selectWorkspaceTab(tab));return button;
  }
  function buildRail(){
    const body=document.querySelector('.workbench-body');if(!body||body.querySelector('.modern-rail'))return;
    rail=el('nav','modern-rail modern-made');rail.setAttribute('aria-label',t('Views'));
    rail.append(railButton(['repos','folder',()=>t('Repos')]),el('span','modern-rail-sep'));
    railItems.forEach(item=>rail.append(railButton(item)));
    const bottom=el('div','modern-rail-bottom');railBottom.forEach(item=>bottom.append(railButton(item)));rail.append(bottom);
    body.prepend(rail);
  }
  function renderRail(){
    if(!rail)return;const data=state.workspace||{};
    const counts={changes:(data.files||[]).length,stashes:(data.stashes||[]).length,conflicts:conflictCount(data)};
    for(const button of rail.querySelectorAll('.modern-rail-item')){
      const tab=button.dataset.tab;
      const active=tab==='repos'?libraryOpen():tab===state.workspaceTab;button.classList.toggle('active',active);
      if(tab==='repos')button.setAttribute('aria-pressed',String(active));
      else if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      const count=counts[tab]||0;const badge=button.querySelector('.modern-rail-badge');
      badge.textContent=count>99?'99+':count?String(count):'';badge.hidden=!count;
      button.classList.toggle('modern-rail-alert',tab==='conflicts'&&count>0);
      button.hidden=tab==='conflicts'&&!count&&!active;
    }
  }

  // ---- Toolbar: More gets an icon ----------------------------------------------------------------
  function decorateToolbar(){
    const more=document.querySelector('.sync-more > summary');
    if(more&&!more.querySelector('.modern-made')){const node=icon('more');node.classList.add('modern-made');more.prepend(node);}
    // The icon replaces the legacy glyph (•••); the word stays. Restored by teardown().
    for(const label of document.querySelectorAll('.sync-more > summary > strong')){
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

  // ---- No local changes: suggested next steps --------------------------------------------------------
  function suggestion(name,title,detail,label,run,primaryStyle=false){
    const card=el('section','modern-suggestion');const text=el('div','modern-suggestion-text');
    text.append(el('strong','',title),el('p','',detail));
    const button=el('button',primaryStyle?'modern-suggestion-action primary':'modern-suggestion-action',label);button.type='button';button.addEventListener('click',run);
    const art=el('span','modern-suggestion-icon');art.append(icon(name,20));card.append(art,text,button);return card;
  }
  function quick(name){return ()=>document.querySelector(`[data-workspace-quick="${name}"]`)?.click();}
  function nothingToCommit(data){
    const panel=el('section','modern-clean modern-made');
    const head=el('div','modern-clean-head');const art=el('span','modern-empty-icon');art.append(icon('check',28));
    head.append(art,el('h3','',t('No local changes')),el('p','',t('Everything in this branch is committed. Some things you might do next:')));
    const list=el('div','modern-suggestions');
    const sync=syncAction(data);
    if(sync&&sync.kind!=='fetch')list.append(suggestion(sync.icon,sync.label,sync.caption,sync.label,()=>runAction(sync.kind),true));
    else if(sync)list.append(suggestion('fetch',sync.label,sync.caption,sync.label,()=>runAction('fetch')));
    list.append(
      suggestion('changes',t('Open in VS Code'),t('Edit the files of this repository'),t('Open in VS Code'),quick('open-code')),
      suggestion('folder',t('Show in Explorer'),t('Open the repository folder'),t('Show in Explorer'),quick('open-folder')),
      suggestion('tools',t('Open a terminal'),t('Start a terminal in this repository'),t('Open terminal'),quick('open-terminal')),
      suggestion('history',t('Browse history'),t('See recent commits on every branch'),t('Open History'),()=>selectWorkspaceTab('history')),
    );
    panel.append(head,list);return panel;
  }
  if(typeof renderChangesView==='function'){
    const baseChanges=renderChangesView;
    renderChangesView=function(content,data){
      const result=baseChanges(content,data);
      try{
        if(isModern()&&data&&!(data.files||[]).length&&!conflictCount(data)){
          const target=content.querySelector('.working-diff');const panel=nothingToCommit(data);
          if(target)target.replaceChildren(panel);else content.append(panel);
          content.classList.add('modern-no-changes');
        }else content.classList.remove('modern-no-changes');
      }catch(error){console.warn('Modern suggestions unavailable',error);}
      return result;
    };
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
  function teardown(){closePopover();restoreToolbar();document.querySelectorAll('.modern-made').forEach(node=>node.remove());document.querySelectorAll('[data-modern]').forEach(node=>delete node.dataset.modern);document.querySelector('.modern-no-changes')?.classList.remove('modern-no-changes');bar=rail=primary=null;}
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
  // The "Last fetched" caption ages; refresh it every minute.
  setInterval(()=>{if(isModern())try{renderHeader();}catch{}},60000);
  const applyLook=()=>{if(isModern())refresh();else teardown();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLook);else applyLook();
  document.addEventListener('gitdeck:appearance',applyLook);
  window.GitDeckModern={primaryAction,syncAction,relativeTime,initials,refKind};
})();
