'use strict';
// Cube (Appearance › Shape › Cube, the default): the program is a 3D box, not a window with a cube in it.
// GitDeck.exe makes the window square and cuts it to the cube's outline (launcher/GitDeckLauncher.cs), so
// the desktop shows around it and clicks there go through.
// - Work: one side faces you, flat and sharp: the real Git Deck. No transforms remain, so it behaves as ever.
// - Turn: Ctrl+Alt+arrows, or the pill that appears at the middle of an edge (hover leans the cube so
//   you peek at the next side). The cube pulls back, rotates and comes forward on the new side.
// - Hold (Esc, or the cube button): the whole cube at an angle; drag to turn, click a side to fly in.
// - Put away (the minimize button): a small cube in the corner of the screen with what waits for you.
// - Full window (the maximize button): the classic wide layout for long diffs; restore folds it back.
// The six sides: Changes, History, Branches, Stashes and tags (around), Today (top), Repositories (bottom).
// While the cube is moving, the other sides show live summaries; the side you land on opens for real.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const ring=['changes','history','branches','stash'];
  const sides={
    changes:{ry:0,place:'translateZ(var(--box-half))',n:[0,0,1]},
    history:{ry:-90,place:'rotateY(90deg) translateZ(var(--box-half))',n:[1,0,0]},
    branches:{ry:-180,place:'rotateY(180deg) translateZ(var(--box-half))',n:[0,0,-1]},
    stash:{ry:90,place:'rotateY(-90deg) translateZ(var(--box-half))',n:[-1,0,0]},
    today:{rx:-90,place:'rotateX(90deg) translateZ(var(--box-half))',n:[0,-1,0]},
    repos:{rx:90,place:'rotateX(-90deg) translateZ(var(--box-half))',n:[0,1,0]},
  };
  // The same angle as `to`, the shortest way round from `from`.
  const near=(from,to)=>to+360*Math.round((from-to)/360);
  // Which side a turn leads to. `last` is the side of the ring you came from (top and bottom return to it).
  function neighbour(face,last,dir){
    if(ring.includes(face)){
      if(dir==='up')return 'today';if(dir==='down')return 'repos';
      return ring[(ring.indexOf(face)+(dir==='right'?1:3))%4];
    }
    if((face==='today'&&dir==='down')||(face==='repos'&&dir==='up'))return last;
    return '';
  }
  // The side a view belongs to ('' = no side: it stays on the side you are on).
  const faceOfTab=(tab)=>({changes:'changes',history:'history',branches:'branches',stashes:'stash',tags:'stash'})[tab]||'';
  const faceOfDashboard=(view)=>view==='fleet'?'repos':'today';
  const rotate=(p,rx,ry)=>{
    const a=ry*Math.PI/180,b=rx*Math.PI/180;
    const x=p[0]*Math.cos(a)+p[2]*Math.sin(a),z0=-p[0]*Math.sin(a)+p[2]*Math.cos(a);
    return [x,p[1]*Math.cos(b)-z0*Math.sin(b),p[1]*Math.sin(b)+z0*Math.cos(b)];
  };
  // The cube's eight corners on screen.
  function corners(rx,ry,z,size,perspective,cx,cy){
    const h=size/2;const out=[];
    for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
      const p=rotate([sx*h,sy*h,sz*h],rx,ry);const k=perspective/(perspective-(p[2]+z));
      out.push([cx+p[0]*k,cy+p[1]*k]);
    }
    return out;
  }
  // Convex hull (the cube's outline), clockwise from the left.
  function hull(points){
    const list=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const half=(input)=>{const out=[];for(const p of input){while(out.length>1&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
    return [...half(list),...half(list.slice().reverse())];
  }
  // How dark a side is at this angle (0 when it faces you).
  function shade(n,rx,ry){
    const v=rotate(n,rx,ry);const light=-0.25*v[0]-0.45*v[1]+0.86*v[2];
    return Math.round(Math.max(0,Math.min(0.62,(0.85-light)*0.6))*100)/100;
  }
  const PERSPECTIVE=2.6;
  // Far enough back that the cube fits the window at any angle.
  const holdZ=(size)=>-(0.805*PERSPECTIVE*size+0.866*size);
  const helpers={ring,sides,near,neighbour,faceOfTab,faceOfDashboard,corners,hull,shade,holdZ,PERSPECTIVE};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement,body=document.body;
  const host=window.chrome&&window.chrome.webview;
  const main=document.querySelector('main.shell');if(!main)return;
  const post=(message)=>{if(host)host.postMessage(message);};
  const names={changes:t('Changes'),history:t('History'),branches:t('Branches'),stash:t('Stashes and tags'),today:t('Today'),repos:t('Repositories')};
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};

  // ---- the box --------------------------------------------------------------------------------------
  const stage=el('div','gd-box-stage');const cube=el('div','gd-box-cube');const real=el('div','gd-box-real');stage.append(cube);
  const realShade=el('i','gd-box-shade');real.append(realShade);
  const faces={};
  for(const id of Object.keys(sides)){
    const side=el('div','gd-box-side');side.dataset.face=id;side.style.transform=sides[id].place;
    side.append(el('div','gd-box-side-body'),el('i','gd-box-shade'));cube.append(side);faces[id]=side;
  }
  cube.append(real);
  const badge=el('button','gd-box-small-open');badge.type='button';badge.setAttribute('aria-label',t('Open Git Deck'));
  const turns={};
  for(const dir of ['left','right','up','down']){
    const pill=el('button',`gd-box-turn gd-box-turn-${dir}`);pill.type='button';pill.hidden=true;
    pill.onclick=()=>turn(dir);pill.onmouseenter=()=>peek(dir);pill.onmouseleave=()=>unpeek();turns[dir]=pill;
  }
  const subBar=el('div','gd-box-sub');subBar.hidden=true;
  for(const [tab,label] of [['stashes',t('Stashes')],['tags',t('Tags')]]){const button=el('button','',label);button.type='button';button.dataset.tab=tab;button.onclick=()=>{if(typeof selectWorkspaceTab==='function')selectWorkspaceTab(tab);};subBar.append(button);}
  const holdButton=el('button','gd-box-hold-button');holdButton.type='button';holdButton.title=t('Hold the cube (Esc)');holdButton.setAttribute('aria-label',holdButton.title);holdButton.onclick=()=>hold();
  holdButton.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 14 5v6l-6 3.2L2 11V5zM2 5l6 3.2L14 5M8 8.2v6"/></svg>';

  let mounted=false,mode='work',face='changes',last='changes';
  let pose={rx:0,ry:0,z:0},frame=0;
  const size=()=>Math.min(innerWidth,innerHeight);
  const workZ=()=>-size()/2;
  const flatNow=()=>body.classList.contains('gd-box-flat');
  function setFlat(on){body.classList.toggle('gd-box-flat',on);if(on){cube.style.transform='';real.style.transform='';}}

  // ---- drawing --------------------------------------------------------------------------------------
  let lastRegion=0;
  function region(force){
    if(!host||mode==='full')return;
    const now=performance.now();if(!force&&now-lastRegion<30)return;lastRegion=now;
    const points=hull(corners(pose.rx,pose.ry,pose.z,size(),PERSPECTIVE*size(),innerWidth/2,innerHeight/2));
    post(`box:poly:${points.map(p=>`${Math.round(Math.max(0,Math.min(innerWidth,p[0]))*10)/10},${Math.round(Math.max(0,Math.min(innerHeight,p[1]))*10)/10}`).join(',')}`);
  }
  function draw(force){
    cube.style.transform=`translateZ(${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg)`;
    for(const id of Object.keys(sides)){const value=String(shade(sides[id].n,pose.rx,pose.ry));faces[id].lastChild.style.opacity=value;if(id===face)realShade.style.opacity=value;}
    region(force);
  }
  function tween(to,{ms=820,dip=0,done}={}){
    cancelAnimationFrame(frame);
    const from={...pose};
    if(still()||ms===0){pose={...to};draw(true);done?.();return;}
    const start=performance.now();
    const step=(now)=>{
      const k=Math.min(1,(now-start)/ms);const e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
      pose={rx:from.rx+(to.rx-from.rx)*e,ry:from.ry+(to.ry-from.ry)*e,z:from.z+(to.z-from.z)*e-dip*Math.sin(Math.PI*k)};
      draw(k===1);
      if(k<1)frame=requestAnimationFrame(step);else{pose={...to};done?.();}
    };
    frame=requestAnimationFrame(step);
    // A window that is not painting has no frames: finish anyway.
    setTimeout(()=>{if(pose.rx!==to.rx||pose.ry!==to.ry||pose.z!==to.z){if(document.hidden){cancelAnimationFrame(frame);pose={...to};draw(true);done?.();}}},ms+120);
  }
  const angleOf=(id,fromRy)=>sides[id].rx!==undefined?{rx:sides[id].rx,ry:near(fromRy,0)}:{rx:0,ry:near(fromRy,sides[id].ry)};
  function placeReal(id){
    real.style.transform=sides[id].place;real.dataset.face=id;
    for(const key of Object.keys(faces))faces[key].classList.toggle('is-real',key===id);
  }
  function settle(){setFlat(true);if(mode==='work'){post('box:round');syncTurns();}}

  // ---- the summaries on the other sides --------------------------------------------------------------
  function rowsFor(id){
    const w=(typeof state!=='undefined'&&state.workspaceRepo)?state.workspace:null;const sync=w?.sync||{};
    const base=(path)=>String(path).split(/[\\/]/).pop();
    switch(id){
      case 'changes':return w?[(w.files||[]).length?t('{count} files to commit',{count:(w.files||[]).length}):t('Working tree clean'),...(w.files||[]).slice(0,12).map(f=>base(f.path))]:[];
      case 'history':return (w?.history||[]).slice(0,13).map(c=>c.subject);
      case 'branches':return w?[`${w.branch||''}`,...(w.branches||[]).filter(b=>!b.current).slice(0,12).map(b=>b.name)]:[];
      case 'stash':return w?[...(w.stashes||[]).slice(0,5).map(s=>s.message||s.ref),...(w.tags||[]).slice(0,8).map(tag=>typeof tag==='string'?tag:tag.name)]:[];
      case 'today':{const out=[];if(w){if((w.files||[]).length)out.push(t('{count} files to commit',{count:w.files.length}));if(sync.behind)out.push(t('{count} commits to pull',{count:sync.behind}));if(sync.ahead)out.push(t('{count} commits to push',{count:sync.ahead}));}const list=(state.repos||[]).filter(repo=>repo.valid!==false&&(Number(repo.changes)>0||Number(repo.behind)>0));return [...out,...list.slice(0,10).map(repo=>repo.name)];}
      case 'repos':return (state.repos||[]).filter(repo=>repo.valid!==false).slice(0,14).map(repo=>repo.name);
      default:return [];
    }
  }
  function fill(){
    const repo=typeof state!=='undefined'?state.workspaceRepo:null;
    for(const id of Object.keys(sides)){
      const inner=faces[id].firstChild;const head=el('div','gd-box-side-head');head.append(el('small','',repo?repo.name:'Git Deck'),el('strong','',names[id]));
      const list=el('div','gd-box-side-rows');list.append(...rowsFor(id).map(text=>el('span','',text)));inner.replaceChildren(head,list);
    }
  }

  // ---- the real view on each side -----------------------------------------------------------------------
  const dashOpen=()=>body.classList.contains('dashboard-page-open');
  function open(id){
    const view={today:'briefing',repos:'fleet'}[id];
    if(view){if(dashOpen()&&typeof switchOperationsView==='function')switchOperationsView(view);else if(typeof showOperationsCenter==='function')showOperationsCenter(view);return;}
    if(dashOpen()&&typeof hideOperationsCenter==='function')hideOperationsCenter();
    const tab={changes:'changes',history:'history',branches:'branches',stash:'stashes'}[id];
    if(typeof state!=='undefined'&&state.workspaceRepo&&typeof selectWorkspaceTab==='function')selectWorkspaceTab(tab);
  }
  function currentFace(){
    if(dashOpen())return faceOfDashboard(document.querySelector('.operations-tabs [data-operations-view].active')?.dataset.operationsView);
    return faceOfTab(typeof state!=='undefined'?state.workspaceTab:'');
  }
  function setFace(id){if(ring.includes(id))last=id;face=id;subBar.hidden=id!=='stash'||mode!=='work';placeReal(id);const a=angleOf(id,pose.ry);pose={...a,z:workZ()};}

  // ---- turning ----------------------------------------------------------------------------------------
  let moving=false;
  function leaveFlat(){fill();setFlat(false);placeReal(face);draw(true);hideTurns();}
  function turn(dir){
    if(moving||mode!=='work')return;
    const to=neighbour(face,last,dir);if(!to)return;
    moving=true;if(flatNow())leaveFlat();
    if(window.GitDeckAppearance?.sound==='on')window.GitDeckCubePlay?.click?.();
    const size_=size();
    tween({...angleOf(to,pose.ry),z:workZ()},{ms:820,dip:1.28*size_,done:()=>{setFace(to);open(to);draw(true);moving=false;settle();}});
  }
  function peek(dir){
    if(moving||mode!=='work')return;
    if(flatNow())leaveFlat();
    const base=angleOf(face,pose.ry);const lean={left:[0,7],right:[0,-7],up:[-7,0],down:[7,0]}[dir];
    turns[dir].hidden=false;
    tween({rx:base.rx+lean[0],ry:base.ry+lean[1],z:workZ()},{ms:260});
  }
  function unpeek(){
    if(moving||mode!=='work'||flatNow())return;
    tween({...angleOf(face,pose.ry),z:workZ()},{ms:220,done:settle});
  }
  function goHold(){
    if(moving)return;moving=true;mode='hold';subBar.hidden=true;body.classList.add('gd-box-hold');
    if(flatNow())leaveFlat();
    const a=angleOf(face,pose.ry);
    tween({rx:sides[face].rx!==undefined?a.rx+24:-24,ry:a.ry-34,z:holdZ(size())},{ms:760,done:()=>{moving=false;}});
  }
  function hold(){
    if(mode==='small'){body.classList.remove('gd-box-small');mode='hold';post('box:on');setTimeout(()=>{fill();setFlat(false);placeReal(face);body.classList.add('gd-box-hold');pose={rx:-24,ry:-34+(sides[face].ry||0),z:holdZ(size())};draw(true);},60);return;}
    if(mode==='work')goHold();
  }
  function enter(id){
    if(moving)return;moving=true;
    if(id!==face){const held={...pose};setFace(id);pose=held;open(id);}
    body.classList.remove('gd-box-hold');mode='work';
    const a=angleOf(id,pose.ry);
    tween({...a,z:workZ()},{ms:760,done:()=>{moving=false;subBar.hidden=id!=='stash';settle();}});
  }
  function putAway(){
    mode='small';subBar.hidden=true;hideTurns();fill();setFlat(false);body.classList.remove('gd-box-hold');body.classList.add('gd-box-small');
    drawBadge();post('box:small');
    setTimeout(()=>{pose={rx:-24,ry:-34,z:holdZ(size())};draw(true);},120);
  }
  function drawBadge(){
    const snap=readJson('gitdeck.pendingSnapshot',null);const count=(state.repos||[]).filter(repo=>repo.valid!==false&&(Number(repo.changes)>0||Number(repo.behind)>0)).length||(snap?.items||[]).length;
    badge.replaceChildren();if(count)badge.append(el('b','',String(count)));
  }
  badge.onclick=()=>hold();

  // Dragging the held cube; a click flies into the side under the pointer.
  let drag=null;
  stage.addEventListener('pointerdown',(event)=>{if(mode!=='hold'||moving)return;drag={x:event.clientX,y:event.clientY,rx:pose.rx,ry:pose.ry,id:event.pointerId,moved:false};});
  stage.addEventListener('pointermove',(event)=>{
    if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.abs(dx)+Math.abs(dy)>5){drag.moved=true;try{stage.setPointerCapture(drag.id);}catch{}}
    if(drag.moved){pose={...pose,ry:drag.ry+dx*.4,rx:Math.max(-85,Math.min(85,drag.rx-dy*.4))};draw(false);}
  });
  stage.addEventListener('pointerup',(event)=>{
    if(!drag)return;const moved=drag.moved;drag=null;if(moved){draw(true);return;}
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('[data-face]');if(hit)enter(hit.dataset.face);
  });

  // ---- edges: a pill at the middle of an edge turns the cube ------------------------------------------------
  const hideTurns=()=>{for(const pill of Object.values(turns))pill.hidden=true;};
  function syncTurns(){for(const [dir,pill] of Object.entries(turns)){const to=neighbour(face,last,dir);pill.textContent=to?names[to]:'';}}
  document.addEventListener('pointermove',(event)=>{
    if(!mounted||mode!=='work'||moving||!flatNow())return;
    const x=event.clientX,y=event.clientY,w=innerWidth,h=innerHeight,edge=30;
    const midX=x>w*.3&&x<w*.7,midY=y>h*.3&&y<h*.7;
    const near={left:x<edge&&midY,right:x>w-edge&&midY,up:y<8&&midX,down:y>h-8&&midX};
    for(const [dir,pill] of Object.entries(turns)){const hover=pill.matches(':hover');pill.hidden=!(near[dir]||hover)||!neighbour(face,last,dir);}
  },{passive:true});

  // ---- keys ---------------------------------------------------------------------------------------
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(!mounted||mode==='full'||mode==='small')return;
    if(event.ctrlKey&&event.altKey&&!event.shiftKey&&!typing(event.target)){
      const dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];
      if(dir&&mode==='work'){event.preventDefault();event.stopImmediatePropagation();turn(dir);}
      return;
    }
    if(event.key==='Escape'&&!event.defaultPrevented&&!typing(event.target)){
      if(mode==='hold'){event.preventDefault();enter(face);return;}
      if(document.querySelector('dialog[open], details[open], #command-palette:not(.hidden), .gd-timeline, .context-menu:not(.hidden)')||body.classList.contains('gd-zen'))return;
      event.preventDefault();goHold();
    }
  },true);

  // ---- window messages, mounting and keeping up -------------------------------------------------------------
  function full(on){
    if(on===(mode==='full'))return;
    if(on){cancelAnimationFrame(frame);moving=false;mode='full';setFlat(true);body.classList.add('gd-box-full');body.classList.remove('gd-box-hold','gd-box-small');hideTurns();subBar.hidden=true;}
    else{mode='work';body.classList.remove('gd-box-full');setFace(face);setFlat(true);setTimeout(()=>post('box:round'),60);subBar.hidden=face!=='stash';syncTurns();}
  }
  host?.addEventListener?.('message',(event)=>{if(!mounted)return;if(event.data==='window:maximized')full(true);else if(event.data==='window:restored'&&mode==='full')full(false);});
  function resize(){
    if(!mounted)return;root.style.setProperty('--box-size',`${size()}px`);root.style.setProperty('--box-half',`${size()/2}px`);stage.style.perspective=`${PERSPECTIVE*size()}px`;
    if(mode==='work'){pose={...angleOf(face,pose.ry),z:workZ()};if(flatNow())post('box:round');else draw(true);}
    else if(mode==='hold'||mode==='small'){pose={...pose,z:holdZ(size())};draw(true);}
  }
  function controls(){
    const bar=document.querySelector('.gd-window-controls');if(bar&&holdButton.parentElement!==bar)bar.prepend(holdButton);
    const minimize=bar?.querySelector('.gd-win-minimize');
    if(minimize&&!minimize.dataset.box){minimize.dataset.box='1';minimize.addEventListener('click',(event)=>{if(!mounted)return;event.stopImmediatePropagation();putAway();},true);}
    const title=t('Put the cube away');if(minimize&&mounted&&minimize.title!==title){minimize.title=title;minimize.setAttribute('aria-label',title);}
  }
  function mount(){
    if(mounted)return;mounted=true;mode='work';
    main.before(stage);real.prepend(main);body.append(badge,subBar,...Object.values(turns));body.classList.add('gd-box-on');
    const id=currentFace()||'changes';setFace(id);resize();setFlat(true);post('box:on');syncTurns();setTimeout(()=>{resize();post('box:round');},200);
  }
  function unmount(){
    if(!mounted)return;mounted=false;cancelAnimationFrame(frame);stage.before(main);stage.remove();badge.remove();subBar.remove();holdButton.remove();for(const pill of Object.values(turns))pill.remove();
    body.classList.remove('gd-box-on','gd-box-flat','gd-box-hold','gd-box-small','gd-box-full');post('box:off');
  }
  const wanted=()=>root.classList.contains('gd-box')&&root.classList.contains('ui-modern')&&(Boolean(host)||readJson('gitdeck.boxPreview',false));
  function sync(){if(wanted())mount();else unmount();}
  window.addEventListener('resize',resize);document.addEventListener('gitdeck:appearance',sync);
  setInterval(()=>{
    if(document.hidden||!mounted)return;controls();
    if(mode==='work'&&!moving&&flatNow()){const id=currentFace();if(id&&id!==face){setFace(id);syncTurns();}subBar.hidden=face!=='stash';for(const button of subBar.children)button.setAttribute('aria-pressed',String(typeof state!=='undefined'&&state.workspaceTab===button.dataset.tab));}
  },600);
  sync();
  window.GitDeckCubeBox={...helpers,turn,hold,enter,putAway,mode:()=>mode,face:()=>face,pose:()=>({...pose})};
})();
