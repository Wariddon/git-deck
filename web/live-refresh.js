'use strict';
// Live refresh: listens to /api/events for the open repository and reloads the
// workspace when files or refs change outside Git Deck (VS Code, terminal…).
// The connection also tells the desktop launcher's server that a window is open.
(function(){
  if(typeof window==='undefined'||typeof EventSource==='undefined')return;
  let source=null,connectedPath='',timer=null,pending=false,lastDiff=null;
  const typing=()=>{const active=document.activeElement;return Boolean(active&&active.closest?.('#workspace-content')&&(active.tagName==='TEXTAREA'||active.tagName==='SELECT'||(active.tagName==='INPUT'&&!['checkbox','radio','button'].includes(active.type))));};
  const run=()=>{
    if(!state.workspaceRepo)return;
    if(state.busy||document.hidden||typing()){pending=true;return;}
    pending=false;void loadWorkspace();
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(run,350);};
  const connect=()=>{
    const path=state.workspaceRepo?.path||'';
    if(path===connectedPath&&source&&source.readyState!==EventSource.CLOSED)return;
    if(source){source.close();source=null;}
    connectedPath=path;
    source=new EventSource(path?`/api/events?path=${encodeURIComponent(path)}`:'/api/events');
    source.addEventListener('changed',(event)=>{let data={};try{data=JSON.parse(event.data);}catch{}if(data.path&&data.path.toLowerCase()!==connectedPath.toLowerCase())return;schedule();});
  };
  setInterval(()=>{connect();if(pending)run();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pending)run();});
  window.addEventListener('focusout',()=>{if(pending)setTimeout(run,50);});
  connect();

  // Keep the file the user was reading selected when the workspace repaints.
  const baseLoadDiff=loadWorkingDiff;
  loadWorkingDiff=function(file,staged,pane,button){lastDiff={repo:state.workspaceRepo?.path||'',path:file.path,staged};return baseLoadDiff(file,staged,pane,button);};
  const baseRender=renderWorkspace;
  renderWorkspace=function(...args){
    // Rendering auto-opens the first file, which overwrites lastDiff; remember it first.
    const remembered=lastDiff;
    const result=baseRender(...args);
    if(state.workspaceTab==='changes'&&remembered&&remembered.repo===(state.workspaceRepo?.path||'')){
      const groups=[...document.querySelectorAll('#workspace-content .change-group')];
      const find=(group)=>group&&[...group.querySelectorAll('.change-file-main')].find(button=>button.title===remembered.path);
      const target=find(groups[remembered.staged?0:1])||find(groups[remembered.staged?1:0]);
      if(target&&!target.classList.contains('active'))target.click();
    }
    return result;
  };
})();
