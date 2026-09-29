'use strict';
// Pull with uncommitted changes: instead of refusing, preview which changed
// files overlap the incoming commits, then let Git stash and restore them
// (git pull --autostash). Restore conflicts open File Status.
function pullAutostashNote(preview){
  const dirty=preview?.dirty||[];if(!dirty.length)return {text:'',blocked:false};
  const list=(files)=>files.slice(0,10).map(file=>`• ${file}`).join('\n')+(files.length>10?`\n…and ${files.length-10} more`:'');
  const blocking=preview.blockingUntracked||[];
  if(blocking.length)return {blocked:true,text:`Pull would overwrite ${blocking.length} untracked file(s) with incoming files. Move, rename or commit them first:\n${list(blocking)}`};
  const lines=[`You have ${dirty.length} uncommitted change(s). Git Deck will stash them, pull, then restore them.`];
  const overlap=preview.overlap||[];
  if(overlap.length)lines.push(`These files changed both here and upstream, so restoring them may conflict. If it does, your changes stay safe in the stash:\n${list(overlap)}`);
  else if(preview.knownTarget)lines.push('None of your changed files are touched by the incoming commits.');
  else lines.push('Incoming changes are unknown until you Fetch, so conflicts cannot be predicted.');
  return {text:lines.join('\n\n'),blocked:false};
}
(function(){
  if(typeof runWorkspaceAction!=='function'||typeof gitCommandPreview!=='function')return;
  const isPull=(action)=>action==='pull'||action==='pull-ref';
  const basePreview=gitCommandPreview;
  gitCommandPreview=function(action,payload={}){const text=basePreview(action,payload);return isPull(action)&&payload.autostash&&text?text.replace(/^git pull (--[\w-]+)/,'git pull $1 --autostash'):text;};
  const baseRun=runWorkspaceAction;
  runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
    const repo=state.workspaceRepo;
    if(isPull(action)&&payload.autostash===undefined&&repo&&!state.busy){
      let preview=null;
      try{const query=new URLSearchParams({path:repo.path});if(action==='pull-ref'){query.set('remote',payload.remote||'');query.set('branch',payload.branch||'');}preview=(await api('/api/repo/pull-preview?'+query)).pull;}
      catch{/* Fall back to the server's own dirty-tree check. */}
      const note=pullAutostashNote(preview);
      if(note.blocked){showActionFeedback(note.text,{error:true,context:`${repo.name} · ${action}`});setOutput(note.text,{expand:true,status:'error'});return null;}
      if(note.text){payload={...payload,autostash:true};confirmation=[confirmation||'Pull into the current branch?',note.text].join('\n\n');}
    }
    const result=await baseRun(action,payload,confirmation,options);
    if(isPull(action)&&result?.conflicts?.length){
      selectWorkspaceTab('changes');
      showActionFeedback(result.message,{error:true,context:`${repo?.name||'Repository'} · ${result.conflicts.length} conflict(s) · stash kept`});
    }
    return result;
  };
})();
