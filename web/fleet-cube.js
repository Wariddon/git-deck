'use strict';
// Fleet cube (Dashboard › The whole family): your repositories on one big cube. Each face is a family
// (the six largest: crs-, lns-, aml-…), each sticker a repository coloured by its weather (web/weather.js):
// green clear, blue cloudy, amber rain, red storm, grey not checked. Drag to turn it, pick a face below
// to turn straight to it, click a sticker to open that repository.
// Faces by: families (name prefix) or folders (the folder holding the repository, e.g. C:\SCB).
// Colour by: weather, or activity (heatmap of the latest commit: today, this week, this month, older).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The six largest families, each with its repositories and a grid size that fits them (2 to 6).
  function cubeFaces(names,familyOf,limit=6){
    const groups=new Map();
    for(const name of names){const key=familyOf(name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(name);}
    return [...groups.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).slice(0,limit)
      .map(([family,members])=>{const size=Math.max(2,Math.min(6,Math.ceil(Math.sqrt(members.length))));return {family,members:members.sort().slice(0,size*size),hidden:Math.max(0,members.length-size*size),size};});
  }
  const levelColor={storm:'#f85149',rain:'#d29922',cloud:'#58a6ff',sun:'#3fb950',unknown:'#4b535d'};
  // The folder holding a repository: "C:\SCB\crs-webview" -> "SCB".
  const folderOf=(path)=>{const parts=String(path||'').split(/[\\/]+/).filter(Boolean);return parts.length>1?parts[parts.length-2]:'';};
  // Heat of the latest commit ("<hash> YYYY-MM-DD subject"): 3 today, 2 this week, 1 this month, 0 older or unknown.
  function heat(lastCommit,now=Date.now()){
    const match=/(\d{4}-\d{2}-\d{2})/.exec(String(lastCommit||''));if(!match)return 0;
    const days=(now-Date.parse(match[1]+'T00:00:00'))/864e5;
    return days<1?3:days<7?2:days<30?1:0;
  }
  const heatColor=['#2a3038','#1d5c3d','#2f8f5b','#56d364'];
  // The cube angle that shows face `index` (front, right, back, left, top, bottom).
  const faceAngles=[[-18,0],[-18,-90],[-18,-180],[-18,90],[-90,0],[90,0]];
  const helpers={cubeFaces,levelColor,faceAngles,folderOf,heat,heatColor};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn}=F;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const places=['translateZ(170px)','rotateY(90deg) translateZ(170px)','rotateY(180deg) translateZ(170px)','rotateY(-90deg) translateZ(170px)','rotateX(90deg) translateZ(170px)','rotateX(-90deg) translateZ(170px)'];

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const choose=(options)=>{const select=document.createElement('select');for(const [value,label] of options)select.append(new Option(label,value));return select;};
    const facesBy=choose([['family',t('Faces: families')],['folder',t('Faces: folders')]]);
    const colourBy=choose([['weather',t('Colour: weather')],['activity',t('Colour: activity')]]);
    bar.append(folder,facesBy,colourBy);
    const stage=el('div','fleet-cube-stage');const cube=el('div','fleet-cube spin');stage.append(cube);
    const legend=el('div','fleet-cube-legend');const status=el('small','multi-repo-status');
    panel.append(bar,el('p','multi-repo-explain',t('Your repositories on one cube: each face is a family or folder, each sticker a repository in its weather colour (green clear, blue cloudy, amber rain, red storm, grey not checked) or its activity (brighter green: committed more recently). Drag to turn it, pick a face to turn to it, click a sticker to open the repository.')),status,stage,legend);
    let rx=-18,ry=-30,dragging=null,moved=false;
    const show=(animate)=>{cube.classList.remove('spin');cube.style.transition=animate?'transform .7s cubic-bezier(.65,0,.25,1)':'none';cube.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;};
    function draw(){
      const weather=window.GitDeckWeather;
      const repos=reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));
      const byName=new Map(repos.map(repo=>[repo.name,repo]));
      const snap=readJson('gitdeck.pendingSnapshot',null);const cache=readJson('gitdeck.forecastCache',{});
      const pending=new Map((snap?.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));
      const familyOf=weather?weather.familyOf:(name)=>name.split('-')[0]+'-';
      const faces=cubeFaces(repos.map(repo=>repo.name),facesBy.value==='folder'?(name)=>folderOf(byName.get(name)?.path)||familyOf(name):familyOf);
      const activity=colourBy.value==='activity';
      cube.replaceChildren();legend.replaceChildren();
      faces.forEach((face,index)=>{
        const side=el('div','fleet-cube-face');side.style.transform=places[index];side.style.gridTemplateColumns=`repeat(${face.size}, minmax(0, 1fr))`;
        for(let i=0;i<face.size*face.size;i++){
          const name=face.members[i];const button=el('button',name?'':'empty');button.type='button';
          if(name){
            const repo=byName.get(name);const w=weather?weather.weatherFor(pending.get(repo.path.toLowerCase()),cache[repo.path.toLowerCase()]):{level:'unknown',reasons:[]};
            if(activity){button.style.background=heatColor[heat(repo.lastCommit)];button.title=[name,repo.lastCommit||''].filter(Boolean).join('\n');}
            else{button.style.background=levelColor[w.level]||levelColor.unknown;button.title=[name,...(w.reasons||[])].join('\n');}button.setAttribute('aria-label',name);
            button.onclick=()=>{if(moved)return;document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')void openWorkspace(repo,'changes');};
          }else{button.disabled=true;button.setAttribute('aria-hidden','true');}
          side.append(button);
        }
        side.append(el('b','',face.family+(face.hidden?` +${face.hidden}`:'')));cube.append(side);
        const pick=el('button','',`${face.family} · ${face.members.length+face.hidden}`);pick.type='button';
        pick.onclick=()=>{[rx,ry]=faceAngles[index];show(true);};legend.append(pick);
      });
      status.textContent=snap?t('{families} families · {repos} repositories · weather from the Pending check of {time}',{families:faces.length,repos:repos.length,time:new Date(snap.at).toLocaleString()}):t('Run a Pending check for weather colours; grey stickers are not checked yet.');
    }
    stage.addEventListener('pointerdown',(event)=>{dragging={x:event.clientX,y:event.clientY,rx,ry,id:event.pointerId};moved=false;stage.classList.add('dragging');if(cube.classList.contains('spin')){const m=getComputedStyle(cube).transform;cube.classList.remove('spin');cube.style.transform=m==='none'?'':m;}});
    stage.addEventListener('pointermove',(event)=>{if(!dragging)return;const dx=event.clientX-dragging.x,dy=event.clientY-dragging.y;// Capture only once it is a drag, so a plain click still reaches the sticker.
      if(!moved&&Math.abs(dx)+Math.abs(dy)>4){moved=true;try{stage.setPointerCapture(dragging.id);}catch{}}ry=dragging.ry+dx*0.4;rx=Math.max(-90,Math.min(90,dragging.rx-dy*0.4));show(false);});
    const stop=()=>{dragging=null;stage.classList.remove('dragging');setTimeout(()=>{moved=false;},0);};
    stage.addEventListener('pointerup',stop);stage.addEventListener('pointercancel',stop);
    folder.addEventListener('change',draw);facesBy.addEventListener('change',draw);colourBy.addEventListener('change',draw);draw();
    window.addEventListener('storage',(event)=>{if(event.key==='gitdeck.pendingSnapshot'&&panel.isConnected)draw();});
  }
  addPanel('fleet-cube',t('Fleet cube'),build);
})();
