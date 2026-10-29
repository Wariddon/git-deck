'use strict';
// Rubik play (with the Rubik shape, web/rubik.js):
// - Twist with the keyboard: Ctrl+Alt+Left/Right turns to the previous/next view in the side rail (or
//   Dashboard menu while the Dashboard is open); Ctrl+Alt+Up opens the Dashboard, Ctrl+Alt+Down closes it.
//   A two-finger sideways swipe on the touchpad does the same as Left/Right where nothing scrolls sideways.
//   Quick face: Ctrl+Alt+1..6 turns straight to that view (Changes, History, Branches, Stashes, Tags,
//   Compare in rail order), the short way round.
// - Stickers you can press: buttons sink when pressed; cards tilt a little toward the pointer.
// - Cube sound (Appearance › Cube sound, off by default): the soft clack of a speedcube layer on every
//   turn (a low thump under a short filtered tick), made with Web Audio (no sound files).
// Reduced motion turns off the tilt; the twists still switch views (without turning).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The view next to `current` in `order` (wrapping around), or '' when there is none.
  function neighbour(order,current,step){
    if(!order.length)return '';
    const at=order.indexOf(current);
    if(at<0)return order[step>0?0:order.length-1];
    return order[(at+step+order.length)%order.length];
  }
  // Tilt in degrees from the pointer position inside a box: up to `max` at the edges.
  function tilt(x,y,width,height,max=4){
    if(!width||!height)return {rx:0,ry:0};
    const dx=Math.max(-1,Math.min(1,(x/width)*2-1)),dy=Math.max(-1,Math.min(1,(y/height)*2-1));
    return {rx:(Math.round(-dy*max*10)/10)||0,ry:(Math.round(dx*max*10)/10)||0};
  }
  // A sideways swipe: enough horizontal travel, clearly more than vertical.
  const isSwipe=(dx,dy,threshold=140)=>Math.abs(dx)>=threshold&&Math.abs(dx)>Math.abs(dy)*2.5;
  // Quick face: the view for key "1".."9" in `order`, or '' when there is none.
  const quickFace=(order,key)=>{const index=Number(key)-1;return Number.isInteger(index)&&index>=0?order[index]||'':'';};
  const helpers={neighbour,tilt,isSwipe,quickFace};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined')return;

  const root=document.documentElement;
  const on=()=>window.GitDeckRubik?.active?.();
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));

  // ---- twists --------------------------------------------------------------------------------------
  const workspaceTabs=new Set(['changes','history','branches','stashes','tags','compare','conflicts','recovery','remotes','worktrees','patches','health','tools','settings']);
  function twist(step){
    const R=window.GitDeckRubik;if(!R)return;
    if(R.dashboardOpen()){
      const order=R.menuOrder().filter(id=>document.querySelector(`.operations-tabs [data-operations-view="${id}"]`)?.offsetParent);
      const current=document.querySelector('.operations-tabs [data-operations-view].active')?.dataset.operationsView;
      const next=neighbour(order,current,step);if(next&&typeof switchOperationsView==='function')switchOperationsView(next);
      return;
    }
    if(typeof state==='undefined'||!state.workspaceRepo)return;
    // Only real workspace views: the rail also holds Repos, Report and Focus, which are not faces.
    const order=R.railOrder().filter(tab=>workspaceTabs.has(tab)&&document.querySelector(`.modern-rail-item[data-tab="${tab}"]`)?.offsetParent);
    const next=neighbour(order,state.workspaceTab,step);if(next&&typeof selectWorkspaceTab==='function')selectWorkspaceTab(next);
  }
  const faceTabs=['changes','history','branches','stashes','tags','compare'];
  function jump(key){
    const R=window.GitDeckRubik;if(!R||typeof state==='undefined'||!state.workspaceRepo||typeof selectWorkspaceTab!=='function')return false;
    const order=R.railOrder().filter(tab=>faceTabs.includes(tab)&&document.querySelector(`.modern-rail-item[data-tab="${tab}"]`)?.offsetParent);
    const view=quickFace(order,key);if(!view)return false;
    if(R.dashboardOpen()&&typeof hideOperationsCenter==='function')hideOperationsCenter();
    selectWorkspaceTab(view);return true;
  }
  document.addEventListener('keydown',(event)=>{
    if(!on()||!event.ctrlKey||!event.altKey||event.shiftKey||event.metaKey||typing(event.target))return;
    const R=window.GitDeckRubik;
    if(event.key==='ArrowRight'){event.preventDefault();twist(1);}
    else if(event.key==='ArrowLeft'){event.preventDefault();twist(-1);}
    else if(event.key==='ArrowUp'&&!R.dashboardOpen()&&typeof showOperationsCenter==='function'){event.preventDefault();showOperationsCenter('briefing');}
    else if(event.key==='ArrowDown'&&R.dashboardOpen()&&typeof hideOperationsCenter==='function'){event.preventDefault();hideOperationsCenter();}
    else if(/^Digit[1-6]$/.test(event.code)&&jump(event.code.slice(5)))event.preventDefault();
  });
  // Touchpad: sideways wheel travel adds up; a swipe twists once, then rests for a moment.
  const scrollsSideways=(node)=>{for(let n=node;n&&n!==document.body;n=n.parentElement){if(n.scrollWidth>n.clientWidth+2){const style=getComputedStyle(n).overflowX;if(style==='auto'||style==='scroll')return true;}}return false;};
  let travelX=0,travelY=0,resting=0,reset=null;
  document.addEventListener('wheel',(event)=>{
    if(!on()||event.ctrlKey||Date.now()<resting||scrollsSideways(event.target))return;
    travelX+=event.deltaX;travelY+=event.deltaY;clearTimeout(reset);reset=setTimeout(()=>{travelX=0;travelY=0;},180);
    if(isSwipe(travelX,travelY)){const step=travelX>0?1:-1;travelX=0;travelY=0;resting=Date.now()+900;twist(step);}
  },{passive:true});

  // ---- cards tilt toward the pointer ---------------------------------------------------------------
  const tiltable='.gd-card, .forecast-card, .lane-card, .weather-family, .day-close-card, .lesson-card, .gd-today-col, .day-cube-face';
  // At most once per frame, however fast the pointer moves.
  let pointer=null,framed=false;
  document.addEventListener('pointermove',(event)=>{
    if(!on()||still()||event.pointerType==='touch')return;
    pointer=event;if(framed)return;framed=true;
    requestAnimationFrame(()=>{
      framed=false;const e=pointer;const card=e.target.closest?.(tiltable);if(!card)return;
      const box=card.getBoundingClientRect();const t=tilt(e.clientX-box.left,e.clientY-box.top,box.width,box.height);
      card.style.setProperty('--gd-rx',`${t.rx}deg`);card.style.setProperty('--gd-ry',`${t.ry}deg`);card.classList.add('gd-tilting');
    });
  },{passive:true});
  document.addEventListener('pointerout',(event)=>{
    const card=event.target.closest?.(tiltable);if(!card||card.contains(event.relatedTarget))return;
    card.style.removeProperty('--gd-rx');card.style.removeProperty('--gd-ry');card.classList.remove('gd-tilting');
  },{passive:true});

  // ---- cube sound ----------------------------------------------------------------------------------
  let audio=null;
  function click(){
    try{
      audio=audio||new (window.AudioContext||window.webkitAudioContext)();
      const now=audio.currentTime;
      // A soft low thump: the layer settling.
      const body=audio.createOscillator();const bodyGain=audio.createGain();body.type='sine';
      body.frequency.setValueAtTime(190,now);body.frequency.exponentialRampToValueAtTime(90,now+0.06);
      bodyGain.gain.setValueAtTime(0.12,now);bodyGain.gain.exponentialRampToValueAtTime(0.001,now+0.08);
      body.connect(bodyGain).connect(audio.destination);body.start(now);body.stop(now+0.09);
      // Two short ticks of filtered noise on top: the plastic edges clacking into place.
      for(const [at,gainValue] of [[0,0.11],[0.06,0.06]]){
        const length=Math.floor(audio.sampleRate*0.025);const buffer=audio.createBuffer(1,length,audio.sampleRate);const data=buffer.getChannelData(0);
        for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,3);
        const source=audio.createBufferSource();source.buffer=buffer;
        const filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1700;filter.Q.value=1.1;
        const gain=audio.createGain();gain.gain.value=gainValue;
        source.connect(filter).connect(gain).connect(audio.destination);source.start(now+at);
      }
    }catch{}
  }
  document.addEventListener('gitdeck:turn',()=>{if(window.GitDeckAppearance?.sound==='on')click();});
  window.GitDeckCubePlay={...helpers,twist,jump,click};
})();
