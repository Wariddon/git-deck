'use strict';
// Cube home (Rubik shape, theme menu › Layout › Cube): Git Deck opens as a Rubik's cube and nothing else.
// - A real 3x3x3 cube of 27 pieces. Drag the empty space to turn the whole cube; drag across a sticker to
//   twist that layer, like a real cube. Scramble, Solve (plays the moves back) and the keys U D L R F B
//   (Shift for the other way) are there for when you want to play.
// - Each face's centre sticker is a door: Changes, History, Branches, Stashes, Dashboard and Repos, with
//   live counts. Click it and the cube flies into that view; the program is then the normal, flat window.
// - Esc (when nothing else is open) or the ⧉ button in the status bar brings the cube back. The cube keeps
//   its twists between visits.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Quarter turns in CSS axes (x right, y down, z towards you), sign as CSS rotateX/Y/Z(+90deg).
  function rotate(axis,sign,[x,y,z]){
    const s=sign>0?1:-1;const clean=(v)=>v.map(n=>n||0);
    if(axis==='x')return clean([x,-s*z,s*y]);
    if(axis==='y')return clean([s*z,y,-s*x]);
    return clean([-s*y,s*x,z]);
  }
  // 3x3 matrices as three columns.
  const turnMatrix=(axis,sign,m)=>m.map(col=>rotate(axis,sign,col));
  const identity=()=>[[1,0,0],[0,1,0],[0,0,1]];
  const axisIndex={x:0,y:1,z:2};
  // The 26 visible pieces of a solved cube.
  function solved(){
    const pieces=[];
    for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])if(x||y||z)pieces.push({home:[x,y,z],pos:[x,y,z],m:identity()});
    return pieces;
  }
  // Twist one layer (index -1, 0 or 1 along axis) a quarter turn.
  function twist(pieces,axis,layer,sign){
    const a=axisIndex[axis];
    return pieces.map(p=>p.pos[a]===layer?{...p,pos:rotate(axis,sign,p.pos),m:turnMatrix(axis,sign,p.m)}:p);
  }
  // Moves in cube notation for the six outer layers (centres never move, so each door stays on its face).
  const moves={U:['y',-1,1],D:['y',1,-1],L:['x',-1,-1],R:['x',1,1],F:['z',1,1],B:['z',-1,-1]};
  const apply=(pieces,move)=>{const [axis,layer,sign]=moves[move[0]];return twist(pieces,axis,layer,move.endsWith("'")?-sign:sign);};
  const inverse=(move)=>move.endsWith("'")?move[0]:`${move}'`;
  // Solved: every piece home and upright (a centre may spin in place, its colour does not change).
  const isCentre=(p)=>p.home.filter(v=>v!==0).length===1;
  const upright=(m)=>m.every((col,j)=>col.every((v,i)=>v===(i===j?1:0)));
  const isSolved=(pieces)=>pieces.every(p=>p.pos.every((v,i)=>v===p.home[i])&&(isCentre(p)||upright(p.m)));
  // Which layer a drag across a sticker turns: the axis whose turning moves the sticker most along the drag.
  function pickTwist(pos,normal,drag,project){
    let best=null;
    for(const axis of ['x','y','z']){
      const a=axisIndex[axis];if(normal[a]!==0||pos[a]===0)continue;
      const c=pos.map((v,i)=>v+normal[i]*0.5);
      const v=axis==='x'?[0,-c[2],c[1]]:axis==='y'?[c[2],0,-c[0]]:[-c[1],c[0],0];
      const [sx,sy]=project(v);const len=Math.hypot(sx,sy)||1;const score=(sx*drag[0]+sy*drag[1])/len;
      if(!best||Math.abs(score)>Math.abs(best.score))best={axis,layer:pos[a],sign:score>0?1:-1,score};
    }
    return best;
  }
  const helpers={rotate,solved,twist,moves,apply,inverse,isSolved,pickTwist};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement;const body=document.body;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  let layout=readJson('gitdeck.layout','cube');if(layout!=='classic')layout='cube';
  const on=()=>layout==='cube'&&root.classList.contains('gd-rubik')&&root.classList.contains('ui-modern');
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ---- the doors: what each face's centre opens ---------------------------------------------------------
  // Face normals in CSS axes: front z+, right x+, back z-, left x-, top y-, bottom y+.
  const doors=[
    {normal:[0,0,1],view:'changes',label:t('Changes'),slot:'red'},
    {normal:[1,0,0],view:'history',label:t('History'),slot:'blue'},
    {normal:[0,0,-1],view:'branches',label:t('Branches'),slot:'orange'},
    {normal:[-1,0,0],view:'stashes',label:t('Stashes'),slot:'yellow'},
    {normal:[0,-1,0],view:'dashboard',label:t('Dashboard'),slot:'green'},
    {normal:[0,1,0],view:'repos',label:t('Repos'),slot:'white'},
  ];
  const doorFor=(normal)=>doors.find(d=>d.normal.every((v,i)=>v===normal[i]));
  function countFor(view){
    const w=(typeof state!=='undefined'&&state.workspace)||null;const sync=w?.sync||{};
    if(view==='changes')return w?(w.files||[]).length:'';
    if(view==='history')return sync.behind?`↓${sync.behind}`:'';
    if(view==='branches')return w?(w.branches||[]).length:'';
    if(view==='stashes')return w?(w.stashes||[]).length:'';
    if(view==='repos')return typeof state!=='undefined'?(state.repos||[]).length:'';
    return '';
  }
  function enter(view){
    if(view==='dashboard'){if(typeof showOperationsCenter==='function')showOperationsCenter('briefing');return;}
    if(view==='repos'){document.body.classList.remove('library-collapsed');if(typeof showRepoSwitcher==='function')showRepoSwitcher();return;}
    if(typeof state!=='undefined'&&state.workspaceRepo&&typeof selectWorkspaceTab==='function')selectWorkspaceTab(view);
    else if(typeof showRepoSwitcher==='function')showRepoSwitcher();
  }

  // ---- the cube -------------------------------------------------------------------------------------------
  const home=el('section','gd-home');home.setAttribute('role','dialog');home.setAttribute('aria-label',t('Git Deck cube'));
  const stage=el('div','gd-home-stage');const cubeNode=el('div','gd-home-cube');stage.append(cubeNode);
  const bar=el('div','gd-home-bar');
  const button=(label,title,run)=>{const node=el('button','',label);node.type='button';node.title=title;node.onclick=(event)=>{event.stopPropagation();run();};return node;};
  const counter=el('small','gd-home-moves');
  const expand=button(t('Expand'),t('Back to the full window where you left it (Esc)'),()=>restore());expand.classList.add('gd-home-expand');
  bar.append(button(t('Scramble'),t('Twist the cube at random'),()=>scramble()),button(t('Solve'),t('Play the twists back until it is solved'),()=>solve()),counter,expand);
  const hint=el('div','gd-home-hint');hint.append(el('strong','',t('Git Deck')),el('small','',t('Drag the space to turn the cube · drag a sticker to twist its layer · click a centre to go in')));
  home.append(hint,stage,bar);
  // Shrink to the cube: next to the window buttons at the top right (or at the end of the tab row).
  const backButton=el('button','gd-home-back','⧉');backButton.type='button';backButton.title=t('Shrink to the cube (Esc)');backButton.setAttribute('aria-label',backButton.title);backButton.onclick=()=>show();
  const lastView=()=>(typeof state!=='undefined'&&state.workspaceTab)||'changes';
  // "Expand" goes back to the window as it was, without changing view.
  const restore=()=>{home.classList.add('gd-home-leaving');setTimeout(()=>{home.remove();body.classList.remove('gd-home-open');home.classList.remove('gd-home-leaving');},still()?0:420);};

  let pieces=helpers.solved();let history=readJson('gitdeck.cubeMoves',[]);if(!Array.isArray(history))history=[];
  for(const move of history)if(moves[String(move)[0]])pieces=apply(pieces,move);
  let rx=-24,ry=-34;let busy=false;
  const size=()=>Math.round(Math.min(innerWidth,innerHeight)*0.17);
  const faceDefs=[[[0,0,1],'translateZ(var(--h))'],[[1,0,0],'rotateY(90deg) translateZ(var(--h))'],[[0,0,-1],'rotateY(180deg) translateZ(var(--h))'],[[-1,0,0],'rotateY(-90deg) translateZ(var(--h))'],[[0,-1,0],'rotateX(90deg) translateZ(var(--h))'],[[0,1,0],'rotateX(-90deg) translateZ(var(--h))']];
  const nodes=new Map();
  function build(){
    cubeNode.replaceChildren();nodes.clear();
    for(const piece of pieces){
      const node=el('div','gd-piece');
      for(const [normal,place] of faceDefs){
        const face=el('div','gd-piece-face');face.style.transform=place;
        const outside=normal.every((v,i)=>v===0||v===piece.home[i]);
        if(outside){
          const door=doorFor(normal);face.classList.add('gd-sticker');face.style.setProperty('--sticker',`var(--st-${door.slot})`);face.dataset.normal=normal.join(',');
          if(isCentreHome(piece,normal)){face.classList.add('gd-door');face.dataset.view=door.view;face.append(el('b','',door.label),el('small','gd-door-count',''));}
        }
        node.append(face);
      }
      cubeNode.append(node);nodes.set(piece,node);
    }
    place(false);refresh();
  }
  const isCentreHome=(piece,normal)=>piece.home.filter(v=>v!==0).length===1&&normal.every((v,i)=>v===piece.home[i]);
  const matrix=(m,p,s)=>`translate3d(${p[0]*s}px, ${p[1]*s}px, ${p[2]*s}px) matrix3d(${m[0][0]},${m[0][1]},${m[0][2]},0,${m[1][0]},${m[1][1]},${m[1][2]},0,${m[2][0]},${m[2][1]},${m[2][2]},0,0,0,0,1)`;
  function place(){
    const s=size();cubeNode.style.setProperty('--s',`${s}px`);cubeNode.style.setProperty('--h',`${s/2}px`);
    cubeNode.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
    for(const piece of pieces){const node=nodes.get(piece)||nodes.get(findNode(piece));if(node){node.style.transition='none';node.style.transform=matrix(piece.m,piece.pos,s);}}
    counter.textContent=helpers.isSolved(pieces)?t('Solved'):t('{count} twists',{count:history.length});
  }
  // Pieces are replaced on every twist; the DOM node follows the piece by its home.
  const findNode=(piece)=>[...nodes.keys()].find(p=>p.home.every((v,i)=>v===piece.home[i]));
  function refresh(){for(const face of cubeNode.querySelectorAll('.gd-door')){const count=countFor(face.dataset.view);face.querySelector('.gd-door-count').textContent=count===''||count===0?'':String(count);}}

  // One animated quarter turn of a layer.
  function turn(axis,layer,sign,record=true){
    if(busy)return Promise.resolve();busy=true;
    const a=axisIndex[axis];const s=size();const angle=`rotate${axis.toUpperCase()}(${sign*90}deg)`;
    const moving=pieces.filter(p=>p.pos[a]===layer);
    const after=twist(pieces,axis,layer,sign);
    return new Promise((resolve)=>{
      const finish=()=>{
        const map=new Map();for(const [k,node] of nodes)map.set(k.home.join(),node);
        pieces=after;nodes.clear();for(const p of pieces)nodes.set(p,map.get(p.home.join()));
        place();busy=false;resolve();
      };
      if(still()){finish();return;}
      for(const p of moving){const node=nodes.get(p);node.style.transition='none';node.style.transform=`${axis==='x'?'rotateX':axis==='y'?'rotateY':'rotateZ'}(0deg) ${matrix(p.m,p.pos,s)}`;}
      void cubeNode.offsetWidth;
      for(const p of moving){const node=nodes.get(p);node.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';node.style.transform=`${angle} ${matrix(p.m,p.pos,s)}`;}
      setTimeout(finish,300);
      document.dispatchEvent(new CustomEvent('gitdeck:turn',{detail:{axis,layer,sign}}));
    }).then(()=>{if(record){const name=Object.entries(moves).find(([,v])=>v[0]===axis&&v[1]===layer);if(name){const move=sign===name[1][2]?name[0]:`${name[0]}'`;const last=history[history.length-1];if(last&&last===inverse(move))history.pop();else history.push(move);history=history.slice(-300);writeJson('gitdeck.cubeMoves',history);place();}}});
  }
  async function scramble(){const names=Object.keys(moves);for(let i=0;i<14;i++){const move=names[Math.floor(Math.random()*6)]+(Math.random()<.5?"'":'');const [axis,layer,sign]=moves[move[0]];await turn(axis,layer,move.endsWith("'")?-sign:sign);}}
  async function solve(){while(history.length){const move=inverse(history[history.length-1]);const [axis,layer,sign]=moves[move[0]];history.pop();await turn(axis,layer,move.endsWith("'")?-sign:sign,false);writeJson('gitdeck.cubeMoves',history);place();}}

  // ---- pointer: orbit, twist, enter ------------------------------------------------------------------
  const project=(v)=>{
    const ry_=ry*Math.PI/180,rx_=rx*Math.PI/180;
    let [x,y,z]=v;const x1=x*Math.cos(ry_)+z*Math.sin(ry_),z1=-x*Math.sin(ry_)+z*Math.cos(ry_);
    const y2=y*Math.cos(rx_)-z1*Math.sin(rx_);return [x1,y2];
  };
  let drag=null;
  stage.addEventListener('pointerdown',(event)=>{
    const face=event.target.closest?.('.gd-sticker');const node=face?.parentElement;
    const piece=node?[...nodes].find(([,n])=>n===node)?.[0]:null;
    drag={x:event.clientX,y:event.clientY,rx,ry,face,piece,done:false,moved:false};
    try{stage.setPointerCapture(event.pointerId);}catch{}
  });
  stage.addEventListener('pointermove',(event)=>{
    if(!drag||drag.done)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>6)drag.moved=true;
    if(drag.piece&&drag.face){
      if(Math.hypot(dx,dy)<18)return;
      const local=drag.face.dataset.normal.split(',').map(Number);
      const normal=[0,1,2].map(i=>drag.piece.m[0][i]*local[0]+drag.piece.m[1][i]*local[1]+drag.piece.m[2][i]*local[2]);
      const pick=pickTwist(drag.piece.pos,normal,[dx/Math.hypot(dx,dy),dy/Math.hypot(dx,dy)],project);
      drag.done=true;if(pick)void turn(pick.axis,pick.layer,pick.sign);
      return;
    }
    ry=drag.ry+dx*0.35;rx=Math.max(-80,Math.min(80,drag.rx-dy*0.35));cubeNode.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  stage.addEventListener('pointerup',(event)=>{
    const d=drag;drag=null;if(!d||d.moved)return;
    const door=event.target.closest?.('.gd-door');if(door)go(door.dataset.view);
  });

  // ---- showing the cube, going in, coming back ------------------------------------------------------
  function show(){
    if(!on())return;refresh();place();
    home.classList.remove('gd-home-leaving');if(!home.isConnected)body.append(home);body.classList.add('gd-home-open');
  }
  function go(view){
    home.classList.add('gd-home-leaving');
    setTimeout(()=>{home.remove();body.classList.remove('gd-home-open');home.classList.remove('gd-home-leaving');enter(view);},still()?0:420);
  }
  const blocked=()=>document.querySelector('dialog[open], #command-palette:not(.hidden), details[open], .gd-timeline, .gd-cube-zoom')||body.classList.contains('dashboard-page-open')||body.classList.contains('gd-zen');
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(!on())return;
    if(home.isConnected){
      const key=event.key.toUpperCase();
      if(moves[key]&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();const [axis,layer,sign]=moves[key];void turn(axis,layer,event.shiftKey?-sign:sign);}
      else if(event.key==='Escape'){event.preventDefault();restore();}
      return;
    }
    if(event.key==='Escape'&&!typing(event.target)&&!blocked()&&!event.defaultPrevented){event.preventDefault();show();}
  });

  // ---- layout choice (theme menu) ---------------------------------------------------------------------
  function sync(){
    const controls=document.querySelector('.gd-window-controls');const tabs=document.getElementById('repo-tabs');
    if(on()){if(controls)controls.prepend(backButton);else if(tabs&&!backButton.isConnected)tabs.append(backButton);}
    else{backButton.remove();home.remove();body.classList.remove('gd-home-open');}
  }
  function addPicker(menu){
    if(menu.querySelector('.layout-choice'))return;
    const block=el('div','look-choice layout-choice');block.append(el('strong','',t('Layout')));
    for(const [value,label,title] of [['cube',t('Cube'),t('Git Deck opens as a Rubik\'s cube; each face\'s centre takes you into a view')],['classic',t('Classic'),t('Open straight into the window, as before')]]){
      const node=el('button','',label);node.type='button';node.title=title;node.dataset.layout=value;node.setAttribute('aria-pressed',String(layout===value));
      node.onclick=()=>{layout=value;writeJson('gitdeck.layout',value);document.querySelectorAll('[data-layout]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.layout===layout)));sync();};
      block.append(node);
    }
    menu.append(block);
  }
  document.querySelectorAll('.theme-menu').forEach(addPicker);
  document.addEventListener('gitdeck:appearance',sync);
  window.addEventListener('resize',()=>{if(home.isConnected)place();});
  setInterval(()=>{if(document.hidden)return;if(home.isConnected)refresh();if(on()&&!backButton.isConnected)sync();},1500);
  build();sync();
  // Git Deck opens as the cube.
  if(on())show();
  window.GitDeckCubeShell={...helpers,show,go,turn:(move)=>{const [axis,layer,sign]=moves[move[0]];return turn(axis,layer,move.endsWith("'")?-sign:sign);},scramble,solve,get history(){return history.slice();},active:on};
})();
