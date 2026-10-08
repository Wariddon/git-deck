'use strict';
const releaseViews=GitDeckRelease.read(localStorage,'git-deck-view-details-v1',{});
let restoringReleaseView=false;
function rememberReleaseView(){
  if(!state.workspaceRepo||restoringReleaseView)return;
  const key=repoKey(state.workspaceRepo),old=releaseViews[key]||{};
  const list=document.querySelector('.commit-list');
  releaseViews[key]={...old,tab:state.workspaceTab,scroll:list?.scrollTop||0,left:list?.scrollLeft||0,commit:document.querySelector('.commit-row.selected')?.dataset.commit||old.commit||''};
  GitDeckRelease.write(localStorage,'git-deck-view-details-v1',releaseViews);
}
const originalOpenWorkspace=openWorkspace;
let releaseRestoreVersion=0;
openWorkspace=async function(repo,tab='history',collapse=true,record=true){
  const version=++releaseRestoreVersion;
  rememberReleaseView();
  const saved=releaseViews[repoKey(repo)];
  // Explicit navigation still wins; repository-tab switching restores its own view.
  if(collapse===null&&saved?.tab&&workspaceTabs.has(saved.tab))tab=saved.tab;
  await originalOpenWorkspace(repo,tab,collapse,record);
  if(version!==releaseRestoreVersion||!state.workspaceRepo||repoKey(repo)!==repoKey(state.workspaceRepo)||!saved)return;
  restoringReleaseView=true;
  try{
    const rows=[...document.querySelectorAll('.commit-row[data-commit]')];
    const selected=rows.find(row=>row.dataset.commit===saved.commit);if(selected&&!selected.classList.contains('selected'))selected.click();
    const list=document.querySelector('.commit-list');if(list){list.scrollTop=saved.scroll||0;list.scrollLeft=saved.left||0;}
  }finally{restoringReleaseView=false;}
};
window.addEventListener('pagehide',rememberReleaseView);
let viewTimer;
document.addEventListener('scroll',event=>{if(event.target.matches?.('.commit-list')){clearTimeout(viewTimer);viewTimer=setTimeout(rememberReleaseView,180);}},true);
document.addEventListener('click',event=>{if(event.target.closest('.commit-row'))setTimeout(rememberReleaseView,0);});

function releaseDialog(title){
  const dialog=document.createElement('dialog');dialog.className='release-dialog';dialog.setAttribute('aria-label',title);
  const heading=el('h2','',title),body=el('div'),actions=el('div');actions.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:16px';
  const close=el('button','',t('Close'));close.addEventListener('click',()=>dialog.close());actions.append(close);dialog.append(heading,body,actions);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return {dialog,body,actions};
}
async function showReadiness(){
  const ui=releaseDialog(t('Readiness check · Git Deck'));ui.dialog.classList.add('readiness-dialog');ui.body.textContent=t('Checking this computer…');
  try{const info=await api('/api/readiness');ui.body.replaceChildren();
    const checks=[[t('Local service / port'),info.serviceReady,t('Connected to port {port}',{port:info.port}),false],['Git',info.gitAvailable,t('Install Git for Windows and restart the application'),false],[t('Global commit identity'),info.globalIdentityReady,t('Set git config --global user.name and user.email, or configure each repository separately'),false],['GitLab CLI',info.gitlabCliAvailable,t('Place glab.exe in bin and sign in with your account'),true]];
    // One row per check: a round mark, the name, and either "Ready" or what to do about it.
    const list=el('div','gd-check-list');
    for(const [label,ok,hint,optional] of checks){
      const row=el('div','gd-check-row '+(ok?'is-ok':optional?'is-optional':'is-warn'));
      const text=el('div','gd-check-text');const name=el('strong','',label);if(optional)name.append(el('small','gd-check-optional',t('optional')));
      text.append(name,el('span','',ok?t('Ready'):hint));
      row.append(el('span','gd-check-mark',ok?'✓':'!'),text);list.append(row);
    }
    ui.body.append(list,el('p','gd-check-privacy',t('Repository metadata and cache stay on this computer. No telemetry is sent.')));
    // Closing it any way counts as seen once everything required is ready; a missing Git or identity shows it again next start.
    if(checks.filter(check=>!check[3]).every(check=>check[1]))ui.dialog.addEventListener('close',()=>{try{localStorage.setItem('git-deck-onboarding-v1','done');}catch{}},{once:true});
    const done=el('button','primary',t('Got it'));done.onclick=()=>{try{localStorage.setItem('git-deck-onboarding-v1','done');}catch{}ui.dialog.close();};ui.actions.append(done);
  }catch(error){ui.body.textContent=t('Could not check: {message}',{message:error.message});}
}
async function showSafeReport(){
  const ui=releaseDialog('Issue report · No repository data');
  try{const info=await api('/api/readiness');const text=GitDeckRelease.report(info);const preview=el('pre','',text);preview.style.whiteSpace='pre-wrap';ui.body.append(el('p','','This report contains only version and readiness information. It excludes raw errors, tokens, URLs, paths and account names. Review it before sharing.'),preview);
    const copy=el('button','','Copy report');copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='Copied';}catch{copy.textContent='Select the text above to copy it';}};ui.actions.append(copy);
  }catch{ui.body.textContent='Local service unavailable. No personal data is attached';}
}
for(const panel of document.querySelectorAll('.help-menu-panel')){
  for(const [label,action] of [['Readiness check',showReadiness],['Report issue (redacted)',showSafeReport],['Clear workspace cache',()=>{workspaceSnapshots.clear();persistWorkspaceSnapshots();setNotice('Saved workspace cache cleared');}]]){const button=el('button','',label);button.type='button';button.onclick=()=>{panel.closest('details')?.removeAttribute('open');action();};panel.append(button);}
}
let preflightBusy=false,approvedPush=null;
let pushReviewVersion=0;
function resetPushReview(){pushReviewVersion++;approvedPush=null;document.getElementById('push-review')?.remove();$('push-form').classList.remove('reviewing');}
function inlinePushReview(){
  document.getElementById('push-review')?.remove();
  const panel=el('section','push-review');panel.id='push-review';panel.tabIndex=-1;panel.setAttribute('aria-label','Review before pushing');
  const steps=el('p','push-review-steps','1 Select branches  →  2 Review  →  3 Confirm');
  const body=el('div','push-review-body'),actions=el('div','push-review-actions');
  const back=el('button','','Back to branch selection');back.type='button';back.onclick=()=>{resetPushReview();$('push-submit').focus();};actions.append(back);
  panel.append(steps,body,actions);$('push-message').before(panel);$('push-form').classList.add('reviewing');panel.focus();
  return {body,actions,close:resetPushReview};
}
['push-close','push-cancel'].forEach(id=>$(id)?.addEventListener('click',resetPushReview));
const originalShowPushDialog=showPushDialog;showPushDialog=function(){resetPushReview();return originalShowPushDialog();};
function pushSignature(){return JSON.stringify({path:state.workspaceRepo?.path,remote:$('push-remote').value,branches:selectedPushBranches(),tags:$('push-tags').checked,force:$('push-force').checked});}
$('push-form').addEventListener('submit',async event=>{
  const signature=pushSignature();
  if(approvedPush===signature){approvedPush=null;return;}
  event.preventDefault();event.stopImmediatePropagation();if(preflightBusy||state.busy)return;
  preflightBusy=true;
  const repo=state.workspaceRepo;const remote=$('push-remote').value;const branches=selectedPushBranches();
  const ui=inlinePushReview();const version=++pushReviewVersion;ui.body.textContent='Reading commits from local tracking refs…';
  try{
    const results=[];for(const branch of branches){results.push(await api('/api/repo/push-preview?'+new URLSearchParams({path:repo.path,remote,local:branch.local,target:branch.remote})));}
    if(version!==pushReviewVersion||signature!==pushSignature())return;
    ui.body.replaceChildren(el('p','push-review-warning','Based on local tracking refs. Fetch the selected remote before pushing if this data may be outdated.'));
    for(const result of results){ui.body.append(el('h3','',`${result.local} → ${result.remote}/${result.target}`),el('p','',result.knownTarget?`Send ${result.ahead} commits · Behind ${result.behind} commits`:'Target not found in local tracking refs. Cannot confirm whether this is a new branch.'),el('small','',`Latest FETCH_HEAD: ${result.lastFetchAt||'Unknown'} (May refer to a different remote)`));const pre=el('pre','',(result.commits||[]).join('\n'));pre.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto';ui.body.append(pre);}
    if($('push-tags').checked)ui.body.append(el('p','','Includes all tags. The commit list above is not a preview of tags.'));
    if($('push-force').checked)ui.body.append(el('p','','Warning: force with lease may rewrite history'));
    const confirm=el('button','primary','Confirm push');confirm.type='button';confirm.disabled=(!branches.length&&!$('push-tags').checked)||(!$('push-force').checked&&results.some(r=>r.behind>0));
    if(confirm.disabled)ui.body.append(el('p','push-review-warning','Cannot push yet. Check selected branches and commits behind the remote.'));
    // Behind on the current branch only: merge the remote commits first, then push (like Sourcetree).
    const behindHere=results.filter(r=>r.behind>0);
    if(confirm.disabled&&branches.length&&!$('push-force').checked&&behindHere.length&&behindHere.every(r=>r.local===state.workspace?.branch)&&window.GitDeckPushMerge){
      ui.body.querySelector('.push-review-warning:last-of-type').textContent=t('{remote} has {count} commit(s) you do not have yet. Merge them into your branch first, then push.',{remote:behindHere[0].remote+'/'+behindHere[0].target,count:behindHere[0].behind});
      const merge=el('button','primary',t('Merge remote changes, then push'));merge.type='button';
      merge.onclick=()=>{ui.close();GitDeckPushMerge.mergeThenPush('push-selection',{remote,branches,pushTags:$('push-tags').checked,forceWithLease:false},{action:'pull-ref',payload:{remote,branch:behindHere[0].target}});};
      confirm.hidden=true;ui.actions.append(merge);
    }
    confirm.title=confirm.disabled?'Review selected branches and incoming commits before pushing.':'';
    const context=el('small','action-target',actionContext(repo,state.workspace,{remote,branches}));ui.actions.append(context);
    confirm.onclick=()=>{if(signature!==pushSignature()){ui.body.append(el('p','','Options changed. Go back and review again.'));return;}ui.close();approvedPush=signature;$('push-form').requestSubmit();};ui.actions.append(confirm);
  }catch(error){ui.body.textContent='Review failed. Push was not sent: '+error.message;}
  finally{preflightBusy=false;}
},true);
const readinessTimer=setInterval(()=>{if(state.initializing)return;clearInterval(readinessTimer);if(localStorage.getItem('git-deck-onboarding-v1')!=='done')showReadiness();},500);

// Compact workbench: preserve existing controls/listeners instead of duplicating actions.
document.body.classList.add('compact-workbench');
const toolbar=document.querySelector('.workspace-modal-head');
const secondary=document.createElement('details');secondary.className='workbench-secondary';
const secondaryLabel=el('summary','','View & tools');secondaryLabel.title='Repositories, theme, Help and application tools';secondary.append(secondaryLabel,document.querySelector('.workspace-header-actions'));
toolbar.append(document.querySelector('.sync-actions'),secondary);
const pullGroup=el('div','toolbar-pull-group');
const pullButton=document.querySelector('[data-git-action="pull"]');
pullButton.before(pullGroup);pullGroup.append(pullButton,document.querySelector('.pull-strategy'));
document.querySelector('.pull-strategy>span').textContent='';
$('pull-strategy').title='Pull strategy — applies when you click Pull';
const baseSyncSummary=renderSyncSummary;
renderSyncSummary=function(sync={}){baseSyncSummary(sync);for(const [action,count,arrow] of [['pull',sync.behind,'↓'],['push',sync.ahead,'↑']]){const button=document.querySelector(`[data-git-action="${action}"]`);button.querySelector('strong').textContent=`${action==='pull'?'Pull':'Push'}${count?' '+arrow+count:''}`;button.title=button.querySelector('small').textContent+' · local tracking refs';}};
document.addEventListener('mousedown',event=>{if(!secondary.contains(event.target))secondary.removeAttribute('open');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&secondary.open){secondary.removeAttribute('open');secondaryLabel.focus();}});
const branchLabel=el('span','toolbar-branch');toolbar.firstElementChild.append(branchLabel);
const footer=$('workspace-statusbar');footer.before($('console'));
$('status-activity').setAttribute('aria-label','Show operation status and output');
$('status-activity').setAttribute('aria-live','polite');
let operationLabel='Ready',operationStart=0,operationRepo='';
const toolbarSetOutput=setOutput;
setOutput=function(message,options={}){operationRepo=state.workspaceRepo?.name||'';toolbarSetOutput(message,options);};
const currentToolbarStatus=()=>state.busy?operationLabel:`${state.workspaceRepo?.name||'Workspace'} · ${state.workspace?'Ready':'Loading…'}`;
const currentGithubProject=()=>{const remotes=state.workspace?.remotes||[];const remote=remotes.find(r=>r.name==='origin')||remotes[0];return GitDeckRelease.githubProject(remote?.fetchUrl||remote?.pushUrl||'');};
const gitlabMrDialog=showMrDialog;
showMrDialog=function(repo,sourceBranch='',remote='origin'){const remotes=state.workspace?.remotes||[];const selected=remotes.find(r=>r.name===remote);const project=GitDeckRelease.githubProject(selected?.fetchUrl||selected?.pushUrl||'');if(project){const branch=sourceBranch||state.workspace?.branch||repo.branch;if(!branch||branch==='HEAD'){setNotice('Select a branch before creating a pull request');return;}window.open(project+'/compare/'+encodeURIComponent(branch)+'?expand=1','_blank','noopener,noreferrer');return;}return gitlabMrDialog(repo,sourceBranch,remote);};
const originalStatus=renderWorkspaceStatus;
renderWorkspaceStatus=function(){originalStatus();branchLabel.textContent=state.workspace?'Working on: '+(state.workspace.branch||'Detached HEAD'):'Loading branch…';branchLabel.title=branchLabel.textContent;$('status-job').textContent=currentToolbarStatus();$('status-activity').title=`Latest output${operationRepo?' · '+operationRepo:''}: ${$('output-summary').textContent||'None'}`;const mr=document.querySelector('.create-mr-button');const github=currentGithubProject();mr.textContent=github?'Pull Request ↗':'Merge Request';mr.title=github?'Open GitHub comparison to choose target and create a pull request (does not push)':'Create GitLab merge request';};
const originalLoading=showLoading,originalHideLoading=hideLoading;
showLoading=function(title,detail=''){operationStart=Date.now();operationLabel=title+(detail?' · '+detail:'');originalLoading(title,detail);renderWorkspaceStatus();};
hideLoading=function(){originalHideLoading();operationLabel=state.busy?'Working…':($('output-summary').textContent||'Ready');renderWorkspaceStatus();};
new MutationObserver(()=>{if(!document.body.hasAttribute('aria-busy')){operationLabel=$('output-summary').textContent||'Ready';renderWorkspaceStatus();}}).observe($('output-summary'),{childList:true,characterData:true,subtree:true});
new MutationObserver(()=>{const value=$('workspace-branch').textContent;if(/Loading|Checking|Reading|Queued/.test(value)){operationLabel=value;renderWorkspaceStatus();}}).observe($('workspace-branch'),{childList:true});
setInterval(()=>{if(document.body.hasAttribute('aria-busy')&&operationStart){$('status-job').textContent=`${operationLabel} · ${((Date.now()-operationStart)/1000).toFixed(1)}s`;}},1000);

function enhanceChangeFiles(){
  for(const node of document.querySelectorAll('.change-file-path:not([data-labelled])')){
    const path=node.textContent;const parts=path.replaceAll('\\','/').split('/');const name=parts.pop();node.dataset.labelled='true';node.title=path;
    node.replaceChildren(el('strong','',name),el('small','',parts.join('/')||'Repository root'));
    const row=node.closest('.change-file');const status=row.querySelector('.file-status');
    const label={M:'Modified',A:'Added',D:'Deleted',R:'Renamed',U:'Conflict','?':'Untracked'}[status?.textContent.trim()]||'Changed';if(status){status.title=label;status.setAttribute('aria-label',label);}
    row.querySelector('.change-file-main')?.setAttribute('aria-label',`${label}: ${path}`);
  }
  const layout=document.querySelector('.changes-layout');if(!layout||layout.querySelector('.changes-column-resizer'))return;
  const key='git-deck-file-pane:'+repoKey(state.workspaceRepo);const handle=el('div','changes-column-resizer');handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label','Resize file list');handle.setAttribute('aria-orientation','vertical');
  let width=Number(localStorage.getItem(key))||300;
  const set=value=>{width=Math.round(Math.min(Math.max(200,value),Math.max(200,layout.clientWidth-260)));layout.style.setProperty('--files-width',width+'px');handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuemin','200');handle.setAttribute('aria-valuemax',String(Math.max(200,layout.clientWidth-260)));};
  const save=()=>{try{localStorage.setItem(key,String(width));}catch{}};
  // Modern wraps the file list and commit box in one column; the handle goes after that column.
  (layout.querySelector(':scope > .modern-changes-column')||layout.querySelector('.change-groups')).after(handle);requestAnimationFrame(()=>set(width));
  handle.onpointerdown=e=>{e.preventDefault();handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))set(e.clientX-layout.getBoundingClientRect().left);};handle.onpointerup=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);save();}};
  handle.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();set(e.key==='Home'?300:width+(e.key==='ArrowLeft'?-20:20));save();}};handle.ondblclick=()=>{set(300);save();};
}
new MutationObserver(enhanceChangeFiles).observe($('workspace-content'),{childList:true,subtree:true});
const paneKey=()=>state.workspaceRepo?'git-deck-pane-layout:'+repoKey(state.workspaceRepo):'';
const restorePaneLayout=()=>{const saved=GitDeckRelease.read(localStorage,paneKey(),{});if(saved.tree)document.querySelector('.workbench-body').style.setProperty('--tree-width',saved.tree);if(saved.files)document.querySelector('.commit-detail-split')?.style.setProperty('--commit-files-width',saved.files);};
const originalDetailResizer=initializeCommitDetailResizer;initializeCommitDetailResizer=function(...args){originalDetailResizer(...args);restorePaneLayout();};
document.addEventListener('pointerup',event=>{if(!event.target.matches('#tree-resizer,.commit-detail-resizer'))return;const body=document.querySelector('.workbench-body');const split=document.querySelector('.commit-detail-split');GitDeckRelease.write(localStorage,paneKey(),{tree:body.style.getPropertyValue('--tree-width'),files:split?.style.getPropertyValue('--commit-files-width')});});
const compactOpenWorkspace=openWorkspace;openWorkspace=async function(...args){const loading=compactOpenWorkspace(...args);renderWorkspaceStatus();await loading;restorePaneLayout();renderWorkspaceStatus();};
enhanceChangeFiles();renderWorkspaceStatus();

// Small, explicit controls; no additional Git reads are needed to render them.
const baseRepoTabs=renderRepoTabs;
renderRepoTabs=function(){
  baseRepoTabs();
  document.querySelectorAll('.repo-tab').forEach((tab,index)=>{
    const repo=state.repos.find(r=>repoKey(r)===tab.dataset.repoKey);if(!repo)return;
    tab.oncontextmenu=event=>showContextMenu(event,repositoryTabContextItems(repo,()=>tab.querySelector(".repo-tab-close")?.click()));
    const cached=workspaceSnapshots.get(repoKey(repo))?.data;
    const data=state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo)?state.workspace:cached;
    const changes=data?.files?.length??repo.changes;
    const sync=data?.sync||repo;
    const button=tab.querySelector('.repo-tab-open');
    if(button.firstChild?.nodeType===Node.TEXT_NODE){const name=el('span','repo-tab-name',button.firstChild.textContent);button.firstChild.replaceWith(name);}
    button.title=`${repo.name}\n${repo.path}\n${data?.branch||repo.branch||'Branch not checked'}\nSync based on local tracking refs`;
    const badge=el('small','repo-tab-status',`${Number(changes)>0?'● '+changes+' ':''}${Number(sync.ahead)>0?'↑'+sync.ahead+' ':''}${Number(sync.behind)>0?'↓'+sync.behind:''}`.trim());
    if(badge.textContent){badge.setAttribute('aria-label',`${changes||0} changes, ${sync.ahead||0} ahead, ${sync.behind||0} behind`);button.append(badge);}
  });
};
const basePaletteEntries=commandPaletteEntries;
commandPaletteEntries=function(){
  const tags=(state.workspace?.tags||[]).map(tag=>typeof tag==='string'?((state.workspace.tagDetails||[]).find(t=>t.name===tag)||{name:tag,hash:''}):tag);
  return basePaletteEntries().concat((state.workspace?.branches||[]).map(branch=>({label:branch.name,group:'Local branch · switch',shortcut:branch.current?'Current':'',search:`branch ${branch.name}`,run:()=>{if(!branch.current)runWorkspaceAction('branch-switch',{branch:branch.name},`Switch to ${branch.name}?`);}})),tags.map(tag=>({label:tag.name,group:'Tag · details',shortcut:tag.hash||'',search:`tag ${tag.name}`,run:()=>showTagDetails(tag)})));
};

function fileRisk(path){return /(^|[\\/])(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?)$|\.(pem|p12|pfx|key)$|(^|[\\/])\.idea([\\/]|$)|\.iml$/i.test(path);}
function changeKind(status){return /U|AA|DD/.test(status)?'conflict':status.includes('D')?'deleted':/[A?]/.test(status)?'new':'modified';}
const baseChangesView=renderChangesView;
renderChangesView=function(content,data){
  baseChangesView(content,data);
  const shell=content.querySelector('.changes-workspace'),bar=shell.querySelector('.changes-commandbar');
  const key='git-deck-change-view:'+repoKey(state.workspaceRepo);
  const saved=GitDeckRelease.read(localStorage,key,{});
  const filter=document.createElement('select');filter.setAttribute('aria-label','Filter file status');
  [['all','All changes'],['modified','Modified'],['new','New'],['deleted','Deleted'],['conflict','Conflicts']].forEach(([v,t])=>filter.append(new Option(t,v)));
  filter.value=['modified','new','deleted','conflict'].includes(saved.filter)?saved.filter:'all';
  const mode=document.createElement('select');mode.setAttribute('aria-label','File list layout');mode.append(new Option('List','list'),new Option('Folders','tree'));mode.value=saved.mode==='tree'?'tree':'list';
  bar.insertBefore(filter,bar.querySelector('.changes-search'));bar.insertBefore(mode,filter);
  const apply=()=>{
    shell.querySelectorAll('.file-folder-heading').forEach(n=>n.remove());
    shell.querySelectorAll('.change-group').forEach(group=>{
      const rows=[...group.querySelectorAll('.change-file')];
      if(mode.value==='tree')rows.sort((a,b)=>a.querySelector('.change-file-main').title.localeCompare(b.querySelector('.change-file-main').title));
      let previous=null;
      for(const row of rows){
        const path=row.querySelector('.change-file-main').title,file=data.files.find(f=>f.path===path);
        row.hidden=filter.value!=='all'&&changeKind(file?.status||'')!==filter.value;
        if(mode.value==='tree'){
          const folder=path.replaceAll('\\','/').split('/').slice(0,-1).join('/')||'Repository root';
          if(!row.hidden&&folder!==previous){group.append(el('div','file-folder-heading',folder));previous=folder;}
          group.append(row);
        }
      }
    });
    const active=shell.querySelector('.change-file-main.active');
    if(active?.closest('.change-file').hidden){
      const next=shell.querySelector('.change-file:not([hidden]) .change-file-main');
      if(next)next.click();else shell.querySelector('.working-diff').replaceChildren(workspaceEmpty('No matching files','Change the status filter or search.'));
    }
    GitDeckRelease.write(localStorage,key,{mode:mode.value,filter:filter.value});
  };
  filter.onchange=mode.onchange=apply;
  shell.querySelector('.changes-search').addEventListener('input',apply);
  bar.querySelector('[aria-label="Sort changed files"]').addEventListener('change',apply);apply();
  const risky=data.files.filter(f=>fileRisk(f.path));
  const note=el('p','commit-scope-note',`Commit uses staged files only · ${data.files.filter(f=>f.staged).length} staged. Stage all is a separate action.`);
  shell.querySelector('.commit-editor').append(note);
  if(risky.length){const warning=el('details','file-risk-warning');warning.append(el('summary','',`Review ${risky.length} potentially sensitive / IDE files`),el('p','',risky.map(f=>f.path).join('\n')));shell.querySelector('.commit-editor').append(warning);}
  shell.querySelector('form').addEventListener('submit',event=>{
    if(!data.files.some(f=>f.staged)&&!shell.querySelector('.commit-option input').checked){event.preventDefault();event.stopImmediatePropagation();setNotice('Stage files before committing.');}
  },true);
};
const baseRunWorkspaceAction=runWorkspaceAction;
runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
  if(action==='stage-all'&&!confirmation)confirmation=`Stage all visible changes in ${state.workspaceRepo?.name}? Review the list before committing.`;
  const paths=action==='stage-all'?(state.workspace?.files||[]).filter(f=>f.unstaged).map(f=>f.path):action==='stage-file'?[payload.file]:action==='files-bulk'&&payload.mode==='stage'?payload.files:action==='commit'?(state.workspace?.files||[]).filter(f=>f.staged).map(f=>f.path):[];
  const risky=(paths||[]).filter(fileRisk);
  if(risky.length)confirmation+=(confirmation?'\n\n':'')+'Potentially sensitive / IDE files — review before proceeding:\n'+risky.join('\n');
  return baseRunWorkspaceAction(action,payload,confirmation,options);
};

function resetWorkbenchLayout(){
  if(!confirm('Reset panel sizes and view layout? Repository tabs, drafts and theme will be kept.'))return;
  const key=state.workspaceRepo?repoKey(state.workspaceRepo):'';
  ['git-deck-pane-width','git-deck-tree-width','git-deck-commit-files-width','git-deck-commit-columns-v1','git-deck-file-pane:'+key,'git-deck-pane-layout:'+key,'git-deck-history-columns:'+key,'git-deck-history-graph-height:'+key].forEach(k=>{try{localStorage.removeItem(k);}catch{}});
  if(key){delete state.meta.historyLayouts[key];delete state.meta.historyDensity[key];delete state.meta.historyColumns[key];}
  state.meta.layoutPreset='compact';saveMeta();applyAppearance();setRepositoryPaneWidth(270);
  document.querySelector('.workbench-body').style.setProperty('--tree-width','220px');
  if(state.workspace)renderWorkspace();setNotice('Layout reset. Tabs and commit drafts kept.');
}
const layoutControls=el('div','workbench-layout-controls');
const density=document.createElement('select');density.setAttribute('aria-label','Workspace density');density.append(new Option('Compact','compact'),new Option('Comfortable','comfortable'));density.value=state.meta.layoutPreset==='comfortable'?'comfortable':'compact';
density.onchange=()=>{state.meta.layoutPreset=density.value;saveMeta();applyAppearance();};
const reset=el('button','','Reset layout');reset.type='button';reset.onclick=resetWorkbenchLayout;layoutControls.append(density,reset);secondary.append(layoutControls);
const freshness=el('span','workspace-freshness');freshness.setAttribute('role','status');$('status-job').before(freshness);
new MutationObserver(()=>{freshness.textContent=$('workspace-branch').textContent;freshness.title=freshness.textContent;}).observe($('workspace-branch'),{childList:true,characterData:true,subtree:true});
const refreshTabs=paintWorkspace;paintWorkspace=function(...args){const result=refreshTabs(...args);renderRepoTabs();return result;};
const baseColumnResizers=initializeCommitColumnResizers;
initializeCommitColumnResizers=function(list,header){
  const key='git-deck-history-columns:'+repoKey(state.workspaceRepo);
  const sizes=GitDeckRelease.read(localStorage,key,{});
  GitDeckRelease.write(localStorage,'git-deck-commit-columns-v1',sizes);
  baseColumnResizers(list,header);
  const save=()=>GitDeckRelease.write(localStorage,key,GitDeckRelease.read(localStorage,'git-deck-commit-columns-v1',{}));
  header.addEventListener('pointerup',()=>setTimeout(save,0));header.addEventListener('keydown',()=>setTimeout(save,0));header.addEventListener('dblclick',()=>setTimeout(save,0));
};
renderRepoTabs();
