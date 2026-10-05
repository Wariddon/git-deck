'use strict';
// Background fetch like Sourcetree ("check remotes for updates every 10 minutes"): on by default for the
// repositories open as tabs, once shortly after start, and a card with a Pull button when new commits
// arrive for the repository you are looking at. So "push rejected, merge first" stops being a surprise.
(function(){
  if(typeof runSmartFetch!=='function'||typeof scheduleAutoFetch!=='function')return;
  const marker='gitdeck.autoFetchDefault';
  const read=(key)=>{try{return localStorage.getItem(key);}catch{return null;}};
  const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};

  // Every 10 minutes unless the user already chose a schedule (including Off) in Operations.
  if(!read(marker)){
    write(marker,'1');
    if(!Number(state.meta.autoFetchMinutes)){state.meta.autoFetchMinutes=10;if(typeof saveMeta==='function')saveMeta();}
    scheduleAutoFetch();
  }
  const interval=document.getElementById('operations-fetch-interval');
  if(interval&&!interval.querySelector('option[value="10"]')){
    for(const minutes of [5,10]){const option=document.createElement('option');option.value=String(minutes);option.textContent=t('Every {count} minutes',{count:minutes});interval.querySelector('option[value="15"]')?.before(option);}
    interval.value=String(state.meta.autoFetchMinutes||0);
  }

  // Compare incoming counts before and after each background fetch.
  const behindOf=(repo)=>Number(repo?.behind)||0;
  function incomingCard(repo,count){
    document.getElementById('incoming-feedback')?.remove();
    const upstream=state.workspace?.sync?.upstream||t('the remote');
    const card=el('section','action-feedback feedback-success incoming-feedback');card.id='incoming-feedback';card.setAttribute('role','status');
    card.append(el('strong','',t('{count} new commit(s) on {upstream}',{count,upstream})),el('p','',t('Someone pushed to this branch. Pull now so your next push goes through.')));
    const actions=el('div','feedback-actions');
    const pull=el('button','primary',t('Pull'));pull.type='button';pull.onclick=()=>{card.remove();document.querySelector('.sync-actions [data-git-action="pull"]')?.click();};
    const later=el('button','',t('Later'));later.type='button';later.onclick=()=>card.remove();
    actions.append(pull,later);card.append(actions);
    let stack=document.getElementById('action-feedback-stack');
    if(!stack){stack=el('div','action-feedback-stack');stack.id='action-feedback-stack';document.body.append(stack);}
    stack.append(card);
  }
  const baseSmartFetch=runSmartFetch;
  runSmartFetch=async function(interactive=false){
    const before=new Map(state.repos.map(repo=>[repo.path,behindOf(repo)]));
    const result=await baseSmartFetch(interactive);
    if(!result)return result;
    const current=state.workspaceRepo&&state.repos.find(repo=>repo.path===state.workspaceRepo.path);
    if(current&&behindOf(current)>(before.get(current.path)||0)){
      // The toolbar's Pull count reads the workspace, so reload it, then say so.
      if(!state.busy&&typeof loadWorkspace==='function'){try{await loadWorkspace();}catch{}}
      if(!interactive)incomingCard(current,behindOf(current));
    }
    return result;
  };

  // One check shortly after opening, so the counts are fresh from the start.
  setTimeout(()=>{if(Number(state.meta.autoFetchMinutes)&&!state.busy&&!state.activeJob)void runSmartFetch(false);},20000);

  window.GitDeckAutoFetch={marker};
})();
