'use strict';
// The living cube (Rubik shape, theme menu › Layout › Cube): the whole program is a Rubik's cube.
// - The window is the cube's front face, printed on nine stickers: plastic grooves split it 3x3 while
//   it stays flat, so text stays sharp and every control works as before.
// - Beyond its top and right edges the cube's top and right faces recede in real 3D (perspective from
//   above right): the top face shows today, the right face the next view, both live.
// - Changing view twists the cube: the three rows of stickers turn away one after the other and the new
//   view is underneath. Git moves twist too: a commit turns the middle row, a pull turns the top row
//   down, a push turns it up, a stash turns the middle column, a merge turns both side columns.
// - Zoom out (the ⧉ button in the status bar, or Esc when nothing else is open): the whole cube, each
//   face a real 3x3 face with its view on the centre sticker; drag to turn, click a face to fly into it.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const views=['changes','history','branches','stashes','tags','compare'];
  // The view on the right face: the next one round the cube.
  const nextView=(view)=>views[(Math.max(0,views.indexOf(view))+1)%views.length];
  // Which slices a finished Git action twists: [kind, index, axis, direction].
  const movesFor=(action)=>({
    commit:[['row',1,'y',-1]],'commit-amend':[['row',1,'y',-1]],
    pull:[['row',0,'x',1]],'pull-ref':[['row',0,'x',1]],
    push:[['row',0,'x',-1]],'push-selection':[['row',0,'x',-1]],
    'stash-save':[['col',1,'x',1]],'stash-pop':[['col',1,'x',-1]],'stash-apply':[['col',1,'x',-1]],
    merge:[['col',0,'x',1],['col',2,'x',-1]],
  })[action]||[];
  // clip-path inset for one row or column of a 3x3 face (in %).
  function slice(kind,index){
    const a=`${(index*100/3).toFixed(3)}%`,b=`${((2-index)*100/3).toFixed(3)}%`;
    return kind==='row'?`inset(${a} 0 ${b} 0)`:`inset(0 ${b} 0 ${a})`;
  }
  const helpers={views,nextView,movesFor,slice};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement;const body=document.body;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  let layout=readJson('gitdeck.layout','cube');if(layout!=='classic')layout='cube';
  const on=()=>layout==='cube'&&root.classList.contains('gd-rubik')&&root.classList.contains('ui-modern');
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const front=document.getElementById('workspace-backdrop');const modal=front?.querySelector('.workspace-modal');
  if(!front||!modal)return;

  const names={changes:t('Changes'),history:t('History'),branches:t('Branches'),stashes:t('Stashes'),tags:t('Tags'),compare:t('Compare'),today:t('Today')};
  const slots={changes:'red',history:'blue',branches:'orange',stashes:'yellow',tags:'white',compare:'green',today:'green'};

  // ---- live content for side faces and the zoomed-out cube ---------------------------------------------
  const line=(text,meta='',tone='')=>{const row=el('span','gd-mini-line');if(tone)row.style.setProperty('--tone',tone);row.append(el('span','',text));if(meta)row.append(el('small','',meta));return row;};
  function rowsFor(view,w){
    const sync=w.sync||{};const files=w.files||[];
    switch(view){
      case 'changes':return {count:files.length,rows:files.length?files.slice(0,6).map(f=>line(String(f.path).split('/').pop(),String(f.status||'').trim(),'var(--st-yellow)')):[line(t('Working tree clean'),'','var(--st-green)')]};
      case 'history':return {count:(w.history||[]).length,rows:(w.history||[]).slice(0,6).map(c=>line(c.subject||'',c.hash||'','var(--st-blue)'))};
      case 'branches':{const list=(w.branches||[]).slice().sort((a,b)=>Number(b.current)-Number(a.current));return {count:list.length,rows:list.slice(0,6).map(b=>line(b.name,b.current?t('current'):[b.ahead?`↑${b.ahead}`:'',b.behind?`↓${b.behind}`:''].join(' ').trim(),b.current?'var(--st-green)':'var(--st-orange)'))};}
      case 'stashes':return {count:(w.stashes||[]).length,rows:(w.stashes||[]).length?(w.stashes||[]).slice(0,5).map(s=>line(s.message||s.subject||s.name||String(s),'','var(--st-yellow)')):[line(t('No stashes'),'')]};
      case 'tags':{const tags=(w.tagDetails||(w.tags||[]).map(name=>({name})));return {count:tags.length,rows:tags.length?tags.slice(0,6).map(tag=>line(tag.name,String(tag.date||'').slice(0,10),'var(--st-white)')):[line(t('No tags'),'')]};}
      case 'compare':return {count:(sync.ahead||0)+(sync.behind||0),rows:[line(sync.upstream||t('No upstream'),'','var(--st-green)'),line(t('{count} only here',{count:sync.ahead||0}),'↑','var(--st-white)'),line(t('{count} only on the remote',{count:sync.behind||0}),'↓','var(--st-blue)')]};
      case 'today':{const parts=window.GitDeckFlow?.sentence?.({branch:w.branch,files:files.length,ahead:sync.ahead,behind:sync.behind,upstream:sync.upstream})||[];return {count:0,rows:parts.map(p=>line(p.text,'',p.kind==='work'?'var(--st-yellow)':p.kind==='pull'?'var(--st-blue)':p.kind==='bad'?'var(--st-red)':'var(--st-green)'))};}
      default:return {count:0,rows:[]};
    }
  }
  function faceContent(view){
    const w=(typeof state!=='undefined'&&state.workspace)||null;const data=w?rowsFor(view,w):{count:0,rows:[]};
    const head=el('span','gd-mini-head');head.append(el('i','gd-mini-chip'),el('b','',names[view]));if(data.count)head.append(el('small','gd-mini-count',String(data.count)));
    const list=el('span','gd-mini-lines');list.append(...data.rows);return [head,list];
  }

  // ---- the cube body: grooves on the front, top and right faces --------------------------------------------
  // Nine sticker outlines: their spread shadows are the plastic grooves, their rounded corners the sticker edges.
  const stickerGrid=()=>{const grid=el('div','gd-lc-grooves');grid.setAttribute('aria-hidden','true');for(let i=0;i<9;i++)grid.append(el('i'));return grid;};
  const grooves=stickerGrid();
  const top=el('div','gd-lc-side gd-lc-top');const right=el('div','gd-lc-side gd-lc-right');
  for(const side of [top,right])side.setAttribute('aria-hidden','true');
  const zoomButton=el('button','gd-lc-zoom','⧉');zoomButton.type='button';zoomButton.title=t('Zoom out to the cube (Esc)');zoomButton.setAttribute('aria-label',zoomButton.title);zoomButton.onclick=()=>zoomOut();
  function mount(){
    if(top.isConnected)return;
    modal.append(grooves);front.append(top,right);body.classList.add('gd-living');measure();
    const bar=document.getElementById('workspace-statusbar');if(bar)bar.append(zoomButton);
    fill(true);
  }
  function unmount(){
    if(!top.isConnected)return;
    grooves.remove();top.remove();right.remove();zoomButton.remove();body.classList.remove('gd-living');
  }
  // The eye that sees the side faces sits above right of the window: the side faces need its size.
  const measure=()=>{const box=front.getBoundingClientRect();front.style.setProperty('--lc-w',`${Math.round(box.width)}px`);front.style.setProperty('--lc-h',`${Math.round(box.height)}px`);};
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(top.isConnected)measure();}).observe(front);
  let lastKey='';
  function fill(force){
    if(!top.isConnected)return;
    const w=(typeof state!=='undefined'&&state.workspace)||null;const current=typeof state!=='undefined'?state.workspaceTab:'';
    const key=w?[current,(w.files||[]).length,(w.history||[])[0]?.hash,(w.branches||[]).length,w.sync?.ahead,w.sync?.behind,state.workspaceRepo?.path].join('|'):'none';
    if(!force&&key===lastKey)return;lastKey=key;
    const next=nextView(current);
    top.style.setProperty('--mini',`var(--st-${slots.today})`);right.style.setProperty('--mini',`var(--st-${slots[next]})`);
    // A side face is a real Rubik face: eight colour stickers round a centre sticker with the live view.
    const ringFor=(view)=>views.filter(v=>v!==view).concat(['today','branches','history']).slice(0,8);
    const print=(face,view)=>{
      const others=ringFor(view);const cells=[];let k=0;
      for(let i=0;i<9;i++){
        if(i===4){const centre=el('div','gd-lc-centre');centre.append(...faceContent(view));cells.push(centre);continue;}
        const sticker=el('i','gd-lc-sticker');sticker.style.background=`var(--st-${slots[others[k++]]||'green'})`;cells.push(sticker);
      }
      face.replaceChildren(...cells);
    };
    print(top,'today');print(right,next);
  }

  // ---- twists: slices of the front face turn away ------------------------------------------------------
  // A static copy of the front face, cut into one slice, turned in 3D around the cube's centre.
  function sliceCopy(kind,index){
    const box=modal.getBoundingClientRect();
    const holder=el('div','gd-lc-slice');holder.style.cssText=`left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    const copy=modal.cloneNode(true);copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    copy.querySelectorAll('.gd-lc-zoom').forEach(node=>node.remove());
    copy.style.cssText=`position:absolute;inset:0;width:${box.width}px;height:${box.height}px;margin:0;pointer-events:none`;
    holder.style.clipPath=slice(kind,index);holder.style.transformOrigin=`50% 50% ${-Math.min(box.width,box.height)/2}px`;
    holder.append(copy);return holder;
  }
  const turnKey=(axis,dir,deg)=>axis==='y'?`rotateY(${dir*deg}deg)`:`rotateX(${dir*deg}deg)`;
  // Turn slices away (out) to reveal what is underneath, or all the way round (round) for Git moves.
  function twistSlices(moves,mode){
    if(!on()||still()||!modal.offsetParent||!moves.length)return 0;
    const stage=el('div','gd-lc-twist');body.append(stage);
    const length=mode==='out'?520:760,gapMs=mode==='out'?110:60;
    moves.forEach(([kind,index,axis,dir],k)=>{
      const holder=sliceCopy(kind,index);stage.append(holder);
      const frames=mode==='out'?[{transform:'perspective(2200px) rotateY(0deg)'},{transform:`perspective(2200px) ${turnKey(axis,dir,90)}`,opacity:.25}]
        :[{transform:'perspective(2200px) rotateY(0deg)',offset:0},{transform:`perspective(2200px) ${turnKey(axis,dir,90)}`,offset:.5},{transform:`perspective(2200px) ${turnKey(axis,-dir,90)}`,offset:.5001},{transform:'perspective(2200px) rotateY(0deg)',offset:1}];
      holder.animate(frames,{duration:length,delay:k*gapMs,easing:'cubic-bezier(.65,0,.3,1)',fill:'forwards'});
    });
    const total=length+(moves.length-1)*gapMs;
    setTimeout(()=>stage.remove(),total+40);
    document.dispatchEvent(new CustomEvent('gitdeck:turn',{detail:{moves}}));
    return total;
  }
  // Changing view: the three rows turn away, one after the other, and the new view is underneath.
  if(typeof selectWorkspaceTab==='function'){
    const base=selectWorkspaceTab;
    selectWorkspaceTab=function(tab,...rest){
      const from=typeof state!=='undefined'?state.workspaceTab:'';
      if(on()&&from&&from!==tab&&state.workspaceRepo&&!body.classList.contains('dashboard-page-open')){
        const dir=views.indexOf(tab)>=0&&views.indexOf(tab)<views.indexOf(from)?1:-1;
        twistSlices([['row',0,'y',dir],['row',1,'y',dir],['row',2,'y',dir]],'out');
      }
      const result=base.call(this,tab,...rest);fill(true);return result;
    };
  }
  // Git moves are twists, after the action succeeded.
  if(typeof runWorkspaceAction==='function'){
    const base=runWorkspaceAction;
    runWorkspaceAction=async function(action,...rest){const result=await base.call(this,action,...rest);if(result&&on())twistSlices(movesFor(action),'round');return result;};
  }

  // ---- zoom out: the whole cube -------------------------------------------------------------------------
  let room=null;
  function zoomOut(){
    if(!on()||room)return;
    room=el('div','gd-cube-zoom');room.setAttribute('role','dialog');room.setAttribute('aria-label',t('The cube'));
    const stage=el('div','gd-cz-stage');const cube=el('div','gd-cz-cube');stage.append(cube);
    const places=['translateZ(var(--cz))','rotateY(90deg) translateZ(var(--cz))','rotateY(180deg) translateZ(var(--cz))','rotateY(-90deg) translateZ(var(--cz))','rotateX(90deg) translateZ(var(--cz))','rotateX(-90deg) translateZ(var(--cz))'];
    const angles=[[0,0],[0,-90],[0,-180],[0,90],[-90,0],[90,0]];
    let rx=-20,ry=-30;const show=()=>{cube.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;};
    views.forEach((view,index)=>{
      const face=el('button','gd-cz-face');face.type='button';face.style.transform=places[index];face.style.setProperty('--mini',`var(--st-${slots[view]})`);
      const others=views.filter(v=>v!==view).concat(['today','compare','history']);const ring=[0,1,2,3,null,4,5,6,7];
      for(const k of ring){
        if(k===null){const middle=el('span','gd-cz-centre');middle.append(...faceContent(view));face.append(middle);continue;}
        const sticker=el('i','gd-cz-sticker');sticker.style.background=`var(--st-${slots[others[k]]||'green'})`;face.append(sticker);
      }
      face.onclick=()=>{[rx,ry]=angles[index];cube.style.transition='transform .5s cubic-bezier(.65,0,.3,1)';show();room.classList.add('gd-cz-fly');setTimeout(()=>{closeZoom();if(typeof selectWorkspaceTab==='function'&&state.workspaceRepo)selectWorkspaceTab(view);},520);};
      cube.append(face);
    });
    const hint=el('div','gd-cz-hint');hint.append(el('strong','',t('The cube')),el('small','',t('Drag to turn · click a face to fly into it · Esc to go back')));
    room.append(hint,stage);body.append(room);show();
    let drag=null;
    stage.addEventListener('pointerdown',(event)=>{drag={x:event.clientX,y:event.clientY,rx,ry,moved:false};});
    stage.addEventListener('pointermove',(event)=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4){drag.moved=true;try{stage.setPointerCapture(event.pointerId);}catch{}}if(!drag.moved)return;ry=drag.ry+dx*0.4;rx=Math.max(-90,Math.min(90,drag.rx-dy*0.4));cube.style.transition='none';show();});
    stage.addEventListener('pointerup',()=>{setTimeout(()=>{drag=null;},0);});
    stage.addEventListener('click',(event)=>{if(drag?.moved){event.stopPropagation();event.preventDefault();}},true);
    room.addEventListener('click',(event)=>{if(event.target===room)closeZoom();});
  }
  function closeZoom(){room?.remove();room=null;}
  const busy=()=>document.querySelector('dialog[open], #command-palette:not(.hidden), details[open], .gd-timeline')||body.classList.contains('dashboard-page-open')||body.classList.contains('gd-zen');
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(!on())return;
    if(event.key==='Escape'&&room){event.preventDefault();closeZoom();return;}
    if(event.key==='Escape'&&!typing(event.target)&&!busy()&&!event.defaultPrevented){event.preventDefault();zoomOut();}
  });

  // ---- layout choice (theme menu) ---------------------------------------------------------------------
  function sync(){if(on())mount();else unmount();fill(false);}
  function addPicker(menu){
    if(menu.querySelector('.layout-choice'))return;
    const block=el('div','look-choice layout-choice');block.append(el('strong','',t('Layout')));
    for(const [value,label,title] of [['cube',t('Cube'),t('The whole program is a Rubik\'s cube: the window is its front face, the top and right faces show other views')],['classic',t('Classic'),t('A flat window, as before')]]){
      const button=el('button','',label);button.type='button';button.title=title;button.dataset.layout=value;button.setAttribute('aria-pressed',String(layout===value));
      button.onclick=()=>{layout=value;writeJson('gitdeck.layout',value);document.querySelectorAll('[data-layout]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.layout===layout)));sync();};
      block.append(button);
    }
    menu.append(block);
  }
  document.querySelectorAll('.theme-menu').forEach(addPicker);
  document.addEventListener('gitdeck:appearance',sync);
  setInterval(()=>{if(!document.hidden)fill(false);},1000);
  sync();
  window.GitDeckCubeShell={...helpers,twistSlices,zoomOut,closeZoom,sync,active:on};
})();
