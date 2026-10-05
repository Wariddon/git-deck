'use strict';
// Work across many repositories, in the Operations Center:
//   Pending work  - what is still open everywhere (changes, unpushed, stashes, merged branches)
//   Update all    - fetch or pull every repository in a folder, with one result table
//   Switch branch - put every repository of a ticket on the same branch (switch, track or create)
//   Search        - commit messages, ticket keys, branch names or changed content in every repository
// Plus Branch cleanup for the open repository. Server side: lib/GitDeck.MultiRepo.ps1.
(function(){
  if(typeof api!=='function'||typeof el!=='function')return;
  const ticketPattern=/\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

  // ---- helpers ------------------------------------------------------------------------------
  async function mapLimit(items,limit,run){
    const results=new Array(items.length);let next=0;
    await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;results[index]=await run(items[index],index);}}));
    return results;
  }
  const query=(params)=>new URLSearchParams(params).toString();
  const usable=(repo)=>repo&&repo.valid!==false&&!repo.pending;
  function inFolder(repo,folder){if(!folder||folder==='all')return true;const path=repo.path.toLowerCase(),root=folder.toLowerCase();return path===root||path.startsWith(root+'\\');}
  // The folder choice is shared by every panel and the Work report, and remembered.
  const folderKey='gitdeck.folder';
  function folderSelect(){
    const select=document.createElement('select');select.className='workflow-input';select.setAttribute('aria-label',t('Folder'));select.append(new Option(t('All folders'),'all'));(state.scanLocations||[]).forEach(root=>select.append(new Option(root,root)));
    try{const saved=localStorage.getItem(folderKey);if(saved&&[...select.options].some(option=>option.value===saved))select.value=saved;}catch{}
    select.addEventListener('change',()=>{try{localStorage.setItem(folderKey,select.value);}catch{}});return select;
  }
  const reposIn=(folder)=>(state.repos||[]).filter(repo=>usable(repo)&&inFolder(repo,folder));
  function openRepo(repo){document.getElementById('operations-close')?.click();openWorkspace(repo,'history',null);}
  function repoLink(repo){const button=el('button','multi-repo-link',repo.name);button.type='button';button.title=repo.path;button.onclick=()=>openRepo(repo);return button;}
  function table(headers){const node=el('table','multi-repo-table');const head=el('tr');headers.forEach(label=>head.append(el('th','',label)));node.append(head);return node;}
  function row(cells){const tr=el('tr');cells.forEach(cell=>{const td=el('td');if(cell instanceof Node)td.append(cell);else td.textContent=cell??'';tr.append(td);});return tr;}
  const firstLine=(text)=>String(text||'').split(/\r?\n/).find(line=>line.trim())||'';
  // Run one Git Deck action without the global loading overlay; background jobs are polled quietly.
  async function runQuiet(action,repo,payload={}){
    let result=await api('/api/action',{method:'POST',body:JSON.stringify({action,path:repo.path,...payload})});
    if(result?.async&&result.jobId){
      for(let i=0;i<480;i++){const job=await api('/api/job?id='+encodeURIComponent(result.jobId));
        if(job.state==='completed')return job;if(job.state==='failed'||job.state==='cancelled')throw new Error(firstLine(job.output)||job.message||t('Failed'));
        await new Promise(resolve=>setTimeout(resolve,750));}
      throw new Error(t('Timed out'));
    }
    return result;
  }
  const refreshAfter=async()=>{try{if(typeof refresh==='function')await refresh();}catch{}try{if(state.workspaceRepo&&typeof loadWorkspace==='function')await loadWorkspace();}catch{}};

  // ---- pure helpers (tested) -----------------------------------------------------------------
  // What a repository still has open, as short labels; empty means nothing pending.
  function pendingLabels(p){
    const labels=[];
    if(p.operation)labels.push({tone:'bad',text:t('{operation} in progress',{operation:p.operation})});
    if(p.conflicts)labels.push({tone:'bad',text:t('{count} conflict(s)',{count:p.conflicts})});
    if(p.changed||p.untracked)labels.push({tone:'warn',text:t('{count} uncommitted file(s)',{count:p.changed+p.untracked})});
    if(p.ahead)labels.push({tone:'warn',text:t('{count} to push',{count:p.ahead})});
    if(p.upstream===''&&p.branch&&!['main','master','develop'].includes(p.branch))labels.push({tone:'warn',text:t('Branch not published')});
    for(const item of p.unpushedBranches||[])labels.push({tone:'warn',text:t('{branch}: {count} not pushed',{branch:item.branch,count:item.commits})});
    if(p.behind)labels.push({tone:'info',text:t('{count} to pull',{count:p.behind})});
    if((p.stashes||[]).length)labels.push({tone:'info',text:t('{count} stash(es)',{count:p.stashes.length})});
    if((p.mergedBranches||[]).length)labels.push({tone:'muted',text:t('{count} merged branch(es) to delete',{count:p.mergedBranches.length})});
    return labels;
  }
  // For each repository: what a multi-repository switch to `name` would do.
  function switchPlan(name,found,{create=false,localChanges='stash'}={}){
    if(found.current===name)return {kind:'none',label:t('Already on {branch}',{branch:name})};
    if(found.dirty&&!localChanges)return {kind:'skip',label:t('Skipped: uncommitted changes')};
    const payload=localChanges?{localChanges}:{};
    if(found.local)return {kind:'switch',action:'branch-switch',payload:{branch:name,...payload},label:t('Switch to {branch}',{branch:name})};
    if(found.remote)return {kind:'track',action:'branch-track',payload:{branch:found.remote,...payload},label:t('Track {remote}',{remote:found.remote})};
    if(create)return {kind:'create',action:'branch-create',payload:{branch:name},label:t('Create {branch} from {current}',{branch:name,current:found.current||'HEAD'})};
    return {kind:'skip',label:t('No branch {branch}',{branch:name})};
  }
  // Branch cleanup suggestions: merged, upstream gone, or untouched for `days`.
  function cleanupReasons(branch,now=Date.now(),days=90){
    if(branch.protected||branch.current)return [];
    const reasons=[];
    if(branch.merged)reasons.push('merged');
    if(branch.gone)reasons.push('gone');
    const age=(now-Date.parse(branch.date))/86400000;if(Number.isFinite(age)&&age>days)reasons.push('old');
    return reasons;
  }
  // The one-click fixes offered for a repository's pending work, most urgent first.
  function pendingActions(p){
    if(!p)return [];const ids=[];
    if(p.operation||p.conflicts)ids.push('resolve');
    if(p.changed||p.untracked)ids.push('commit');
    if(p.ahead&&p.upstream&&!p.conflicts)ids.push('push');
    else if(!p.upstream&&p.branch&&!['main','master','develop'].includes(p.branch))ids.push('publish');
    if(p.behind&&!p.operation)ids.push('pull');
    if((p.stashes||[]).length)ids.push('stashes');
    if((p.mergedBranches||[]).length)ids.push('cleanup');
    return ids;
  }
  const ticketPrefix=(branch)=>{const match=String(branch||'').match(ticketPattern);return match?match[0]+': ':'';};

  // ---- Operations Center panels -------------------------------------------------------------
  const panels={};
  function addPanel(id,label,build){
    const nav=document.querySelector('.operations-tabs');const modal=document.querySelector('.operations-modal');
    if(!nav||!modal||nav.querySelector(`[data-operations-view="${id}"]`))return;
    const button=el('button','',label);button.type='button';button.dataset.operationsView=id;nav.append(button);
    const panel=el('section','operations-view hidden multi-repo-panel');panel.dataset.operationsPanel=id;modal.append(panel);
    panels[id]={panel,build,built:false};
  }
  if(typeof switchOperationsView==='function'){
    const baseSwitch=switchOperationsView;
    switchOperationsView=function(view){
      if(!panels[view])return baseSwitch(view);
      document.querySelectorAll('[data-operations-view]').forEach(button=>button.classList.toggle('active',button.dataset.operationsView===view));
      document.querySelectorAll('[data-operations-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.operationsPanel!==view));
      const item=panels[view];if(!item.built){item.built=true;item.build(item.panel);}
    };
  }

  // Pending work.
  function buildPending(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const onlyOpen=document.createElement('input');onlyOpen.type='checkbox';onlyOpen.checked=true;
    const onlyLabel=el('label','modern-dialog-check');onlyLabel.append(onlyOpen,el('span','',t('Only repositories with something pending')));
    const run=el('button','primary',t('Check'));run.type='button';
    const pushAll=el('button','',t('Push all'));pushAll.type='button';pushAll.title=t('Push the current branch of every repository that has commits to push');pushAll.disabled=true;
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    bar.append(folder,onlyLabel,run,pushAll);panel.append(bar,status,out);
    let results=[];
    const check=async(repo)=>{try{const pending=(await api('/api/repo/pending?'+query({path:repo.path}))).pending;return {repo,pending,labels:pendingLabels(pending),error:''};}catch(error){return {repo,pending:null,labels:[],error:firstLine(error.message)};}};
    const summary=()=>{const pending=results.filter(item=>item.labels.length).length;status.textContent=t('{pending} of {total} repositories have something pending',{pending,total:results.length});pushAll.disabled=!results.some(item=>pendingActions(item.pending).includes('push'));};
    // One click per fix: the button does the safe step or opens the right view.
    const act=async(item,id,button)=>{
      const repo=item.repo;const go=(tab)=>{document.getElementById('operations-close')?.click();openWorkspace(repo,tab,null);};
      if(id==='commit')return go('changes');if(id==='resolve')return go('conflicts');if(id==='stashes')return go('stashes');
      if(id==='cleanup'){document.getElementById('operations-close')?.click();return openBranchCleanup(repo);}
      button.disabled=true;button.textContent=t('Working…');
      try{
        const result=id==='pull'?await runQuiet('pull',repo,{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}):await runQuiet('push',repo);
        showActionFeedback(`${repo.name} · ${firstLine(result?.message)||t('Done')}`);
      }catch(error){showActionFeedback(firstLine(error.message),{error:true,context:`${repo.name} · ${id}`});}
      Object.assign(item,await check(repo));summary();draw();
    };
    const actionLabels={commit:()=>t('Commit…'),push:()=>t('Push'),publish:()=>t('Publish'),pull:()=>t('Pull'),resolve:()=>t('Resolve…'),stashes:()=>t('Stashes…'),cleanup:()=>t('Clean up…')};
    const draw=()=>{
      out.replaceChildren();
      const shown=results.filter(item=>item.error||!onlyOpen.checked||item.labels.length);
      if(!shown.length){out.append(el('p','multi-repo-empty',t('Nothing pending. Everything is committed, pushed and tidy.')));return;}
      const grid=table([t('Repository'),t('Branch'),t('Pending'),'']);
      shown.forEach(item=>{
        const chips=el('div','multi-repo-chips');
        if(item.error)chips.append(el('span','multi-repo-chip tone-bad',item.error));
        item.labels.forEach(label=>chips.append(el('span',`multi-repo-chip tone-${label.tone}`,label.text)));
        const actions=el('div','multi-repo-actions');
        for(const id of pendingActions(item.pending)){const button=el('button',id==='push'||id==='publish'?'primary':'',actionLabels[id]());button.type='button';button.onclick=()=>act(item,id==='publish'?'push':id,button);actions.append(button);}
        grid.append(row([repoLink(item.repo),item.pending?.branch||'',chips,actions]));
      });
      out.append(grid);
    };
    onlyOpen.onchange=draw;
    run.onclick=async()=>{
      const repos=reposIn(folder.value);run.disabled=true;let done=0;
      results=await mapLimit(repos,4,async repo=>{const item=await check(repo);status.textContent=t('Checked {done} of {total}',{done:++done,total:repos.length});return item;});
      results.sort((a,b)=>(b.error?99:b.labels.length)-(a.error?99:a.labels.length)||a.repo.name.localeCompare(b.repo.name));
      summary();run.disabled=false;draw();
    };
    pushAll.onclick=async()=>{
      const todo=results.filter(item=>pendingActions(item.pending).includes('push'));if(!todo.length)return;
      if(!confirm(t('Push {count} repositories now?',{count:todo.length})+'\n'+todo.map(item=>`${item.repo.name} (${item.pending.branch}, ${item.pending.ahead})`).join('\n')))return;
      pushAll.disabled=run.disabled=true;let failed=0;
      for(const item of todo){
        status.textContent=t('Pushing {name}…',{name:item.repo.name});let problem='';
        try{await runQuiet('push',item.repo);}catch(error){failed++;problem=firstLine(error.message);}
        Object.assign(item,await check(item.repo));if(problem)item.error=problem;
      }
      summary();if(failed)status.textContent+=' · '+t('{count} could not push',{count:failed});run.disabled=false;draw();
    };
    run.click();
  }

  // Fetch or pull every repository in a folder.
  function buildUpdate(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const fetch=el('button','',t('Fetch all'));fetch.type='button';
    const pull=el('button','primary',t('Pull all'));pull.type='button';pull.title=t('Pull the current branch of each repository; uncommitted changes are stashed and restored');
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    bar.append(folder,fetch,pull);panel.append(bar,el('p','multi-repo-note',t('Pull uses your pull strategy ({strategy}) with uncommitted changes stashed and restored. Repositories without a remote or in the middle of a merge are skipped.',{strategy:state.meta?.pullStrategy||'ff-only'})),status,out);
    const go=async(mode)=>{
      const repos=reposIn(folder.value).filter(repo=>repo.remote!==''&&repo.remote!==null);
      if(!repos.length){status.textContent=t('No repositories with a remote in this folder.');return;}
      if(mode==='pull'&&!confirm(t('Pull {count} repositories now?',{count:repos.length})))return;
      fetch.disabled=pull.disabled=true;out.replaceChildren();const grid=table([t('Repository'),t('Result')]);out.append(grid);let done=0;
      const rows=new Map(repos.map(repo=>{const cell=el('span','multi-repo-result',t('Waiting…'));grid.append(row([repoLink(repo),cell]));return [repo.path,cell];}));
      const outcome=await mapLimit(repos,mode==='pull'?2:4,async repo=>{
        const cell=rows.get(repo.path);cell.textContent=t('Working…');
        try{
          const result=mode==='pull'?await runQuiet('pull',repo,{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}):await runQuiet('fetch',repo);
          const text=firstLine(result?.message||result?.output)||t('Done');
          const conflict=/conflict/i.test(text)||(result?.conflicts||[]).length;
          cell.textContent=text;cell.className='multi-repo-result '+(conflict?'tone-bad':/up to date|already/i.test(text)?'tone-muted':'tone-ok');return conflict?'conflict':'ok';
        }catch(error){cell.textContent=firstLine(error.message);cell.className='multi-repo-result tone-bad';return 'error';}
        finally{status.textContent=t('{done} of {total} done',{done:++done,total:repos.length});}
      });
      const failed=outcome.filter(x=>x!=='ok').length;
      status.textContent=failed?t('{ok} done · {failed} need attention',{ok:outcome.length-failed,failed}):t('All {count} repositories updated',{count:outcome.length});
      fetch.disabled=pull.disabled=false;await refreshAfter();
    };
    fetch.onclick=()=>go('fetch');pull.onclick=()=>go('pull');
  }

  // Put many repositories on the same branch.
  function buildSwitch(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const name=el('input','workflow-input');name.placeholder=t('Branch name, e.g. feature/AP2365-3319');name.setAttribute('aria-label',t('Branch name'));
    const mode=document.createElement('select');mode.className='workflow-input';mode.setAttribute('aria-label',t('Uncommitted changes'));
    [['stash',t('Changes: stash, switch, restore')],['carry',t('Changes: bring along')],['',t('Changes: skip that repository')]].forEach(([value,label])=>mode.append(new Option(label,value)));
    const create=document.createElement('input');create.type='checkbox';
    const createLabel=el('label','modern-dialog-check');createLabel.append(create,el('span','',t('Create it where it does not exist')));
    const preview=el('button','',t('Preview'));preview.type='button';const run=el('button','primary',t('Switch'));run.type='button';run.disabled=true;
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    bar.append(folder,name,mode,createLabel,preview,run);panel.append(bar,status,out);
    let plans=[];
    if(state.workspace?.branch&&state.workspace.branch!=='main'&&state.workspace.branch!=='master')name.value=state.workspace.branch;
    preview.onclick=async()=>{
      const branch=name.value.trim();if(!branch){name.focus();return;}
      preview.disabled=run.disabled=true;out.replaceChildren();status.textContent=t('Checking…');
      const repos=reposIn(folder.value);
      plans=await mapLimit(repos,4,async repo=>{try{const found=(await api('/api/repo/find-branch?'+query({path:repo.path,name:branch}))).branch;return {repo,found,plan:switchPlan(branch,found,{create:create.checked,localChanges:mode.value})};}catch(error){return {repo,plan:{kind:'skip',label:firstLine(error.message)}};}});
      const grid=table([t('Repository'),t('Now on'),t('Plan')]);
      plans.forEach(item=>{item.cell=el('span',`multi-repo-result tone-${item.plan.action?'info':'muted'}`,item.plan.label);grid.append(row([repoLink(item.repo),item.found?.current||'',item.cell]));});
      out.append(grid);const count=plans.filter(item=>item.plan.action).length;
      status.textContent=t('{count} repositories will change',{count});preview.disabled=false;run.disabled=!count;
    };
    run.onclick=async()=>{
      const todo=plans.filter(item=>item.plan.action);if(!todo.length)return;
      if(!confirm(t('Switch {count} repositories to {branch}?',{count:todo.length,branch:name.value.trim()})))return;
      run.disabled=preview.disabled=true;let failed=0;
      for(const item of todo){
        item.cell.textContent=t('Working…');
        try{const result=await runQuiet(item.plan.action,item.repo,item.plan.payload);item.cell.textContent=firstLine(result?.message)||t('Done');item.cell.className='multi-repo-result tone-ok';}
        catch(error){failed++;item.cell.textContent=firstLine(error.message);item.cell.className='multi-repo-result tone-bad';}
      }
      status.textContent=failed?t('{failed} could not switch; see the table',{failed}):t('All done');preview.disabled=false;await refreshAfter();
    };
    name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();preview.click();}});
  }

  // Search every repository.
  function buildSearch(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const text=el('input','workflow-input');text.type='search';text.placeholder=t('Ticket, word in a commit message or branch name');text.setAttribute('aria-label',t('Search text'));
    const mode=document.createElement('select');mode.className='workflow-input';mode.setAttribute('aria-label',t('Search in'));
    [['message',t('Commit messages and branches')],['content',t('Changed code (slower)')]].forEach(([value,label])=>mode.append(new Option(label,value)));
    const run=el('button','primary',t('Search'));run.type='submit';
    const form=el('form','operations-toolbar');form.append(folder,text,mode,run);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');panel.append(form,status,out);
    form.onsubmit=async(event)=>{
      event.preventDefault();const q=text.value.trim();if(!q)return;
      run.disabled=true;out.replaceChildren();const repos=reposIn(folder.value);let done=0;
      const list=(value)=>Array.isArray(value)?value:value?[value]:[];
      const results=await mapLimit(repos,4,async repo=>{let answer={commits:[],branches:[]};try{const raw=await api('/api/repo/search?'+query({path:repo.path,q,mode:mode.value}));answer={commits:list(raw.commits),branches:list(raw.branches)};}catch(error){answer.error=firstLine(error.message);}status.textContent=t('Searched {done} of {total}',{done:++done,total:repos.length});return {repo,...answer};});
      const hits=results.filter(item=>(item.commits||[]).length||(item.branches||[]).length);
      status.textContent=t('{count} repositories match',{count:hits.length});run.disabled=false;
      if(!hits.length){out.append(el('p','multi-repo-empty',t('No matches.')));return;}
      for(const item of hits){
        const box=el('section','multi-repo-hit');const head=el('h3');head.append(repoLink(item.repo));box.append(head);
        if(item.branches?.length)box.append(el('p','multi-repo-branches',t('Branches: {list}',{list:item.branches.join(', ')})));
        const list=el('ul');(item.commits||[]).forEach(commit=>{const line=el('li');line.append(el('code','',commit.hash),el('span','',` ${commit.date} · ${commit.subject}`),el('small','',commit.author?` — ${commit.author}`:''));
          line.title=t('Open in history');line.onclick=()=>{openRepo(item.repo);setTimeout(()=>{const search=document.querySelector('.history-search');if(search){search.value=commit.hash;search.dispatchEvent(new Event('input'));}},900);};list.append(line);});
        box.append(list);out.append(box);
      }
    };
    setTimeout(()=>text.focus(),0);
  }

  // ---- Branch cleanup (open repository) --------------------------------------------------------
  async function openBranchCleanup(target){
    const repo=target?.path?target:state.workspaceRepo;if(!repo||typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Clean up branches'));ui.dialog.classList.add('modern-action-dialog','branch-cleanup-dialog');ui.actions.querySelector('button').textContent=t('Close');
    ui.body.append(el('p','',t('Loading…')));
    let data;try{data=(await api('/api/repo/branch-cleanup?'+query({path:repo.path}))).cleanup;}catch(error){ui.body.replaceChildren(el('p','',error.message));return;}
    const days=document.createElement('select');days.className='workflow-input';days.setAttribute('aria-label',t('Older than'));[[30,t('Older than 30 days')],[90,t('Older than 90 days')],[180,t('Older than 180 days')]].forEach(([v,l])=>days.append(new Option(l,v)));days.value='90';
    const showRemote=document.createElement('input');showRemote.type='checkbox';showRemote.checked=true;
    const remoteLabel=el('label','modern-dialog-check');remoteLabel.append(showRemote,el('span','',t('Include remote branches')));
    const head=el('div','operations-toolbar');head.append(days,remoteLabel);
    const note=el('p','multi-repo-note',data.mainline?t('Merged means already in {branch}. main, master, develop and the current branch are never suggested.',{branch:data.mainline}):t('No main branch found, so only gone and old branches are suggested.'));
    const list=el('div','multi-repo-body');ui.body.replaceChildren(head,note,list);
    const remove=el('button','danger',t('Delete selected'));remove.type='button';ui.actions.prepend(remove);
    const reasonText={merged:t('merged'),gone:t('upstream gone'),old:t('old')};
    let checks=[];
    const draw=()=>{
      list.replaceChildren();checks=[];
      const items=data.branches.filter(branch=>showRemote.checked||!branch.remote).map(branch=>({branch,reasons:cleanupReasons(branch,Date.now(),Number(days.value))})).filter(item=>item.reasons.length);
      if(!items.length){list.append(el('p','multi-repo-empty',t('No branches to clean up.')));remove.disabled=true;return;}
      const grid=table(['',t('Branch'),t('Why'),t('Last commit')]);
      items.forEach(item=>{const box=document.createElement('input');box.type='checkbox';box.checked=item.reasons.includes('merged')||item.reasons.includes('gone');box.setAttribute('aria-label',item.branch.name);checks.push({box,item});
        grid.append(row([box,item.branch.remote?`☁ ${item.branch.name}`:item.branch.name,item.reasons.map(r=>reasonText[r]).join(', '),`${String(item.branch.date).slice(0,10)} · ${item.branch.subject}`]));});
      list.append(grid);remove.disabled=false;
    };
    days.onchange=draw;showRemote.onchange=draw;draw();
    remove.onclick=async()=>{
      const chosen=checks.filter(c=>c.box.checked).map(c=>c.item.branch);if(!chosen.length)return;
      const remotes=chosen.filter(b=>b.remote).length;
      if(!confirm(t('Delete {count} branch(es)?',{count:chosen.length})+(remotes?'\n'+t('{count} are on the remote and will be deleted for everyone.',{count:remotes}):'')+'\n'+t('Unmerged local branches are force-deleted; their commits stay in Recovery (reflog) for a while.')))return;
      remove.disabled=true;let failed=[];
      for(const branch of chosen){
        try{
          if(branch.remote){const parts=branch.name.split('/');const remote=parts.shift();await runQuiet('branch-delete-remote',repo,{remote,branch:parts.join('/')});}
          else await runQuiet('branch-delete',repo,{branch:branch.name,force:!branch.merged});
          data.branches=data.branches.filter(b=>b!==branch);
        }catch(error){failed.push(`${branch.name}: ${firstLine(error.message)}`);}
      }
      showActionFeedback(failed.length?failed.join('\n'):t('Deleted {count} branch(es)',{count:chosen.length}),failed.length?{error:true,context:`${repo.name} · ${t('Clean up branches')}`}:{});
      draw();await refreshAfter();
    };
  }

  // ---- GitLab notifications: failed pipelines and new MR comments --------------------------------
  const seenKey='gitdeck.gitlabSeen';
  const readSeen=()=>{try{return JSON.parse(localStorage.getItem(seenKey)||'{}')||{};}catch{return {};}};
  const writeSeen=(value)=>{try{localStorage.setItem(seenKey,JSON.stringify(value));}catch{}};
  // Compare an inbox with what was seen before; the first look only records.
  function gitlabNews(previous,inbox){
    const news=[];const next={pipelines:{},notes:{}};
    for(const pipeline of inbox.pipelines||[]){next.pipelines[pipeline.id]=pipeline.status;
      if(previous&&pipeline.status==='failed'&&previous.pipelines?.[pipeline.id]!=='failed')news.push({kind:'pipeline',text:t('Pipeline #{id} failed on {ref}',{id:pipeline.id,ref:pipeline.ref}),url:pipeline.web_url});}
    for(const mr of inbox.mergeRequests||[]){const count=Number(mr.user_notes_count)||0;next.notes[mr.iid]=count;
      if(previous&&previous.notes?.[mr.iid]!==undefined&&count>previous.notes[mr.iid])news.push({kind:'comment',text:t('New comment on !{iid} {title}',{iid:mr.iid,title:mr.title}),url:mr.web_url});}
    return {news,next};
  }
  function newsCard(repo,items){
    const card=el('section','action-feedback gitlab-news');card.setAttribute('role','status');
    card.append(el('strong','',`${repo.name} · GitLab`));items.slice(0,4).forEach(item=>card.append(el('p','',item.text)));
    const actions=el('div','feedback-actions');const open=el('button','primary',t('Open inbox'));open.type='button';
    open.onclick=()=>{card.remove();openWorkspace(repo,'gitlab-inbox',null);};const later=el('button','',t('Later'));later.type='button';later.onclick=()=>card.remove();
    actions.append(open,later);card.append(actions);
    let stack=document.getElementById('action-feedback-stack');if(!stack){stack=el('div','action-feedback-stack');stack.id='action-feedback-stack';document.body.append(stack);}
    stack.append(card);setTimeout(()=>card.remove(),60000);
    if(typeof notifyComplete==='function')notifyComplete(`${repo.name} · GitLab`,items.map(item=>item.text).join('\n'));
  }
  async function checkGitLab(){
    try{const hosts=await api('/api/gitlab/hosts');if(!hosts.installed||!(hosts.hosts||[]).some(h=>h.authenticated))return;}catch{return;}
    const open=new Set(state.meta?.openRepos||[]);const repos=(state.repos||[]).filter(repo=>usable(repo)&&/gitlab/i.test(repo.remote||'')&&open.has(repoKey(repo)));
    const seen=readSeen();
    for(const repo of repos){
      try{const inbox=(await api('/api/gitlab/inbox?'+query({path:repo.path}))).inbox;const {news,next}=gitlabNews(seen[repo.path],inbox);seen[repo.path]=next;if(news.length)newsCard(repo,news);}catch{}
    }
    writeSeen(seen);
  }

  // ---- daily helpers ---------------------------------------------------------------------------
  // Commit message starts with the ticket key from the branch name (feature/AP2365-3319 -> "AP2365-3319: ").
  if(typeof document!=='undefined')document.addEventListener('focusin',event=>{
    const box=event.target;if(!(box instanceof HTMLTextAreaElement)||!box.closest('.commit-editor')||box.value)return;
    const prefix=ticketPrefix(state.workspace?.branch);if(!prefix)return;
    box.value=prefix;box.setSelectionRange(prefix.length,prefix.length);box.dispatchEvent(new Event('input',{bubbles:true}));
    box.addEventListener('blur',()=>{if(box.value===prefix){box.value='';box.dispatchEvent(new Event('input',{bubbles:true}));}},{once:true});
  });
  // File history and blame from the Changes file menu too (History already has them).
  if(typeof workingFileContextItems==='function'&&typeof loadFileHistory==='function'){
    const baseWorking=workingFileContextItems;
    workingFileContextItems=function(file,staged,diffPane,button){
      const items=baseWorking(file,staged,diffPane,button);if(file.status==='??'||!diffPane)return items;
      return items.concat([{separator:true},{label:t('File history'),run:()=>loadFileHistory(file,diffPane)},{label:t('Blame'),hint:t('who changed each line'),run:()=>loadFileBlame(file,diffPane)}]);
    };
  }
  // Cherry-pick several commits: a way into History's multi-select from the commit menu.
  if(typeof commitContextItems==='function'){
    const baseCommit=commitContextItems;
    commitContextItems=function(...args){
      const items=baseCommit(...args);
      const toggle=[...document.querySelectorAll('input[type=checkbox]')].find(input=>/Select multiple commits/.test(input.parentElement?.textContent||''));
      if(!toggle||toggle.checked)return items;
      return items.concat([{separator:true},{label:t('Select several commits to cherry-pick…'),run:()=>{toggle.click();showActionFeedback(t('Tick the commits, then press Cherry-pick selected.'));}}]);
    };
  }
  // After a push to GitLab from a work branch, offer the merge request.
  if(typeof runWorkspaceAction==='function'&&typeof showMrDialog==='function'){
    const baseRun=runWorkspaceAction;
    runWorkspaceAction=async function(action,...rest){
      const result=await baseRun.call(this,action,...rest);
      const branch=state.workspace?.branch||'';const repo=state.workspaceRepo;
      if(result&&(action==='push'||action==='push-selection')&&repo&&/gitlab/i.test(repo.remote||(state.workspace?.remotes||[])[0]?.url||'')&&branch&&!['main','master','develop'].includes(branch)){
        const card=el('section','action-feedback feedback-success');card.setAttribute('role','status');
        card.append(el('strong','',t('Pushed {branch}',{branch})),el('p','',t('Open a merge request for it? The AI button in the dialog can write the description.')));
        const actions=el('div','feedback-actions');const go=el('button','primary',t('Create merge request'));go.type='button';go.onclick=()=>{card.remove();showMrDialog(repo,branch);};
        const later=el('button','',t('Later'));later.type='button';later.onclick=()=>card.remove();actions.append(go,later);card.append(actions);
        let stack=document.getElementById('action-feedback-stack');if(!stack){stack=el('div','action-feedback-stack');stack.id='action-feedback-stack';document.body.append(stack);}
        stack.append(card);setTimeout(()=>card.remove(),45000);
      }
      return result;
    };
  }

  // ---- entry points ----------------------------------------------------------------------------
  if(typeof document!=='undefined'&&document.querySelector('.operations-tabs')){
    addPanel('pending',t('Pending work'),buildPending);
    addPanel('update-all',t('Update all'),buildUpdate);
    addPanel('switch-all',t('Switch branch'),buildSwitch);
    addPanel('search-all',t('Search all'),buildSearch);
    const openView=(view)=>{if(typeof showOperationsCenter==='function')showOperationsCenter(view);};
    const more=document.querySelector('.sync-more > div');
    if(more&&!more.querySelector('[data-multi-repo]')){
      const entries=[['pending',t('📋 Pending work'),t('What is still uncommitted, unpushed or stashed in every repository')],['switch-all',t('🔀 Switch branch everywhere'),t('Put every repository of a ticket on the same branch')],['search-all',t('🔎 Search all repositories'),t('Find a ticket, message or branch in every repository')]];
      for(const [view,label,hint] of entries){const button=el('button','');button.type='button';button.dataset.multiRepo=view;button.append(el('strong','',label),el('small','',hint));button.onclick=()=>{more.parentElement?.removeAttribute('open');openView(view);};more.append(button);}
      const clean=el('button','');clean.type='button';clean.dataset.multiRepo='cleanup';clean.append(el('strong','',t('🧹 Clean up branches')),el('small','',t('Delete merged, gone or old branches of this repository')));clean.onclick=()=>{more.parentElement?.removeAttribute('open');openBranchCleanup();};more.append(clean);
    }
    const buttons=document.querySelector('.panel-buttons');
    if(buttons&&!buttons.querySelector('#pending-work')){const button=el('button','btn soft',t('Pending'));button.id='pending-work';button.type='button';button.title=t('What is still uncommitted, unpushed or stashed in every repository');button.onclick=()=>openView('pending');buttons.insertBefore(button,buttons.querySelector('#work-report')||buttons.querySelector('#gitlab'));}
    if(typeof commandPaletteEntries==='function'){
      const base=commandPaletteEntries;const group=t('Repositories');
      const extra=[[t('Pending work in all repositories'),()=>openView('pending')],[t('Fetch or pull all repositories'),()=>openView('update-all')],[t('Switch branch in all repositories'),()=>openView('switch-all')],[t('Search all repositories'),()=>openView('search-all')],[t('Clean up branches…'),openBranchCleanup]];
      commandPaletteEntries=function(){return [...base(),...extra.map(([label,run])=>({label,group,shortcut:'',run,search:`${label} ${group}`}))];};
    }
    if(typeof branchOperationContextItems==='function'){
      const baseBranch=branchOperationContextItems;
      branchOperationContextItems=function(...args){return [...baseBranch(...args),{separator:true},{label:t('Clean up branches…'),run:openBranchCleanup}];};
    }
    setTimeout(checkGitLab,30000);setInterval(checkGitLab,10*60*1000);
  }
  window.GitDeckMultiRepo={pendingLabels,pendingActions,switchPlan,cleanupReasons,ticketPrefix,gitlabNews,openBranchCleanup,checkGitLab};
})();
