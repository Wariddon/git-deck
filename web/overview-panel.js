'use strict';
// Overview panel: "what should I do next" for the open repository, built from
// the workspace snapshot. Each step opens the view or starts the action it names.
function overviewSteps(data){
  const steps=[];const sync=data?.sync||{};const files=data?.files||[];const operation=data?.operation||{};
  const conflicts=operation.conflicts||[];
  if(conflicts.length)steps.push({id:'conflicts',tone:'bad',label:t(conflicts.length===1?'Resolve 1 conflict':'Resolve {count} conflicts',{count:conflicts.length}),detail:operation.type?t('{operation} in progress',{operation:operation.type}):t('Files have unresolved conflicts'),tab:'conflicts'});
  else if(operation.active)steps.push({id:'finish',tone:'warn',label:t('Finish the {operation}',{operation:operation.type}),detail:t('Conflicts are resolved. Continue or abort it.'),tab:'conflicts'});
  const changed=new Set(files.map(file=>file.path)).size;const staged=new Set(files.filter(file=>file.staged).map(file=>file.path)).size;
  if(changed)steps.push({id:'changes',tone:'info',label:staged?t(staged===1?'Commit 1 staged file':'Commit {count} staged files',{count:staged}):t(changed===1?'Review 1 changed file':'Review {count} changed files',{count:changed}),detail:t('{changed} changed · {staged} staged',{changed,staged}),tab:'changes'});
  if(sync.behind>0)steps.push({id:'pull',tone:'info',label:t(sync.behind===1?'Pull 1 commit':'Pull {count} commits',{count:sync.behind}),detail:t('from {ref}',{ref:sync.upstream}),action:'pull'});
  if(data?.branch&&!sync.upstream&&data.remotes?.length)steps.push({id:'publish',tone:'info',label:t('Publish this branch'),detail:t('No upstream yet. Push it to {remote}.',{remote:data.remotes[0].name}),action:'push'});
  else if(sync.ahead>0)steps.push({id:'push',tone:'info',label:t(sync.ahead===1?'Push 1 commit':'Push {count} commits',{count:sync.ahead}),detail:t('to {ref}',{ref:sync.upstream}),action:'push'});
  const stashes=data?.stashes||[];
  if(stashes.length)steps.push({id:'stashes',tone:'muted',label:t(stashes.length===1?'1 stash saved':'{count} stashes saved',{count:stashes.length}),detail:stashes[0].message||stashes[0].ref,tab:'stashes'});
  if(!steps.length)steps.push({id:'clean',tone:'ok',label:t('All clear'),detail:t('No changes and nothing to pull or push')});
  return steps;
}
function runOverviewStep(step){
  if(step.tab){selectWorkspaceTab(step.tab);return;}
  if(step.action==='pull')runWorkspaceAction('pull',{strategy:state.meta.pullStrategy},syncConfirmation('pull'));
  else if(step.action==='push')showPushDialog();
}
function renderOverviewSteps(data){
  const box=el('section','overview-steps');box.setAttribute('aria-label',t('Next steps'));
  box.append(el('small','overview-steps-title',t('Next steps')));
  for(const step of overviewSteps(data)){
    const actionable=Boolean(step.tab||step.action);
    const item=el(actionable?'button':'div',`overview-step tone-${step.tone}`);item.dataset.step=step.id;
    if(actionable){item.type='button';item.addEventListener('click',()=>runOverviewStep(step));}
    item.append(el('strong','',step.label));if(step.detail)item.append(el('small','',step.detail));
    box.append(item);
  }
  return box;
}
if(typeof module!=='undefined')module.exports={overviewSteps};
