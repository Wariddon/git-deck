// Push rejected because the remote has newer commits (like Sourcetree): instead of a dead end,
// offer one click that merges the remote branch into yours and pushes again. When the merge
// conflicts, the Conflicts page opens so the merge can be finished there.
(function(){
  if(typeof runWorkspaceAction!=='function')return;
  const behindRejection=message=>/non-fast-forward|fetch first|updates were rejected because the (remote contains work|tip of your current branch is behind)/i.test(String(message||''));
  // "! [rejected]   main -> main (fetch first)" -> local branch names that were rejected.
  const rejectedBranches=message=>[...String(message||'').matchAll(/\[rejected\]\s+(\S+)\s+->\s+(\S+)/g)].map(match=>match[1]);
  const strategy=()=>state.meta?.pullStrategy==='rebase'?'rebase':'merge';

  // Where to pull from so the push can go through; null when merging the current branch would not help.
  function pullSource(action,payload,message){
    const branch=state.workspace?.branch;if(!branch)return null;
    const rejected=rejectedBranches(message);
    if(rejected.length&&rejected.some(name=>name!==branch))return null;
    if(action==='push-selection'){
      const item=(payload.branches||[]).find(entry=>entry.local===branch);
      return item?{action:'pull-ref',payload:{remote:payload.remote,branch:item.remote||item.target||branch}}:null;
    }
    const upstream=state.workspace?.sync?.upstream;
    if(upstream)return {action:'pull',payload:{}};
    return {action:'pull-ref',payload:{remote:'origin',branch}};
  }

  async function mergeThenPush(action,payload,source){
    const repo=state.workspaceRepo;if(!repo||state.busy)return null;
    if(typeof hidePushDialog==='function')hidePushDialog();
    const current=()=>state.workspaceRepo&&state.workspaceRepo.path===repo.path;
    let failure=null;
    const pulled=await runWorkspaceAction(source.action,{...source.payload,strategy:strategy(),autostash:true},'',{onError:error=>{failure=error;}});
    if(!current())return null;
    if(!pulled){
      // The merge stopped on conflicts: go straight to where they are resolved.
      // app.js could not reload while it was still busy, so read the repository state again now.
      if(failure){try{await loadWorkspace();}catch{}}
      if(failure&&current()&&(state.workspace?.operation?.active||/conflict/i.test(failure.message))){
        pending={path:repo.path,branch:state.workspace?.branch,action,payload};
        selectWorkspaceTab('conflicts');
        showActionFeedback(t('The remote changes conflict with yours. Resolve each file and commit the merge; Git Deck then offers to push.'),{error:true,context:t('{repo} · merge',{repo:repo.name})});
      }
      return null;
    }
    // The merge itself is done even when restoring uncommitted work clashed (File Status shows that), so push.
    return pushAgain(action,payload);
  }

  // After conflicts: once the merge is committed, offer the push that was waiting (like Sourcetree's Push button lighting up).
  let pending=null;
  function askPush(){
    const waiting=pending;pending=null;
    const ui=releaseDialog(t('Merge finished'));ui.dialog.classList.add('push-merge-dialog');
    ui.body.append(el('p','',t('The merge is committed. Push {branch} now so the remote gets your work?',{branch:waiting.branch||''})));
    const go=el('button','primary',t('Push now'));go.type='button';
    go.onclick=()=>{ui.dialog.close();pushAgain(waiting.action,waiting.payload);};
    ui.actions.querySelector('button').textContent=t('Later');ui.actions.append(go);go.focus();
  }
  function afterOperation(action,result){
    if(!pending||!result||state.workspaceRepo?.path!==pending.path)return;
    if(action==='operation-abort'){pending=null;return;}
    if(['operation-continue','commit'].includes(action)&&!state.workspace?.operation?.active&&state.workspace?.branch===pending.branch)askPush();
  }

  let retrying=false;
  async function pushAgain(action,payload){retrying=true;try{return await runWorkspaceAction(action,payload,'');}finally{retrying=false;}}

  function offer(action,payload,source,cancel){
    const branch=state.workspace?.branch||'';const from=source.action==='pull'?state.workspace?.sync?.upstream:`${source.payload.remote}/${source.payload.branch}`;
    const ui=releaseDialog(t('Remote has newer commits'));ui.dialog.classList.add('push-merge-dialog');
    ui.body.append(
      el('p','',t('Someone pushed to {remote} after your last pull, so Git will not overwrite it.',{remote:from||t('the remote')})),
      el('p','',t('Git Deck can merge those commits into {branch} and push again. If both sides changed the same lines, the Conflicts page opens so you can choose what to keep.',{branch})));
    const go=el('button','primary',t('Merge and push'));go.type='button';
    let chosen=false;go.onclick=()=>{chosen=true;ui.dialog.close();mergeThenPush(action,payload,source);};
    ui.dialog.addEventListener('close',()=>{if(!chosen)cancel();},{once:true});
    ui.actions.querySelector('button').textContent=t('Cancel');ui.actions.append(go);go.focus();
  }

  // Pull with fast-forward only, but both sides have commits: ask how to combine them instead of failing.
  function choosePull(payload,confirmation,options){
    const sync=state.workspace?.sync||{};
    return new Promise(resolve=>{
      const ui=releaseDialog(t('Both sides have new commits'));ui.dialog.classList.add('push-merge-dialog');
      ui.body.append(
        el('p','',t('You have {ahead} commit(s) that {remote} does not, and it has {behind} that you do not.',{ahead:sync.ahead,behind:sync.behind,remote:sync.upstream||t('the remote')})),
        el('p','',t('A fast-forward pull cannot combine them. Merge keeps both histories (like Sourcetree); rebase replays your commits on top.')));
      let chosen=null;
      const pick=(label,strategy,primary)=>{const button=el('button',primary?'primary':'',label);button.type='button';button.onclick=()=>{chosen=strategy;ui.dialog.close();};ui.actions.append(button);return button;};
      ui.actions.querySelector('button').textContent=t('Cancel');
      pick(t('Pull with rebase'),'rebase',false);const merge=pick(t('Pull with merge'),'merge',true);merge.focus();
      ui.dialog.addEventListener('close',()=>resolve(chosen?baseRun('pull',{...payload,strategy:chosen},'',options):null),{once:true});
    });
  }

  const baseRun=runWorkspaceAction;
  runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
    const sync=state.workspace?.sync;
    if(action==='pull'&&(payload.strategy||'ff-only')==='ff-only'&&sync?.ahead>0&&sync?.behind>0&&!state.busy)return choosePull(payload,confirmation,options);
    if(['operation-continue','operation-abort','commit'].includes(action)){const result=await baseRun(action,payload,confirmation,options);afterOperation(action,result);return result;}
    if(!['push','push-selection'].includes(action)||payload.forceWithLease||retrying)return baseRun(action,payload,confirmation,options);
    let failure=null;
    const result=await baseRun(action,payload,confirmation,{...options,onError:error=>{failure=error;}});
    if(result||!failure)return result;
    const source=behindRejection(failure.message)?pullSource(action,payload,failure.message):null;
    const reportFailure=()=>{if(typeof options.onError==='function')options.onError(failure);};
    // The offer replaces the error card, so the same advice does not appear twice.
    if(source){document.getElementById('action-error-feedback')?.remove();offer(action,payload,source,reportFailure);return null;}
    reportFailure();
    return null;
  };

  window.GitDeckPushMerge={behindRejection,rejectedBranches,pullSource,mergeThenPush};
})();
