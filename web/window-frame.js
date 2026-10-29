'use strict';
// Frameless window (GitDeck.exe with WebView2, launcher/GitDeckLauncher.cs): the page draws the window's
// top bar. The empty parts of the repository tab row and the toolbar move the window (CSS app-region,
// web/soft.css), double-click maximizes, and three buttons at the top right minimize, maximize or close.
// In a browser or an Edge app window (no window.chrome.webview) nothing changes.
// Scrolling inside the top bar: Windows treats a drag area as the title bar, so a scrollbar there could
// not be grabbed. Every scroll box in a drag area is marked no-drag (gd-scrolls); the tab row only while
// it overflows, so its empty space still moves the window otherwise. Anywhere (browser too), the mouse
// wheel scrolls the tab row and the action bar sideways when they overflow.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const actions={minimize:'window:minimize',maximize:'window:maximize',close:'window:close'};
  const stateFrom=(message)=>message==='window:maximized'?'maximized':message==='window:restored'?'restored':'';
  // A sideways scroll for a wheel event over a box that only scrolls sideways (0 when nothing to do).
  const sideways=(deltaX,deltaY,box)=>{
    if(!box||box.scrollWidth<=box.clientWidth+1||Math.abs(deltaX)>=Math.abs(deltaY))return 0;
    const max=box.scrollWidth-box.clientWidth;const next=Math.max(0,Math.min(max,box.scrollLeft+deltaY));
    return next-box.scrollLeft;
  };
  const helpers={actions,stateFrom,sideways};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document!=='undefined')document.addEventListener('wheel',(event)=>{
    if(event.ctrlKey)return;const box=event.target.closest?.('.repo-tabs, .modern-actions');
    const step=sideways(event.deltaX,event.deltaY,box);if(!step)return;
    event.preventDefault();box.scrollLeft+=step;
  },{passive:false});
  const host=window.chrome&&window.chrome.webview;
  if(!host||typeof document==='undefined')return;

  document.documentElement.classList.add('gd-hosted');
  const svg=(paths)=>`<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">${paths}</svg>`;
  const icons={minimize:svg('<path d="M2 6.5h8"/>'),maximize:svg('<rect x="2.5" y="2.5" width="7" height="7" rx="1.5"/>'),restore:svg('<rect x="2.5" y="4" width="5.5" height="5.5" rx="1.2"/><path d="M4.5 4V3.2c0-.4.3-.7.7-.7h3.6c.4 0 .7.3.7.7v3.6c0 .4-.3.7-.7.7H8"/>'),close:svg('<path d="M3 3l6 6M9 3l-6 6"/>')};
  const bar=document.createElement('div');bar.className='gd-window-controls';
  const make=(kind,label)=>{const button=document.createElement('button');button.type='button';button.className=`gd-win-${kind}`;button.setAttribute('aria-label',label);button.title=label;button.innerHTML=icons[kind];button.addEventListener('click',()=>host.postMessage(actions[kind]));return button;};
  const minimize=make('minimize',t('Minimize')),maximize=make('maximize',t('Maximize')),close=make('close',t('Close'));
  bar.append(minimize,maximize,close);
  // In the repository tab row when there is one (it is redrawn often, so re-attach), else floating at
  // the top right of the window.
  const place=()=>{
    const tabs=document.querySelector('.repo-tabs');
    const home=tabs&&tabs.offsetParent?tabs:document.body;
    if(bar.parentElement!==home)home.append(bar);
    bar.classList.toggle('gd-window-floating',home===document.body);
  };
  // Scroll boxes in the drag areas become no-drag (checked at most twice a second).
  const zones='.repo-tabs, .workspace-modal-head, .modern-toolbar, .shell > header, .shell > section > header:first-child';
  let scanned=0,scanTimer=null;
  function scan(){
    scanned=Date.now();scanTimer=null;
    for(const zone of document.querySelectorAll(zones)){
      for(const node of [zone,...zone.querySelectorAll('div, nav, ul, section, menu')]){
        const style=getComputedStyle(node);const scrolls=/auto|scroll/.test(style.overflowX+style.overflowY);
        const overflowing=node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1;
        node.classList.toggle('gd-scrolls',scrolls&&(node.matches('.repo-tabs')?overflowing:true));
      }
    }
  }
  const scanSoon=()=>{if(scanTimer)return;scanTimer=setTimeout(scan,Math.max(0,500-(Date.now()-scanned)));};
  window.addEventListener('resize',scanSoon);
  let queued=false;
  const schedule=()=>{scanSoon();if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;place();});};
  const start=()=>{place();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
  host.addEventListener('message',(event)=>{
    const state=stateFrom(event.data);if(!state)return;
    document.documentElement.classList.toggle('gd-maximized',state==='maximized');
    maximize.innerHTML=state==='maximized'?icons.restore:icons.maximize;
    const label=state==='maximized'?t('Restore'):t('Maximize');maximize.setAttribute('aria-label',label);maximize.title=label;
  });
  host.postMessage('window:state');
})();
