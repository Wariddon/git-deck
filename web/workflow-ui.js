'use strict';
// Local workflow helpers. Reports contain numeric measurements, never repository data.
const workflowTimings=[];
function recordWorkflowTiming(kind,ms,gitMs){
  if(!['workspace','status','checkout','history','render'].includes(kind)||!Number.isFinite(ms))return;
  workflowTimings.push({kind,ms:Math.round(Math.max(0,ms)),...(Number.isFinite(gitMs)?{gitMs:Math.round(Math.max(0,gitMs))}:{})});
  if(workflowTimings.length>40)workflowTimings.shift();
}
const workflowBaseApi=api;
api=async function(path,options={}){
  const kind=path.startsWith('/api/repo/status-snapshot?')?'status':path.startsWith('/api/repo/checkout-review?')?'checkout':path.startsWith('/api/repo/workspace?')?'workspace':path.startsWith('/api/repo/history?')?'history':'';
  const start=performance.now();let result;
  try{result=await workflowBaseApi(path,options);return result;}
  finally{if(kind)recordWorkflowTiming(kind,performance.now()-start,result?.gitMs??result?.status?.gitMs);}
};
const workflowBaseRender=renderWorkspace;
renderWorkspace=function(...args){const start=performance.now();try{return workflowBaseRender(...args);}finally{recordWorkflowTiming('render',performance.now()-start);}};
function workflowButton(label,run){const button=el('button','',label);button.type='button';button.onclick=run;return button;}
function workflowCurrent(repo){return state.workspaceRepo?.path===repo.path;}
function workflowList(items){const list=el('ul','workflow-list');for(const item of items)list.append(el('li','',item));return list;}
function workflowReport(){return JSON.stringify({app:'Git Deck',measurements:workflowTimings.map(x=>({kind:x.kind,ms:x.ms,...(Number.isFinite(x.gitMs)?{gitMs:x.gitMs}:{})}))},null,2);}
function showWorkflowPerformance(){
  const ui=releaseDialog('Performance · Local measurements');
  ui.body.append(el('p','','Request includes transit, server wait and processing time. Git measures status reads. The difference is total overhead, not just queue time. Render measures synchronous DOM creation only.'));
  const report=workflowReport();ui.body.append(el('pre','workflow-report',report));
  ui.actions.append(workflowButton('Copy safe report',async()=>{await navigator.clipboard.writeText(report);setNotice('Copied numeric report — no paths, URLs or commit data');}),workflowButton('Clear measurements',()=>{workflowTimings.length=0;ui.dialog.close();}));
}

let statusCheckRunning=false,lastStatusCheck=0,statusUnsupported=false;
function workflowFileStamp(files=[]){return JSON.stringify(files.map(f=>[f.path,f.status,Boolean(f.staged),Boolean(f.unstaged)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
const workflowHeads=new Map();
const workflowBasePaint=paintWorkspace;
paintWorkspace=function(data){const head=(data.history||[]).find(c=>/(^|,\s*)HEAD(?: ->|,|$)/.test(c.decorations||''));if(state.workspaceRepo&&head)workflowHeads.set(repoKey(state.workspaceRepo),head.fullHash);return workflowBasePaint(data);};
if(state.workspace&&state.workspaceRepo){const head=(state.workspace.history||[]).find(c=>/(^|,\s*)HEAD(?: ->|,|$)/.test(c.decorations||''));if(head)workflowHeads.set(repoKey(state.workspaceRepo),head.fullHash);}
function workflowStatusNotice(text,retry){
  document.getElementById('workflow-status-note')?.remove();const note=el('div','history-context');note.id='workflow-status-note';note.setAttribute('role','status');note.append(el('span','',text));if(retry)note.append(workflowButton('Refresh',retry));$('workspace-content').prepend(note);
}
async function checkActiveWorkingFiles(manual=false){
  const repo=state.workspaceRepo;if(!repo||!state.workspace||state.busy||state.activeJob||statusCheckRunning||workspaceReadInFlight||document.hidden||document.querySelector('dialog[open]')||(!manual&&(statusUnsupported||Date.now()-lastStatusCheck<2000)))return;
  statusCheckRunning=true;lastStatusCheck=Date.now();const version=workspaceLoadVersion;
  try{
    const result=await api('/api/repo/status-snapshot?'+new URLSearchParams({path:repo.path}));
    if(!workflowCurrent(repo)||state.busy||version!==workspaceLoadVersion)return;
    statusUnsupported=false;
    const oldHead=workflowHeads.get(repoKey(repo));workflowHeads.set(repoKey(repo),result.head);
    if(result.branch!==state.workspace.branch||(oldHead!==undefined&&oldHead!==result.head)){
      workflowStatusNotice('Branch/HEAD changed in another application. Existing history is preserved. Refresh to load current data.',()=>loadWorkspace());return;
    }
    const changed=workflowFileStamp(state.workspace.files)!==workflowFileStamp(result.files)||JSON.stringify(state.workspace.operation)!==JSON.stringify(result.operation);
    state.workspace.files=result.files;state.workspace.protectedUntracked=result.protectedUntracked;state.workspace.operation=result.operation;
    // Do not stamp a whole workspace snapshot fresh: only status was checked.
    renderWorkspaceStatus();
    if(changed){
      const editing=document.activeElement?.matches('input,textarea,select,[contenteditable=true]');
      if(state.workspaceTab==='changes'&&!editing)renderWorkspace();
      workflowStatusNotice(`Files last checked ${new Date().toLocaleTimeString('en-US')} · ${result.files.length} changed · History was not reloaded`,()=>{if(state.workspaceTab==='changes')renderWorkspace();else selectWorkspaceTab('changes');});
    }
  }catch(error){
    if(workflowCurrent(repo)){statusUnsupported=/404|not found/i.test(error.message);workflowStatusNotice('File check failed. Existing data is preserved. Restart Git Deck if the server is outdated.',()=>checkActiveWorkingFiles(true));}
  }finally{statusCheckRunning=false;}
}
window.addEventListener('focus',()=>checkActiveWorkingFiles());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkActiveWorkingFiles();});

let checkoutReviewBusy=false;
async function confirmCheckoutReview(repo,target){
  const ui=releaseDialog('Review before checkout');ui.body.textContent='Checking branch and pending changes in Git…';
  return new Promise(resolve=>{
    let approved=false;ui.dialog.addEventListener('close',()=>resolve(approved),{once:true});
    (async()=>{try{
      const result=await api('/api/repo/checkout-review?'+new URLSearchParams({path:repo.path,target}));
      if(!ui.dialog.isConnected)return;
      if(!workflowCurrent(repo)){ui.body.textContent='Repository changed. Reopen this action.';return;}
      ui.body.replaceChildren(el('h3','',`${result.status.branch||'Detached HEAD'} → ${target}`),el('p','',`${result.currentOnly} commits source-only · ${result.targetOnly} target-only · ${result.changedFiles.length} changed files`));
      ui.body.append(el('h4','','Files changed between commits'),workflowList(result.changedFiles.slice(0,100)));
      if(result.changedFiles.length>100)ui.body.append(el('p','','Showing the first 100 files'));
      if(result.blocked){
        ui.body.append(el('p','workflow-warning','Cannot check out yet. Resolve pending changes or the active Git operation first.'),workflowList(result.status.files.map(f=>f.status+' '+f.path)));
        ui.actions.append(workflowButton('Review changed files',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('changes');}),workflowButton('Open Stashes / stash manually',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('stashes');}));
      }else ui.actions.append(workflowButton('Confirm checkout',()=>{if(!workflowCurrent(repo)||state.busy)return;approved=true;ui.dialog.close();}));
      ui.body.append(el('small','','No automatic stashing. Pending changes are checked again before switching branches.'));
    }catch(error){if(ui.dialog.isConnected)ui.body.textContent='Check failed. Checkout was not performed: '+error.message;}})();
  });
}
const workflowBaseAction=runWorkspaceAction;
runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
  if(['branch-switch','branch-track','checkout-commit'].includes(action)){
    const repo=state.workspaceRepo;if(!repo||state.busy||checkoutReviewBusy)return null;
    checkoutReviewBusy=true;try{if(!await confirmCheckoutReview(repo,payload.branch||payload.commit)||!workflowCurrent(repo))return null;}finally{checkoutReviewBusy=false;}
    return workflowBaseAction(action,payload,'',options);
  }
  return workflowBaseAction(action,payload,confirmation,options);
};

async function showSendReview(){
  const repo=state.workspaceRepo;if(!repo){setNotice('Select a repository first');return;}
  const ui=releaseDialog('Before sending · '+repo.name);ui.body.textContent='Reading current local status…';
  try{
    const response=await api('/api/repo/workspace?'+new URLSearchParams({path:repo.path,extras:'false'}));const data=response.workspace;
    if(!ui.dialog.isConnected)return;if(!workflowCurrent(repo)){ui.body.textContent='Repository changed. Reopen this view.';return;}
    ui.body.replaceChildren(el('h3','',`Current: ${data.branch||'Detached HEAD'}`),el('p','',`${data.files.length} pending files · ${data.operation?.active?'Active: '+data.operation.type+' in progress':'No Git operation in progress'}`));
    ui.body.append(workflowList(data.files.map(f=>f.status+' '+f.path)));
    const remotes=el('select');remotes.setAttribute('aria-label','Review push remote');for(const r of data.remotes||[])remotes.append(new Option(r.name,r.name));
    const upstream=(data.sync?.upstream||'').split('/');if(upstream.length>1)remotes.value=upstream[0];if(!remotes.value&&remotes.options.length)remotes.selectedIndex=0;
    const target=el('input');target.setAttribute('aria-label','Review destination branch');target.value=upstream.length>1?upstream.slice(1).join('/'):data.branch;
    const preview=el('div');let reviewVersion=0;const inspect=async()=>{
      const version=++reviewVersion;preview.textContent='Checking the destination using local refs…';
      try{const result=await api('/api/repo/push-preview?'+new URLSearchParams({path:repo.path,remote:remotes.value,local:data.branch,target:target.value.trim()}));if(!ui.dialog.isConnected||version!==reviewVersion)return;preview.replaceChildren(el('p','',`${data.branch} → ${result.remote}/${result.target} · ↑${result.ahead??'?'} ↓${result.behind??'?'} · Local refs do not confirm the latest remote state`),workflowList(result.commits||[]));}
      catch(error){if(ui.dialog.isConnected&&version===reviewVersion)preview.textContent=error.message;}
    };
    remotes.className='workflow-input';target.className='workflow-input';
    const invalidate=()=>{reviewVersion++;preview.textContent='Destination changed. Review commits again.';};remotes.onchange=invalidate;target.oninput=invalidate;
    ui.body.append(remotes,target,workflowButton('Review outgoing commits',inspect),preview);
    if(remotes.options.length&&data.branch)void inspect();else preview.textContent='No remote or detached HEAD. Configure a branch and remote before pushing.';
    const mr=el('div');mr.textContent='MR: not checked online';ui.body.append(mr);
    ui.actions.append(workflowButton('Check MR status on GitLab',async()=>{mr.textContent='Reading GitLab…';try{const result=await api('/api/gitlab/inbox?'+new URLSearchParams({path:repo.path}));if(ui.dialog.isConnected)mr.replaceChildren(el('p','','Open MRs for this branch'),workflowList((result.inbox.mergeRequests||[]).filter(x=>x.source_branch===data.branch).map(x=>`!${x.iid} ${x.title} · ${x.detailed_merge_status||x.state||'open'}`)));}catch(error){mr.textContent='Could not check MRs: '+error.message;}}));
    ui.actions.append(workflowButton('Open Push to review and confirm',async()=>{if(!workflowCurrent(repo)||state.busy)return;await loadWorkspace();if(!workflowCurrent(repo))return;ui.dialog.close();showPushDialog();}),workflowButton('Open File Status',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('changes');}));
    ui.body.append(el('small','','This review does not push or create MRs automatically. The Push dialog asks you to select a destination and confirm again.'));
  }catch(error){if(ui.dialog.isConnected)ui.body.textContent='Could not check: '+error.message;}
}

function workflowBlockers(data,busy=false){
  const reasons=[];if(busy)reasons.push('An operation is running. Wait for it to finish before starting another write operation.');
  if(!data)return [...reasons,'Repository not loaded. Select a repository and reload.'];
  if(!data.branch)reasons.push('Detached HEAD. Create or check out a branch before pushing.');
  if(!data.remotes?.length)reasons.push('No remote. Open Remotes to configure a push destination.');
  if(data.files?.length)reasons.push('Pending changes. Commit or stash before checkout/merge. Pushing existing commits does not require a clean working tree.');
  if(data.operation?.active)reasons.push('Active: '+data.operation.type+' in progress. Open Conflict Center to resolve, continue or abort.');
  if(data.sync?.behind>0)reasons.push('Local tracking refs show incoming commits. Fetch, then compare/pull before pushing. Do not force push without reviewing.');
  return reasons;
}
async function showActionReasons(){
  const repo=state.workspaceRepo,ui=releaseDialog('Action help · Push / Checkout / Merge');ui.body.textContent='Checking…';
  try{const data=repo?(await api('/api/repo/workspace?'+new URLSearchParams({path:repo.path,extras:'false'}))).workspace:null;if(!ui.dialog.isConnected)return;const reasons=workflowBlockers(data,state.busy);ui.body.replaceChildren(workflowList(reasons.length?reasons:['No basic local blockers found. Select a branch/file if required, or check remote permissions and Output.']));for(const [label,tab]of [['Manage files','changes'],['Configure remote','remotes'],['Resolve conflicts','conflicts'],['Compare','compare']])ui.actions.append(workflowButton(label,()=>{ui.dialog.close();if(repo&&workflowCurrent(repo))selectWorkspaceTab(tab);}));}
  catch(error){ui.body.textContent='Could not check status: '+error.message;}
}

function readWorksets(){const value=GitDeckRelease.read(localStorage,'git-deck-worksets-v1',[]);return Array.isArray(value)?value.filter(x=>typeof x.name==='string'&&Array.isArray(x.paths)).slice(0,30):[];}
const worksetTabs=renderRepoTabs;
renderRepoTabs=function(){worksetTabs();const button=workflowButton('Worksets',showWorksets);button.classList.add('repo-tab-search','repo-tab-worksets');button.title='Save or open a group of repositories';const tabs=$('repo-tabs'),search=tabs.querySelector('.repo-tab-search');if(search)search.before(button);else tabs.append(button);};
function showWorksets(){
  const ui=releaseDialog('Repository worksets');const draw=()=>{ui.body.replaceChildren(el('p','','Open as tabs while keeping existing tabs and drafts. No branch checkout is performed.'));const sets=readWorksets();
    sets.forEach((set,index)=>{const row=el('div','workflow-workset');row.append(el('strong','',set.name),el('small','',set.paths.length+' repos'),workflowButton('Open workset',()=>{
      const repos=set.paths.map(path=>state.repos.find(r=>repoKey(r)===path));const valid=repos.filter(r=>r&&r.valid!==false);const missing=repos.length-valid.length;
      state.meta.openRepos=[...new Set([...state.meta.openRepos,...valid.map(repoKey)])];saveMeta();renderRepoTabs();if(valid.length)openWorkspace(valid[0],state.workspaceTab||'history',null);if(missing)setNotice(`${missing} repositories missing or unavailable. Skipped without creating or cloning.`);ui.dialog.close();
    }),workflowButton('Delete workset',()=>{if(!confirm('Delete only workset '+set.name+'? Repository files will not be deleted'))return;sets.splice(index,1);GitDeckRelease.write(localStorage,'git-deck-worksets-v1',sets);draw();}));ui.body.append(row);});
  };draw();ui.actions.append(workflowButton('Save open tabs as a workset',()=>{const name=prompt('Workset name (up to 60 characters)');if(!name?.trim())return;const sets=readWorksets();if(sets.length>=30){setNotice('You can save up to 30 worksets');return;}const paths=[...new Set(state.meta.openRepos)].slice(0,50);if(!paths.length){setNotice('Open at least one repository tab first');return;}sets.push({name:name.trim().slice(0,60),paths});GitDeckRelease.write(localStorage,'git-deck-worksets-v1',sets);draw();}));
}

function showTraining(){
  const ui=releaseDialog('Git practice · Separate from real projects');ui.body.append(el('p','','Creates a new repository under Git Deck/sandboxes each time. No remote, no copied project data, and no existing repositories deleted.'));
  ui.body.append(workflowList(['Commit: stage notes.txt and enter a commit message','Branch: open Branches, create a test branch, then check out main again','Merge: on main, merge lesson/conflict to practice conflict resolution','Conflict: open Conflict Center, resolve files, then continue or abort','Push and MR are excluded because there is no remote']));
  const create=workflowButton('Create and open practice repository',async()=>{
    if(state.busy)return;create.disabled=true;setBusy(true);
    try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'training-create'})});const repo={path:result.path,name:result.name,valid:true,branch:'main',changes:1,remote:''};state.repos.push(repo);ui.dialog.close();await openWorkspace(repo,'changes',true);setNotice('Practice repository ready. No remote configured. Read README to get started.');}
    catch(error){ui.body.append(el('p','workflow-warning','Could not create: '+error.message));}
    finally{setBusy(false);create.disabled=false;}
  });ui.actions.append(create);
}
const workflowCommands=[['Before sending',showSendReview],['Refresh files',()=>checkActiveWorkingFiles(true)],['Action help',showActionReasons],['Worksets',showWorksets],['Performance',showWorkflowPerformance],['Practice',showTraining]];
const workflowBaseCommands=commandPaletteEntries;
commandPaletteEntries=function(){return workflowBaseCommands().concat(workflowCommands.map(([label,run])=>({label,group:'Workflow',shortcut:'',search:label,run})));};
for(const panel of document.querySelectorAll('.help-menu-panel'))for(const [label,run]of workflowCommands){panel.append(workflowButton(label,()=>{panel.closest('details')?.removeAttribute('open');run();}));}
const workflowTools=el('div','workflow-toolbar');workflowTools.append(workflowButton('Before sending',showSendReview),workflowButton('Action help',showActionReasons),workflowButton('Worksets',showWorksets));document.querySelector('.workbench-layout-controls')?.append(workflowTools);
