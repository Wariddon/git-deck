'use strict';
// Motion and loading feedback for the whole app (styles in motion.css).
// - A thin bar at the top while Git Deck waits for the server (only for waits longer than a
//   moment, and never for background polling).
// - Shimmering placeholder rows while a repository opens.
// - Views fade in when you switch to them; a refresh of the same view does not animate.
// Reduced-motion users get the same feedback without movement (see motion.css).
(function(){
  if(typeof document==='undefined')return;
  // Background polls: the bar would blink every few seconds for work the user did not ask for.
  const quiet=/^\/api\/(version|jobs|gitlab\/inbox|gitlab\/hosts|ui-state)\b/;
  const isQuiet=(path,options)=>quiet.test(String(path||''))||(()=>{try{return /"action":"ui-state-/.test(String(options?.body||''));}catch{return false;}})();

  // ---- top progress bar --------------------------------------------------------------------------
  const bar=document.createElement('div');bar.id='gd-progress';bar.setAttribute('aria-hidden','true');bar.append(document.createElement('span'));
  let active=0;let showTimer=0;let hideTimer=0;
  const begin=()=>{
    active+=1;clearTimeout(hideTimer);
    if(active===1&&!bar.classList.contains('on'))showTimer=setTimeout(()=>{bar.classList.remove('done');bar.classList.add('on');},180);
  };
  const end=()=>{
    active=Math.max(0,active-1);if(active)return;clearTimeout(showTimer);
    if(!bar.classList.contains('on'))return;
    bar.classList.add('done');hideTimer=setTimeout(()=>bar.classList.remove('on','done'),320);
  };
  const busy=()=>document.body.hasAttribute('aria-busy');
  const mount=()=>{if(!bar.isConnected)document.body.append(bar);};
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
  if(typeof api==='function'){
    const baseApi=api;
    api=function(path,options){
      if(isQuiet(path,options))return baseApi(path,options);
      begin();let result;
      try{result=baseApi(path,options);}catch(error){end();throw error;}
      return Promise.resolve(result).finally(end);
    };
  }
  // Long operations already mark the page busy (showLoading): keep the bar on for them too.
  let busyHeld=false;
  new MutationObserver(()=>{const now=busy();if(now&&!busyHeld){busyHeld=true;begin();}else if(!now&&busyHeld){busyHeld=false;end();}})
    .observe(document.body,{attributes:true,attributeFilter:['aria-busy']});

  // ---- placeholder rows while a repository opens -------------------------------------------------
  function workspaceSkeleton(){
    const content=document.getElementById('workspace-content');
    if(!content||!content.hasAttribute('aria-busy')||content.children.length)return;
    const box=document.createElement('div');box.className='gd-skeleton gd-skeleton-workspace';box.setAttribute('aria-hidden','true');
    for(let index=0;index<9;index+=1){const row=document.createElement('div');row.className='gd-skeleton-row';for(let cell=0;cell<5;cell+=1)row.append(document.createElement('i'));box.append(row);}
    content.append(box);
  }
  const content=document.getElementById('workspace-content');
  if(content)new MutationObserver(()=>{
    if(content.hasAttribute('aria-busy'))workspaceSkeleton();
    else content.querySelector(':scope > .gd-skeleton-workspace')?.remove();
  }).observe(content,{attributes:true,attributeFilter:['aria-busy']});

  // ---- views fade in when switched to -----------------------------------------------------------
  const enter=(node)=>{if(!node)return;node.classList.remove('gd-view-enter');void node.offsetWidth;node.classList.add('gd-view-enter');setTimeout(()=>node.classList.remove('gd-view-enter'),400);};
  if(typeof selectWorkspaceTab==='function'){
    const baseSelect=selectWorkspaceTab;
    selectWorkspaceTab=function(tab,...rest){
      const changed=rest[0]!==false&&typeof state==='object'&&state.workspaceTab!==tab;
      const result=baseSelect(tab,...rest);if(changed)enter(document.getElementById('workspace-content'));return result;
    };
  }
  window.GitDeckMotion={begin,end,isQuiet,enter};
})();
