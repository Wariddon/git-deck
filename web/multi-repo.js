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
  // Numbers for the Pending table; score orders "most pending first".
  function pendingCounts(p){
    if(!p)return {changes:0,push:0,pull:0,stashes:0,localOnly:0,localOnlyCommits:0,merged:0,conflicts:0,unpublished:0,operation:0,score:0};
    const unpublished=!p.upstream&&p.branch&&!['main','master','develop'].includes(p.branch)?1:0;
    const c={changes:(p.changed||0)+(p.untracked||0),push:p.ahead||0,pull:p.behind||0,stashes:(p.stashes||[]).length,
      localOnly:(p.unpushedBranches||[]).length,localOnlyCommits:(p.unpushedBranches||[]).reduce((n,b)=>n+(Number(b.commits)||0),0),
      merged:(p.mergedBranches||[]).length,conflicts:p.conflicts||0,unpublished,operation:p.operation?1:0};
    c.score=(c.operation||c.conflicts?1000:0)+c.changes*3+c.push*3+unpublished*5+c.pull*2+c.stashes+c.localOnly+(c.merged?1:0);
    return c;
  }
  // The filter box takes several names at once: "crs-svc, lns-deployment tonson". Each term matches
  // a repository name, branch or latest tag; the rank (which term matched first) keeps the typed order.
  const parseTerms=(text)=>String(text||'').toLowerCase().split(/[,\s]+/).map(term=>term.trim()).filter(Boolean);
  function termRank(item,terms){
    if(!terms.length)return 0;
    const name=item.repo.name.toLowerCase();const other=`${item.pending?.branch||''} ${item.pending?.latestTag||''}`.toLowerCase();
    // An exact name beats a partial one, so "lns" lists lns before lns-deployment-2.
    const exact=terms.indexOf(name);if(exact>=0)return exact;
    return terms.findIndex(term=>name.includes(term)||other.includes(term));
  }
  // Tag filter: has a tag, no tag yet, or commits on the branch after its latest tag (time to release?).
  function tagMatches(item,mode){
    const p=item.pending||{};
    if(mode==='tagged')return Boolean(p.latestTag);
    if(mode==='untagged')return Boolean(item.pending)&&!p.latestTag;
    if(mode==='since')return Boolean(p.latestTag)&&Number(p.commitsSinceTag)>0;
    return true;
  }
  // "3 days ago" style age of an ISO date.
  function ageOf(iso,now=Date.now()){
    // Calendar days, not 24-hour blocks: yesterday evening is "yesterday", not "today".
    const then=new Date(Date.parse(iso));if(!Number.isFinite(then.getTime()))return '';const today=new Date(now);
    const days=Math.round((new Date(today.getFullYear(),today.getMonth(),today.getDate())-new Date(then.getFullYear(),then.getMonth(),then.getDate()))/86400000);
    if(days<1)return t('today');if(days<2)return t('yesterday');if(days<60)return t('{count} days ago',{count:days});
    const months=Math.floor(days/30);return months<24?t('{count} months ago',{count:months}):t('{count} years ago',{count:Math.floor(days/365)});
  }
  // Branch names break after "/" instead of in the middle of a word ("feature/" + "login").
  function breakable(text){const span=document.createElement('span');String(text).split('/').forEach((part,i,all)=>{span.append(part+(i<all.length-1?'/':''));if(i<all.length-1)span.append(document.createElement('wbr'));});return span;}
  // "2026-10-06" from an ISO date (Git already gives local time), and "2026-10-06 · 3 days ago".
  const dayOf=(iso)=>/^\d{4}-\d{2}-\d{2}/.test(String(iso||''))?String(iso).slice(0,10):'';
  const whenOf=(iso,now=Date.now())=>[dayOf(iso),ageOf(iso,now)].filter(Boolean).join(' · ');
  // Plain-words reason for a failed Git action: the error guide's title when one matches,
  // otherwise the line of Git output that says what went wrong (not "To C:/...remote.git").
  function explainError(message){
    const text=String(message||'');const guide=typeof window!=='undefined'&&window.GitDeckErrorGuide?.guideFor?.(text);
    if(guide)return guide.title();
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    return lines.find(line=>/^(error|fatal):|rejected|denied|not found|could not|failed/i.test(line))||lines[0]||'';
  }
  // The next thing to do for a repository, in plain words, most urgent first.
  function nextSteps(item){
    const c=item.counts||pendingCounts(item.pending);const p=item.pending||{};const steps=[];
    if(item.error)steps.push({tone:'bad',text:t('Could not check: {error}',{error:item.error})});
    if(item.actionError)steps.push({tone:'bad',text:item.actionError.kind==='pull'?t('Pull failed: {reason}',{reason:item.actionError.reason}):t('Push failed: {reason}',{reason:item.actionError.reason})});
    if(c.operation||c.conflicts)steps.push({tone:'bad',text:c.conflicts?t('Resolve {count} conflict(s), then finish the {operation}',{count:c.conflicts,operation:p.operation||'merge'}):t('Finish or abort the {operation}',{operation:p.operation})});
    if(c.changes)steps.push({tone:'warn',text:t('Commit or stash {count} changed file(s)',{count:c.changes})});
    if(c.push)steps.push({tone:'warn',text:t('Push {count} commit(s)',{count:c.push})});
    if(c.unpublished)steps.push({tone:'warn',text:t('Publish this branch to the remote')});
    if(c.pull)steps.push({tone:'info',text:t('Pull {count} new commit(s)',{count:c.pull})});
    if(c.localOnly)steps.push({tone:'warn',text:t('{count} branch(es) exist only on this computer: push or delete them',{count:c.localOnly})});
    if(c.stashes)steps.push({tone:'info',text:t('Review {count} stash(es)',{count:c.stashes})});
    if(c.merged)steps.push({tone:'muted',text:t('Delete {count} merged branch(es)',{count:c.merged})});
    return steps;
  }
  // Whether a checked repository belongs under a filter chip.
  function pendingMatches(item,filter){
    const c=item.counts||pendingCounts(item.pending);
    switch(filter){
      case 'all':return true;
      case 'changes':return c.changes>0;
      case 'push':return c.push>0;
      case 'pull':return c.pull>0;
      case 'unpublished':return c.unpublished>0;
      case 'localOnly':return c.localOnly>0;
      case 'stashes':return c.stashes>0;
      case 'merged':return c.merged>0;
      case 'problems':return Boolean(item.error||item.actionError)||c.conflicts>0||c.operation>0;
      default:return Boolean(item.error||item.actionError)||c.score>0;
    }
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
  // Pending work as a table: one row per repository, one number per kind of pending work.
  // Filter chips count each kind; long lists (unpushed branches, merged branches, stashes) open
  // under the row instead of filling it. Results appear as they arrive; a new check cancels the old.
  function buildPending(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const search=el('input','workflow-input pending-search');search.type='search';search.placeholder=t('Names, branches or tags: several at once, separated by commas');search.setAttribute('aria-label',t('Filter by names, branches or tags'));search.title=t('Type several names to see only those repositories, in the order you typed them. Example: crs-svc-common, lns-deployment-2, tonson');
    const sort=document.createElement('select');sort.className='workflow-input';sort.setAttribute('aria-label',t('Sort'));
    [['pending',t('Most pending first')],['name',t('Name A–Z')],['push',t('Most to push')],['changes',t('Most uncommitted')],['tag',t('Newest tag first')],['recent',t('Recently changed first')]].forEach(([value,label])=>sort.append(new Option(label,value)));
    const run=el('button','primary',t('Check'));run.type='button';
    const more=document.createElement('details');more.className='pending-more';const moreLabel=el('summary','',t('Bulk actions'));more.append(moreLabel);
    const menu=el('div','pending-more-menu');more.append(menu);
    const pushAll=el('button','',t('Push all'));pushAll.type='button';pushAll.title=t('Push the current branch of every repository that has commits to push');
    const pullAll=el('button','',t('Pull all behind'));pullAll.type='button';pullAll.title=t('Pull every repository that is behind its upstream (changes are stashed and restored)');
    const copy=el('button','',t('Copy summary'));copy.type='button';copy.title=t('Copy the shown rows as a Markdown table');
    const pruneMerged=el('button','',t('Delete merged branches (this computer)'));pruneMerged.type='button';pruneMerged.title=t('Delete local branches that are already merged; remote branches are not touched');
    menu.append(pushAll,pullAll,pruneMerged,copy);
    // Two ways to look: grouped by what to do (default, easiest) or one table row per repository.
    const viewSwitch=el('div','pending-view-switch');viewSwitch.setAttribute('role','group');viewSwitch.setAttribute('aria-label',t('View'));
    const byTask=el('button','',t('By task'));byTask.type='button';const byTable=el('button','',t('Table'));byTable.type='button';viewSwitch.append(byTask,byTable);
    const tagFilter=document.createElement('select');tagFilter.className='workflow-input pending-tag-filter';tagFilter.setAttribute('aria-label',t('Tags'));
    [['any',t('Any tag')],['tagged',t('Has a tag')],['untagged',t('No tag yet')],['since',t('Commits after latest tag')]].forEach(([value,label])=>tagFilter.append(new Option(label,value)));
    tagFilter.title=t('Commits after latest tag: the branch has work that is not in any release tag yet.');
    bar.append(folder,search,tagFilter,viewSwitch,sort,run,more);
    const chips=el('div','pending-filters');const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    const help=el('p','multi-repo-note pending-help');
    // One line under the filters: what was checked on the left, how to read the view on the right.
    const info=el('div','pending-info');info.append(status,help);
    panel.append(bar,chips,info,out);

    // Filter and sort are remembered between visits.
    const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
    const recall=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
    let results=[];let filter=recall('gitdeck.pendingFilter','any');let runId=0;let checkedAt=null;const expanded=new Set();
    let view=recall('gitdeck.pendingView','tasks')==='table'?'table':'tasks';
    tagFilter.value=[...tagFilter.options].some(option=>option.value===recall('gitdeck.pendingTag',''))?recall('gitdeck.pendingTag',''):'any';
    // Tag name, with its date and the commits since it in the tooltip.
    const tagBadge=(item)=>{const p=item.pending;const badge=el('span','pending-tag-badge','🏷 '+p.latestTag);badge.title=[t('Latest tag: {tag}',{tag:p.latestTag}),p.latestTagDate?String(p.latestTagDate).slice(0,10)+' ('+ageOf(p.latestTagDate)+')':'',Number(p.commitsSinceTag)>0?t('{count} commit(s) on {branch} after this tag',{count:p.commitsSinceTag,branch:p.branch||'HEAD'}):t('Nothing new since this tag'),t('{count} tag(s) in total',{count:p.tagCount||1})].filter(Boolean).join('\n');return badge;};
    // Columns can be widened to read long names in full: drag the edge of a column name.
    // Widths are remembered; double-click the edge to go back to the automatic width.
    const colKey='gitdeck.pendingColumns';
    const readWidths=()=>{try{return JSON.parse(localStorage.getItem(colKey)||'{}')||{};}catch{return {};}};
    const applyWidth=(grid,index,width)=>{
      for(const row of grid.rows){const cell=row.cells[index];if(!cell||cell.colSpan>1)continue;
        cell.style.width=cell.style.minWidth=cell.style.maxWidth=width?width+'px':'';cell.classList.toggle('pending-col-sized',Boolean(width));}
    };
    let columnDragEnd=null;const endColumnDrag=()=>{columnDragEnd?.();document.body.classList.remove('pending-col-resizing');};
    function sizeColumns(grid){
      const widths=readWidths();const head=grid.rows[0];if(!head)return;
      [...head.cells].forEach((th,index)=>{
        if(widths[index])applyWidth(grid,index,widths[index]);
        const grip=el('span','pending-col-grip');grip.title=t('Drag to widen or narrow this column. Double-click: automatic width.');grip.setAttribute('aria-hidden','true');
        // The drag is followed on the whole window, not the grip: the table can be redrawn while
        // dragging (results still arriving) and the button can be released outside the grip or the
        // window. Every way a drag can end (release, cancel, lost capture, window blur) ends it, so
        // the resize cursor never stays on.
        grip.onpointerdown=(event)=>{
          if(event.button!==0)return;
          event.preventDefault();event.stopPropagation();endColumnDrag();
          const startX=event.clientX;const start=th.getBoundingClientRect().width;let width=0;
          try{grip.setPointerCapture(event.pointerId);}catch{}document.body.classList.add('pending-col-resizing');
          const move=(e)=>{width=Math.max(44,Math.round(start+e.clientX-startX));applyWidth(grid,index,width);};
          const end=()=>{
            window.removeEventListener('pointermove',move,true);
            for(const type of ['pointerup','pointercancel','blur'])window.removeEventListener(type,end,true);
            grip.removeEventListener('lostpointercapture',end);
            document.body.classList.remove('pending-col-resizing');columnDragEnd=null;
            if(width){const all=readWidths();all[index]=width;try{localStorage.setItem(colKey,JSON.stringify(all));}catch{}}
          };
          columnDragEnd=end;
          window.addEventListener('pointermove',move,true);
          for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,end,true);
          grip.addEventListener('lostpointercapture',end);
        };
        grip.ondblclick=(event)=>{event.stopPropagation();applyWidth(grid,index,0);const all=readWidths();delete all[index];try{localStorage.setItem(colKey,JSON.stringify(all));}catch{}};
        th.append(grip);
      });
    }
    const syncView=()=>{
      byTask.classList.toggle('active',view==='tasks');byTable.classList.toggle('active',view==='table');
      byTask.setAttribute('aria-pressed',String(view==='tasks'));byTable.setAttribute('aria-pressed',String(view==='table'));
      sort.hidden=chips.hidden=view==='tasks';
      help.textContent=view==='tasks'?t('Grouped by what needs doing. Each group has a button that does it for every repository in the group.'):t('An overview to read: click a repository to open it, or a number to see the list. To act on many repositories, use By task.');
    };
    byTask.onclick=()=>{view='tasks';remember('gitdeck.pendingView',view);syncView();draw();};
    byTable.onclick=()=>{view='table';remember('gitdeck.pendingView',view);syncView();drawChips();draw();};
    sort.value=[...sort.options].some(option=>option.value===recall('gitdeck.pendingSort',''))?recall('gitdeck.pendingSort',''):'pending';
    const headerHelp={
      [t('Uncommitted')]:t('Files changed on this computer and not committed yet'),
      [t('To push')]:t('Commits on the current branch that the remote does not have yet'),
      [t('To pull')]:t('New commits on the remote that this computer does not have yet'),
      [t('Stashes')]:t('Work put aside with Stash; restore or delete it'),
      [t('Unpushed branches')]:t('Other branches with commits that exist only on this computer'),
      [t('Merged branches')]:t('Branches already in the main branch; safe to delete'),
      [t('What to do')]:t('The most important next step for this repository'),
      [t('Last commit')]:t('When the branch you are on last changed; hover the date for the message'),
    };
    const check=async(repo)=>{try{const pending=(await api('/api/repo/pending?'+query({path:repo.path}))).pending;return {repo,pending,counts:pendingCounts(pending),error:''};}catch(error){return {repo,pending:null,counts:pendingCounts(null),error:firstLine(error.message)};}};
    const kinds=[
      ['any',()=>t('Anything pending')],['changes',()=>t('Uncommitted')],['push',()=>t('To push')],['pull',()=>t('To pull')],
      ['unpublished',()=>t('Not published')],['localOnly',()=>t('Unpushed branches')],['stashes',()=>t('Stashes')],['merged',()=>t('Merged branches')],['problems',()=>t('Conflicts / errors')],['all',()=>t('All')]];
    const drawChips=()=>{
      chips.replaceChildren();
      for(const [id,label] of kinds){
        const count=results.filter(item=>shown(item)&&pendingMatches(item,id)).length;
        if(!count&&id!==filter&&!['any','all'].includes(id))continue;
        const chip=el('button',`pending-filter${filter===id?' active':''}`);chip.type='button';chip.append(el('span','',label()),el('b','',String(count)));
        chip.onclick=()=>{filter=id;remember('gitdeck.pendingFilter',id);drawChips();draw();};chips.append(chip);
      }
    };
    const order=(a,b)=>{
      const by=sort.value;const ca=a.counts,cb=b.counts;
      // Several names typed: keep the order they were typed in.
      const terms=parseTerms(search.value);if(terms.length>1){const diff=termRank(a,terms)-termRank(b,terms);if(diff)return diff;}
      if(by==='name')return a.repo.name.localeCompare(b.repo.name);
      if(by==='recent')return String(b.pending?.lastCommitDate||'').localeCompare(String(a.pending?.lastCommitDate||''))||a.repo.name.localeCompare(b.repo.name);
      if(by==='tag')return String(b.pending?.latestTagDate||'').localeCompare(String(a.pending?.latestTagDate||''))||a.repo.name.localeCompare(b.repo.name);
      if(by==='push')return (cb.push+cb.localOnlyCommits)-(ca.push+ca.localOnlyCommits)||a.repo.name.localeCompare(b.repo.name);
      if(by==='changes')return cb.changes-ca.changes||a.repo.name.localeCompare(b.repo.name);
      return (b.error?1e6:cb.score)-(a.error?1e6:ca.score)||a.repo.name.localeCompare(b.repo.name);
    };
    const shown=(item)=>{const terms=parseTerms(search.value);return (!terms.length||termRank(item,terms)>=0)&&tagMatches(item,tagFilter.value);};
    const visible=()=>results.filter(item=>pendingMatches(item,filter)&&shown(item)).sort(order);

    // One click per fix: the button does the safe step or opens the right view.
    const act=async(item,id,button)=>{
      const repo=item.repo;const go=(tab)=>{document.getElementById('operations-close')?.click();openWorkspace(repo,tab,null);};
      if(id==='commit')return go('changes');if(id==='resolve')return go('conflicts');if(id==='stashes')return go('stashes');
      if(id==='cleanup'){document.getElementById('operations-close')?.click();return openBranchCleanup(repo);}
      button.disabled=true;button.textContent=t('Working…');
      try{
        const result=id==='pull'?await runQuiet('pull',repo,{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}):await runQuiet('push',repo);
        showActionFeedback(`${repo.name} · ${firstLine(result?.message)||t('Done')}`);
        item.actionError=null;
      }catch(error){item.actionError={kind:id,reason:explainError(error.message),raw:String(error.message||'')};showActionFeedback(error.message,{error:true,context:`${repo.name} · ${id}`});}
      Object.assign(item,await check(repo));drawChips();draw();
    };
    const numberCell=(value,{tone='',detail='',title=''}={})=>{
      const td=el('td','pending-num');if(!value){td.append(el('span','pending-zero','·'));return td;}
      const text=String(value);
      if(detail){const button=el('button',`pending-count tone-${tone}`,text);button.type='button';button.title=title;button.setAttribute('aria-expanded',String(expanded.has(detail)));button.onclick=()=>{expanded.has(detail)?expanded.delete(detail):expanded.add(detail);draw();};td.append(button);}
      else{const span=el('span',`pending-count tone-${tone}`,text);span.title=title;td.append(span);}
      return td;
    };
    const detailRow=(item,kind)=>{
      const tr=el('tr','pending-detail');const td=el('td');td.colSpan=11;const p=item.pending;const box=el('div','pending-detail-box');
      if(kind==='localOnly'){
        box.append(el('strong','',t('Branches with commits that are on no remote')));
        const list=el('div','pending-detail-list');[...p.unpushedBranches].sort((a,b)=>b.commits-a.commits).forEach(b=>list.append(el('span','',`${b.branch} · ${b.commits}`)));box.append(list);
        const open=el('button','',t('Open Branches'));open.type='button';open.onclick=()=>{document.getElementById('operations-close')?.click();openWorkspace(item.repo,'branches',null);};box.append(open);
      }else if(kind==='merged'){
        box.append(el('strong','',t('Branches already merged into {branch}',{branch:p.mainline||'main'})));
        const list=el('div','pending-detail-list');p.mergedBranches.forEach(name=>list.append(el('span','',name)));box.append(list);
        const clean=el('button','',t('Clean up…'));clean.type='button';clean.onclick=()=>act(item,'cleanup',clean);box.append(clean);
      }else if(kind==='stashes'){
        box.append(el('strong','',t('Stashes')));const list=el('div','pending-detail-list');p.stashes.forEach(s=>list.append(el('span','',`${s.ref} · ${s.message}`)));box.append(list);
      }
      td.append(box);tr.append(td);return tr;
    };
    // ---- By task: one group per kind of work, each repository a short line with one button ----
    const taskGroups=[
      {id:'problems',icon:'⚠️',title:()=>t('Fix these first'),hint:()=>t('A push or pull failed, a merge or rebase is unfinished, there are conflicts, or the repository could not be read.'),
        line:item=>nextSteps(item)[0]?.text||'',
        // A rejected push needs a pull first; other failures open the repository.
        action:item=>item.actionError?.kind==='push'&&/rejected|fetch first|non-fast-forward|behind/i.test(item.actionError.raw)?{id:'pull',label:t('Pull first')}:item.error||item.actionError?{id:'open',label:t('Open')}:{id:'resolve',label:t('Resolve…')}},
      {id:'changes',icon:'✏️',title:()=>t('Not committed yet'),hint:()=>t('You changed files and have not committed them.'),
        line:item=>t('{count} changed file(s) on {branch}',{count:item.counts.changes,branch:item.pending.branch||'—'}),action:()=>({id:'commit',label:t('Commit…')})},
      {id:'push',icon:'⬆️',title:()=>t('Ready to push'),hint:()=>t('Committed on this computer, not on the remote yet.'),
        line:item=>t('{count} commit(s) on {branch}',{count:item.counts.push,branch:item.pending.branch}),action:()=>({id:'push',label:t('Push')}),bulk:{label:()=>t('Push all'),run:()=>bulk('push')}},
      {id:'unpublished',icon:'🆕',title:()=>t('New branches not on the remote'),hint:()=>t('The branch you are on exists only on this computer.'),
        line:item=>item.pending.branch,action:()=>({id:'publish',label:t('Publish')})},
      {id:'pull',icon:'⬇️',title:()=>t('New commits to pull'),hint:()=>t('Someone pushed; your copy is behind.'),
        line:item=>t('{count} new commit(s) for {branch}',{count:item.counts.pull,branch:item.pending.branch}),action:()=>({id:'pull',label:t('Pull')}),bulk:{label:()=>t('Pull all'),run:()=>bulk('pull')}},
      {id:'localOnly',icon:'🌿',title:()=>t('Other branches only on this computer'),hint:()=>t('Not the branch you are on: older work that was never pushed. Push it if you need it, delete it if you do not.'),
        line:item=>t('{count} branch(es), {commits} commit(s)',{count:item.counts.localOnly,commits:item.counts.localOnlyCommits}),action:()=>({id:'branches',label:t('Open Branches')}),list:item=>[...item.pending.unpushedBranches].sort((a,b)=>b.commits-a.commits).map(b=>`${b.branch} · ${b.commits}`)},
      {id:'stashes',icon:'📦',title:()=>t('Stashes left behind'),hint:()=>t('Work you put aside. Restore it or delete it.'),
        line:item=>t('{count} stash(es)',{count:item.counts.stashes}),action:()=>({id:'stashes',label:t('Stashes…')}),list:item=>item.pending.stashes.map(s=>s.message||s.ref)},
      {id:'merged',icon:'🧹',title:()=>t('Merged branches you can delete'),hint:()=>t('Already in the main branch. Deleting them only tidies up; no work is lost.'),
        line:item=>t('{count} branch(es)',{count:item.counts.merged}),action:()=>({id:'cleanup',label:t('Clean up…')}),list:item=>item.pending.mergedBranches,bulk:{label:()=>t('Delete all (this computer)'),run:()=>pruneMerged.onclick()}},
    ];
    const collapsed=new Set();
    const drawTasks=()=>{
      out.replaceChildren();
      const pool=results.filter(shown);const terms=parseTerms(search.value);
      const byTyped=(a,b)=>(terms.length>1?termRank(a,terms)-termRank(b,terms):0)||a.repo.name.localeCompare(b.repo.name);
      if(!pool.length){out.append(el('div','multi-repo-empty',results.length?t('No repository matches this filter.'):t('Checking…')));return;}
      let shownAny=false;
      // At a glance: one tile per group with its count; a click jumps to the group.
      const overview=el('div','pending-overview');out.append(overview);
      for(const group of taskGroups){
        const items=pool.filter(item=>pendingMatches(item,group.id)).sort(byTyped);
        if(!items.length)continue;shownAny=true;
        const tile=el('button',`pending-tile pending-tile-${group.id}`);tile.type='button';tile.append(el('span','pending-tile-icon',group.icon),el('b','',String(items.length)),el('span','',group.title()));
        tile.onclick=()=>{collapsed.delete(group.id);if(!out.querySelector('#pending-group-'+group.id+' .pending-group-list'))drawTasks();out.querySelector('#pending-group-'+group.id)?.scrollIntoView({behavior:'smooth',block:'start'});};
        overview.append(tile);
        const section=el('section',`pending-group pending-group-${group.id}`);section.id='pending-group-'+group.id;
        const head=el('div','pending-group-head');
        const toggle=el('button','pending-group-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed.has(group.id)));
        toggle.append(el('span','pending-group-icon',group.icon),el('strong','',group.title()),el('b','pending-group-count',String(items.length)));
        toggle.onclick=()=>{collapsed.has(group.id)?collapsed.delete(group.id):collapsed.add(group.id);drawTasks();};
        head.append(toggle);
        if(group.bulk&&items.length>1){const all=el('button','primary',`${group.bulk.label()} (${items.length})`);all.type='button';all.onclick=group.bulk.run;head.append(all);}
        section.append(head,el('p','pending-group-hint',group.hint()));
        if(!collapsed.has(group.id)){
          const list=el('div','pending-group-list');const limit=expanded.has('group|'+group.id)?items.length:8;
          for(const item of items.slice(0,limit)){
            const line=el('div','pending-line');
            const what=el('div','pending-line-what');what.append(repoLink(item.repo));if(item.pending?.latestTag)what.append(tagBadge(item));what.append(el('span','pending-line-text',group.line(item)));if(item.pending?.lastCommitDate){const when=el('small','pending-line-date',t('last commit {when}',{when:whenOf(item.pending.lastCommitDate)}));when.title=item.pending.lastCommitSubject||'';what.append(when);}
            const action=group.action(item);const button=el('button',action.id==='push'||action.id==='publish'||action.id==='pull'?'primary':'',action.label);button.type='button';
            button.onclick=()=>{
              if(action.id==='open'){document.getElementById('operations-close')?.click();openWorkspace(item.repo,'history',null);return;}
              if(action.id==='branches'){document.getElementById('operations-close')?.click();openWorkspace(item.repo,'branches',null);return;}
              act(item,action.id==='publish'?'push':action.id,button);
            };
            line.append(what);
            if(group.list){const key=`${group.id}|${item.repo.path}`;const more=el('button','pending-line-more',expanded.has(key)?t('Hide list'):t('Show list'));more.type='button';more.onclick=()=>{expanded.has(key)?expanded.delete(key):expanded.add(key);drawTasks();};line.append(more);}
            line.append(button);list.append(line);
            if(group.list&&expanded.has(`${group.id}|${item.repo.path}`)){const names=el('div','pending-detail-list pending-line-list');group.list(item).forEach(name=>names.append(el('span','',name)));list.append(names);}
          }
          if(items.length>limit){const rest=el('button','pending-show-all',t('Show all {count}',{count:items.length}));rest.type='button';rest.onclick=()=>{expanded.add('group|'+group.id);drawTasks();};list.append(rest);}
          section.append(list);
        }
        out.append(section);
      }
      const tidy=pool.filter(item=>!pendingMatches(item,'any')).length;
      if(!shownAny&&checkedAt){const empty=el('div','multi-repo-empty');empty.append(el('strong','',t('🎉 Everything is tidy')),el('p','',t('Every repository in this folder is committed, pushed and up to date.')));out.append(empty);}
      else if(tidy)out.append(el('p','pending-tidy',t('✓ {count} repositories need nothing',{count:tidy})));
    };
    const draw=()=>{
      if(view==='tasks')return drawTasks();
      out.replaceChildren();
      const rows=visible();
      if(!rows.length){
        const done=results.length&&checkedAt;
        const tidy=done&&filter==='any'&&!search.value.trim();
        const empty=el('div','multi-repo-empty');
        empty.append(el('strong','',!results.length?t('Checking…'):tidy?t('🎉 Everything is tidy'):t('No repository matches this filter.')));
        if(tidy)empty.append(el('p','',t('Every repository in this folder is committed, pushed and up to date.')));
        else if(done&&filter!=='all'){const all=el('button','',t('Show all repositories'));all.type='button';all.onclick=()=>{filter='all';remember('gitdeck.pendingFilter','all');search.value='';drawChips();draw();};empty.append(all);}
        out.append(empty);return;
      }
      const grid=table([t('Repository'),t('Branch'),t('Latest tag'),t('Last commit'),t('What to do'),t('Uncommitted'),t('To push'),t('To pull'),t('Stashes'),t('Unpushed branches'),t('Merged branches')]);
      grid.classList.add('pending-table');
      grid.querySelectorAll('th').forEach(th=>{if(headerHelp[th.textContent]){th.title=headerHelp[th.textContent];th.classList.add('pending-has-help');}});
      for(const item of rows.slice(0,300)){
        const c=item.counts,p=item.pending,key=item.repo.path;
        const name=el('td','pending-repo');name.append(repoLink(item.repo));if(item.error)name.append(el('small','pending-error',item.error));else if(p?.operation)name.append(el('small','pending-error',t('{operation} in progress',{operation:p.operation})+(c.conflicts?` · ${t('{count} conflict(s)',{count:c.conflicts})}`:'')));
        const branch=el('td','pending-branch');branch.append(breakable(p?.branch||'—'));if(c.unpublished)branch.append(el('small','pending-tag',t('not published')));
        const steps=nextSteps(item);const todo=el('td','pending-todo');
        if(steps.length){todo.append(el('span',`pending-step tone-${steps[0].tone}`,steps[0].text));if(steps.length>1){
          // The other steps open in place: click +N more (or hover it to read them).
          const rest=el('ul','pending-steps-rest');for(const step of steps.slice(1))rest.append(el('li',`pending-step tone-${step.tone}`,step.text));
          const more=el('button','pending-more-steps',t('+{count} more',{count:steps.length-1}));more.type='button';more.title=steps.slice(1).map(step=>'• '+step.text).join('\n');
          more.onclick=()=>{const open=todo.classList.toggle('pending-steps-open');more.textContent=open?t('Show less'):t('+{count} more',{count:steps.length-1});more.setAttribute('aria-expanded',String(open));};
          more.setAttribute('aria-expanded','false');todo.append(rest,more);}}
        else todo.append(el('span','pending-step tone-ok',t('Nothing to do')));
        const tagCell=el('td','pending-tag-cell');
        if(p?.latestTag){tagCell.append(tagBadge(item));tagCell.append(el('small','',[whenOf(p.latestTagDate),Number(p.commitsSinceTag)>0?t('+{count} since',{count:p.commitsSinceTag}):''].filter(Boolean).join(' · ')));}
        else tagCell.append(el('span','pending-zero',p?t('no tag'):'·'));
        const lastCell=el('td','pending-last-cell');
        if(p?.lastCommitDate){lastCell.append(el('span','',dayOf(p.lastCommitDate)),el('small','',ageOf(p.lastCommitDate)));if(p.lastCommitSubject)lastCell.append(el('small','pending-last-subject',p.lastCommitSubject));lastCell.title=p.lastCommitSubject||'';}
        else lastCell.append(el('span','pending-zero','·'));
        const tr=el('tr');tr.append(name,branch,tagCell,lastCell,todo,
          numberCell(c.changes,{tone:'warn',title:t('{count} uncommitted file(s)',{count:c.changes})}),
          numberCell(c.push,{tone:'warn',title:t('{count} to push',{count:c.push})}),
          numberCell(c.pull,{tone:'info',title:t('{count} to pull',{count:c.pull})}),
          numberCell(c.stashes,{tone:'info',detail:c.stashes?key+'|stashes':'',title:t('Show stashes')}),
          numberCell(c.localOnly,{tone:'warn',detail:c.localOnly?key+'|localOnly':'',title:t('{count} branches, {commits} commits on no remote',{count:c.localOnly,commits:c.localOnlyCommits})}),
          numberCell(c.merged,{tone:'muted',detail:c.merged?key+'|merged':'',title:t('Show merged branches')}));
        grid.append(tr);
        for(const kind of ['localOnly','merged','stashes'])if(expanded.has(key+'|'+kind))grid.append(detailRow(item,kind));
      }
      out.append(grid);sizeColumns(grid);
      if(rows.length>300)out.append(el('p','multi-repo-note',t('Showing the first 300. Narrow the folder or filter.')));
    };
    const summary=()=>{
      const pending=results.filter(item=>pendingMatches(item,'any')).length;
      const time=checkedAt?checkedAt.toLocaleString([],{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      status.textContent=t('{pending} of {total} repositories have something pending',{pending,total:results.length})+(time?' · '+t('checked at {time}',{time}):'');
    };
    let timer=0;const schedule=()=>{if(timer)return;timer=setTimeout(()=>{timer=0;drawChips();draw();},250);};
    const start=async()=>{
      const id=++runId;const repos=reposIn(folder.value);results=[];expanded.clear();let done=0;drawChips();draw();
      status.textContent=t('Checking {done} of {total}…',{done:0,total:repos.length});
      await mapLimit(repos,4,async repo=>{if(id!==runId)return;const item=await check(repo);if(id!==runId)return;results.push(item);status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});schedule();});
      if(id!==runId)return;checkedAt=new Date();summary();drawChips();draw();
    };
    run.onclick=start;folder.addEventListener('change',start);sort.onchange=()=>{remember('gitdeck.pendingSort',sort.value);draw();};tagFilter.onchange=()=>{remember('gitdeck.pendingTag',tagFilter.value);drawChips();draw();};search.oninput=()=>{drawChips();draw();};
    const bulk=async(kind)=>{
      more.removeAttribute('open');
      const todo=results.filter(item=>kind==='push'?pendingActions(item.pending).includes('push'):(item.counts.pull&&!item.pending?.operation));
      if(!todo.length){showActionFeedback(kind==='push'?t('Nothing to push.'):t('Nothing to pull.'));return;}
      const title=kind==='push'?t('Push {count} repositories now?',{count:todo.length}):t('Pull {count} repositories now?',{count:todo.length});
      if(!confirm(title+'\n'+todo.map(item=>`${item.repo.name} (${item.pending.branch}, ${kind==='push'?item.counts.push:item.counts.pull})`).join('\n')))return;
      run.disabled=true;let failed=0;
      for(const item of todo){
        status.textContent=(kind==='push'?t('Pushing {name}…',{name:item.repo.name}):t('Pulling {name}…',{name:item.repo.name}));let problem='';
        try{await runQuiet(kind,item.repo,kind==='pull'?{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}:{});}catch(error){failed++;problem=String(error.message||'');}
        Object.assign(item,await check(item.repo));item.actionError=problem?{kind,reason:explainError(problem),raw:problem}:null;drawChips();draw();
      }
      summary();if(failed)status.textContent+=' · '+t('{count} failed',{count:failed});run.disabled=false;
    };
    pushAll.onclick=()=>bulk('push');pullAll.onclick=()=>bulk('pull');
    // Local merged branches only: git refuses (-d) anything not merged, and remotes stay as they are.
    pruneMerged.onclick=async()=>{
      more.removeAttribute('open');
      const todo=results.filter(item=>item.counts.merged);const total=todo.reduce((n,item)=>n+item.counts.merged,0);
      if(!total){showActionFeedback(t('No merged branches to delete.'));return;}
      const list=todo.map(item=>`${item.repo.name}: ${item.pending.mergedBranches.slice(0,5).join(', ')}${item.counts.merged>5?' …':''}`).join('\n');
      if(!confirm(t('Delete {count} merged branch(es) in {repos} repositories on this computer?',{count:total,repos:todo.length})+'\n'+t('Remote branches are not touched. Git keeps any branch that is not fully merged.')+'\n\n'+list))return;
      run.disabled=true;let deleted=0,failed=0;
      for(const item of todo){
        status.textContent=t('Cleaning {name}…',{name:item.repo.name});
        for(const branch of item.pending.mergedBranches){try{await runQuiet('branch-delete',item.repo,{branch,force:false});deleted++;}catch{failed++;}}
        Object.assign(item,await check(item.repo));drawChips();draw();
      }
      summary();status.textContent+=' · '+t('Deleted {count} branch(es)',{count:deleted})+(failed?' · '+t('{count} failed',{count:failed}):'');run.disabled=false;
    };
    copy.onclick=async()=>{
      more.removeAttribute('open');
      const lines=['| '+[t('Repository'),t('Branch'),t('Latest tag'),t('Last commit'),t('Uncommitted'),t('To push'),t('To pull'),t('Stashes'),t('Unpushed branches'),t('Merged branches')].join(' | ')+' |','|---|---|---|---|---|---|---|---|---|---|'];
      for(const item of visible()){const c=item.counts;const p=item.pending||{};lines.push(`| ${item.repo.name} | ${p.branch||''} | ${p.latestTag?`${p.latestTag} ${dayOf(p.latestTagDate)}${Number(p.commitsSinceTag)?` (+${p.commitsSinceTag})`:''}`:''} | ${dayOf(p.lastCommitDate)} | ${c.changes} | ${c.push} | ${c.pull} | ${c.stashes} | ${c.localOnly} | ${c.merged} |`);}
      try{await navigator.clipboard.writeText(lines.join('\n')+'\n');showActionFeedback(t('Copied {count} rows',{count:lines.length-2}));}catch(error){showActionFeedback(error.message,{error:true});}
    };
    syncView();start();
  }

  // Fetch or pull every repository in a folder.
  function buildUpdate(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const fetch=el('button','',t('Fetch all'));fetch.type='button';
    const pull=el('button','primary',t('Pull all'));pull.type='button';pull.title=t('Pull the current branch of each repository; uncommitted changes are stashed and restored');
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    const explain=el('div','multi-repo-explain');
    explain.append(el('p','',t('Fetch only asks the remote what is new. It changes none of your files: safe any time.')),
      el('p','',t('Pull brings the new commits into the branch you are on. Uncommitted changes are put aside and put back. Uses your pull setting ({strategy}).',{strategy:state.meta?.pullStrategy||'ff-only'})));
    bar.append(folder,fetch,pull);panel.append(bar,explain,status,out);
    const go=async(mode)=>{
      const repos=reposIn(folder.value).filter(repo=>repo.remote!==''&&repo.remote!==null);
      if(!repos.length){status.textContent=t('No repositories with a remote in this folder.');return;}
      if(mode==='pull'&&!confirm(t('Pull {count} repositories now?',{count:repos.length})))return;
      fetch.disabled=pull.disabled=true;out.replaceChildren();const grid=table([t('Repository'),t('Result'),'']);out.append(grid);let done=0;
      const rows=new Map(repos.map(repo=>{const cell=el('span','multi-repo-result',t('Waiting…'));const tools=el('span');const tr=row([repoLink(repo),cell,tools]);grid.append(tr);return [repo.path,{cell,tools,tr}];}));
      const outcome=await mapLimit(repos,mode==='pull'?2:4,async repo=>{
        const {cell,tools,tr}=rows.get(repo.path);cell.textContent=t('Working…');
        try{
          const result=mode==='pull'?await runQuiet('pull',repo,{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}):await runQuiet('fetch',repo);
          const text=firstLine(result?.message||result?.output)||t('Done');
          const conflict=/conflict/i.test(text)||(result?.conflicts||[]).length;
          const same=/up to date|already/i.test(text);
          cell.textContent=conflict?t('Conflicts: open the repository to resolve them'):same?t('Already up to date'):text;
          cell.className='multi-repo-result '+(conflict?'tone-bad':same?'tone-muted':'tone-ok');
          if(conflict){const open=el('button','',t('Open'));open.type='button';open.onclick=()=>{document.getElementById('operations-close')?.click();openWorkspace(repo,'conflicts',null);};tools.append(open);}
          tr.dataset.outcome=conflict?'problem':same?'same':'updated';return conflict?'problem':same?'same':'updated';
        }catch(error){
          cell.textContent=explainError(error.message);cell.title=String(error.message||'');cell.className='multi-repo-result tone-bad';
          const open=el('button','',t('Open'));open.type='button';open.onclick=()=>{document.getElementById('operations-close')?.click();openWorkspace(repo,'history',null);};tools.append(open);
          tr.dataset.outcome='problem';return 'problem';
        }
        finally{status.textContent=t('{done} of {total} done',{done:++done,total:repos.length});}
      });
      const count=(kind)=>outcome.filter(x=>x===kind).length;
      status.textContent=mode==='fetch'
        ?t('{done} fetched · {problems} need attention. Pending work shows what to pull.',{done:count('updated')+count('same'),problems:count('problem')})
        :t('{updated} updated · {same} already up to date · {problems} need attention',{updated:count('updated'),same:count('same'),problems:count('problem')});
      // Problems first, so they are not lost in a long list.
      [...grid.querySelectorAll('tr[data-outcome="problem"]')].reverse().forEach(tr=>grid.querySelector('tr').after(tr));
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
    const explain=el('div','multi-repo-explain');
    explain.append(el('p','',t('For work that touches several repositories (one ticket, several services): put them all on the same branch.')),
      el('p','',t('1. Type the branch name.  2. Press Preview to see what will happen in each repository.  3. Press Switch.')));
    bar.append(folder,name,mode,createLabel,preview,run);panel.append(bar,explain,status,out);
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
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    const explain=el('div','multi-repo-explain');
    explain.append(el('p','',t('Find which repositories have a ticket or a change. Examples: AP2365-3319, timeout, feature/login.')),
      el('p','',t('Click a result to open that repository at the commit.')));
    panel.append(form,explain,status,out);
    form.onsubmit=async(event)=>{
      event.preventDefault();const q=text.value.trim();if(!q)return;
      run.disabled=true;out.replaceChildren();const repos=reposIn(folder.value);let done=0;
      const list=(value)=>Array.isArray(value)?value:value?[value]:[];
      const results=await mapLimit(repos,4,async repo=>{let answer={commits:[],branches:[]};try{const raw=await api('/api/repo/search?'+query({path:repo.path,q,mode:mode.value}));answer={commits:list(raw.commits),branches:list(raw.branches)};}catch(error){answer.error=explainError(error.message);}status.textContent=t('Searched {done} of {total}',{done:++done,total:repos.length});return {repo,...answer};});
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

  // ---- Dashboard as a page -----------------------------------------------------------------------
  // The Dashboard is a page, not a window over the screen: it takes the work area (right of the
  // left rail, under the toolbar), so the toolbar and rail stay. Back, any rail view or opening a
  // repository leaves it. Without a work area (no repository open yet) it stays a full window.
  function setUpDashboardPage(modal,closeButton,backdrop){
    backdrop.classList.add('dashboard-as-page');
    closeButton.textContent='← '+t('Back');closeButton.classList.add('dashboard-back');
    closeButton.title=t('Back to the repository');closeButton.setAttribute('aria-label',closeButton.title);
    // A page header: Back first, then the title on one line.
    const head=modal.querySelector('.operations-head');if(head)head.prepend(closeButton);
    // / jumps to the name filter of the open view.
    document.addEventListener('keydown',(event)=>{
      if(event.key!=='/'||!document.body.classList.contains('dashboard-page-open')||event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      const box=modal.querySelector('.operations-view:not(.hidden) input');if(box){event.preventDefault();box.focus();box.select?.();}
    });
    const host=()=>{const body=document.querySelector('.workbench-body');return body&&body.getClientRects().length?body:null;};
    const place=()=>{
      const open=!backdrop.classList.contains('hidden');const body=open?host():null;
      if(body){
        if(modal.parentElement!==body)body.append(modal);
        const rail=body.querySelector(':scope > .modern-rail');modal.style.left=rail&&rail.getClientRects().length?rail.offsetWidth+'px':'0px';
      }else if(modal.parentElement!==backdrop){modal.style.left='';backdrop.append(modal);}
      document.body.classList.toggle('dashboard-page-open',Boolean(body));
      window.dispatchEvent(new Event('gitdeck:dashboard'));
    };
    if(typeof MutationObserver==='function')new MutationObserver(place).observe(backdrop,{attributes:true,attributeFilter:['class']});
    window.addEventListener('resize',()=>{if(document.body.classList.contains('dashboard-page-open'))place();});
    const leave=()=>{if(!backdrop.classList.contains('hidden')&&typeof hideOperationsCenter==='function')hideOperationsCenter();};
    // Opening another repository or another view leaves the page; a refresh of the same view does not.
    if(typeof openWorkspace==='function'){
      const baseOpen=openWorkspace;
      openWorkspace=function(repo,tab='history',...rest){
        const same=state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo)&&state.workspaceTab===tab;
        if(!same)leave();return baseOpen(repo,tab,...rest);
      };
    }
    if(typeof selectWorkspaceTab==='function'){
      const baseSelect=selectWorkspaceTab;
      selectWorkspaceTab=function(tab,...rest){if(rest[0]!==false)leave();return baseSelect(tab,...rest);};
    }
  }

  // ---- entry points ----------------------------------------------------------------------------
  if(typeof document!=='undefined'&&document.querySelector('.operations-tabs')){
    addPanel('pending',t('Pending work'),buildPending);
    addPanel('update-all',t('Update all'),buildUpdate);
    addPanel('switch-all',t('Switch branch'),buildSwitch);
    addPanel('search-all',t('Search all'),buildSearch);
    // The everyday views come first, and the window is called what the toolbar button says: Dashboard.
    const nav=document.querySelector('.operations-tabs');
    if(nav){for(const id of ['search-all','switch-all','update-all','pending']){const tab=nav.querySelector(`[data-operations-view="${id}"]`);if(tab)nav.prepend(tab);}}
    const modal=document.querySelector('.operations-modal');const closeButton=document.getElementById('operations-close');
    const backdrop=document.getElementById('operations-backdrop');
    if(modal&&closeButton&&backdrop&&!backdrop.classList.contains('dashboard-as-page'))setUpDashboardPage(modal,closeButton,backdrop);
    // The health view is one of the Dashboard's tabs, so it is not called a dashboard itself.
    const fleetTab=nav?.querySelector('[data-operations-view="fleet"]');if(fleetTab)fleetTab.textContent=t('Repository health');
    const heading=document.getElementById('operations-title');
    if(heading){heading.textContent=t('Dashboard');const eyebrow=heading.parentElement?.querySelector('.eyebrow');if(eyebrow)eyebrow.textContent=t('ALL REPOSITORIES');const line=heading.nextElementSibling;if(line?.tagName==='P')line.textContent=t('What is pending everywhere, update or switch many repositories at once, search them all. Background jobs and automation are here too.');}
    const openView=(view)=>{if(typeof showOperationsCenter==='function')showOperationsCenter(view);};
    // Always-visible way in: a Dashboard button in the top toolbar, next to View & tools.
    const head=document.querySelector('.workspace-modal-head');
    if(head&&!head.querySelector('#dashboard-button')){
      const dash=el('button','toolbar-dashboard');dash.id='dashboard-button';dash.type='button';dash.title=t('Pending work, update, switch branch and search in every repository');
      dash.append(el('span','',t('Dashboard')));
      // icons.js loads after this file, so the icon may only be ready at load.
      const addIcon=()=>{if(window.GitDeckIcons?.svg&&!dash.querySelector('svg'))dash.prepend(window.GitDeckIcons.svg('repos',18));};
      if(window.GitDeckIcons)addIcon();else window.addEventListener('load',addIcon,{once:true});dash.onclick=()=>openView('pending');
      const secondary=head.querySelector('.workbench-secondary');if(secondary)secondary.before(dash);else head.append(dash);
    }
    const more=document.querySelector('.sync-more > div');
    if(more&&!more.querySelector('[data-multi-repo]')){
      const entries=[['pending',t('📋 Pending work'),t('What is still uncommitted, unpushed or stashed in every repository')],['switch-all',t('🔀 Switch branch everywhere'),t('Put every repository of a ticket on the same branch')],['search-all',t('🔎 Search all repositories'),t('Find a ticket, message or branch in every repository')]];
      for(const [view,label,hint] of entries){const button=el('button','');button.type='button';button.dataset.multiRepo=view;button.append(el('strong','',label),el('small','',hint));button.onclick=()=>{more.parentElement?.removeAttribute('open');openView(view);};more.append(button);}
      const clean=el('button','');clean.type='button';clean.dataset.multiRepo='cleanup';clean.append(el('strong','',t('🧹 Clean up branches')),el('small','',t('Delete merged, gone or old branches of this repository')));clean.onclick=()=>{more.parentElement?.removeAttribute('open');openBranchCleanup();};more.append(clean);
    }
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
  window.GitDeckMultiRepo={dayOf,whenOf,pendingLabels,pendingActions,pendingCounts,pendingMatches,nextSteps,explainError,parseTerms,termRank,tagMatches,ageOf,switchPlan,cleanupReasons,ticketPrefix,gitlabNews,openBranchCleanup,checkGitLab};
})();
