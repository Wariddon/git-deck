'use strict';
// Problems you cannot miss:
// 1. A failed action (merge, commit, push, …) opens a large red card at the top of the window that
//    stays until dismissed, says what happened in plain words (error-guide) and can be shown again.
// 2. A bar above every view says when the repository is stuck or about to trip you up: an unfinished
//    merge/rebase or conflicts, a detached HEAD, a branch that has diverged from its remote (push will
//    be rejected), or changes Git Deck put aside in a stash and you have not taken back yet.
(function(){
  if(typeof showActionFeedback!=='function'||typeof el!=='function')return;
  const gitDeckStash=/Saved by Git Deck|gitdeck: /i;

  // What is wrong with the open repository right now, most serious first.
  function repoAlerts(data){
    if(!data)return [];
    const alerts=[];const operation=data.operation||{};const conflicts=operation.conflicts||[];const sync=data.sync||{};
    if(operation.active){
      alerts.push(conflicts.length
        ?{id:'conflicts',tone:'bad',title:t('{operation} stopped: {count} file(s) conflict',{operation:operation.type||'merge',count:conflicts.length}),detail:t('Nothing else can be committed, pulled or pushed until you resolve them, or abort the {operation}.',{operation:operation.type||'merge'}),actions:['resolve','abort']}
        :{id:'operation',tone:'bad',title:t('A {operation} is waiting to be finished',{operation:operation.type||'merge'}),detail:t('Conflicts are resolved. Continue to finish it, or abort to go back.'),actions:['continue','abort']});
    }
    if(data.branch===''||data.branch==null&&data.head)alerts.push({id:'detached',tone:'warn',title:t('You are not on a branch (detached HEAD)'),detail:t('Commits made here belong to no branch and are easy to lose. Switch to a branch, or create one here.'),actions:['branches']});
    if(Number(sync.ahead)>0&&Number(sync.behind)>0)alerts.push({id:'diverged',tone:'warn',title:t('Your branch and {upstream} both have new commits',{upstream:sync.upstream||t('the remote')}),detail:t('Push will be rejected until you bring in the {count} remote commit(s). Pull first (merge or rebase), then push.',{count:sync.behind}),actions:['pull']});
    const parked=(data.stashes||[]).filter(stash=>gitDeckStash.test(String(stash.message||'')));
    if(parked.length)alerts.push({id:'parked',tone:'info',title:t('Git Deck put your changes aside ({count} stash)',{count:parked.length}),detail:t('"{message}". They are not in your files until you put them back.',{message:String(parked[0].message||'').replace(/^On [^:]+:\s*/,'')}),actions:['restore','stashes'],stash:parked[0].ref});
    return alerts;
  }

  // ---- 1. Failed actions: big, at the top, until dismissed -------------------------------------
  let lastError=null;
  const baseFeedback=showActionFeedback;
  showActionFeedback=function(message,options={}){
    const result=baseFeedback(message,options);
    if(options.error){
      lastError={message:String(message||''),context:String(options.context||''),repo:state.workspaceRepo?.path||'',at:new Date()};
      spotlight(document.getElementById('action-error-feedback'));renderAlerts();
    }
    return result;
  };
  function spotlight(card){
    if(!card)return;
    let holder=document.getElementById('error-spotlight');
    if(!holder){holder=el('div','error-spotlight');holder.id='error-spotlight';holder.setAttribute('aria-live','assertive');document.body.append(holder);}
    card.classList.add('feedback-spotlight');
    const head=card.querySelector(':scope > strong');if(head&&!head.querySelector('.feedback-icon'))head.prepend(el('span','feedback-icon','⛔'));
    holder.replaceChildren(card);
    card.classList.remove('feedback-shake');void card.offsetWidth;card.classList.add('feedback-shake');
    // The Dismiss button removes the card; the alert bar keeps a way back to it.
    card.querySelectorAll('.feedback-actions button').forEach(button=>{if([t('Dismiss'),'Dismiss'].includes(button.textContent.trim()))button.addEventListener('click',()=>setTimeout(renderAlerts,0));});
  }

  // ---- 2. The alert bar above every view --------------------------------------------------------
  function bar(){
    let node=document.getElementById('repo-alerts');
    const content=document.getElementById('workspace-content');if(!content)return null;
    if(!node){node=el('div','repo-alerts');node.id='repo-alerts';node.setAttribute('role','status');content.before(node);}
    return node;
  }
  function runAlertAction(kind,alert,button){
    if(kind==='resolve')return selectWorkspaceTab('conflicts');
    if(kind==='branches')return selectWorkspaceTab('branches');
    if(kind==='stashes')return selectWorkspaceTab('stashes');
    if(kind==='continue')return runWorkspaceAction('operation-continue',{},'');
    if(kind==='abort')return runWorkspaceAction('operation-abort',{},t('Abort the {operation}? Your branch goes back to how it was before it started.',{operation:state.workspace?.operation?.type||'merge'}));
    if(kind==='pull'){const pull=document.querySelector('.sync-actions [data-git-action="pull"]');if(pull)pull.click();else runWorkspaceAction('pull',{strategy:'merge',autostash:true},'');return;}
    if(kind==='restore')return runWorkspaceAction('stash-pop',{stash:alert.stash},t('Put the changes back into your files and remove the stash?'));
  }
  const labels={resolve:()=>t('Resolve conflicts'),abort:()=>t('Abort'),continue:()=>t('Continue'),branches:()=>t('Open Branches'),pull:()=>t('Pull now'),restore:()=>t('Put them back'),stashes:()=>t('Show stashes')};
  function renderAlerts(){
    const node=bar();if(!node)return;node.replaceChildren();
    const alerts=state.workspaceRepo?repoAlerts(state.workspace):[];
    for(const alert of alerts){
      const row=el('div',`repo-alert tone-${alert.tone}`);row.dataset.alert=alert.id;
      const text=el('div','repo-alert-text');text.append(el('strong','',alert.title),el('span','',alert.detail));
      const actions=el('div','repo-alert-actions');
      alert.actions.forEach((kind,index)=>{const button=el('button',index===0?'primary':'',labels[kind]());button.type='button';button.onclick=()=>runAlertAction(kind,alert,button);actions.append(button);});
      row.append(el('span','repo-alert-icon',alert.tone==='bad'?'⛔':alert.tone==='warn'?'⚠️':'📦'),text,actions);node.append(row);
    }
    // A dismissed error for this repository stays one click away.
    if(lastError&&lastError.repo===(state.workspaceRepo?.path||'')&&!document.getElementById('action-error-feedback')){
      const row=el('div','repo-alert tone-muted');row.dataset.alert='last-error';
      const text=el('div','repo-alert-text');text.append(el('strong','',t('Last error ({time})',{time:lastError.at.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})})),el('span','',lastError.message.split(/\r?\n/).find(line=>line.trim())||''));
      const actions=el('div','repo-alert-actions');
      const show=el('button','',t('Show again'));show.type='button';show.onclick=()=>showActionFeedback(lastError.message,{error:true,context:lastError.context});
      const forget=el('button','',t('Clear'));forget.type='button';forget.onclick=()=>{lastError=null;renderAlerts();};
      actions.append(show,forget);row.append(el('span','repo-alert-icon','🕘'),text,actions);node.append(row);
    }
    node.hidden=!node.children.length;
  }
  if(typeof renderWorkspace==='function'){const base=renderWorkspace;renderWorkspace=function(...args){const result=base.apply(this,args);try{renderAlerts();}catch{}return result;};}
  if(typeof selectWorkspaceTab==='function'){const base=selectWorkspaceTab;selectWorkspaceTab=function(...args){const result=base.apply(this,args);try{renderAlerts();}catch{}return result;};}
  window.GitDeckAlerts={repoAlerts,renderAlerts,get lastError(){return lastError;}};
})();
