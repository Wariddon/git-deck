'use strict';
// File actions that Sourcetree offers from its context menus (server: lib/GitDeck.Parity.ps1):
// - File Status: Ignore (file / extension / folder), Stop tracking, Resolve using mine/theirs,
//   and Move to Recycle Bin for untracked files (Sourcetree deletes them permanently).
// - History file list: Open this version, Reset file to this commit.
// - Commit box: recent commit messages.
// - Stashes: "Keep staged changes".
(function(){
  if(typeof workingFileContextItems!=='function'||typeof runWorkspaceAction!=='function')return;

  // ---- File Status ----------------------------------------------------------------------------
  function ignorePatterns(path){
    const clean=String(path).replace(/\/$/,'');const slash=clean.lastIndexOf('/');
    const name=clean.slice(slash+1);const folder=slash>0?clean.slice(0,slash):'';
    const dot=name.lastIndexOf('.');const extension=dot>0?name.slice(dot):'';
    const items=[{label:t('Ignore this file'),pattern:'/'+clean+(String(path).endsWith('/')?'/':'')}];
    if(extension&&!String(path).endsWith('/'))items.push({label:t('Ignore all {pattern} files',{pattern:'*'+extension}),pattern:'*'+extension});
    if(folder)items.push({label:t('Ignore folder {folder}/',{folder}),pattern:'/'+folder+'/'});
    return items;
  }
  const baseWorking=workingFileContextItems;
  workingFileContextItems=function(file,staged,diffPane,button){
    const items=baseWorking(file,staged,diffPane,button).filter(Boolean);
    const untracked=file.status==='??';const conflicted=/U|AA|DD/.test(file.status||'');
    const extra=[{separator:true}];
    if(conflicted){
      extra.push({label:t('Resolve using mine'),hint:t('keep your version'),run:()=>runWorkspaceAction('conflict-resolve',{file:file.path,mode:'ours'},t('Use your version of {file} and mark it resolved?',{file:file.path}))});
      extra.push({label:t('Resolve using theirs'),hint:t('keep the incoming version'),run:()=>runWorkspaceAction('conflict-resolve',{file:file.path,mode:'theirs'},t('Use the incoming version of {file} and mark it resolved?',{file:file.path}))});
      extra.push({separator:true});
    }
    for(const option of ignorePatterns(file.path))extra.push({label:option.label,hint:option.pattern,run:()=>runWorkspaceAction('ignore-add',{pattern:option.pattern},t('Add {pattern} to .gitignore?',{pattern:option.pattern}))});
    if(!untracked&&!conflicted)extra.push({label:t('Stop tracking (keep the file)'),run:()=>runWorkspaceAction('untrack-file',{file:file.path},t('Stop tracking {file}? The file stays on disk and is removed from Git in the next commit.',{file:file.path}))});
    extra.push({separator:true},{label:t('Compare in VS Code'),hint:t('HEAD ↔ working copy'),run:()=>runWorkspaceAction('external-diff',{file:file.path})});
    if(untracked)extra.push({separator:true},{label:t('Move to Recycle Bin…'),danger:true,run:()=>runWorkspaceAction('untracked-recycle',{file:file.path},t('Move {file} to the Recycle Bin?\nYou can restore it from the Recycle Bin.',{file:file.path}))});
    return items.concat(extra);
  };

  // ---- History file list (commit details) --------------------------------------------------------
  if(typeof attachCommitFileMenu==='function'){
    attachCommitFileMenu=function(row,button,file,repo,diff,tools){
      button.title=file.path+'\n'+fileFullPath(repo,file.path)+'\nPath in the working copy; historical files may no longer exist.';
      const commit=()=>document.querySelector('.commit-row.selected')?.dataset.commit||'';
      const deleted=/^D/.test(String(file.status||''));
      const items=()=>[...filePathContextItems(file,repo),{separator:true},
        {label:'File history',run:()=>loadFileHistory(file,diff)},
        {label:'Blame current working revision',run:()=>loadFileBlame(file,diff)},
        {separator:true},
        {label:t('Compare with previous in VS Code'),disabled:!commit(),run:()=>runWorkspaceAction('external-diff',{file:file.path,commit:commit()})},
        {label:t('Open this version'),disabled:deleted||!commit(),disabledReason:t('The file does not exist in this commit.'),run:()=>runWorkspaceAction('file-open-revision',{commit:commit(),file:file.path})},
        {label:t('Reset file to this commit…'),danger:true,disabled:deleted||!commit(),disabledReason:t('The file does not exist in this commit.'),run:()=>runWorkspaceAction('file-restore-at',{commit:commit(),file:file.path},t('Replace the working copy of {file} with its version from {commit}?\nThe change appears in File Status; discard it to undo.',{file:file.path,commit:commit().slice(0,8)}))}];
      row.addEventListener('contextmenu',event=>showContextMenu(event,items()));
      tools.replaceChildren(refMenuButton(items,'File actions for '+file.path));
    };
  }

  // ---- Commit box: recent messages (Sourcetree "History" in the commit box) -------------------------
  function recentMessages(data){
    const me=(data.settings?.userName||'').trim().toLowerCase();const seen=new Set();const out=[];
    for(const commit of data.history||[]){
      if(me&&String(commit.author||'').trim().toLowerCase()!==me)continue;
      // Skip merges and the commits git creates for stashes ("WIP on …", "On branch: …", "index on …").
      const subject=String(commit.subject||'').trim();if(!subject||seen.has(subject)||/^(Merge |WIP on |index on |On [^:\s]+: )/.test(subject))continue;
      seen.add(subject);out.push(subject);if(out.length>=15)break;
    }
    return out;
  }
  if(typeof renderChangesView==='function'){
    const baseChanges=renderChangesView;
    renderChangesView=function(content,data){
      const result=baseChanges(content,data);
      try{
        const bar=content.querySelector('.commit-assist');const message=content.querySelector('.commit-composer textarea');
        const messages=recentMessages(data||{});
        if(bar&&message&&messages.length&&!bar.querySelector('.recent-messages')){
          const select=document.createElement('select');select.className='recent-messages';select.setAttribute('aria-label',t('Recent commit messages'));select.title=t('Reuse one of your recent commit messages');
          select.append(new Option(t('Recent…'),''),...messages.map(text=>new Option(text.length>70?text.slice(0,69)+'…':text,text)));
          select.addEventListener('change',()=>{if(!select.value)return;message.value=select.value;message.dispatchEvent(new Event('input',{bubbles:true}));message.focus();select.value='';});
          bar.append(select);
        }
      }catch(error){console.warn('Recent messages unavailable',error);}
      return result;
    };
  }

  // ---- Stashes: keep staged changes ------------------------------------------------------------------
  const baseRun=runWorkspaceAction;
  runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
    if(action==='stash-save'){const keep=document.getElementById('stash-keep-index');if(keep?.checked)payload={...payload,keepIndex:true};}
    const result=await baseRun(action,payload,confirmation,options);
    // A stash applied onto work in progress may conflict: go where it can be resolved.
    if(['stash-pop','stash-apply'].includes(action)&&result?.conflicts?.length)selectWorkspaceTab('changes');
    return result;
  };
  const content=document.getElementById('workspace-content');
  const addKeepIndex=()=>{
    const form=content?.querySelector('.workspace-section-head .workspace-form');
    if(!form||state.workspaceTab!=='stashes'||form.querySelector('#stash-keep-index'))return;
    const label=el('label','stash-keep-index');const box=document.createElement('input');box.type='checkbox';box.id='stash-keep-index';
    label.title=t('Staged changes stay staged in your working tree as well as going into the stash');label.append(box,el('span','',t('Keep staged changes')));
    form.querySelector('button')?.before(label);
  };
  if(content)new MutationObserver(()=>setTimeout(addKeepIndex,0)).observe(content,{childList:true});
  // ---- Diff: ignore whitespace (commit diffs; staging diffs stay exact so hunks apply) ---------------
  const wsKey='gitdeck.ignoreWhitespace';
  const ignoreWs=()=>{try{return localStorage.getItem(wsKey)==='1';}catch{return false;}};
  if(typeof api==='function'){
    const baseApi=api;
    api=function(url,...rest){
      if(typeof url==='string'&&url.startsWith('/api/repo/commit-diff?')&&ignoreWs())url+='&ignoreWhitespace=1';
      return baseApi.call(this,url,...rest);
    };
  }
  function addWhitespaceToggle(root){
    for(const toolbar of root.querySelectorAll('.commit-diff .diff-viewer-toolbar:not([data-ws])')){
      toolbar.dataset.ws='1';
      const button=el('button','diff-ws-toggle',t('Ignore whitespace'));button.type='button';button.setAttribute('aria-pressed',String(ignoreWs()));
      button.title=t('Hide changes that only add or remove spaces, tabs or line endings');
      button.addEventListener('click',()=>{
        try{localStorage.setItem(wsKey,ignoreWs()?'0':'1');}catch{}
        // Reload the open file with the new setting.
        document.querySelector('.commit-file-row.selected .commit-file-main')?.click();
      });
      toolbar.append(button);
    }
  }
  if(content)new MutationObserver(()=>setTimeout(()=>addWhitespaceToggle(content),0)).observe(content,{childList:true,subtree:true});

  // ---- Commit, then push straight to the upstream (Sourcetree's "Push changes immediately") ---------------
  function pushOption(content){
    const labels=[...content.querySelectorAll('.commit-composer .commit-option')];
    const label=labels.find(item=>/Push/i.test(item.textContent));const upstream=state.workspace?.sync?.upstream;
    if(!label||!upstream)return;
    const box=label.querySelector('input');box.dataset.directPush=upstream;
    label.querySelector('span').textContent=t('Push to {upstream} after commit',{upstream});
    label.title=t('After a successful commit, run the pre-push checks and push. If a check blocks, the Push dialog opens instead.');
  }
  if(typeof renderChangesView==='function'){
    const baseChangesView=renderChangesView;
    renderChangesView=function(content,data){const result=baseChangesView(content,data);try{pushOption(content);}catch(error){console.warn('Push option unavailable',error);}return result;};
  }
  async function pushAfterCommit(upstream){
    const repo=state.workspaceRepo;const local=state.workspace?.branch;if(!repo||!local)return;
    const slash=upstream.indexOf('/');const remote=upstream.slice(0,slash);const target=upstream.slice(slash+1);
    try{
      const checks=(await api(`/api/repo/push-checks?path=${encodeURIComponent(repo.path)}&remote=${encodeURIComponent(remote)}&local=${encodeURIComponent(local)}&target=${encodeURIComponent(target)}&force=false`)).pushChecks;
      // Any warning (protected branch, possible secret, large or sensitive file) needs a human look first.
      if((checks.checks||[]).some(check=>check.level!=='ok')){
        showActionFeedback(t('Not pushed automatically: a pre-push check needs a look (for example a protected branch or a possible secret). Review it in the Push dialog.'),{error:true,context:t('Push')});
        if(typeof showPushDialog==='function')showPushDialog();return;
      }
    }catch(error){showActionFeedback(t('Not pushed: pre-push checks failed ({error}).',{error:error.message}),{error:true,context:t('Push')});return;}
    await baseRun('push',{},'');
  }
  const runWithPush=runWorkspaceAction;
  runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
    const box=action==='commit'?document.querySelector('.commit-composer input[data-direct-push]'):null;
    const upstream=box?.checked?box.dataset.directPush:'';
    const result=await runWithPush(action,payload,confirmation,options);
    // Unchecking stops app.js from also opening the Push dialog after this returns.
    if(result&&upstream){box.checked=false;setTimeout(()=>pushAfterCommit(upstream),0);}
    return result;
  };

  window.GitDeckFileActions={ignorePatterns,recentMessages};
})();
