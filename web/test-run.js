'use strict';
// Run tests before pushing (server side: lib/GitDeck.TestRun.ps1). The command comes from the repository's
// build files (Maven, Gradle, Go, npm, Cargo, pytest, dotnet) and can be changed per repository. It runs in
// the background, so Git Deck stays usable; the result is remembered for the commit and shown in the Push
// dialog. It advises and never blocks a push. A pass counts only for the commit it ran on, with a clean
// working tree and at least one test.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // What a remembered run says about the commit at `head`.
  function verdict(record,head){
    if(!record||!head)return 'none';
    if(record.head!==head)return 'stale';
    if(!record.passed)return 'failed';
    if(record.noTests)return 'no-tests';
    if(record.dirty)return 'dirty';
    return 'passed';
  }
  // "1m 05s", "12s".
  function duration(ms){
    const total=Math.max(0,Math.round(Number(ms||0)/1000));const m=Math.floor(total/60),s=total%60;
    return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
  }
  // Keep the newest results only (one per repository).
  function remember(results,path,record,limit=200){
    const next={...results,[String(path).toLowerCase()]:record};
    const keys=Object.keys(next);if(keys.length<=limit)return next;
    keys.sort((a,b)=>Date.parse(next[a].at||0)-Date.parse(next[b].at||0));
    for(const key of keys.slice(0,keys.length-limit))delete next[key];
    return next;
  }
  const helpers={verdict,duration,remember};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function'||typeof api!=='function')return;

  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const keyOf=(path)=>String(path).toLowerCase();
  const recordFor=(path)=>readJson('gitdeck.testResults',{})[keyOf(path)]||null;
  const customFor=(path)=>readJson('gitdeck.testCommands',{})[keyOf(path)]||'';
  const running=new Map();// path -> {jobId, command, message}
  const words=(v,record)=>({
    none:t('Tests not run for this commit'),stale:t('Tests last ran on another commit'),failed:t('Tests failed on this commit'),
    'no-tests':t('The test command found no tests'),dirty:t('Tests passed, but with uncommitted changes'),passed:t('Tests passed on this commit'),
  })[v]+(record&&v!=='none'&&v!=='stale'?` · ${duration(record.durationMs)}`:'');
  const repoNow=()=>(typeof state!=='undefined'&&state.workspaceRepo)||null;
  const info=(path)=>api('/api/repo/test-info?path='+encodeURIComponent(path)).then(answer=>answer.test);

  // ---- run -----------------------------------------------------------------------------------------
  async function run(repo=repoNow()){
    if(!repo||running.has(keyOf(repo.path)))return;
    let started;
    try{started=await api('/api/action',{method:'POST',body:JSON.stringify({action:'repo-test',path:repo.path,command:customFor(repo.path)})});}
    catch(error){if(typeof showActionFeedback==='function')showActionFeedback(error.message,{error:true});return;}
    const entry={jobId:started.jobId,message:t('Running tests…')};running.set(keyOf(repo.path),entry);changed();
    let misses=0;
    while(running.get(keyOf(repo.path))===entry){
      await new Promise(resolve=>setTimeout(resolve,1500));
      let job;try{job=await api('/api/job?id='+encodeURIComponent(entry.jobId));misses=0;}catch{if(++misses>10)break;continue;}
      entry.message=job.message||entry.message;changed();
      if(!['completed','failed','cancelled'].includes(job.state))continue;
      running.delete(keyOf(repo.path));
      if(job.state==='completed'&&job.result){
        const record={...job.result,at:new Date().toISOString()};
        writeJson('gitdeck.testResults',remember(readJson('gitdeck.testResults',{}),repo.path,record));
        if(typeof showActionFeedback==='function')showActionFeedback(`${repo.name}: ${words(record.passed?(record.noTests?'no-tests':record.dirty?'dirty':'passed'):'failed',record)}`);
      }else if(job.state==='failed'&&typeof showActionFeedback==='function')showActionFeedback(job.message||t('The tests could not run.'),{error:true});
      changed();return;
    }
    running.delete(keyOf(repo.path));changed();
  }
  async function cancel(repo=repoNow()){
    const entry=repo&&running.get(keyOf(repo.path));if(!entry)return;
    try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'cancel-job',jobId:entry.jobId,id:entry.jobId})});}catch{}
    running.delete(keyOf(repo.path));changed();
  }

  // ---- the result ------------------------------------------------------------------------------------
  async function openDialog(repo=repoNow()){
    if(!repo||typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Tests: {repo}',{repo:repo.name}));ui.dialog.classList.add('gd-test-dialog');
    const body=el('div','gd-test-body');ui.body.append(body);
    const command=document.createElement('input');command.className='workflow-input';command.spellcheck=false;command.setAttribute('aria-label',t('Test command'));
    const go=el('button','primary',t('Run tests'));go.type='button';ui.actions.prepend(go);
    const paintGo=()=>{const isRunning=running.has(keyOf(repo.path));go.textContent=isRunning?t('Stop'):t('Run tests');go.disabled=!isRunning&&!command.value.trim();};
    command.addEventListener('input',paintGo);
    const draw=async()=>{
      let now=null;try{now=await info(repo.path);}catch(error){body.replaceChildren(el('p','',error.message));return;}
      if(!ui.dialog.open)return;
      const isRunning=running.has(keyOf(repo.path));const record=recordFor(repo.path);const v=verdict(record,now.head);
      if(!command.dataset.filled){command.dataset.filled='1';command.value=customFor(repo.path)||now.command||'';command.placeholder=t('For example: mvn test');}
      paintGo();
      const row=el('label','gd-test-command');row.append(el('small','',t('Command, run in the repository folder (remembered for this repository)')),command);
      const nodes=[row];
      if(isRunning)nodes.push(el('p','gd-test-verdict is-running',running.get(keyOf(repo.path)).message));
      else nodes.push(el('p',`gd-test-verdict is-${v}`,words(v,record)));
      if(record&&!isRunning){
        nodes.push(el('small','fleet-muted',`${String(record.head||'').slice(0,7)} · ${record.command||''} · ${new Date(record.at).toLocaleString()}`));
        if((record.failures||[]).length){const list=el('ul','gd-test-failures');for(const name of record.failures)list.append(el('li','',name));nodes.push(el('strong','',t('Failing tests: {count}',{count:record.failures.length})),list);}
        if(record.tail&&!record.passed)nodes.push(el('pre','gd-test-output',record.tail));
      }
      body.replaceChildren(...nodes);
    };
    go.onclick=async()=>{
      if(running.has(keyOf(repo.path))){await cancel(repo);void draw();return;}
      const value=command.value.trim();const detected=(await info(repo.path)).command||'';
      const saved=readJson('gitdeck.testCommands',{});if(value&&value!==detected)saved[keyOf(repo.path)]=value;else delete saved[keyOf(repo.path)];writeJson('gitdeck.testCommands',saved);
      void run(repo);void draw();
    };
    const refreshDialog=()=>{if(!ui.dialog.isConnected||!ui.dialog.open){listeners.delete(refreshDialog);return;}if(document.activeElement!==command)void draw();};
    listeners.add(refreshDialog);void draw();
  }

  // ---- status bar and Push dialog ----------------------------------------------------------------------
  const listeners=new Set();
  const chip=el('button','gd-test-chip');chip.type='button';chip.onclick=()=>void openDialog();
  let chipKey='',chipWorkspace=null;
  async function paintChip(force){
    const repo=repoNow();const bar=document.getElementById('workspace-statusbar');
    if(!repo||!bar){chip.hidden=true;return;}
    if(!chip.isConnected)document.getElementById('status-activity')?.before(chip);
    const entry=running.get(keyOf(repo.path));
    // A commit reloads the workspace: ask the server for HEAD only then, not on every tick.
    const key=[repo.path,entry?.message,recordFor(repo.path)?.at].join('|');
    if(!force&&key===chipKey&&chipWorkspace===state.workspace)return;chipKey=key;chipWorkspace=state.workspace;
    let now=null;if(!entry){try{now=await info(repo.path);}catch{chip.hidden=true;return;}}
    if(repoNow()!==repo)return;
    if(!entry&&!now.command&&!customFor(repo.path)){chip.hidden=true;return;}
    chip.hidden=false;const v=entry?'running':verdict(recordFor(repo.path),now.head);
    chip.dataset.verdict=v;chip.textContent=entry?t('Tests…'):{passed:t('Tests ✓'),failed:t('Tests ✗'),dirty:t('Tests ~'),'no-tests':t('Tests ?'),stale:t('Tests'),none:t('Tests')}[v];
    chip.title=entry?entry.message:words(v,recordFor(repo.path));
  }
  function pushRow(){
    const anchor=document.querySelector('#push-form .push-preview');const repo=repoNow();if(!anchor||!repo)return;
    let row=document.getElementById('push-tests');if(!row){row=el('section','push-tests');row.id='push-tests';anchor.before(row);}
    const entry=running.get(keyOf(repo.path));const current=state.workspace?.branch||'';
    const pushing=[...document.querySelectorAll('#push-branch-list .push-branch-row')].filter(item=>item.querySelector('.push-check')?.checked).map(item=>item.dataset.local);
    const draw=(now)=>{
      if(!row.isConnected||repoNow()!==repo)return;
      if(!entry&&!now?.command&&!customFor(repo.path)){row.hidden=true;return;}
      row.hidden=false;const v=entry?'running':verdict(recordFor(repo.path),now.head);
      const open=el('button','',entry?t('Show'):v==='passed'?t('Details'):t('Run tests'));open.type='button';
      open.onclick=()=>{if(entry||v==='passed')void openDialog(repo);else void run(repo);};
      const other=pushing.length&&!pushing.includes(current)?` · ${t('These results are for {branch}, not the branch you are pushing',{branch:current})}`:'';
      row.dataset.verdict=v;row.replaceChildren(el('span','',(entry?entry.message:words(v,recordFor(repo.path)))+other),open);
    };
    if(entry)draw(null);else info(repo.path).then(draw).catch(()=>{row.hidden=true;});
  }
  function changed(){void paintChip(true);if(document.getElementById('push-tests'))pushRow();for(const listener of [...listeners])listener();}
  if(typeof updatePushDialog==='function'){
    const base=updatePushDialog;
    updatePushDialog=function(...args){const result=base.apply(this,args);try{pushRow();}catch{}return result;};
  }
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;
    commandPaletteEntries=function(...args){
      const label=t('Run tests'),result=t('Test results'),group=t('Tools');
      return [...base.apply(this,args),{label,group,shortcut:'',run:()=>void run(),search:`${label} ${group} test mvn npm go`},{label:result,group,shortcut:'',run:()=>void openDialog(),search:`${result} ${group} test`}];
    };
  }
  setInterval(()=>{if(!document.hidden)void paintChip(false);},2500);
  window.GitDeckTestRun={...helpers,run,cancel,openDialog};
})();
