'use strict';
// Cube home (Rubik shape, theme menu › Layout › Cube): Git Deck opens as a Rubik's cube, and the cube is
// your Git work. A real 3x3x3 cube: drag the empty space to turn it, drag across a sticker to twist a layer.
// Four modes (tabs above the cube):
// - Repo: the open repository. Faces are Changes, Sync, Branches, Stashes, Releases and Conflicts; each
//   sticker round a centre is one real thing that needs you (a changed file, a commit to pull or push, a
//   branch behind, a stash, a commit not released yet, a conflict) in a scrambled colour. A clean, synced
//   repository is a solved cube. Twisting a face does its Git move: Changes stages everything, Sync pulls
//   one way and pushes the other, Branches fetches, Stashes stashes or pops, Releases opens Tags, Conflicts
//   opens the Conflict Center. Moves that change things ask first.
// - Workset: the 26 pieces are 26 repositories (open tabs, favourites, then the busiest), each in its status
//   colour. Click a piece to open it; twisting a layer fetches the repositories in it.
// - Branches: each face is a branch (the current one in front), its stickers the latest commits; commits the
//   current branch already has are in the face's colour, the others stand out.
// - Play: a plain cube to twist, scramble and solve.
// Each face's centre is a door into that view. Expand goes back to the window; ⧉ Shrink to the cube (or Esc)
// brings the cube back.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Quarter turns in CSS axes (x right, y down, z towards you), sign as CSS rotateX/Y/Z(+90deg).
  function rotate(axis,sign,[x,y,z]){
    const s=sign>0?1:-1;const clean=(v)=>v.map(n=>n||0);
    if(axis==='x')return clean([x,-s*z,s*y]);
    if(axis==='y')return clean([s*z,y,-s*x]);
    return clean([-s*y,s*x,z]);
  }
  const turnMatrix=(axis,sign,m)=>m.map(col=>rotate(axis,sign,col));
  const identity=()=>[[1,0,0],[0,1,0],[0,0,1]];
  const axisIndex={x:0,y:1,z:2};
  function solved(){
    const pieces=[];
    for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])if(x||y||z)pieces.push({home:[x,y,z],pos:[x,y,z],m:identity()});
    return pieces;
  }
  function twist(pieces,axis,layer,sign){
    const a=axisIndex[axis];
    return pieces.map(p=>p.pos[a]===layer?{...p,pos:rotate(axis,sign,p.pos),m:turnMatrix(axis,sign,p.m)}:p);
  }
  // The six outer layers; centres never move, so each door stays on its face.
  const moves={U:['y',-1,1],D:['y',1,-1],L:['x',-1,-1],R:['x',1,1],F:['z',1,1],B:['z',-1,-1]};
  const apply=(pieces,move)=>{const [axis,layer,sign]=moves[move[0]];return twist(pieces,axis,layer,move.endsWith("'")?-sign:sign);};
  const inverse=(move)=>move.endsWith("'")?move[0]:`${move}'`;
  const isCentre=(p)=>p.home.filter(v=>v!==0).length===1;
  const upright=(m)=>m.every((col,j)=>col.every((v,i)=>v===(i===j?1:0)));
  const isSolved=(pieces)=>pieces.every(p=>p.pos.every((v,i)=>v===p.home[i])&&(isCentre(p)||upright(p.m)));
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
  // Faces in CSS axes: 0 front z+, 1 right x+, 2 back z-, 3 left x-, 4 top y-, 5 bottom y+.
  const normals=[[0,0,1],[1,0,0],[0,0,-1],[-1,0,0],[0,-1,0],[0,1,0]];
  const faceOf=(normal)=>normals.findIndex(n=>n.every((v,i)=>v===normal[i]));
  // The outer layer a twist turns, as a face (or -1 for a middle layer).
  const faceOfLayer=(axis,layer)=>layer===0?-1:faceOf([axis==='x'?layer:0,axis==='y'?layer:0,axis==='z'?layer:0]);
  // Where a sticker sits on its face, 0..8 reading order as you look at the face (4 is the centre).
  function slotOf(normal,[x,y,z]){
    const f=faceOf(normal);
    const [u,v]=f===0?[x,y]:f===1?[-z,y]:f===2?[-x,y]:f===3?[z,y]:f===4?[x,z]:[x,-z];
    return (v+1)*3+(u+1);
  }
  const ring=[0,1,2,3,5,6,7,8];
  // Lay up to eight items round a face's centre: the rest of the ring stays "solved".
  const layout=(items)=>{const slots=Array(9).fill(null);items.slice(0,8).forEach((item,k)=>{slots[ring[k]]=item;});return slots;};
  // Commits reachable from a head inside a loaded history (first come, newest first).
  function reachable(history,head,limit=400){
    const byHash=new Map();for(const c of history||[]){byHash.set(c.fullHash,c);byHash.set(c.hash,c);}
    const seen=new Set();const queue=[head];
    while(queue.length&&seen.size<limit){const id=queue.shift();const c=byHash.get(id);if(!c||seen.has(c.fullHash))continue;seen.add(c.fullHash);for(const p of c.parents||[])queue.push(p);}
    return seen;
  }
  // The commit a branch points at, from the history's decorations.
  function headOf(history,branch){
    for(const c of history||[]){const refs=String(c.decorations||'').split(',').map(r=>r.trim().replace(/^HEAD -> /,''));if(refs.includes(branch))return c.fullHash;}
    return '';
  }
  const helpers={rotate,solved,twist,moves,apply,inverse,isSolved,pickTwist,normals,faceOf,faceOfLayer,slotOf,layout,reachable,headOf};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement;const body=document.body;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  let layoutChoice=readJson('gitdeck.layout','cube');if(layoutChoice!=='classic')layoutChoice='cube';
  const on=()=>layoutChoice==='cube'&&root.classList.contains('gd-rubik')&&root.classList.contains('ui-modern');
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const ws=()=>(typeof state!=='undefined'&&state.workspaceRepo&&state.workspace)||null;
  const colours=['red','blue','orange','yellow','white','green'];
  const tone=(name)=>`var(--st-${name})`;
  const scrambled=(face,k)=>colours[(face+1+k)%6]===colours[face]?colours[(face+2+k)%6]:colours[(face+1+k)%6];

  // ---- the modes: what each face shows -----------------------------------------------------------
  let mode=readJson('gitdeck.cubeMode','repo');if(!['repo','workset','branches','play'].includes(mode))mode='repo';
  let releaseCommits=null,releaseFor='';
  async function loadReleases(){
    const repo=state?.workspaceRepo;if(!repo||releaseFor===repo.path)return;releaseFor=repo.path;releaseCommits=null;
    try{const tag=(await api('/api/repo/latest-tag?path='+encodeURIComponent(repo.path))).tag?.name||'';releaseCommits=tag?((await api('/api/repo/commits-since?'+new URLSearchParams({path:repo.path,tag}))).commits||[]):[];if(home.isConnected)paint();}catch{releaseCommits=[];}
  }
  // Each mode gives six faces: {label, colour, view, items:[{title, text, colour, open}]}.
  function repoFaces(){
    const w=ws();const sync=w?.sync||{};const files=w?.files||[];
    const fileItem=(f)=>({title:f.path,text:String(f.path).split('/').pop(),staged:/^[MADRC]/.test(String(f.status||''))&&String(f.status||'').length>1&&String(f.status)[1]===' '});
    return [
      {label:t('Changes'),view:'changes',items:files.map(fileItem)},
      {label:t('Sync'),view:'history',items:[...(sync.incoming||[]).map(c=>({title:t('To pull: {commit}',{commit:c}),text:`↓ ${String(c).split(' ').slice(1).join(' ')}`})),...(sync.outgoing||[]).map(c=>({title:t('To push: {commit}',{commit:c}),text:`↑ ${String(c).split(' ').slice(1).join(' ')}`}))]},
      {label:t('Branches'),view:'branches',items:(w?.branches||[]).filter(b=>!b.current&&(b.behind||b.ahead)).map(b=>({title:`${b.name} ${b.ahead?`↑${b.ahead}`:''} ${b.behind?`↓${b.behind}`:''}`.trim(),text:b.name}))},
      {label:t('Stashes'),view:'stashes',items:(w?.stashes||[]).map(s=>({title:s.message||s.subject||String(s.ref||s),text:s.message||s.subject||String(s.ref||s)}))},
      {label:t('Releases'),view:'tags',items:(releaseCommits||[]).map(c=>({title:t('Not released yet: {commit}',{commit:`${c.hash||''} ${c.subject||''}`}),text:c.subject||c.hash||''}))},
      {label:t('Conflicts'),view:'conflicts',items:(w?.operation?.conflicts||[]).map(f=>({title:String(f.path||f),text:String(f.path||f).split('/').pop()}))},
    ];
  }
  function worksetRepos(){
    const repos=(state?.repos||[]).filter(r=>r.valid!==false&&!/\.worktrees[\\/]/i.test(r.path));
    const open=(state?.meta?.openRepos||[]).map(key=>repos.find(r=>repoKey(r)===key)).filter(Boolean);
    const fav=repos.filter(r=>typeof isFavorite==='function'&&isFavorite(r));
    const busy=repos.slice().sort((a,b)=>(b.changes||0)+(b.behind||0)+(b.ahead||0)-((a.changes||0)+(a.behind||0)+(a.ahead||0)));
    const list=[];for(const r of [...open,...fav,...busy])if(!list.includes(r))list.push(r);
    return list.slice(0,26);
  }
  const statusColour=(r)=>{const kind=window.GitDeckSpeedcube?.tabSticker?.({changes:r.changes,ahead:r.ahead,behind:r.behind})||'clean';return {clean:'green',work:'yellow',pull:'blue',push:'white',conflict:'red'}[kind];};
  function branchFaces(){
    const w=ws();const history=w?.history||[];const current=w?.branch||'';
    const names=[current,...['main','master','develop','dev','staging'].filter(n=>n!==current&&(w?.branches||[]).some(b=>b.name===n))];
    for(const b of w?.branches||[])if(names.length<6&&!names.includes(b.name))names.push(b.name);
    // A local head older than the loaded history is found through its remote branch.
    const headFor=(name)=>headOf(history,name)||headOf(history,`origin/${name}`);
    const mine=reachable(history,headFor(current)||history[0]?.fullHash,600);
    return names.slice(0,6).map((name)=>{
      const head=headFor(name);const commits=head?[...reachable(history,head,8)].map(h=>history.find(c=>c.fullHash===h)).filter(Boolean):[];
      return {label:name||t('Branches'),view:'branches',branch:name,items:commits.map(c=>({title:`${c.hash} ${c.subject}`,text:c.subject||c.hash,shared:mine.has(c.fullHash)}))};
    });
  }

  // ---- the cube ---------------------------------------------------------------------------------------
  const home=el('section','gd-home');home.setAttribute('role','dialog');home.setAttribute('aria-label',t('Git Deck cube'));
  const stage=el('div','gd-home-stage');const cubeNode=el('div','gd-home-cube');stage.append(cubeNode);
  const tabs=el('div','gd-home-modes');
  const modeNames={repo:t('Repo'),workset:t('Workset'),branches:t('Branches'),play:t('Play')};
  const modeHints={repo:t('Each sticker is something that needs you; a solved cube is a clean, synced repository. Twist a face to do its Git move.'),workset:t('Each piece is a repository in its status colour. Click a piece to open it; twist a layer to fetch its repositories.'),branches:t('Each face is a branch; stickers are its latest commits. Coloured like the face: the current branch has it.'),play:t('Just a cube: twist, scramble, solve.')};
  for(const value of Object.keys(modeNames)){const b=el('button','',modeNames[value]);b.type='button';b.dataset.mode=value;b.onclick=(event)=>{event.stopPropagation();setMode(value);};tabs.append(b);}
  const bar=el('div','gd-home-bar');const counter=el('small','gd-home-moves');const status=el('small','gd-home-status');
  const button=(label,title,run,className='')=>{const node=el('button',className,label);node.type='button';node.title=title;node.onclick=(event)=>{event.stopPropagation();run();};return node;};
  const playButtons=[button(t('Scramble'),t('Twist the cube at random'),()=>scramble()),button(t('Solve'),t('Play the twists back until it is solved'),()=>solve())];
  const expand=button(t('Expand'),t('Back to the full window where you left it (Esc)'),()=>restore(),'gd-home-expand');
  bar.append(...playButtons,counter,status,expand);
  const hint=el('div','gd-home-hint');const hintText=el('small','');hint.append(el('strong','',t('Git Deck')),hintText);
  const top=el('div','gd-home-top');top.append(hint,tabs);
  home.append(top,stage,bar);
  const backButton=el('button','gd-home-back','⧉');backButton.type='button';backButton.title=t('Shrink to the cube (Esc)');backButton.setAttribute('aria-label',backButton.title);backButton.onclick=()=>show();

  let pieces=solved();let history=readJson('gitdeck.cubeMoves',[]);if(!Array.isArray(history))history=[];
  const playPieces=()=>{let p=solved();for(const move of history)if(moves[String(move)[0]])p=apply(p,move);return p;};
  if(mode==='play')pieces=playPieces();
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
        if(normal.every((v,i)=>v===0||v===piece.home[i])){face.classList.add('gd-sticker');face.dataset.normal=normal.join(',');face.append(el('b'),el('small'));}
        node.append(face);
      }
      cubeNode.append(node);nodes.set(piece,node);
    }
    place();paint();
  }
  const matrix=(m,p,s)=>`translate3d(${p[0]*s}px, ${p[1]*s}px, ${p[2]*s}px) matrix3d(${m[0][0]},${m[0][1]},${m[0][2]},0,${m[1][0]},${m[1][1]},${m[1][2]},0,${m[2][0]},${m[2][1]},${m[2][2]},0,0,0,0,1)`;
  function place(){
    const s=size();cubeNode.style.setProperty('--s',`${s}px`);cubeNode.style.setProperty('--h',`${s/2}px`);
    cubeNode.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
    for(const piece of pieces){const node=nodes.get(piece);if(node){node.style.transition='none';node.style.transform=matrix(piece.m,piece.pos,s);}}
  }
  const worldNormal=(piece,local)=>[0,1,2].map(i=>piece.m[0][i]*local[0]+piece.m[1][i]*local[1]+piece.m[2][i]*local[2]);
  // Colour and label every sticker from the mode's data.
  function paint(){
    const faces=mode==='repo'?repoFaces():mode==='branches'?branchFaces():null;
    const repos=mode==='workset'?worksetRepos():null;let mess=0;
    let repoIndex=0;const pieceRepo=new Map();
    if(repos){const order=pieces.slice().sort((a,b)=>isCentre(a)-isCentre(b));for(const p of order)pieceRepo.set(p,repos[repoIndex++]||null);}
    for(const piece of pieces){
      const node=nodes.get(piece);if(!node)continue;
      for(const face of node.querySelectorAll('.gd-sticker')){
        const local=face.dataset.normal.split(',').map(Number);const normal=mode==='play'?local:worldNormal(piece,local);
        const f=faceOf(mode==='play'?local:normal);const slot=slotOf(normal,piece.pos);
        let colour=colours[f],label='',small='',title='',door='',action=null;
        if(mode==='play'){if(slot===4&&isCentre(piece)){label=[t('Changes'),t('Sync'),t('Branches'),t('Stashes'),t('Releases'),t('Conflicts')][f];}}
        else if(faces){
          // Fewer branches than faces (or nothing loaded yet): the spare faces stay plain.
          const data=faces[f]||{label:'',view:'',items:[]};const items=layout(data.items);colour=colours[f];
          if(slot===4){label=data.label;small=data.items.length?String(data.items.length):'';door=data.view;title=data.label;action=data.view?()=>go(data.view):null;}
          else{const item=items[slot];if(item){title=item.title;small='';label=item.text;
            if(mode==='repo'){colour=scrambled(f,ring.indexOf(slot));mess++;}else colour=item.shared?colours[f]:scrambled(f,ring.indexOf(slot));
            action=()=>go(data.view);}}
          if(mode==='branches'&&slot===4)action=()=>go('branches');
        }
        else if(repos){
          const repo=pieceRepo.get(piece);
          if(repo){colour=statusColour(repo);title=`${repo.name}\n${repo.path}`;if(slot===4||face===node.querySelector('.gd-sticker'))label=repo.name;action=()=>{leave(()=>{if(typeof openWorkspace==='function')void openWorkspace(repo,'changes');});};}
          else{colour='grey';}
        }
        face.style.setProperty('--sticker',colour==='grey'?'#3a414b':tone(colour));
        face.classList.toggle('gd-light',['white','yellow','orange'].includes(colour));
        face.classList.toggle('gd-door',slot===4&&Boolean(door));face.classList.toggle('gd-item',Boolean(label)&&slot!==4);
        face.querySelector('b').textContent=label;face.querySelector('small').textContent=small;face.title=title;face._act=action;
      }
    }
    counter.textContent=mode==='play'?(isSolved(pieces)?t('Solved'):t('{count} twists',{count:history.length})):'';
    status.textContent=mode==='repo'?(mess?t('{count} things to do',{count:mess}):t('Solved: clean and in sync')):mode==='workset'?t('{count} repositories',{count:repos.length}):mode==='branches'?(ws()?.branch||''):'';
    home.classList.toggle('gd-home-clean',mode==='repo'&&!mess);
    for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
    for(const b of playButtons)b.hidden=mode!=='play';
    hintText.textContent=modeHints[mode];
  }
  function setMode(value){
    mode=value;writeJson('gitdeck.cubeMode',value);
    pieces=value==='play'?playPieces():solved();build();
    if(value==='repo')void loadReleases();
  }

  // One animated quarter turn of a layer.
  function turn(axis,layer,sign,record=true){
    if(busy)return Promise.resolve();busy=true;
    const a=axisIndex[axis];const s=size();const angle=`rotate${axis.toUpperCase()}(${sign*90}deg)`;
    const moving=pieces.filter(p=>p.pos[a]===layer);const after=twist(pieces,axis,layer,sign);
    return new Promise((resolve)=>{
      const finish=()=>{const map=new Map();for(const [k,node] of nodes)map.set(k.home.join(),node);pieces=after;nodes.clear();for(const p of pieces)nodes.set(p,map.get(p.home.join()));place();busy=false;resolve();};
      if(still()){finish();return;}
      for(const p of moving){const node=nodes.get(p);node.style.transition='none';node.style.transform=`rotate${axis.toUpperCase()}(0deg) ${matrix(p.m,p.pos,s)}`;}
      void cubeNode.offsetWidth;
      for(const p of moving){const node=nodes.get(p);node.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';node.style.transform=`${angle} ${matrix(p.m,p.pos,s)}`;}
      setTimeout(finish,300);
      document.dispatchEvent(new CustomEvent('gitdeck:turn',{detail:{axis,layer,sign}}));
    }).then(()=>{
      if(mode!=='play'){pieces=solved();build();return;}
      if(record){const name=Object.entries(moves).find(([,v])=>v[0]===axis&&v[1]===layer);if(name){const move=sign===name[1][2]?name[0]:`${name[0]}'`;const last=history[history.length-1];if(last&&last===inverse(move))history.pop();else history.push(move);history=history.slice(-300);writeJson('gitdeck.cubeMoves',history);}}
      paint();
    });
  }
  async function scramble(){if(mode!=='play')return;const names=Object.keys(moves);for(let i=0;i<14;i++){const move=names[Math.floor(Math.random()*6)]+(Math.random()<.5?"'":'');const [axis,layer,sign]=moves[move[0]];await turn(axis,layer,move.endsWith("'")?-sign:sign);}}
  async function solve(){if(mode!=='play')return;while(history.length){const move=inverse(history[history.length-1]);const [axis,layer,sign]=moves[move[0]];history.pop();await turn(axis,layer,move.endsWith("'")?-sign:sign,false);writeJson('gitdeck.cubeMoves',history);paint();}}

  // ---- twists do Git ----------------------------------------------------------------------------------
  const runAction=(action,payload={},question='')=>typeof runWorkspaceAction==='function'?runWorkspaceAction(action,payload,question):null;
  async function gitTwist(axis,layer,sign){
    const f=faceOfLayer(axis,layer);if(f<0)return;
    if(mode==='workset'){
      const repos=worksetRepos();const order=pieces.slice().sort((a,b)=>isCentre(a)-isCentre(b));const a=axisIndex[axis];
      const inLayer=order.map((p,i)=>p.pos[a]===layer?repos[i]:null).filter(Boolean);
      if(!inLayer.length||!confirm(t('Fetch the {count} repositories in this layer?',{count:inLayer.length})))return;
      await turn(axis,layer,sign);let done=0;
      for(const repo of inLayer){try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'fetch',path:repo.path})});done++;}catch{}}
      if(typeof showActionFeedback==='function')showActionFeedback(t('Fetched {done} of {count} repositories',{done,count:inLayer.length}));
      if(typeof refresh==='function')await refresh();paint();return;
    }
    if(mode==='branches'){await turn(axis,layer,sign);return;}
    const w=ws();if(!w){if(typeof showActionFeedback==='function')showActionFeedback(t('Open a repository first.'),{error:true});return;}
    const sync=w.sync||{};let result=null;
    if(f===0){if(!(w.files||[]).length)return;if(!confirm(t('Stage all {count} changed files?',{count:w.files.length})))return;result=await runAction('stage-all');}
    else if(f===1){const up=sign>0;result=up?await runAction('push',{},typeof syncConfirmation==='function'?syncConfirmation('push'):t('Push?')):await runAction('pull',{strategy:state.meta.pullStrategy},typeof syncConfirmation==='function'?syncConfirmation('pull'):t('Pull?'));void sync;}
    else if(f===2){result=await runAction('fetch');}
    else if(f===3){if((w.files||[]).length){if(!confirm(t('Stash the {count} changed files?',{count:w.files.length})))return;result=await runAction('stash-save',{message:t('Saved from the cube')});}else if((w.stashes||[]).length){const s=w.stashes[0];if(!confirm(t('Bring back the latest stash?')))return;result=await runAction('stash-pop',{stash:s.ref});}else return;}
    else if(f===4){leave(()=>enter('tags'));return;}
    else if(f===5){leave(()=>enter('conflicts'));return;}
    if(result){releaseFor='';await turn(axis,layer,sign);void loadReleases();}
  }
  function onTwist(axis,layer,sign){if(mode==='play')void turn(axis,layer,sign);else void gitTwist(axis,layer,sign);}

  // ---- pointer: orbit, twist, click ---------------------------------------------------------------------
  const project=(v)=>{const a=ry*Math.PI/180,b=rx*Math.PI/180;const [x,y,z]=v;const x1=x*Math.cos(a)+z*Math.sin(a),z1=-x*Math.sin(a)+z*Math.cos(a);return [x1,y*Math.cos(b)-z1*Math.sin(b)];};
  let drag=null;
  stage.addEventListener('pointerdown',(event)=>{
    const face=event.target.closest?.('.gd-sticker');const node=face?.parentElement;const piece=node?[...nodes].find(([,n])=>n===node)?.[0]:null;
    drag={x:event.clientX,y:event.clientY,rx,ry,face,piece,done:false,moved:false};try{stage.setPointerCapture(event.pointerId);}catch{}
  });
  stage.addEventListener('pointermove',(event)=>{
    if(!drag||drag.done)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>6)drag.moved=true;
    if(drag.piece&&drag.face){
      if(Math.hypot(dx,dy)<18)return;
      const normal=worldNormal(drag.piece,drag.face.dataset.normal.split(',').map(Number));
      const pick=pickTwist(drag.piece.pos,normal,[dx/Math.hypot(dx,dy),dy/Math.hypot(dx,dy)],project);
      drag.done=true;if(pick&&!busy)onTwist(pick.axis,pick.layer,pick.sign);return;
    }
    ry=drag.ry+dx*0.35;rx=Math.max(-80,Math.min(80,drag.rx-dy*0.35));cubeNode.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  stage.addEventListener('pointerup',(event)=>{const d=drag;drag=null;if(!d||d.moved)return;const face=event.target.closest?.('.gd-sticker');if(face?._act)face._act();});

  // ---- the doors -----------------------------------------------------------------------------------------
  function enter(view){
    if(view==='dashboard'){if(typeof showOperationsCenter==='function')showOperationsCenter('briefing');return;}
    if(state?.workspaceRepo&&typeof selectWorkspaceTab==='function')selectWorkspaceTab(view);
    else if(typeof showRepoSwitcher==='function')showRepoSwitcher();
  }
  function leave(then){
    home.classList.add('gd-home-leaving');
    setTimeout(()=>{home.remove();body.classList.remove('gd-home-open');home.classList.remove('gd-home-leaving');if(typeof then==='function')then();},still()?0:420);
  }
  const go=(view)=>leave(()=>enter(view));
  const restore=()=>leave();
  function show(){
    if(!on())return;place();paint();if(mode==='repo')void loadReleases();
    home.classList.remove('gd-home-leaving');if(!home.isConnected)body.append(home);body.classList.add('gd-home-open');
  }
  const blocked=()=>document.querySelector('dialog[open], #command-palette:not(.hidden), details[open], .gd-timeline')||body.classList.contains('dashboard-page-open')||body.classList.contains('gd-zen');
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(!on())return;
    if(home.isConnected){
      if(typing(event.target)||document.querySelector('dialog[open]'))return;
      const key=event.key.toUpperCase();
      if(moves[key]&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();const [axis,layer,sign]=moves[key];onTwist(axis,layer,event.shiftKey?-sign:sign);}
      else if(event.key==='Escape'){event.preventDefault();restore();}
      return;
    }
    if(event.key==='Escape'&&!typing(event.target)&&!blocked()&&!event.defaultPrevented){event.preventDefault();show();}
  });

  // ---- layout choice (theme menu) ---------------------------------------------------------------------
  function sync(){
    const controls=document.querySelector('.gd-window-controls');const tabRow=document.getElementById('repo-tabs');
    if(on()){if(controls)controls.prepend(backButton);else if(tabRow&&!backButton.isConnected)tabRow.append(backButton);}
    else{backButton.remove();home.remove();body.classList.remove('gd-home-open');}
  }
  function addPicker(menu){
    if(menu.querySelector('.layout-choice'))return;
    const block=el('div','look-choice layout-choice');block.append(el('strong','',t('Layout')));
    for(const [value,label,title] of [['cube',t('Cube'),t('Git Deck opens as a Rubik\'s cube; each face\'s centre takes you into a view')],['classic',t('Classic'),t('Open straight into the window, as before')]]){
      const node=el('button','',label);node.type='button';node.title=title;node.dataset.layout=value;node.setAttribute('aria-pressed',String(layoutChoice===value));
      node.onclick=()=>{layoutChoice=value;writeJson('gitdeck.layout',value);document.querySelectorAll('[data-layout]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.layout===layoutChoice)));sync();};
      block.append(node);
    }
    menu.append(block);
  }
  document.querySelectorAll('.theme-menu').forEach(addPicker);
  document.addEventListener('gitdeck:appearance',sync);
  window.addEventListener('resize',()=>{if(home.isConnected)place();});
  let lastKey='';
  setInterval(()=>{
    if(document.hidden)return;if(on()&&!backButton.isConnected)sync();if(!home.isConnected||busy)return;
    const w=ws();const key=[mode,state?.workspaceRepo?.path,(w?.files||[]).length,w?.sync?.ahead,w?.sync?.behind,(w?.stashes||[]).length,(state?.repos||[]).length,releaseCommits?.length].join('|');
    if(key!==lastKey){lastKey=key;paint();}
  },1500);
  build();sync();
  if(on())show();
  window.GitDeckCubeShell={...helpers,show,go,setMode,get mode(){return mode;},turn:(move)=>{const [axis,layer,sign]=moves[move[0]];return turn(axis,layer,move.endsWith("'")?-sign:sign);},scramble,solve,get history(){return history.slice();},active:on};
})();
