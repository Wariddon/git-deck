'use strict';
// Absorb (server side: lib/GitDeck.Absorb.ps1): a button beside the commit box puts staged fixes into
// the unpushed commits that last touched the same lines, after a preview of where each change goes.
// Changes it cannot place stay as working changes for a normal commit. Undo puts everything back.
(function(){
  if(typeof window==='undefined'||typeof renderChangesView!=='function'||typeof api!=='function')return;
  const baseChanges=renderChangesView;
  renderChangesView=function(content,data){
    const result=baseChanges(content,data);
    try{addButton(content,data);}catch(error){console.warn('Absorb unavailable',error);}
    return result;
  };
  function addButton(content,data){
    const bar=content.querySelector('.commit-assist');if(!bar||bar.querySelector('.absorb-button'))return;
    const staged=(data.files||[]).some(file=>file.staged);
    const ahead=Number(data.sync?.ahead)||0;const published=Boolean(data.sync?.upstream);
    const button=el('button','absorb-button',t('Absorb into commits'));button.type='button';
    button.title=t('Put the staged fixes into the unpushed commits that last changed the same lines');
    button.disabled=!staged||(published&&!ahead);
    button.onclick=()=>preview(state.workspaceRepo);
    bar.append(button);
  }
  async function preview(repo){
    if(!repo||typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Absorb staged changes'));ui.dialog.classList.add('absorb-dialog');ui.body.textContent=t('Finding the commit of each change…');
    let plan;
    try{plan=(await api('/api/repo/absorb-plan?'+new URLSearchParams({path:repo.path}))).plan;}
    catch(error){ui.body.textContent=error.message;return;}
    ui.body.replaceChildren();
    if(!plan.targets.length){ui.body.append(el('p','',plan.reason||t('No staged change belongs to a single unpushed commit.')));}
    else{
      ui.body.append(el('p','fleet-muted',t('Each change goes into the unpushed commit that last changed the same lines:')));
      const list=el('div','absorb-targets');
      for(const target of plan.targets){const item=el('div','absorb-target');item.append(el('code','',target.short),el('strong','',target.subject),el('small','fleet-muted',t('{count} change(s) in {files}',{count:target.hunks,files:target.files.join(', ')})));list.append(item);}
      ui.body.append(list);
    }
    if(plan.unassigned.length){
      const reasons={'new file':t('new file'),'deleted file':t('deleted file'),'binary file':t('binary file'),'lines from several commits':t('lines from several commits'),'lines from a pushed commit':t('lines from a pushed commit'),'no lines to compare':t('no lines to compare')};
      const left=el('details','absorb-left');left.append(el('summary','',t('{count} change(s) stay as working changes',{count:plan.unassigned.length})));
      for(const item of plan.unassigned)left.append(el('div','',`${item.file} · ${reasons[item.reason]||item.reason}`));
      ui.body.append(left);
    }
    if(plan.targets.length){
      ui.body.append(el('p','fleet-muted',t('The unpushed commits are rewritten; Undo puts them back. Pushed commits are never changed.')));
      const go=el('button','primary',t('Absorb'));go.type='button';
      go.onclick=async()=>{ui.dialog.close();await runWorkspaceAction('absorb',{fingerprint:plan.fingerprint});};
      ui.actions.prepend(go);
    }
  }
})();
