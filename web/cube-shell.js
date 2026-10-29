'use strict';
// Cube shell (Rubik shape, theme menu › Layout › Cube face): the workspace is one face of the cube.
// - The face is a 3x3 grid of stickers. The centre sticker is the view you work in (the real view, full
//   size); the 8 around it are live mini views of the others (files to commit, latest commits, branches…).
// - Twist a row or a column with the arrows on the edge (or Ctrl+Alt+Shift+arrows on the centre's row and
//   column): the stickers slide like a Rubik's layer and whatever lands in the centre opens there.
//   Clicking a mini view brings it to the centre.
// - Zoom out (the cube button, or Esc when nothing else is open) shows the whole cube: six faces you can
//   turn; click a face to fly into it.
// - Git moves are twists: after a commit the centre turns a quarter, a pull drops the top row in, a push
//   lifts it out, a stash pops the centre to the corner, a merge closes the side columns.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const views=['changes','history','branches','stashes','tags','compare','conflicts','recovery','remotes'];
  // Start face: Changes in the centre (cell 4).
  const startCells=()=>['history','branches','stashes','tags','changes','compare','conflicts','recovery','remotes'];
  // Twist one row (kind 'row') or column ('col') of the 3x3 cells by one place (dir 1: right/down, -1: left/up).
  function twist(cells,kind,index,dir){
    const line=kind==='row'?[index*3,index*3+1,index*3+2]:[index,index+3,index+6];
    const values=line.map(i=>cells[i]);const moved=dir>0?[values[2],values[0],values[1]]:[values[1],values[2],values[0]];
    const next=cells.slice();line.forEach((i,k)=>{next[i]=moved[k];});return next;
  }
  // Bring a view to the centre by swapping it with whatever is there.
  function toCentre(cells,view){
    const at=cells.indexOf(view);if(at<0||at===4)return cells.slice();
    const next=cells.slice();next[at]=cells[4];next[4]=view;return next;
  }
  // A saved face is used only when it holds exactly the nine views.
  const validCells=(cells)=>Array.isArray(cells)&&cells.length===9&&views.every(v=>cells.includes(v));
  // Which twist animation a finished Git action plays.
  const moveFor=(action)=>({commit:'commit','commit-amend':'commit',pull:'pull','pull-ref':'pull',push:'push','push-selection':'push','stash-save':'stash','stash-pop':'unstash','stash-apply':'unstash',merge:'merge'})[action]||'';
  const helpers={views,startCells,twist,toCentre,validCells,moveFor};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement;const body=document.body;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  let layout=readJson('gitdeck.layout','cube');
  let cells=validCells(readJson('gitdeck.cubeCells',null))?readJson('gitdeck.cubeCells',null):startCells();
  const on=()=>layout==='cube'&&root.classList.contains('gd-rubik')&&root.classList.contains('ui-modern');
  const main=document.querySelector('.workbench-main');const content=document.getElementById('workspace-content');
  if(!main||!content)return;

  // ---- the face --------------------------------------------------------------------------------------
  const names={changes:t('Changes'),history:t('History'),branches:t('Branches'),stashes:t('Stashes'),tags:t('Tags'),compare:t('Compare'),conflicts:t('Conflicts'),recovery:t('Recovery'),remotes:t('Remotes')};
  const slots={changes:'red',history:'blue',branches:'orange',stashes:'yellow',tags:'white',compare:'green',conflicts:'red',recovery:'blue',remotes:'green'};
  const centre=el('div','gd-shell-centre');const handles=el('div','gd-shell-handles');handles.setAttribute('aria-hidden','false');
  const minis={};
  for(const view of views){
    const node=el('button','gd-mini');node.type='button';node.dataset.view=view;node.style.setProperty('--mini',`var(--st-${slots[view]})`);
    node.onclick=()=>bring(view);minis[view]=node;
  }
  const kids=[...main.children];
  function mount(){
    if(centre.isConnected)return;
    for(const kid of kids)centre.append(kid);
    main.append(centre,...Object.values(minis),handles);main.classList.add('gd-shell');body.classList.add('gd-cube-shell');
    // The view already open takes the centre.
    const open=typeof state!=='undefined'?state.workspaceTab:'';if(views.includes(open)&&cells[4]!==open){cells=toCentre(cells,open);writeJson('gitdeck.cubeCells',cells);}
    place(false);fill(true);
  }
  function unmount(){
    if(!centre.isConnected)return;
    for(const kid of kids)main.append(kid);
    centre.remove();handles.remove();for(const node of Object.values(minis))node.remove();
    main.classList.remove('gd-shell');body.classList.remove('gd-cube-shell');
  }
  const areas=['a','b','c','d','e','f','g','h','i'];
  // Put each mini in its cell; animate from where it was (FLIP) when asked.
  function place(animate){
    const before={};if(animate)for(const [view,node] of Object.entries(minis))if(node.isConnected)before[view]=node.getBoundingClientRect();
    cells.forEach((view,index)=>{const node=minis[view];node.style.gridArea=areas[index];node.dataset.cell=areas[index];node.hidden=index===4;node.classList.toggle('gd-mini-wide',index===3||index===5);node.classList.toggle('gd-mini-tall',index===1||index===7);});
    centre.style.setProperty('--centre',`var(--st-${slots[cells[4]]})`);
    if(!animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    for(const [view,node] of Object.entries(minis)){
      const old=before[view];if(!old||node.hidden)continue;const now=node.getBoundingClientRect();
      const dx=old.left-now.left,dy=old.top-now.top;if(!dx&&!dy)continue;
      node.animate([{transform:`translate(${dx}px, ${dy}px)`},{transform:'none'}],{duration:520,easing:'cubic-bezier(.65,0,.3,1)'});
    }
  }
  function commit(next,animate=true){
    const old=cells[4];cells=next;writeJson('gitdeck.cubeCells',cells);place(animate);fill(true);
    if(cells[4]!==old&&typeof selectWorkspaceTab==='function'&&typeof state!=='undefined'&&state.workspaceRepo)selectWorkspaceTab(cells[4]);
  }
  const bring=(view)=>commit(toCentre(cells,view));

  // Twist arrows on the edges.
  const arrows=[];
  for(let i=0;i<3;i++){
    for(const [kind,dir,icon,label] of [['row',-1,'◀',t('Twist row {n} left',{n:i+1})],['row',1,'▶',t('Twist row {n} right',{n:i+1})],['col',-1,'▲',t('Twist column {n} up',{n:i+1})],['col',1,'▼',t('Twist column {n} down',{n:i+1})]]){
      const button=el('button',`gd-twist gd-twist-${kind} gd-twist-${dir>0?'end':'start'}`,icon);button.type='button';button.title=label;button.setAttribute('aria-label',label);
      button.style.setProperty(kind==='row'?'--row':'--col',String(i+1));button.onclick=()=>commit(twist(cells,kind,i,dir));arrows.push(button);
    }
  }
  const zoomButton=el('button','gd-twist gd-zoom-out','⧉');zoomButton.type='button';zoomButton.title=t('Zoom out to the cube (Esc)');zoomButton.setAttribute('aria-label',zoomButton.title);zoomButton.onclick=()=>zoomOut();
  handles.append(...arrows,zoomButton);

  // ---- live mini views ----------------------------------------------------------------------------
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
      case 'conflicts':{const list=w.operation?.conflicts||[];return {count:list.length,rows:list.length?list.slice(0,5).map(f=>line(String(f.path||f).split('/').pop(),'','var(--st-red)')):[line(w.operation?.active?t('{type} in progress',{type:w.operation.type}):t('No conflicts'),'','var(--st-green)')]};}
      case 'recovery':return {count:0,rows:[line(t('Undo recent operations'),'','var(--st-blue)'),line(t('Find lost commits in the reflog'),'','var(--st-blue)')]};
      case 'remotes':return {count:(w.remotes||[]).length,rows:(w.remotes||[]).slice(0,4).map(r=>line(r.name,String(r.fetchUrl||'').replace(/^https?:\/\//,'').slice(0,40),'var(--st-green)'))};
      default:return {count:0,rows:[]};
    }
  }
  let lastKey='';
  function fill(force){
    if(!centre.isConnected)return;
    // A view opened another way (start-up restore, repository tabs) still takes the centre.
    const open=typeof state!=='undefined'?state.workspaceTab:'';
    if(views.includes(open)&&cells[4]!==open){cells=toCentre(cells,open);writeJson('gitdeck.cubeCells',cells);place(false);}
    const w=(typeof state!=='undefined'&&state.workspace)||null;
    const key=w?[cells.join(),(w.files||[]).length,(w.history||[])[0]?.hash,(w.branches||[]).length,(w.stashes||[]).length,(w.tags||[]).length,w.sync?.ahead,w.sync?.behind,w.operation?.active,state.workspaceRepo?.path].join('|'):'none';
    if(!force&&key===lastKey)return;lastKey=key;
    for(const view of views){
      const node=minis[view];const data=w?rowsFor(view,w):{count:0,rows:[]};
      const head=el('span','gd-mini-head');head.append(el('i','gd-mini-chip'),el('b','',names[view]));if(data.count)head.append(el('small','gd-mini-count',String(data.count)));
      const list=el('span','gd-mini-lines');list.append(...data.rows);
      node.replaceChildren(head,list);node.title=t('Bring {view} to the centre',{view:names[view]});
    }
  }

  // Follow views opened elsewhere (Ctrl+K, links): bring them to the centre without a slide.
  if(typeof selectWorkspaceTab==='function'){
    const base=selectWorkspaceTab;
    selectWorkspaceTab=function(tab,...rest){
      if(on()&&views.includes(tab)&&cells[4]!==tab){cells=toCentre(cells,tab);writeJson('gitdeck.cubeCells',cells);place(true);fill(true);}
      return base.call(this,tab,...rest);
    };
  }

  // ---- zoom out: the whole cube ---------------------------------------------------------------------------
  let room=null;
  function zoomOut(){
    if(!on()||room)return;
    room=el('div','gd-cube-zoom');room.setAttribute('role','dialog');room.setAttribute('aria-label',t('The cube'));
    const stage=el('div','gd-cz-stage');const cube=el('div','gd-cz-cube');stage.append(cube);
    const faces=['changes','history','branches','stashes','tags','compare'];const places=['translateZ(var(--cz))','rotateY(90deg) translateZ(var(--cz))','rotateY(180deg) translateZ(var(--cz))','rotateY(-90deg) translateZ(var(--cz))','rotateX(90deg) translateZ(var(--cz))','rotateX(-90deg) translateZ(var(--cz))'];
    const angles=[[0,0],[0,-90],[0,-180],[0,90],[-90,0],[90,0]];
    let rx=-20,ry=-30;const show=()=>{cube.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;};
    const w=(typeof state!=='undefined'&&state.workspace)||null;
    faces.forEach((view,index)=>{
      const face=el('button','gd-cz-face');face.type='button';face.style.transform=places[index];face.style.setProperty('--mini',`var(--st-${slots[view]})`);
      const data=w?rowsFor(view,w):{count:0,rows:[]};
      const head=el('span','gd-mini-head');head.append(el('i','gd-mini-chip'),el('b','',names[view]));if(data.count)head.append(el('small','gd-mini-count',String(data.count)));
      const list=el('span','gd-mini-lines');list.append(...data.rows);
      // A real 3x3 face: the view's content on the centre sticker, the other views' colours around it.
      const others=views.filter(v=>v!==view);const ring=[0,1,2,3,null,4,5,6,7];
      for(const k of ring){
        if(k===null){const middle=el('span','gd-cz-centre');middle.append(head,list);face.append(middle);continue;}
        const sticker=el('i','gd-cz-sticker');sticker.style.background=`var(--st-${slots[others[k]]})`;face.append(sticker);
      }
      face.onclick=()=>{[rx,ry]=angles[index];cube.style.transition='transform .5s cubic-bezier(.65,0,.3,1)';show();room.classList.add('gd-cz-fly');setTimeout(()=>{closeZoom();bring(view);},520);};
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
    if(event.key==='Escape'&&!typing(event.target)&&!busy()&&!event.defaultPrevented){event.preventDefault();zoomOut();return;}
    // Ctrl+Alt+Shift+arrows twist the centre's row (left/right) or column (up/down).
    if(event.ctrlKey&&event.altKey&&event.shiftKey&&!typing(event.target)){
      const map={ArrowLeft:['row',-1],ArrowRight:['row',1],ArrowUp:['col',-1],ArrowDown:['col',1]}[event.key];
      if(map){event.preventDefault();commit(twist(cells,map[0],1,map[1]));}
    }
  });

  // ---- git moves are twists ----------------------------------------------------------------------------
  function play(move){
    if(!move||!centre.isConnected||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    main.classList.remove(...[...main.classList].filter(name=>name.startsWith('gd-move-')));void main.offsetWidth;
    main.classList.add(`gd-move-${move}`);setTimeout(()=>main.classList.remove(`gd-move-${move}`),900);
    document.dispatchEvent(new CustomEvent('gitdeck:turn',{detail:{move}}));
  }
  if(typeof runWorkspaceAction==='function'){
    const base=runWorkspaceAction;
    runWorkspaceAction=async function(action,...rest){const result=await base.call(this,action,...rest);if(result&&on())play(moveFor(action));return result;};
  }

  // ---- layout choice (theme menu) and keeping it in step ------------------------------------------------
  function sync(){if(on())mount();else unmount();fill(false);}
  function addPicker(menu){
    if(menu.querySelector('.layout-choice'))return;
    const block=el('div','look-choice layout-choice');block.append(el('strong','',t('Layout')));
    for(const [value,label,title] of [['cube',t('Cube face'),t('The workspace is a 3x3 cube face: twist rows and columns, the centre is where you work')],['classic',t('Classic'),t('Side rail, branch tree and one view')]]){
      const button=el('button','',label);button.type='button';button.title=title;button.dataset.layout=value;button.setAttribute('aria-pressed',String(layout===value));
      button.onclick=()=>{layout=value;writeJson('gitdeck.layout',value);document.querySelectorAll('[data-layout]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.layout===layout)));sync();};
      block.append(button);
    }
    menu.append(block);
  }
  document.querySelectorAll('.theme-menu').forEach(addPicker);
  document.addEventListener('gitdeck:appearance',sync);
  setInterval(()=>{if(!document.hidden)fill(false);},900);
  sync();
  window.GitDeckCubeShell={...helpers,get cells(){return cells.slice();},bring,play,zoomOut,closeZoom,sync};
})();
