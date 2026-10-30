'use strict';
// Cube (Appearance › Shape › Cube, the default): the program is a 3D box, not a window with a cube in it.
// GitDeck.exe cuts the window to the box's outline (launcher/GitDeckLauncher.cs), so the desktop shows around it
// and clicks there go through.
// - Work: one side faces you, flat and sharp: the real Git Deck, in a normal window you can move, snap and
//   resize to anything by its edges and corners. Size and place are remembered. No transforms remain.
// - Side bar under the toolbar: every side with what waits on it; a click turns straight there. More views
//   holds everything else. Ctrl+Alt+1..6 and Ctrl+Alt+arrows do the same from the keyboard.
// - Hold (the small cube in the side bar, or Ctrl+Alt+0): the whole cube at an angle, large enough to use.
//   Drag to turn it. Every side works from here: click a file, a commit or a repository to fly straight to
//   it, or use its buttons (Commit, Fetch, Pull, Push). Esc goes back.
// - Put away (the minimize button): a small cube in the corner of the screen with what waits for you.
// - Maximize works as in any window; everything stays where it is. Below 1100 px the toolbar gets compact and
//   the branch tree makes room; below 720 px it is a slim column to keep beside your other windows, down to
//   340 px. The dock button (Ctrl+Alt+D) puts it against the side of the screen and back again.
// The six sides: Changes, History, Branches, Stashes and tags (around), Today (top), Repositories (bottom).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const ring=['changes','history','branches','stash'];
  const order=['changes','history','branches','stash','today','repos'];
  const sides={
    changes:{ry:0,place:'translateZ(calc(var(--box-w) / 2))',n:[0,0,1]},
    history:{ry:-90,place:'rotateY(90deg) translateZ(calc(var(--box-w) / 2))',n:[1,0,0]},
    branches:{ry:-180,place:'rotateY(180deg) translateZ(calc(var(--box-w) / 2))',n:[0,0,-1]},
    stash:{ry:90,place:'rotateY(-90deg) translateZ(calc(var(--box-w) / 2))',n:[-1,0,0]},
    today:{rx:-90,place:'rotateX(90deg) translateZ(calc(var(--box-h) / 2))',n:[0,-1,0]},
    repos:{rx:90,place:'rotateX(-90deg) translateZ(calc(var(--box-h) / 2))',n:[0,1,0]},
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
  // The box's eight corners on screen (w wide, h high, d deep).
  function corners(rx,ry,z,w,h,d,perspective,cx,cy){
    const out=[];
    for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
      const p=rotate([sx*w/2,sy*h/2,sz*d/2],rx,ry);const k=perspective/(perspective-(p[2]+z));
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
    return Math.round(Math.max(0,Math.min(0.32,(0.85-light)*0.3))*100)/100;
  }
  const PERSPECTIVE=2.6;
  // As close as the cube can come at this angle and still fit the window: large enough to use when held.
  function fitZ(rx,ry,size,width=size,height=size,margin=0.015){
    const perspective=PERSPECTIVE*Math.max(width,height);const pad=Math.min(width,height)*margin;
    const fits=(z)=>corners(rx,ry,z,size,size,size,perspective,width/2,height/2).every(([x,y])=>x>=pad&&x<=width-pad&&y>=pad&&y<=height-pad);
    let z=-size/2;for(let i=0;i<160&&!fits(z);i++)z-=size*0.03;
    return z;
  }
  const helpers={ring,order,sides,near,neighbour,faceOfTab,faceOfDashboard,corners,hull,shade,fitZ,PERSPECTIVE};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement,body=document.body;
  const host=window.chrome&&window.chrome.webview;
  const main=document.querySelector('main.shell');if(!main)return;
  const post=(message)=>{if(host)host.postMessage(message);};
  const names={changes:t('Changes'),history:t('History'),branches:t('Branches'),stash:t('Stashes and tags'),today:t('Today'),repos:t('Repositories')};
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};

  // ---- the box --------------------------------------------------------------------------------------
  const stage=el('div','gd-box-stage');const cube=el('div','gd-box-cube');const real=el('div','gd-box-real');stage.append(cube);
  const realShade=el('i','gd-box-shade');real.append(realShade);
  const faces={};
  for(const id of order){
    const side=el('div','gd-box-side');side.dataset.face=id;side.style.transform=sides[id].place;
    side.append(el('div','gd-box-side-body'),el('i','gd-box-shade'));cube.append(side);faces[id]=side;
  }
  cube.append(real);
  const badge=button('','gd-box-small-open');badge.setAttribute('aria-label',t('Open Git Deck'));

  let mounted=false,mode='work',face='changes',last='changes',maxed=false;
  let pose={rx:0,ry:0,z:0,w:0,h:0},frame=0;
  const W=()=>innerWidth,H=()=>innerHeight;
  const size=()=>Math.min(W(),H());
  const perspective=()=>PERSPECTIVE*Math.max(W(),H());
  // Working: the box has the window's shape. Held: a true cube, as large as fits.
  const workPose=(id,fromRy)=>({...angleOf(id,fromRy),z:sides[id].rx!==undefined?-H()/2:-W()/2,w:W(),h:H()});
  const holdPose=(id,fromRy,margin)=>{const a=angleOf(id,fromRy);const rx=sides[id].rx!==undefined?a.rx+24:-24,ry=a.ry-34;return {rx,ry,z:fitZ(rx,ry,size(),W(),H(),margin),w:size(),h:size()};};
  const flatNow=()=>body.classList.contains('gd-box-flat');
  function setFlat(on){body.classList.toggle('gd-box-flat',on);if(on){cube.style.transform='';real.style.transform='';}}

  // ---- drawing --------------------------------------------------------------------------------------
  let lastRegion=0;
  function region(force){
    if(!host||maxed)return;
    const now=performance.now();if(!force&&now-lastRegion<30)return;lastRegion=now;
    const points=hull(corners(pose.rx,pose.ry,pose.z,pose.w,pose.h,pose.w,perspective(),W()/2,H()/2));
    post(`box:poly:${points.map(p=>`${Math.round(Math.max(0,Math.min(innerWidth,p[0]))*10)/10},${Math.round(Math.max(0,Math.min(innerHeight,p[1]))*10)/10}`).join(',')}`);
  }
  function draw(force){
    stage.style.setProperty('--box-w',`${pose.w}px`);stage.style.setProperty('--box-h',`${pose.h}px`);
    cube.style.transform=`translateZ(${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg)`;
    // The real side keeps its layout; on the cube it is shown whole, scaled to fit.
    real.style.transform=`${sides[face].place} translateZ(1px) scale(${Math.min(pose.w/W(),pose.h/H())})`;
    for(const id of order){const value=String(shade(sides[id].n,pose.rx,pose.ry));faces[id].lastChild.style.opacity=value;if(id===face)realShade.style.opacity=value;}
    region(force);
  }
  function tween(to,{ms=460,dip=0,done}={}){
    cancelAnimationFrame(frame);
    const from={...pose};
    if(still()||ms===0||document.hidden){pose={...to};draw(true);done?.();return;}
    const start=performance.now();
    const step=(now)=>{
      const k=Math.min(1,(now-start)/ms);const e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
      pose={rx:from.rx+(to.rx-from.rx)*e,ry:from.ry+(to.ry-from.ry)*e,z:from.z+(to.z-from.z)*e-dip*Math.sin(Math.PI*k),w:from.w+(to.w-from.w)*e,h:from.h+(to.h-from.h)*e};
      draw(k===1);
      if(k<1)frame=requestAnimationFrame(step);else{pose={...to};done?.();}
    };
    frame=requestAnimationFrame(step);
  }
  const angleOf=(id,fromRy)=>sides[id].rx!==undefined?{rx:sides[id].rx,ry:near(fromRy,0)}:{rx:0,ry:near(fromRy,sides[id].ry)};
  function placeReal(id){
    real.dataset.face=id;
    for(const key of order)faces[key].classList.toggle('is-real',key===id);
  }
  function settle(){setFlat(true);if(mode==='work')post('box:round');drawNav();}

  // ---- what each side knows and can do --------------------------------------------------------------------
  const ws=()=>(typeof state!=='undefined'&&state.workspaceRepo)?state.workspace:null;
  const repos=()=>(typeof state!=='undefined'?state.repos||[]:[]).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));
  const needing=()=>repos().filter(repo=>Number(repo.changes)>0||Number(repo.behind)>0||Number(repo.ahead)>0);
  const base=(path)=>String(path).split(/[\\/]/).pop();
  // The side has just opened and may still be drawing: wait for the row, and click it once the list has settled.
  const clickIn=(selector)=>{let tries=0;const go=()=>{const node=document.querySelector(selector);if(!node){if(tries++<30)setTimeout(go,120);return;}setTimeout(()=>{const fresh=document.querySelector(selector)||node;fresh.click();fresh.scrollIntoView?.({block:'nearest'});},350);};setTimeout(go,150);};
  // A commit from the side: its row, after widening the history to all branches if it is filtered to one.
  const showCommit=(commit)=>{
    const rowOf=()=>document.querySelector(`.commit-row[data-commit="${commit.fullHash}"]`);
    const pick=(row)=>{row.click();row.scrollIntoView?.({block:'nearest'});};
    setTimeout(()=>{
      const row=rowOf();if(row){pick(row);return;}
      const filter=[...document.querySelectorAll('#workspace-content select')].find(node=>[...node.options].some(option=>/all branches/i.test(option.textContent)));
      if(!filter)return;filter.value=[...filter.options].find(option=>/all branches/i.test(option.textContent)).value;filter.dispatchEvent(new Event('change',{bubbles:true}));
      let tries=0;const again=()=>{const found=rowOf();if(found)pick(found);else if(tries++<25)setTimeout(again,160);};again();
    },500);
  };
  const focusIn=(selector)=>{let tries=0;const go=()=>{const node=document.querySelector(selector);if(node)node.focus();else if(tries++<25)setTimeout(go,120);};go();};
  const sync=(action)=>{
    if(typeof runWorkspaceAction!=='function')return;
    if(action==='fetch')runWorkspaceAction('fetch');
    else if(action==='pull')runWorkspaceAction('pull',{strategy:state.meta.pullStrategy},typeof syncConfirmation==='function'?syncConfirmation('pull'):'Pull?');
    else runWorkspaceAction('push',{},typeof syncConfirmation==='function'?syncConfirmation('push'):'Push?');
  };
  const openRepo=(repo,side='changes')=>{if(typeof openWorkspace==='function')void openWorkspace(repo,side==='changes'?'changes':'history');enter(side);};
  function sideData(id){
    const w=ws();const up=w?.sync||{};
    switch(id){
      case 'changes':return {count:(w?.files||[]).length,
        actions:w?[{label:t('Commit'),primary:(w.files||[]).length>0,run:()=>enter('changes',()=>focusIn('#workspace-content textarea'))}]:[],
        rows:(w?.files||[]).slice(0,14).map(f=>({text:base(f.path),meta:String(f.status||'').trim(),run:()=>enter('changes',()=>clickIn(`.commit-file-main[data-path="${CSS.escape(f.path)}"]`))}))};
      case 'history':return {count:0,actions:[],rows:(w?.history||[]).slice(0,14).map(c=>({text:c.subject,meta:c.hash,run:()=>enter('history',()=>showCommit(c))}))};
      case 'branches':return {count:0,actions:w?[{label:t('New branch'),run:()=>enter('branches',()=>clickIn('#toolbar-create-branch'))}]:[],
        rows:w?[{text:w.branch||'',meta:t('current'),run:()=>enter('branches')},...(w.branches||[]).filter(b=>!b.current).slice(0,13).map(b=>({text:b.name,meta:'',run:()=>enter('branches')}))]:[]};
      case 'stash':return {count:(w?.stashes||[]).length,actions:[],
        rows:w?[...(w.stashes||[]).slice(0,6).map(s=>({text:s.message||s.ref,meta:'',run:()=>enter('stash')})),...(w.tags||[]).slice(0,8).map(tag=>{const name=typeof tag==='string'?tag:tag.name;return {text:name,meta:t('Tags'),run:()=>enter('stash',()=>selectWorkspaceTab?.('tags'))};})]:[]};
      case 'today':{const list=needing().sort((a,b)=>(Number(b.changes)||0)-(Number(a.changes)||0));return {count:list.length,
        actions:w?[{label:t('Fetch'),run:()=>sync('fetch')},{label:up.behind?t('Pull {count}',{count:up.behind}):t('Pull'),primary:Boolean(up.behind),run:()=>sync('pull')},{label:up.ahead?t('Push {count}',{count:up.ahead}):t('Push'),run:()=>sync('push')}]:[],
        rows:list.slice(0,14).map(repo=>({text:repo.name,meta:`${Number(repo.changes)>0?`● ${repo.changes} `:''}${Number(repo.behind)>0?`↓${repo.behind} `:''}${Number(repo.ahead)>0?`↑${repo.ahead}`:''}`.trim(),run:()=>openRepo(repo)}))};}
      case 'repos':{const open=(state.meta?.openRepos||[]).map(key=>(state.repos||[]).find(repo=>repoKey(repo)===key)).filter(Boolean);const rest=repos().filter(repo=>!open.includes(repo));return {count:repos().length,actions:[],
        rows:[...open,...rest].slice(0,14).map(repo=>({text:repo.name,meta:Number(repo.changes)>0?`● ${repo.changes}`:'',run:()=>openRepo(repo)}))};}
      default:return {count:0,actions:[],rows:[]};
    }
  }
  function fill(){
    const repo=ws()?state.workspaceRepo:null;
    for(const id of order){
      const data=sideData(id);const inner=faces[id].firstChild;
      const head=el('div','gd-box-side-head');const title=el('div','gd-box-side-title');
      title.append(el('small','',repo?`${repo.name} · ${ws()?.branch||''}`:'Git Deck'),el('strong','',names[id]));
      const actions=el('div','gd-box-side-actions');
      for(const action of data.actions){const node=button(action.label,action.primary?'is-primary':'');node.onclick=action.run;actions.append(node);}
      head.append(title,actions);
      const list=el('div','gd-box-side-rows');
      for(const row of data.rows){const node=button('');node.append(el('span','',row.text),el('small','',row.meta));node.title=row.text;node.onclick=row.run;list.append(node);}
      inner.replaceChildren(head,list);
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
  function setFace(id){if(ring.includes(id))last=id;face=id;placeReal(id);}

  // ---- turning ----------------------------------------------------------------------------------------
  let moving=false,queued='';
  function leaveFlat(){fill();setFlat(false);placeReal(face);pose=workPose(face,pose.ry);draw(true);}
  function turnTo(to){
    if(mode!=='work'||!to)return;
    if(moving){queued=to;return;}
    if(to===face&&flatNow()){open(to);drawNav();return;}
    moving=true;markNav(to);if(flatNow())leaveFlat();
    if(window.GitDeckAppearance?.sound==='on')window.GitDeckCubePlay?.click?.();
    tween(workPose(to,pose.ry),{dip:0.55*Math.max(W(),H()),done:()=>{
      setFace(to);open(to);pose=workPose(to,pose.ry);draw(true);moving=false;settle();
      if(queued){const next=queued;queued='';turnTo(next);}
    }});
  }
  const turn=(dir)=>turnTo(neighbour(face,last,dir));
  function hold(){
    if(mode==='small'){body.classList.remove('gd-box-small');post('box:on');mode='hold';setTimeout(()=>{fill();setFlat(false);placeReal(face);body.classList.add('gd-box-hold');pose=holdPose(face,0);draw(true);},120);return;}
    if(mode!=='work'||moving)return;
    moving=true;mode='hold';body.classList.add('gd-box-hold');
    if(flatNow())leaveFlat();
    tween(holdPose(face,pose.ry),{ms:520,done:()=>{moving=false;}});
  }
  function enter(id,after){
    if(mode!=='hold'){if(mode==='work'){turnTo(id);if(after)setTimeout(after,520);}return;}
    if(moving)return;moving=true;
    if(id!==face){setFace(id);open(id);}else open(id);
    body.classList.remove('gd-box-hold');mode='work';
    tween(workPose(id,pose.ry),{ms:520,done:()=>{moving=false;settle();after?.();}});
  }
  function putAway(){
    mode='small';setFlat(false);fill();body.classList.remove('gd-box-hold');body.classList.add('gd-box-small');
    drawBadge();post('box:small');
    setTimeout(()=>{pose=holdPose('changes',0,0.04);draw(true);},120);
  }
  function drawBadge(){const count=needing().length;badge.replaceChildren();if(count)badge.append(el('b','',String(count)));}
  // The small cube: a click opens it, a drag moves it.
  let badgeDrag=null;
  badge.addEventListener('pointerdown',(event)=>{badgeDrag={x:event.clientX,y:event.clientY,moved:false};});
  badge.addEventListener('pointermove',(event)=>{if(badgeDrag&&!badgeDrag.moved&&Math.abs(event.clientX-badgeDrag.x)+Math.abs(event.clientY-badgeDrag.y)>4){badgeDrag.moved=true;post('box:drag');}});
  badge.addEventListener('click',()=>{const moved=badgeDrag?.moved;badgeDrag=null;if(!moved)hold();});

  // Dragging the held cube; a click on a side flies into it; its buttons do their own thing.
  let drag=null;
  stage.addEventListener('pointerdown',(event)=>{if(mode!=='hold'||moving)return;drag={x:event.clientX,y:event.clientY,rx:pose.rx,ry:pose.ry,id:event.pointerId,moved:false};});
  stage.addEventListener('pointermove',(event)=>{
    if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.abs(dx)+Math.abs(dy)>5){drag.moved=true;try{stage.setPointerCapture(drag.id);}catch{}}
    if(drag.moved){const ry=drag.ry+dx*.4,rx=Math.max(-85,Math.min(85,drag.rx-dy*.4));pose={...pose,rx,ry,z:fitZ(rx,ry,size(),W(),H())};draw(false);}
  });
  stage.addEventListener('pointerup',(event)=>{
    if(!drag)return;const moved=drag.moved;drag=null;if(moved){draw(true);return;}
    if(event.target.closest?.('button'))return;
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('[data-face]');if(hit)enter(hit.dataset.face);
  });

  // ---- the side bar: where you are, what waits, one click to anywhere ----------------------------------------
  const nav=el('nav','gd-box-nav');nav.setAttribute('aria-label',t('Sides of the cube'));
  const mini=button('','gd-box-mini');mini.title=t('Hold the cube (Ctrl+Alt+0)');mini.setAttribute('aria-label',mini.title);mini.onclick=()=>hold();
  const miniCube=el('span','gd-box-mini-cube');for(const id of order){const part=el('i');part.style.transform=sides[id].place.replace(/translateZ\(.*\)$/,'translateZ(10px)');part.dataset.face=id;miniCube.append(part);}mini.append(miniCube);
  nav.append(mini);
  // The empty part of the bar moves the window (snapping included); a double click maximizes.
  nav.addEventListener('pointerdown',(event)=>{if(event.target===nav&&event.button===0&&!maxed){event.preventDefault();post('box:drag');}});
  nav.addEventListener('dblclick',(event)=>{if(event.target===nav)post('window:maximize');});
  const navButtons={};
  order.forEach((id,index)=>{
    const node=button('','gd-box-nav-side');node.title=`${names[id]} (Ctrl+Alt+${index+1})`;node.append(el('i','gd-box-nav-icon'),el('span','',names[id]),el('b'));node.onclick=()=>turnTo(id);navButtons[id]=node;nav.append(node);
  });
  const subBar=el('span','gd-box-sub');
  for(const [tab,label] of [['stashes',t('Stashes')],['tags',t('Tags')]]){const node=button(label);node.dataset.tab=tab;node.onclick=()=>{if(typeof selectWorkspaceTab==='function')selectWorkspaceTab(tab);};subBar.append(node);}
  nav.append(subBar);
  const moreViews=document.createElement('details');moreViews.className='gd-box-more';
  const moreSummary=document.createElement('summary');moreSummary.textContent=t('More views');const moreList=el('div','gd-box-more-list');
  moreViews.append(moreSummary,moreList);nav.append(moreViews);
  function drawMore(){
    // Everything the side rail offers beyond the six sides; the rail's own buttons do the work.
    const skip=new Set(['changes','history','branches','stashes','tags','repos']);
    moreList.replaceChildren();
    for(const item of document.querySelectorAll('.modern-rail .modern-rail-item')){
      if(skip.has(item.dataset.tab))continue;
      const label=item.querySelector('.modern-rail-label')?.textContent||item.textContent.trim();
      const node=button(label);node.onclick=()=>{moreViews.removeAttribute('open');item.click();};moreList.append(node);
    }
    const repos_=button(t('Repository list'));repos_.onclick=()=>{moreViews.removeAttribute('open');document.querySelector('.modern-rail-item[data-tab="repos"]')?.click();};moreList.prepend(repos_);
    const place=(label,run)=>{const node=button(label);node.onclick=()=>{moreViews.removeAttribute('open');run();};moreList.append(node);};
    if(docked)place(t('Back to normal size'),undock);else{place(t('Beside other windows: right'),()=>dock('right'));place(t('Beside other windows: left'),()=>dock('left'));}
    place(t('Full window'),()=>post('window:maximize'));
  }
  moreSummary.addEventListener('click',drawMore);
  document.addEventListener('click',(event)=>{if(!moreViews.contains(event.target))moreViews.removeAttribute('open');});
  let docked=false;
  function dock(side){docked=true;post(`box:dock:${side}`);drawDock();}
  function undock(){docked=false;post('box:undock');drawDock();}
  const dockButton=button('','gd-box-dock');dockButton.onclick=()=>{if(docked)undock();else dock('right');};
  function drawDock(){const title=docked?t('Back to normal size (Ctrl+Alt+D)'):t('Keep beside other windows (Ctrl+Alt+D)');dockButton.title=title;dockButton.setAttribute('aria-label',title);dockButton.classList.toggle('is-docked',docked);}
  dockButton.innerHTML='<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><rect x="1.5" y="2" width="9" height="8" rx="1.2"/><path d="M7.5 2v8"/></svg>';
  drawDock();
  function markNav(id){for(const key of order)navButtons[key].classList.toggle('is-here',key===id);}
  // Each side's icon, the same ones the side rail uses, so a slim bar can show icons alone.
  function navIcons(){
    const source={changes:'.modern-rail-item[data-tab="changes"] svg',history:'.modern-rail-item[data-tab="history"] svg',branches:'.modern-rail-item[data-tab="branches"] svg',stash:'.modern-rail-item[data-tab="stashes"] svg',today:'#dashboard-button svg',repos:'.modern-rail-item[data-tab="repos"] svg'};
    for(const id of order){const holder=navButtons[id].querySelector('.gd-box-nav-icon');if(holder.firstChild)continue;const icon=document.querySelector(source[id]);if(icon)holder.append(icon.cloneNode(true));}
  }
  function drawNav(){
    navIcons();
    const here=currentFace()||'';markNav(here||(moving?face:''));
    for(const id of order){
      const count=sideData(id).count;const pill=navButtons[id].lastChild;const text=count?String(count):'';if(pill.textContent!==text)pill.textContent=text;
      navButtons[id].classList.toggle('has-work',Boolean(count)&&(id==='changes'||id==='today'));
    }
    subBar.hidden=face!=='stash'||!here;
    for(const node of subBar.children)node.setAttribute('aria-pressed',String(typeof state!=='undefined'&&state.workspaceTab===node.dataset.tab));
    const a=angleOf(face,0);miniCube.style.transform=`rotateX(${(a.rx||0)-18}deg) rotateY(${a.ry-28}deg)`;
    for(const part of miniCube.children)part.classList.toggle('is-here',part.dataset.face===face);
  }

  // ---- resizing: every edge and corner grabs, as in any window ------------------------------------------------
  const grips=Object.entries({n:12,s:15,w:10,e:11,nw:13,ne:14,sw:16,se:17}).map(([name,code])=>{
    const grip=el('i',`gd-box-grip gd-box-grip-${name}`);grip.addEventListener('pointerdown',(event)=>{if(event.button===0){event.preventDefault();post(`box:size:${code}`);}});return grip;
  });

  // ---- keys ---------------------------------------------------------------------------------------
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(!mounted||mode==='small')return;
    if(event.ctrlKey&&event.altKey&&!event.shiftKey&&!typing(event.target)){
      if(event.code==='KeyD'){event.preventDefault();event.stopImmediatePropagation();if(docked)undock();else dock('right');return;}
      const dir={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];
      if(dir&&mode==='work'){event.preventDefault();event.stopImmediatePropagation();turn(dir);return;}
      const digit=/^Digit([0-6])$/.exec(event.code);
      if(digit){event.preventDefault();event.stopImmediatePropagation();if(digit[1]==='0'){if(mode==='work')hold();else enter(face);}else if(mode==='work')turnTo(order[Number(digit[1])-1]);else enter(order[Number(digit[1])-1]);}
      return;
    }
    if(event.key==='Escape'&&mode==='hold'&&!typing(event.target)){event.preventDefault();enter(face);}
  },true);

  // ---- window messages, mounting and keeping up -------------------------------------------------------------
  function setMaxed(on){maxed=on;body.classList.toggle('gd-box-max',on);if(!on&&mode==='work'&&flatNow())post('box:round');}
  host?.addEventListener?.('message',(event)=>{if(!mounted)return;if(event.data==='window:maximized')setMaxed(true);else if(event.data==='window:restored')setMaxed(false);});
  function resize(){
    if(!mounted)return;stage.style.setProperty('--box-size',`${size()}px`);stage.style.perspective=`${perspective()}px`;
    body.classList.toggle('gd-box-narrow',W()<1100);body.classList.toggle('gd-box-slim',W()<720);
    if(mode==='work'){pose=workPose(face,pose.ry);if(!flatNow())draw(true);}
    else if(mode==='hold'||mode==='small'){pose={...pose,w:size(),h:size(),z:fitZ(pose.rx,pose.ry,size(),W(),H(),mode==='small'?0.04:0.015)};draw(true);}
  }
  function controls(){
    const bar=document.querySelector('.gd-window-controls');const minimize=bar?.querySelector('.gd-win-minimize');
    if(minimize&&!minimize.dataset.box){minimize.dataset.box='1';minimize.addEventListener('click',(event)=>{if(!mounted)return;event.stopImmediatePropagation();putAway();},true);}
    if(bar&&dockButton.parentElement!==bar)bar.prepend(dockButton);
    const title=t('Put the cube away');if(minimize&&mounted&&minimize.title!==title){minimize.title=title;minimize.setAttribute('aria-label',title);}
    const head=document.querySelector('.workspace-modal-head');if(head&&nav.previousElementSibling!==head)head.after(nav);
  }
  function mount(){
    if(mounted)return;mounted=true;mode='work';
    main.before(stage);real.prepend(main);body.append(badge,...grips);body.classList.add('gd-box-on');controls();
    setFace(currentFace()||'changes');resize();setFlat(true);post('box:on');drawNav();setTimeout(()=>{resize();post('box:round');},200);
  }
  function unmount(){
    if(!mounted)return;mounted=false;cancelAnimationFrame(frame);stage.before(main);stage.remove();badge.remove();nav.remove();for(const grip of grips)grip.remove();
    dockButton.remove();body.classList.remove('gd-box-on','gd-box-flat','gd-box-hold','gd-box-small','gd-box-max','gd-box-narrow','gd-box-slim');post('box:off');
  }
  const preview=()=>{try{return localStorage.getItem('gitdeck.boxPreview')==='true';}catch{return false;}};
  const wanted=()=>root.classList.contains('gd-box')&&root.classList.contains('ui-modern')&&(Boolean(host)||preview());
  function syncMount(){if(wanted())mount();else unmount();}
  window.addEventListener('resize',resize);document.addEventListener('gitdeck:appearance',syncMount);
  setInterval(()=>{
    if(document.hidden||!mounted)return;controls();
    if(mode==='work'&&!moving&&flatNow()){const id=currentFace();if(id&&id!==face)setFace(id);drawNav();}
    if(mode==='small')drawBadge();
  },500);
  syncMount();
  window.GitDeckCubeBox={...helpers,turn,turnTo,hold,enter,putAway,sideData,mode:()=>mode,face:()=>face,pose:()=>({...pose})};
})();
