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
  let bar=null,repoButton,branchButton,syncButton,syncMore,primary,actionButtons={};
  // Sourcetree-style action bar: icon over label, one button per everyday action.
  function actionButton(kind,name,label,title,run){
    const button=el('button','modern-act');button.type='button';button.dataset.act=kind;button.title=title;
    const glyph=el('span','modern-act-icon');glyph.append(icon(name,20));
    const badge=el('b','modern-act-badge');badge.hidden=true;
    button.append(glyph,el('span','modern-act-label',label),badge);
    button.addEventListener('click',run);return button;
  }
  // Small dialogs like Sourcetree's Stash and Merge windows, instead of sending you to another page.
  function actionDialog(title,submitLabel,build,submit){
    if(typeof releaseDialog!=='function')return null;
    const ui=releaseDialog(title);ui.dialog.classList.add('modern-action-dialog');
    const form=el('form','modern-dialog-form');form.id='modern-dialog-'+Math.random().toString(36).slice(2);
    build(form,ui);ui.body.append(form);
    const go=el('button','primary',submitLabel);go.type='submit';go.setAttribute('form',form.id);
    ui.actions.querySelector('button').textContent=t('Cancel');ui.actions.append(go);
    form.addEventListener('submit',(event)=>{event.preventDefault();if(go.disabled)return;const payload=submit();if(payload===null)return;ui.dialog.close();});
    return {ui,form,go};
  }
  function openStash(){
    const data=state.workspace;if(!state.workspaceRepo||!data||state.busy)return;
    const count=(data.files||[]).length;let message,keep;
    actionDialog(t('Stash changes'),t('Stash'),(form)=>{
      form.append(el('p','',t('{count} changed file(s) are set aside, new files included. Apply them again from Stashes.',{count})));
      message=el('input','workflow-input');message.type='text';message.placeholder=t('Message (optional)');message.setAttribute('aria-label',t('Stash message'));
      const keepLabel=el('label','modern-dialog-check');keep=document.createElement('input');keep.type='checkbox';
      keepLabel.append(keep,el('span','',t('Keep staged changes')));keepLabel.title=t('Staged changes stay staged in your working tree as well as going into the stash');
      form.append(message,keepLabel);setTimeout(()=>message.focus(),0);
    },()=>{runWorkspaceAction('stash-save',{message:message.value.trim(),keepIndex:keep.checked},'');});
  }
  function openMerge(){
    const data=state.workspace;if(!state.workspaceRepo||!data||state.busy)return;
    const current=data.branch;
    const local=(data.branches||[]).map(b=>b.name).filter(name=>name!==current);
    const remote=(data.remoteBranches||[]).map(b=>b.name||b).filter(name=>name&&!/\/HEAD$/.test(name));
    let list,mode,search;
    const dialog=actionDialog(t('Merge'),t('Merge'),(form)=>{
      form.append(el('p','',t('Choose what to merge into {branch}:',{branch:current||t('Detached HEAD')})));
      search=el('input','workflow-input');search.type='search';search.placeholder=t('Filter branches');search.setAttribute('aria-label',t('Filter branches'));
      list=document.createElement('select');list.size=10;list.className='modern-merge-list';list.setAttribute('aria-label',t('Branch to merge'));
      const fill=()=>{
        const term=search.value.trim().toLowerCase();const keep=list.value;list.replaceChildren();
        for(const [label,names] of [[t('Local branches'),local],[t('Remote branches'),remote]]){
          const shown=names.filter(name=>!term||name.toLowerCase().includes(term));if(!shown.length)continue;
          const group=document.createElement('optgroup');group.label=label;
          shown.forEach(name=>{const option=document.createElement('option');option.value=name;option.textContent=name;group.append(option);});list.append(group);
        }
        list.value=keep;if(!list.value&&list.options.length)list.selectedIndex=0;
        dialog&&(dialog.go.disabled=!list.value||!!(data.files||[]).length);
      };
      search.addEventListener('input',fill);list.addEventListener('dblclick',()=>form.requestSubmit());
      mode=document.createElement('select');mode.className='workflow-input';mode.setAttribute('aria-label',t('Merge option'));
      [['default',t('Merge (fast-forward when possible)')],['no-ff',t('Always create a merge commit')],['squash',t('Squash into one change, commit it yourself')]].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);});
      form.append(search,list,mode);
      if((data.files||[]).length){
        const note=el('p','modern-dialog-note',t('You have uncommitted changes. Commit or stash them before merging.'));
        const stash=el('button','',t('Stash my changes'));stash.type='button';stash.onclick=()=>{form.closest('dialog')?.close();openStash();};
        note.append(' ',stash);form.append(note);
      }
      form._fill=fill;setTimeout(()=>search.focus(),0);
    },()=>{
      if(!list.value)return null;
      runWorkspaceAction('merge',{branch:list.value,mode:mode.value},'');
    });
    dialog?.form._fill();
  }
  function buildActions(){
    const strip=el('div','modern-actions');
    const group=()=>{const node=el('div','modern-act-group');strip.append(node);return node;};
    const repoRun=(action)=>()=>{if(state.workspaceRepo&&typeof run==='function')run(action,state.workspaceRepo);};
    actionButtons={
      commit:actionButton('commit','commit',t('Commit'),t('Stage files and write a commit (Ctrl+1)'),()=>runAction('commit')),
      pull:actionButton('pull','pull',t('Pull'),t('Bring remote commits into this branch'),()=>legacyClick('pull')),
      push:actionButton('push','push',t('Push'),t('Publish your commits'),()=>legacyClick('push')),
      fetch:actionButton('fetch','fetch',t('Fetch'),t('Download new commits without changing your files'),()=>legacyClick('fetch')),
      branch:actionButton('branch','branch',t('Branch'),t('Create a new branch from here'),()=>typeof showBranchCreator==='function'&&showBranchCreator()),
      merge:actionButton('merge','merge',t('Merge'),t('Merge another branch into this one'),openMerge),
      stash:actionButton('stash','stash',t('Stash'),t('Set your changes aside without committing'),openStash),
      tag:actionButton('tag','tag',t('Tag'),t('Name this point in history, for example a release'),()=>typeof openTagCreator==='function'&&openTagCreator()),
      terminal:actionButton('terminal','terminal',t('Terminal'),t('Open a terminal in this repository'),repoRun('open-terminal')),
      explorer:actionButton('explorer','explorer',t('Explorer'),t('Open this repository folder in Explorer'),repoRun('open-folder')),
    };
    group().append(actionButtons.commit);
    const syncGroup=group();syncGroup.append(actionButtons.pull,actionButtons.push,actionButtons.fetch);
    group().append(actionButtons.branch,actionButtons.merge,actionButtons.stash,actionButtons.tag);
    const end=group();end.classList.add('modern-act-end');end.append(actionButtons.terminal,actionButtons.explorer);
    return {strip,syncGroup};
  }
  function renderActions(data){
    const sync=data?.sync||{};const files=data?.files||[];const remotes=(data?.remotes||[]).length>0;
    const badge=(kind,text)=>{const node=actionButtons[kind]?.querySelector('.modern-act-badge');if(node){node.textContent=text||'';node.hidden=!text;}};
    badge('commit',files.length?String(files.length):'');badge('pull',sync.behind>0?String(sync.behind):'');badge('push',sync.ahead>0?String(sync.ahead):'');
    const publish=data?.branch&&!sync.upstream&&remotes;
    actionButtons.push.querySelector('.modern-act-label').textContent=publish?t('Publish'):t('Push');
    actionButtons.push.title=publish?t('Push this branch and set its upstream'):sync.ahead>0?t('{count} commit(s) to publish',{count:sync.ahead}):t('Publish your commits');
    actionButtons.pull.title=sync.behind>0?t('{count} incoming commit(s)',{count:sync.behind}):t('Bring remote commits into this branch');
    for(const kind of ['pull','push','fetch'])actionButtons[kind].disabled=!remotes;
    actionButtons.stash.disabled=!files.length;actionButtons.merge.disabled=!data?.branch;
    actionButtons.pull.classList.toggle('modern-act-due',sync.behind>0);actionButtons.push.classList.toggle('modern-act-due',sync.ahead>0||!!publish);
    actionButtons.commit.classList.toggle('modern-act-due',files.some(file=>file.staged));
  }
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
    const actions=buildActions();
    // The old single sync button stays for keyboard users of syncAction, hidden by modern.css; its menu sits after Fetch.
    syncGroup.append(syncButton);actions.syncGroup.append(syncMore);
    bar.append(repoButton,branchButton,syncGroup,actions.strip);head.prepend(bar);
    primary=el('button','modern-primary modern-made');primary.type='button';primary.addEventListener('click',()=>runAction(primary.dataset.kind));
    document.querySelector('.sync-actions')?.prepend(primary);
  }
  function renderHeader(){
    if(!bar)return;const data=state.workspace;const repo=state.workspaceRepo;
    setBlock(repoButton,'folder',repo?.name||t('Select a repository'));
    branchButton.hidden=!repo;setBlock(branchButton,'branch',data?.branch||t('Detached HEAD'));
    branchButton.title=data&&!data.branch?t('Not on a branch: new commits here are easy to lose. Create a branch to keep them.'):t('Switch branch');
    const sync=repo?syncAction(data):null;syncButton.parentElement.hidden=!sync;
    if(sync){
      syncButton.dataset.kind=sync.kind;syncButton.title=sync.caption;setBlock(syncButton,sync.icon,sync.label,sync.caption);
      syncButton.querySelector('.modern-tb-badge')?.remove();if(sync.badge)syncButton.append(el('b','modern-tb-badge',sync.badge));
    }
    renderActions(repo?data:null);
    const action=repo?primaryAction(data):null;const local=action&&localKinds.includes(action.kind);
    // The action bar has Commit; the accent button is kept for what blocks everything else: conflicts.
    primary.hidden=!local||action.kind!=='conflicts';
    if(local){primary.dataset.kind=action.kind;primary.title=action.title;primary.replaceChildren(icon(action.icon),el('span','',action.label));}
  }

  // ---- Left rail -------------------------------------------------------------------------------
  const railItems=[
    ['changes','changes',()=>t('Changes')],['history','history',()=>t('History')],['branches','branch',()=>t('Branches')],
    ['stashes','stash',()=>t('Stashes')],['tags','tag',()=>t('Tags')],['compare','compare',()=>t('Compare')],
    ['conflicts','conflict',()=>t('Conflicts')],['recovery','recovery',()=>t('Recovery')],
  ];
  const railBottom=[['focus','focus',()=>t('Focus')],['tools','tools',()=>t('Tools')],['settings','settings',()=>t('Settings')]];
  // Plain-language tooltips: what each place is for, without Git jargon.
  const railHelp={
    repos:()=>t('Show or hide the list of your repositories'),
    changes:()=>t('Files you changed but have not committed yet. Stage them and write a commit message here.'),
    history:()=>t('Every commit on every branch, newest first'),
    branches:()=>t('Separate lines of work. Switch, merge or create branches here.'),
    stashes:()=>t('Work you set aside for later without committing it'),
    tags:()=>t('Named points in history, usually releases such as v1.2'),
    compare:()=>t('See what differs between two branches before a merge request'),
    conflicts:()=>t('Files where two changes collided. Choose which version to keep.'),
    recovery:()=>t('Undo mistakes: find lost commits and earlier branch positions'),
    focus:()=>t('Hide the side panels to concentrate on files and diffs'),
    tools:()=>t('Maintenance and advanced Git tools'),
    settings:()=>t('Name, email, .gitignore and other settings for this repository'),
  };
  const toggleFocus=()=>{$id('focus-workbench')?.click();setTimeout(renderRail,0);};
  let rail=null;
  const libraryOpen=()=>!document.body.classList.contains('library-collapsed');
  // Unpinned, the repository list is a drawer over the workspace (Fork / Tower style)
  // instead of a fourth column; pinned keeps the column. Outside click or Esc closes it.
  const syncDrawer=()=>document.body.classList.toggle('modern-library-drawer',!state.meta?.libraryPinned);
  const drawerOpen=()=>document.body.classList.contains('modern-library-drawer')&&libraryOpen();
  const closeDrawer=()=>{if(drawerOpen()){$id('library-collapse')?.click();setTimeout(renderRail,0);}};
  document.addEventListener('mousedown',(event)=>{if(isModern()&&drawerOpen()&&!event.target.closest('.repos, .modern-rail-item[data-tab="repos"], .repo-switcher, dialog, .modal'))closeDrawer();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&isModern()&&drawerOpen()&&!popover&&!document.querySelector('dialog[open]'))closeDrawer();});
  document.addEventListener('click',(event)=>{if(event.target.closest('#library-pin'))setTimeout(()=>{if(isModern()){syncDrawer();renderRail();}},0);});
  function toggleLibrary(){(libraryOpen()?$id('library-collapse'):$id('library-open'))?.click();setTimeout(renderRail,0);}
  function railButton([tab,name,label]){
    const button=el('button','modern-rail-item');button.type='button';button.dataset.tab=tab;
    button.title=label()+(railHelp[tab]?' — '+railHelp[tab]():'');button.append(icon(name,18),el('span','modern-rail-label',label()),el('b','modern-rail-badge'));
    button.addEventListener('click',()=>tab==='repos'?toggleLibrary():tab==='focus'?toggleFocus():selectWorkspaceTab(tab));return button;
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
      const active=tab==='repos'?libraryOpen():tab==='focus'?document.body.classList.contains('focus-workbench'):tab===state.workspaceTab;button.classList.toggle('active',active);
      if(tab==='repos'||tab==='focus')button.setAttribute('aria-pressed',String(active));
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
  // "View & tools": its two legacy panels (header actions, layout/workflow tools) were
  // positioned separately and overlapped. Modern moves both into one menu panel; the
  // nodes keep their listeners and go back exactly where they were for Classic.
  const movedTools=[];
  function buildToolsPanel(){
    const secondary=document.querySelector('.workbench-secondary');if(!secondary||secondary.querySelector('.modern-tools-panel'))return;
    const panel=el('div','modern-tools-panel modern-made');
    for(const node of [...secondary.children].filter(node=>node.tagName!=='SUMMARY')){movedTools.push({node,parent:secondary,next:node.nextSibling});panel.append(node);}
    secondary.append(panel);
    const theme=secondary.querySelector('.theme-picker > summary');
    if(theme&&!theme.querySelector('.modern-made'))theme.append(el('span','modern-theme-label modern-made',t('Theme')));
  }
  function restoreToolsPanel(){while(movedTools.length){const {node,parent,next}=movedTools.pop();parent.insertBefore(node,next&&next.parentElement===parent?next:null);}}
  // Close the menu after choosing an action (not when opening a submenu or changing a field).
  document.addEventListener('click',(event)=>{
    const secondary=event.target.closest('.modern-tools-panel')?.closest('.workbench-secondary');
    if(secondary&&event.target.closest('button')&&!event.target.closest('select'))secondary.open=false;
    document.querySelectorAll('.workbench-secondary[open]').forEach(menu=>{if(isModern()&&!menu.contains(event.target))menu.open=false;});
  });
  // "More" menu: icons instead of mixed glyphs (⇄ ◈ ⌕ ⑂ ≋ …); the words stay.
  const moreIcons={'compare':'compare','gitlab-inbox':'inbox','search-history':'search','branches':'branch','rebase':'commit','conflicts':'conflict','health':'check','worktrees':'folder','stashes':'stash','tag-create':'tag','patches':'changes','remotes':'cloud','recovery':'recovery','tools':'tools','settings':'settings','toolbar-create-branch':'branch','toolbar-create-tag':'tag'};
  // Upper-case group labels ("REVIEW & GITLAB") read as sentence case, keeping product names.
  function sentenceCase(text){
    if(!/^[^a-z]*[A-Z][^a-z]*$/.test(text))return text;
    return (text.charAt(0)+text.slice(1).toLowerCase()).replace(/\bgitlab\b/g,'GitLab').replace(/\bgithub\b/g,'GitHub').replace(/\bmr\b/g,'MR');
  }
  function decorateMoreMenu(){
    for(const heading of document.querySelectorAll('.sync-more > div > .sync-more-group')){
      if(heading.dataset.modernText!==undefined)continue;
      const text=heading.textContent;const nicer=sentenceCase(text);if(nicer!==text){heading.dataset.modernText=text;heading.textContent=nicer;}
    }
    for(const button of document.querySelectorAll('.sync-more > div > button')){
      if(button.querySelector(':scope > .modern-made'))continue;
      const name=moreIcons[button.dataset.workbenchNav||button.id];if(!name)continue;
      const label=button.querySelector(':scope > strong');
      if(label&&label.dataset.modernText===undefined){const text=label.textContent;const words=text.replace(/^[^\p{L}\p{N}]+/u,'');if(words!==text){label.dataset.modernText=text;label.textContent=words;}}
      const node=icon(name,16);node.classList.add('modern-made');button.prepend(node);
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
  // History: fold the "Viewing…" bar into the controls row, so the list starts one row higher.
  function foldHistoryHead(root){
    const bar=root.querySelector(':scope > .history-context:not(.modern-folded)');const head=bar?.nextElementSibling;
    if(!bar||!head?.classList.contains('workspace-section-head'))return;
    bar.classList.add('modern-folded');head.classList.add('modern-history-head');
    // The bar re-renders on its own; drop what an earlier one moved here.
    head.querySelectorAll('.modern-viewing, :scope > .modern-moved').forEach(node=>node.remove());
    const viewing=bar.querySelector('.viewing-context');
    if(viewing){const chip=el('span','modern-viewing modern-made',viewing.textContent);chip.title=viewing.parentElement?.title||'';head.querySelector('h3')?.after(chip);}
    for(const button of bar.querySelectorAll(':scope > button')){button.classList.add('modern-moved');head.append(button);}
  }
  // Compare and Stashes open their first item instead of an empty "Select a file" panel, like Sourcetree.
  const autoOpened=new WeakSet();
  function autoOpenFirst(root){
    for(const [placeholder,first] of [['.compare-diff > .workspace-empty','.compare-file-list .compare-file-row'],['.stash-preview > .workspace-empty','.stash-layout .stash-label']]){
      const empty=root.querySelector(placeholder);if(!empty||autoOpened.has(empty))continue;
      autoOpened.add(empty);root.querySelector(first)?.click();
    }
  }
  function decorateHistory(root){
    try{foldHistoryHead(root);}catch(error){console.warn('History header unavailable',error);}
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

  // ---- Branches page: grouped list (GitHub / GitLab branch pages) ------------------------------------
  function decorateBranches(root){
    const cards=[...root.querySelectorAll('.workspace-list > .branch-card:not([data-modern])')];if(!cards.length)return;
    for(const card of cards){
      card.dataset.modern='1';
      const detail=card.querySelector('.workspace-row > div:first-child small')?.textContent||'';
      card.dataset.kind=/^Remote branch/.test(detail)?'remote':'local';
      if(card.querySelector('.current-branch'))card.dataset.current='1';
    }
    const list=cards[0].parentElement;list.querySelectorAll(':scope > .modern-list-heading').forEach(node=>node.remove());
    for(const [kind,label] of [['local',t('Local branches')],['remote',t('Remote branches')]]){
      const group=[...list.querySelectorAll(`:scope > .branch-card[data-kind="${kind}"]`)];if(!group.length)continue;
      const heading=el('h4','modern-list-heading modern-made');heading.append(el('span','',label),el('small','',String(group.length)));group[0].before(heading);
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
  // "1 staged · 2 unstaged" becomes a sentence that says what to do next.
  function plainSummary(content,data){
    const line=content.querySelector('.changes-summary > p');const files=data?.files||[];if(!line||!files.length)return;
    const staged=files.filter(file=>file.staged).length;const unstaged=files.filter(file=>file.unstaged).length;
    line.textContent=staged&&unstaged?t('{staged} ready to commit · {unstaged} not staged yet',{staged,unstaged})
      :staged?t('{count} file(s) ready to commit — write a message below',{count:staged})
      :t('{count} changed file(s) — stage the ones you want to commit',{count:unstaged});
  }
  // GitHub Desktop layout: the commit box sits under the file list (one column to
  // read top to bottom) instead of spanning the whole window. The view is rebuilt on
  // every render and on look changes, so nothing needs to be moved back.
  function composerInColumn(content,data){
    const groups=content.querySelector('.changes-layout > .change-groups');const form=content.querySelector('.changes-workspace > .commit-composer');
    if(!groups||!form)return;
    const column=el('div','modern-changes-column');groups.before(column);column.append(groups,form);
    const submit=form.querySelector('.commit-submit');
    if(submit&&data?.branch)submit.after(el('small','modern-commit-target',t('to {branch}',{branch:data.branch})));
  }
  if(typeof renderChangesView==='function'){
    const baseChanges=renderChangesView;
    renderChangesView=function(content,data){
      const result=baseChanges(content,data);
      try{if(isModern())composerInColumn(content,data);}catch(error){console.warn('Modern commit layout unavailable',error);}
      try{if(isModern())plainSummary(content,data);}catch(error){console.warn('Modern summary unavailable',error);}
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
      const art=el('span','modern-empty-icon modern-made');
      // "Loading …" is progress, not an empty result: show a spinner.
      art.append(/^Loading\b/.test(String(title))?el('span','modern-spinner'):icon(name,28));box.prepend(art);
      const action=emptyActions[title];
      if(action&&!(title==='No remotes'&&state.workspaceTab==='remotes')){const button=el('button','modern-empty-action modern-made',action[0]());button.type='button';button.addEventListener('click',action[1]);box.append(button);}
      return box;
    };
  }

  // ---- Readable accent -----------------------------------------------------------------------------
  // The accent is user-chosen. A black accent on the dark theme (or a pale one on light)
  // would draw text, icons and highlights in the background colour. When the accent has
  // less than 3:1 contrast with the surface, body gets a lighter/darker version of it
  // (and a matching text colour for accent buttons); every stylesheet reads --green.
  function toRgb(value){
    const ctx=toRgb.ctx||(toRgb.ctx=document.createElement('canvas').getContext('2d'));
    ctx.fillStyle='#000';ctx.fillStyle=value;const color=ctx.fillStyle;
    if(color[0]==='#')return [1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
    return (color.match(/[\d.]+/g)||['0','0','0']).slice(0,3).map(Number);
  }
  function luminance(rgb){const channel=(value)=>{value/=255;return value<=.03928?value/12.92:((value+.055)/1.055)**2.4;};return .2126*channel(rgb[0])+.7152*channel(rgb[1])+.0722*channel(rgb[2]);}
  function contrast(a,b){const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (light+.05)/(dark+.05);}
  function readableAccent(accent,surface){
    if(contrast(accent,surface)>=3)return accent;
    const target=luminance(surface)<.5?[255,255,255]:[0,0,0];
    // A grey/black/white accent becomes its opposite (e.g. black → near-white buttons on
    // dark), the way monochrome themes invert; a coloured accent is only lightened/darkened.
    if(Math.max(...accent)-Math.min(...accent)<32)return luminance(surface)<.5?[228,228,231]:[39,39,42];
    for(let step=1;step<=20;step++){const t=step/20;const color=accent.map((value,index)=>Math.round(value+(target[index]-value)*t));if(contrast(color,surface)>=3.5)return color;}
    return target;
  }
  function syncAccent(){
    const body=document.body;if(!body)return;
    body.style.removeProperty('--green');body.style.removeProperty('--accent-contrast');
    const style=getComputedStyle(body);
    const accent=toRgb(style.getPropertyValue('--green').trim()||'#0969da');const surface=toRgb(style.getPropertyValue('--surface').trim()||'#ffffff');
    const fixed=readableAccent(accent,surface);if(fixed===accent)return;
    body.style.setProperty('--green','#'+fixed.map(value=>value.toString(16).padStart(2,'0')).join(''));
    body.style.setProperty('--accent-contrast',luminance(fixed)>.4?'#111113':'#ffffff');
  }
  // Theme (body class) and accent (html style) changes both need a re-check.
  if(window.MutationObserver&&document.body){
    const watch=new MutationObserver(()=>{if(isModern())syncAccent();});
    watch.observe(document.body,{attributes:true,attributeFilter:['class']});
    watch.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  }

  // ---- Lifecycle -------------------------------------------------------------------------------
  function refresh(){if(!isModern())return;syncAccent();syncDrawer();buildHeader();buildToolsPanel();decorateMoreMenu();buildRail();decorateToolbar();renderHeader();renderRail();}
  function teardown(){closePopover();restoreToolbar();restoreToolsPanel();if(document.querySelector('.modern-folded'))setTimeout(()=>selectWorkspaceTab(state.workspaceTab,false),0);document.querySelectorAll('.modern-made').forEach(node=>node.remove());document.querySelectorAll('[data-modern]').forEach(node=>delete node.dataset.modern);document.querySelector('.modern-no-changes')?.classList.remove('modern-no-changes');document.body?.classList.remove('modern-library-drawer');document.body?.style.removeProperty('--green');document.body?.style.removeProperty('--accent-contrast');bar=rail=primary=null;}
  if(typeof renderWorkspaceStatus==='function'){
    const baseStatus=renderWorkspaceStatus;
    renderWorkspaceStatus=function(...args){const result=baseStatus.apply(this,args);try{refresh();}catch(error){console.warn('Modern header unavailable',error);}return result;};
  }
  if(typeof selectWorkspaceTab==='function'){
    const baseSelect=selectWorkspaceTab;
    selectWorkspaceTab=function(...args){const result=baseSelect.apply(this,args);try{if(isModern()){renderRail();renderHeader();}}catch{}return result;};
  }
  const content=$id('workspace-content');let pending=false;
  // setTimeout, not requestAnimationFrame: rAF is paused while the window is hidden.
  if(content)new MutationObserver(()=>{if(pending||!isModern())return;pending=true;setTimeout(()=>{pending=false;decorateHistory(content);decorateBranches(content);renderRail();try{autoOpenFirst(content);}catch{}},0);}).observe(content,{childList:true,subtree:true});
  // The "Last fetched" caption ages; refresh it every minute.
  setInterval(()=>{if(isModern())try{renderHeader();}catch{}},60000);
  const applyLook=()=>{if(isModern())refresh();else teardown();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLook);else applyLook();
  document.addEventListener('gitdeck:appearance',applyLook);
  window.GitDeckModern={primaryAction,syncAction,relativeTime,initials,refKind,readableAccent,contrast,sentenceCase};
})();
