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
  window.GitDeckFileActions={ignorePatterns,recentMessages};
})();
