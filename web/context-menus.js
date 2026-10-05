'use strict';
// Right-click menus with Sourcetree's full set of actions wherever a commit, branch, tag, stash,
// remote or file appears. Each item runs an action Git Deck already has; risky ones still confirm.
(function(){
  if(typeof showContextMenu!=='function'||typeof runWorkspaceAction!=='function')return;
  const data=()=>state.workspace||{};
  const copy=(value,label)=>typeof copyRepositoryValue==='function'?copyRepositoryValue(value,label):navigator.clipboard?.writeText(value);
  const sep={separator:true};
  const askName=(message,value)=>{const name=prompt(message,value);return name&&name.trim();};

  // ---- History: commit rows -------------------------------------------------------------------------
  if(typeof commitContextItems==='function'){
    const baseCommit=commitContextItems;
    commitContextItems=function(item){
      const base=baseCommit(item);const current=data().branch;
      const firstSep=base.findIndex(entry=>entry&&entry.separator);
      const lastSep=base.length-1-[...base].reverse().findIndex(entry=>entry&&entry.separator);
      const merge=[
        {label:t('Merge into {branch}…',{branch:current||'HEAD'}),disabled:!current,disabledReason:t('Check out a branch first'),
          run:()=>runWorkspaceAction('merge',{branch:item.fullHash,mode:'default'},t('Merge {hash} into {branch}?',{hash:item.hash,branch:current}))},
        {label:t('Rebase {branch} onto this commit…',{branch:current||'HEAD'}),disabled:!current,disabledReason:t('Check out a branch first'),
          run:()=>runWorkspaceAction('rebase-start',{branch:item.fullHash},t('Rebase {branch} onto {hash}?\nYour commits are replayed on top of it.',{branch:current,hash:item.hash}))},
      ];
      const files=[
        {label:t('Create patch…'),hint:'.patch',run:()=>runWorkspaceAction('patch-export',{commit:item.fullHash},'')},
        {label:t('Archive as ZIP…'),hint:item.hash,run:()=>runWorkspaceAction('archive-export',{ref:item.fullHash},'')},
      ];
      const copies=[
        {label:t('Copy full SHA'),hint:item.fullHash?.slice(0,12),run:()=>copy(item.fullHash,t('full SHA'))},
        {label:t('Copy commit message'),run:()=>copy(item.subject||'',t('commit message'))},
      ];
      if(firstSep<0)return [...base,sep,...merge,sep,...files,sep,...copies];
      return [...base.slice(0,firstSep),sep,...merge,...base.slice(firstSep,lastSep),sep,...files,...base.slice(lastSep),...copies];
    };
  }

  // ---- Branches (sidebar tree, Branches page) -------------------------------------------------------
  if(typeof branchOperationContextItems==='function'){
    const baseBranch=branchOperationContextItems;
    branchOperationContextItems=function(workspace,branch,kind){
      const base=baseBranch(workspace,branch,kind);const current=workspace.branch;
      const history={label:t('View history'),run:()=>typeof viewRefHistory==='function'?viewRefHistory(branch.name):selectWorkspaceTab('history')};
      const newBranch={label:t('New branch from here…'),run:()=>{const name=askName(t('New branch name from {ref}',{ref:branch.name}),'');if(name)runWorkspaceAction('branch-create-at',{branch:name,commit:branch.name},t('Create {name} from {ref}?',{name,ref:branch.name}));}};
      const newTag={label:t('New tag here…'),run:()=>typeof openTagCreator==='function'&&openTagCreator(branch.name)};
      const zip={label:t('Archive as ZIP…'),run:()=>runWorkspaceAction('archive-export',{ref:branch.name},'')};
      if(kind==='remote'){
        const parts=branch.name.split('/');const remote=parts.shift();
        return [history,sep,...base.slice(0,2),
          {label:t('Merge {ref} into current',{ref:branch.name}),disabled:!current,disabledReason:t('Check out a branch first'),run:()=>runWorkspaceAction('merge',{branch:branch.name,mode:'default'},t('Merge {ref} into {branch}?',{ref:branch.name,branch:current}))},
          {label:t('Rebase current onto {ref}',{ref:branch.name}),disabled:!current,disabledReason:t('Check out a branch first'),run:()=>runWorkspaceAction('rebase-start',{branch:branch.name},t('Rebase {branch} onto {ref}?',{branch:current,ref:branch.name}))},
          ...base.slice(2),sep,newBranch,newTag,zip,
          {label:t('Prune {remote}',{remote}),hint:t('remove refs deleted on the server'),run:()=>runWorkspaceAction('remote-prune',{remote},t('Prune remote-tracking refs no longer on {remote}?\nLocal branches are not deleted.',{remote}))}];
      }
      const isCurrent=branch.current||branch.name===current;
      const upstream=branch.upstream||'';
      const extra=[history];
      if(isCurrent&&upstream)extra.push({label:t('Pull {upstream}',{upstream}),hint:state.meta?.pullStrategy,run:()=>runWorkspaceAction('pull',{strategy:state.meta?.pullStrategy})});
      const remoteNames=(workspace.remoteBranches||[]).map(item=>item.name||item);
      const guess=remoteNames.find(name=>name.endsWith('/'+branch.name));
      extra.push(upstream
        ?{label:t('Stop tracking {upstream}',{upstream}),run:()=>runWorkspaceAction('branch-unset-upstream',{branch:branch.name},t('Stop {branch} tracking {upstream}?',{branch:branch.name,upstream}))}
        :{label:t('Track remote branch…'),hint:guess||'',disabled:!remoteNames.length,run:()=>{const target=askName(t('Remote branch for {branch} to track',{branch:branch.name}),guess||'');if(target)runWorkspaceAction('branch-set-upstream',{branch:branch.name,upstream:target},t('Set {branch} to track {upstream}?',{branch:branch.name,upstream:target}));}});
      const deleteIndex=base.findIndex(entry=>entry&&/^Delete local branch/.test(entry.label||''));
      const force={label:t('Force delete {branch}…',{branch:branch.name}),danger:true,disabled:isCurrent,disabledReason:t('Switch away before deleting the current branch.'),
        run:()=>runWorkspaceAction('branch-delete',{branch:branch.name,force:true},t('Delete {branch} even though it has unmerged commits?\nThose commits are only reachable from the reflog afterwards.',{branch:branch.name}))};
      const withForce=deleteIndex<0?[...base,force]:[...base.slice(0,deleteIndex+1),force,...base.slice(deleteIndex+1)];
      return [...extra,sep,...withForce,sep,newBranch,newTag,zip];
    };
  }

  // ---- Tags -----------------------------------------------------------------------------------------
  if(typeof tagContextItems==='function'){
    const baseTag=tagContextItems;
    tagContextItems=function(workspace,tag){
      const base=baseTag(workspace,tag);
      return [
        {label:t('View history'),run:()=>typeof viewRefHistory==='function'?viewRefHistory(tag.name):selectWorkspaceTab('history')},sep,
        ...base,sep,
        {label:t('New branch from tag…'),run:()=>{const name=askName(t('New branch name from {ref}',{ref:tag.name}),'release/'+tag.name);if(name)runWorkspaceAction('branch-create-at',{branch:name,commit:tag.hash||tag.name},t('Create {name} from {ref}?',{name,ref:tag.name}));}},
        {label:t('Archive as ZIP…'),run:()=>runWorkspaceAction('archive-export',{ref:tag.name},'')},
        {label:t('Copy commit SHA'),hint:tag.hash||'',disabled:!tag.hash,run:()=>copy(tag.hash,t('commit SHA'))},
      ];
    };
  }

  // ---- Stashes (Stashes page and sidebar) -----------------------------------------------------------
  function stashItems(stash){
    return [
      {label:t('Apply stash'),hint:t('keep it in the list'),run:()=>runWorkspaceAction('stash-apply',{stash:stash.ref},t('Apply {ref} and keep the stash?',{ref:stash.ref}))},
      {label:t('Pop stash'),hint:t('apply and remove'),run:()=>runWorkspaceAction('stash-pop',{stash:stash.ref},t('Apply {ref} and remove it from the stash list?',{ref:stash.ref}))},
      {label:t('Show changes'),run:()=>{selectWorkspaceTab('stashes');setTimeout(()=>[...document.querySelectorAll('.stash-layout .stash-label')].find(node=>node.textContent.startsWith(stash.ref))?.click(),300);}},
      sep,
      {label:t('Copy stash name'),hint:stash.ref,run:()=>copy(stash.ref,t('stash name'))},
      {label:t('Copy message'),run:()=>copy(stash.message||'',t('stash message'))},
      sep,
      {label:t('Delete stash…'),danger:true,run:()=>runWorkspaceAction('stash-drop',{stash:stash.ref},t('Delete {ref} permanently?',{ref:stash.ref}))},
    ];
  }

  // ---- Remotes (Remotes page and sidebar groups) ----------------------------------------------------
  function remoteItems(name){
    const remote=(data().remotes||[]).find(item=>item.name===name)||{name};
    return [
      {label:t('Fetch {remote}',{remote:name}),run:()=>runWorkspaceAction('fetch')},
      {label:t('Prune {remote}',{remote:name}),hint:t('remove refs deleted on the server'),run:()=>runWorkspaceAction('remote-prune',{remote:name},t('Prune remote-tracking refs no longer on {remote}?\nLocal branches are not deleted.',{remote:name}))},
      {label:t('Open in browser'),run:()=>state.workspaceRepo&&typeof run==='function'&&run('open-remote',state.workspaceRepo)},
      sep,
      {label:t('Copy URL'),hint:remote.fetchUrl||'',disabled:!remote.fetchUrl,run:()=>copy(remote.fetchUrl,t('remote URL'))},
      {label:t('Edit URL…'),run:()=>selectWorkspaceTab('remotes')},
      sep,
      {label:t('Remove {remote}…',{remote:name}),danger:true,run:()=>runWorkspaceAction('remote-delete',{remote:name},t('Remove remote {remote} from config?\nThe repository on the server is not deleted.',{remote:name}))},
    ];
  }

  // Rows that are drawn without a menu get one as they appear.
  function attach(root){
    const stashes=data().stashes||[];
    for(const node of root.querySelectorAll('.stash-layout .stash-label:not([data-menu]), .ref-simple:not([data-menu])')){
      const text=node.textContent||'';const stash=stashes.find(item=>text.startsWith(item.ref));
      if(!stash){if(node.classList.contains('stash-label'))node.dataset.menu='0';continue;}
      node.dataset.menu='1';node.addEventListener('contextmenu',event=>showContextMenu(event,stashItems(stash)));
    }
    for(const card of root.querySelectorAll('.remote-card:not([data-menu])')){
      const name=card.querySelector('.remote-row strong')?.textContent;if(!name)continue;
      card.dataset.menu='1';card.addEventListener('contextmenu',event=>showContextMenu(event,remoteItems(name)));
    }
    // Sidebar: a remote's group is the section holding its "Manage remote URL…" button.
    for(const box of root.querySelectorAll('details.ref-section')){
      const summary=box.querySelector(':scope > summary');
      if(!summary||summary.dataset.menu||!box.querySelector(':scope > .ref-manage'))continue;
      const name=summary.querySelector('span')?.textContent;if(!name)continue;
      summary.dataset.menu='1';summary.addEventListener('contextmenu',event=>showContextMenu(event,remoteItems(name)));
    }
  }
  for(const id of ['workspace-content','tree-content']){
    const node=document.getElementById(id);
    if(node)new MutationObserver(()=>setTimeout(()=>{try{attach(node);}catch(error){console.warn('Context menus unavailable',error);}},0)).observe(node,{childList:true,subtree:true});
  }

  window.GitDeckContextMenus={stashItems,remoteItems};
})();
