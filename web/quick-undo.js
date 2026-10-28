'use strict';
// Quick undo: after a local action that moves a branch (commit, pull, merge, switch, reset,
// cherry-pick…) a small toast offers "Undo" for 10 seconds. It uses the same Undo timeline entry as
// Dashboard › Undo timeline (lib/GitDeck.Timeline.ps1), so nothing is lost: the newer commits stay
// reachable there. Pushes, tags and other remote changes are never offered here.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const undoable=new Set(['stack-restack','absorb','commit','pull','pull-ref','branch-create','branch-create-at','branch-switch','branch-track','checkout-commit','merge','rebase-start','rebase-interactive','operation-continue','reset-commit','cherry-pick','cherry-pick-many','revert-commit']);
  // The timeline entry this action just wrote: newest for the path, still undoable, recent.
  function undoCandidate(timeline,path,action,now=Date.now(),windowMs=60000){
    const key=String(path||'').toLowerCase();
    const item=(timeline||[]).find(entry=>String(entry.path||'').toLowerCase()===key);
    if(!item||item.status!=='latest'||item.action!==action)return null;
    const at=Date.parse(String(item.createdAt||'').replace(' ','T'));
    return Number.isFinite(at)&&Math.abs(now-at)<=windowMs?item:null;
  }
  const helpers={undoable,undoCandidate};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof api!=='function'||typeof el!=='function')return;

  let toast=null,timer=null;
  const close=()=>{clearTimeout(timer);toast?.remove();toast=null;};
  function show(item){
    close();
    toast=el('div','gd-undo-toast');toast.setAttribute('role','status');
    const undo=el('button','primary',t('Undo'));undo.type='button';
    const dismiss=el('button','',t('Close'));dismiss.type='button';dismiss.onclick=close;
    undo.onclick=async()=>{
      undo.disabled=true;
      try{
        await baseApi('/api/action',{method:'POST',body:JSON.stringify({action:'timeline-restore',path:item.path,id:item.id})});
        window.GitDeckSavings?.add('quick-undo');
        close();if(typeof showActionFeedback==='function')showActionFeedback(t('Undid {action} in {repo}',{action:item.action,repo:item.repository}));
        if(typeof loadWorkspace==='function'&&state?.workspaceRepo&&String(state.workspaceRepo.path).toLowerCase()===String(item.path).toLowerCase())void loadWorkspace();
      }catch(error){undo.disabled=false;if(typeof showActionFeedback==='function')showActionFeedback(error.message,{error:true});}
    };
    toast.append(el('span','',t('{action} done in {repo}',{action:item.action,repo:item.repository})),undo,dismiss);
    document.body.append(toast);timer=setTimeout(close,10000);
  }
  // Watch every action request, wherever it comes from (workspace, Dashboard panels, Ctrl+K).
  const baseApi=api;
  api=async function(path,options={}){
    const result=await baseApi(path,options);
    if(path==='/api/action'&&String(options.method||'').toUpperCase()==='POST'&&!result?.async){
      let body={};try{body=JSON.parse(options.body||'{}');}catch{}
      if(undoable.has(body.action)&&body.path){
        baseApi('/api/timeline').then(answer=>{const item=undoCandidate(answer?.timeline,body.path,body.action);if(item)show(item);}).catch(()=>{});
      }
    }
    return result;
  };
  document.addEventListener('keydown',(event)=>{if(toast&&event.key==='Escape')close();});
})();
