'use strict';
// Git-flow, like Sourcetree's Git-flow button, without needing the git-flow extension: plain branch,
// switch, merge and tag steps on main (or master) + develop, with feature/, release/ and hotfix/ prefixes.
// The dialog suggests what fits the current branch, shows every step first, and stops at the first error.
(function(){
  if(typeof api!=='function'||typeof releaseDialog!=='function')return;
  const prefixes={feature:'feature/',release:'release/',hotfix:'hotfix/'};
  const names=(data)=>(data?.branches||[]).map(branch=>branch.name);
  const production=(data)=>names(data).includes('main')?'main':names(data).includes('master')?'master':null;
  const kindOf=(branch)=>Object.keys(prefixes).find(kind=>String(branch||'').startsWith(prefixes[kind]))||null;

  // Each step is one Git Deck action, sent directly so the steps run without a dialog each.
  async function runSteps(title,steps){
    const repo=state.workspaceRepo;if(!repo||state.busy)return false;
    const done=[];setBusy(true);showLoading(title,repo.name);
    try{
      for(const item of steps){
        setOutput(done.concat(item.label+'…').join('\n'));
        let result=await api('/api/action',{method:'POST',body:JSON.stringify({action:item.action,path:repo.path,...item.payload})});
        if(typeof resolveActionResult==='function')result=await resolveActionResult(result);
        done.push('✓ '+item.label);
      }
      setOutput(done.join('\n'),{collapse:true});showActionFeedback(t('{title}: done',{title}));return true;
    }catch(error){
      setOutput(done.concat('✗ '+error.message).join('\n'),{expand:true,status:'error'});
      showActionFeedback(error.message,{error:true,context:`${repo.name} · Git-flow`});return false;
    }finally{
      setBusy(false);hideLoading();
      try{if(typeof refresh==='function')await refresh();}catch{}
      try{if(typeof loadWorkspace==='function')await loadWorkspace();}catch{}
    }
  }

  // Plans: what each Git-flow command does, as steps.
  function planStart(kind,name,data){
    const branch=prefixes[kind]+name;const base=kind==='hotfix'?production(data):'develop';
    return {title:t('Start {branch}',{branch}),steps:[
      {label:t('Create {branch} from {base}',{branch,base}),action:'branch-create-at',payload:{branch,commit:base}},
      {label:t('Switch to {branch}',{branch}),action:'branch-switch',payload:{branch}},
    ]};
  }
  function planFinish(branch,data,{deleteBranch=true}={}){
    const kind=kindOf(branch);const main=production(data);const version=branch.slice(prefixes[kind].length);const steps=[];
    const switchTo=(target)=>steps.push({label:t('Switch to {branch}',{branch:target}),action:'branch-switch',payload:{branch:target}});
    const mergeInto=(target)=>steps.push({label:t('Merge {branch} into {target}',{branch,target}),action:'merge',payload:{branch,mode:'no-ff'}});
    if(kind==='feature'){switchTo('develop');mergeInto('develop');}
    else{
      switchTo(main);mergeInto(main);
      steps.push({label:t('Tag {tag}',{tag:version}),action:'tag-create',payload:{tag:version,message:t('{kind} {version}',{kind:kind==='release'?'Release':'Hotfix',version})}});
      switchTo('develop');mergeInto('develop');
    }
    if(deleteBranch)steps.push({label:t('Delete {branch}',{branch}),action:'branch-delete',payload:{branch}});
    return {title:t('Finish {branch}',{branch}),steps};
  }

  function openGitFlow(){
    const repo=state.workspaceRepo,data=state.workspace;if(!repo||!data)return;
    const ui=releaseDialog(t('Git-flow'));ui.dialog.classList.add('modern-action-dialog','git-flow-dialog');
    ui.actions.querySelector('button').textContent=t('Cancel');
    const main=production(data);const current=data.branch||'';const kind=kindOf(current);
    const dirty=(data.files||[]).length>0;
    const body=el('div','modern-dialog-form');ui.body.append(body);
    const stepsBox=el('ol','git-flow-steps');
    const show=(plan)=>{stepsBox.replaceChildren(...plan.steps.map(item=>el('li','',item.label)));};
    const go=(label,plan)=>{const button=el('button','primary',label);button.type='button';button.disabled=dirty;button.onclick=async()=>{ui.dialog.close();await runSteps(plan().title,plan().steps);};ui.actions.append(button);return button;};
    if(dirty)body.append(el('p','modern-dialog-note',t('Commit or stash your changes first: Git-flow switches branches.')));
    if(!main){body.append(el('p','',t('Git-flow needs a main or master branch.')));return;}
    if(!names(data).includes('develop')){
      body.append(el('p','',t('Git-flow keeps finished work on {main} and ongoing work on develop, with feature/, release/ and hotfix/ branches. This repository has no develop branch yet.',{main})));
      const plan=()=>({title:t('Initialize Git-flow'),steps:[{label:t('Create develop from {main}',{main}),action:'branch-create-at',payload:{branch:'develop',commit:main}},{label:t('Switch to {branch}',{branch:'develop'}),action:'branch-switch',payload:{branch:'develop'}}]});
      show(plan());body.append(el('strong','',t('Steps')),stepsBox);go(t('Initialize'),plan);return;
    }
    if(kind){
      const finish=document.createElement('input');finish.type='checkbox';finish.checked=true;
      const keep=el('label','modern-dialog-check');keep.append(finish,el('span','',t('Delete {branch} afterwards',{branch:current})));
      const plan=()=>planFinish(current,data,{deleteBranch:finish.checked});
      finish.onchange=()=>show(plan());
      body.append(el('p','',t('You are on {branch}. Finishing merges it back as Git-flow expects.',{branch:current})),keep,el('strong','',t('Steps')),stepsBox);show(plan());
      go(t('Finish {branch}',{branch:current}),plan);
      body.append(el('hr'));
    }
    // Start something new.
    const type=document.createElement('select');type.className='workflow-input';type.setAttribute('aria-label',t('Type'));
    [['feature',t('New feature')],['release',t('New release')],['hotfix',t('New hotfix')]].forEach(([value,label])=>type.append(new Option(label,value)));
    const name=el('input','workflow-input');name.placeholder=t('Name or version, e.g. login or 1.4.0');name.setAttribute('aria-label',t('Name or version'));
    const preview=el('p','custom-action-help');
    const update=()=>{const value=name.value.trim();preview.textContent=value?t('Creates {branch} from {base} and switches to it.',{branch:prefixes[type.value]+value,base:type.value==='hotfix'?main:'develop'}):'';start.disabled=dirty||!value||!/^[A-Za-z0-9._-]+$/.test(value);};
    const row=el('div','git-flow-start');row.append(type,name);body.append(el('strong','',t('Start')),row,preview);
    const start=el('button',kind?'':'primary',t('Start'));start.type='button';
    start.onclick=async()=>{const plan=planStart(type.value,name.value.trim(),data);ui.dialog.close();await runSteps(plan.title,plan.steps);};
    type.onchange=update;name.oninput=update;ui.actions.append(start);update();
    setTimeout(()=>name.focus(),0);
  }

  window.GitDeckGitFlow={openGitFlow,planStart,planFinish,kindOf,production};
})();
