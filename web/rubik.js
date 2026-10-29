'use strict';
// Rubik shape (Appearance › Shape › Rubik; html.gd-rubik, styles in web/rubik.css): the app is a cube.
// Every view is a face: switching a workspace tab, opening another repository, opening or closing the
// Dashboard and switching Dashboard views turns the cube to the new face (View Transitions: the old
// face rotates away around the cube's centre while the new one rotates in). The tiles are stickers on
// dark plastic, each view with its own sticker colour. Reduced motion, or a browser without View
// Transitions, switches without the turn.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Which way the cube turns: later in the menu = the next face comes in from the right.
  function direction(order,from,to){
    const a=order.indexOf(from),b=order.indexOf(to);
    if(a<0||b<0||a===b)return 'next';
    return b>a?'next':'prev';
  }
  // Sticker colour per view (the six cube colours, plus grey for the rest).
  const faceColors={changes:'#e5534b',history:'#2f81f7',branches:'#d29922',tags:'#eef1f4',stashes:'#f2cc60',compare:'#3fb950',dashboard:'#0b6e47',repos:'#0b6e47',all:'#0b6e47'};
  const faceColor=(view)=>faceColors[view]||'#6e7781';
  // The sticker variable each view uses, so sticker sets (web/rubik.css) recolour it.
  const faceSlots={changes:'red',history:'blue',branches:'orange',tags:'white',stashes:'yellow',compare:'green',dashboard:'green',repos:'green',all:'green'};
  const faceValue=(view)=>faceSlots[view]?`var(--st-${faceSlots[view]}, ${faceColor(view)})`:faceColor(view);
  const helpers={direction,faceColors,faceColor,faceSlots,faceValue};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined')return;

  const root=document.documentElement;
  const rubik=()=>root.classList.contains('gd-rubik')&&root.classList.contains('ui-modern');
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canTurn=()=>typeof document.startViewTransition==='function';
  const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const dashboardOpen=()=>{const backdrop=document.getElementById('operations-backdrop');return Boolean(backdrop&&!backdrop.classList.contains('hidden'));};
  // The face on screen now: the open Dashboard view, else the repository's content.
  function face(){
    if(dashboardOpen())return document.querySelector('.operations-view:not([hidden])')||document.querySelector('.operations-modal');
    return document.getElementById('workspace-content');
  }
  const setFace=(view)=>{root.dataset.face=view||'';root.style.setProperty('--gd-face-color',faceValue(view));root.style.setProperty('--gd-face-ink',['white','yellow','orange'].includes(faceSlots[view])?'#1f2328':'#ffffff');};

  let turning=false,updating=false,pending=Promise.resolve();
  // Runs `update` while the cube turns `way` (next, prev, up, down). Returns what update returns.
  // A switch asked for during a turn runs after it (else the older switch could land last); one made
  // by the update itself (the Dashboard opening its view) runs at once.
  const waiting=()=>turning&&!updating;
  function turn(way,update){
    const old=face();
    if(!rubik()||still()||!canTurn()||turning||!old||!old.offsetParent)return update();
    turning=true;
    const box=old.getBoundingClientRect();
    root.style.setProperty('--gd-depth',`${Math.round((way==='up'||way==='down'?box.height:box.width)/2)}px`);
    root.dataset.turn=way;
    document.dispatchEvent(new CustomEvent('gitdeck:turn',{detail:{way}}));
    old.style.viewTransitionName='gd-face';
    let result,started=false,done=false;
    const run=()=>{if(done)return result;done=true;updating=true;try{result=update();}finally{updating=false;}return result;};
    const transition=document.startViewTransition(async()=>{
      started=true;old.style.viewTransitionName='';
      if(done)return;
      run();
      // Wait for the new face to render, but never freeze the screen for long on a slow load.
      await Promise.race([Promise.resolve(result).catch(()=>{}),wait(320)]);
      const next=face();if(next)next.style.viewTransitionName='gd-face';
    });
    // Switches queued during this turn run once it has finished (turning is false by then).
    let release;pending=new Promise(resolve=>{release=resolve;});
    const finish=()=>{turning=false;const next=face();if(next)next.style.viewTransitionName='';old.style.viewTransitionName='';delete root.dataset.turn;release();};
    transition.ready.catch(()=>{});transition.finished.catch(()=>{}).finally(finish);
    // A window that is not painting (minimized, covered) never starts the turn: switch at once instead.
    const shown=new Promise(resolve=>{
      const guard=setTimeout(()=>{if(started)return;try{transition.skipTransition();}catch{}finish();resolve(run());},400);
      transition.updateCallbackDone.then(()=>{clearTimeout(guard);resolve(result);},()=>{clearTimeout(guard);resolve(run());});
    });
    return shown;
  }
  const railOrder=()=>[...document.querySelectorAll('.modern-rail-item[data-tab]')].map(item=>item.dataset.tab);
  const menuOrder=()=>[...document.querySelectorAll('.operations-tabs [data-operations-view]')].map(item=>item.dataset.operationsView);

  if(typeof selectWorkspaceTab==='function'){
    const base=selectWorkspaceTab;
    selectWorkspaceTab=function(tab,...rest){
      if(waiting())return pending.then(()=>selectWorkspaceTab(tab,...rest));
      const from=state.workspaceTab;setFace(tab);
      if(from===tab||dashboardOpen())return base.call(this,tab,...rest);
      return turn(direction(railOrder(),from,tab),()=>base.call(this,tab,...rest));
    };
  }
  if(typeof openWorkspace==='function'){
    const base=openWorkspace;
    openWorkspace=function(repo,...rest){
      if(waiting())return pending.then(()=>openWorkspace(repo,...rest));
      const same=state.workspaceRepo&&repo&&String(state.workspaceRepo.path).toLowerCase()===String(repo.path).toLowerCase();
      // openWorkspace(repo, tab) picks the view itself (also the restored one at start): follow it.
      if(typeof rest[0]==='string')setFace(rest[0]);
      const open=()=>{const result=base.call(this,repo,...rest);Promise.resolve(result).then(()=>{if(!dashboardOpen())setFace(state.workspaceTab);},()=>{});return result;};
      if(same||!state.workspaceRepo)return open();
      return turn('next',open);
    };
  }
  if(typeof switchOperationsView==='function'){
    const base=switchOperationsView;
    switchOperationsView=function(view,...rest){
      if(waiting())return pending.then(()=>switchOperationsView(view,...rest));
      const from=document.querySelector('.operations-tabs [data-operations-view].active')?.dataset.operationsView;
      if(!dashboardOpen()||!from||from===view)return base.call(this,view,...rest);
      return turn(direction(menuOrder(),from,view),()=>base.call(this,view,...rest));
    };
  }
  if(typeof showOperationsCenter==='function'){
    const base=showOperationsCenter;
    showOperationsCenter=function(...args){if(waiting())return pending.then(()=>showOperationsCenter(...args));setFace('dashboard');return dashboardOpen()?base.apply(this,args):turn('up',()=>base.apply(this,args));};
  }
  if(typeof hideOperationsCenter==='function'){
    const base=hideOperationsCenter;
    hideOperationsCenter=function(...args){if(waiting())return pending.then(()=>hideOperationsCenter(...args));setFace(state.workspaceTab);return dashboardOpen()?turn('down',()=>base.apply(this,args)):base.apply(this,args);};
    // The close button was bound to the original function; send it through the turn too.
    document.getElementById('operations-close')?.addEventListener('click',(event)=>{if(!rubik())return;event.stopImmediatePropagation();hideOperationsCenter();},true);
  }
  // Rubik is dark plastic whatever the colour theme: keep the dark, green-accent palette while it is on.
  if(typeof applyAppearance==='function'){
    const base=applyAppearance;
    applyAppearance=function(...args){
      const result=base.apply(this,args);
      // White plastic is the light cube: the light palette instead.
      if(rubik()&&root.classList.contains('gd-plastic-white')){document.body.classList.remove('theme-dark','theme-focus','theme-midnight');root.style.colorScheme='light';}
      else if(rubik()){document.body.classList.add('theme-dark','theme-focus');root.style.colorScheme='dark';}
      return result;
    };
    document.addEventListener('gitdeck:appearance',()=>applyAppearance());
    applyAppearance();
  }
  setFace(typeof state!=='undefined'?state.workspaceTab:'');
  window.GitDeckRubik={...helpers,railOrder,menuOrder,dashboardOpen,active:rubik};
})();
