'use strict';
// Desktop bridge (frameless window only, GitDeck.exe + WebView2): what the launcher asks for and what it
// needs to know.
// - From the launcher: "palette:open" (Win+Shift+G), "do:today|mini|day-close|dashboard|palette" (tray
//   menu, Jump List tasks) and "open:<folder>" (a recent repository in the Jump List, Explorer's
//   "Open in Git Deck"). A ?do= in the address does the same at start.
// - To the launcher: "badge:<n>" (things waiting, shown on the taskbar button) and "jump:<lines>" (recent
//   repositories for the Jump List, one "name<TAB>path" per line).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const tasks=['today','mini','day-close','dashboard','palette'];
  function parseCommand(message){
    const text=String(message||'');
    if(text==='palette:open')return {kind:'do',task:'palette'};
    if(text.startsWith('do:')&&tasks.includes(text.slice(3)))return {kind:'do',task:text.slice(3)};
    if(text.startsWith('open:')&&text.length>5)return {kind:'open',path:text.slice(5)};
    return null;
  }
  // Recent repositories as Jump List lines; names and paths cannot break the format.
  function jumpLines(repos){
    return (repos||[]).filter(repo=>repo&&repo.path).slice(0,10).map(repo=>`${String(repo.name).replace(/[\t\n]/g,' ')}\t${String(repo.path).replace(/[\t\n]/g,'')}`).join('\n');
  }
  const helpers={parseCommand,jumpLines,tasks};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  const host=window.chrome&&window.chrome.webview;
  if(!host||typeof document==='undefined')return;

  function run(command){
    if(!command)return;
    if(command.kind==='open'){
      const repo=(state.repos||[]).find(item=>String(item.path).toLowerCase()===command.path.toLowerCase());
      if(repo&&typeof openWorkspace==='function'){document.getElementById('operations-close')?.click();void openWorkspace(repo,'changes');}
      return;
    }
    const task=command.task;
    if(task==='palette'&&typeof showCommandPalette==='function')showCommandPalette();
    else if(task==='today'&&typeof showOperationsCenter==='function')showOperationsCenter('briefing');
    else if(task==='dashboard'&&typeof showOperationsCenter==='function')showOperationsCenter('inbox');
    else if(task==='day-close')window.GitDeckDayClose?.open?.();
    else if(task==='mini')window.open('/mini.html','gitdeck-mini','width=400,height=640');
  }
  host.addEventListener('message',(event)=>run(parseCommand(event.data)));
  // Started from a Jump List task while Git Deck was closed: ?do=<task>.
  const startTask=new URLSearchParams(location.search).get('do');
  if(startTask&&tasks.includes(startTask))setTimeout(()=>run({kind:'do',task:startTask}),1500);

  // Tell the launcher what to show on the taskbar.
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  let lastBadge=-1,lastJump=null;
  function report(){
    const inbox=window.GitDeckInboxHelpers;const snap=readJson('gitdeck.pendingSnapshot',null);
    if(inbox&&snap){
      const items=(snap.items||[]).filter(item=>!/\.worktrees[\\/]/i.test(item.path)).flatMap(item=>inbox.itemsFor({path:item.path,name:String(item.path).split(/[\\/]/).pop()},item.pending,{}));
      const count=inbox.visibleItems(items,readJson('gitdeck.inboxState',{})).filter(item=>item.group==='now').length;
      if(count!==lastBadge){lastBadge=count;host.postMessage(`badge:${count}`);}
    }
    if(typeof state!=='undefined'&&typeof repoKey==='function'){
      const repos=(state.meta?.recent||[]).map(key=>(state.repos||[]).find(repo=>repoKey(repo)===key)).filter(Boolean);
      const lines=jumpLines(repos);if(lines!==lastJump){lastJump=lines;host.postMessage(`jump:${lines}`);}
    }
  }
  setInterval(()=>{if(!document.hidden)report();},5000);setTimeout(report,2500);
  window.addEventListener('storage',(event)=>{if(event.key==='gitdeck.pendingSnapshot'||event.key==='gitdeck.inboxState')report();});
})();
