'use strict';
// Opening (Appearance › Opening): how Git Deck appears when it starts, plus a greeting for the time
// of day. Loaded right after web/startup.js so it can take over the splash's finish.
//   logo    - the splash logo shrinks into the top-left corner while the app grows in, then a greeting.
//   stars   - every repository flies in as a star, grouped by family and coloured by its weather
//             (web/weather.js), then the app; click or Esc skips.
//   command - one box first: "What will you do today?", with what you usually do now, the top Inbox
//             items and, in the evening, Close the day. Enter, Esc or a click opens the app.
//   cube    - a scrambled Rubik's cube twists itself solved; stickers that stay red or amber are your
//             repositories that need you (web/weather.js). The green face with the Git Deck mark turns to
//             you and the app grows out of it. Click or Esc skips.
//   off     - the splash just fades.
// Reduced motion: every opening becomes a plain fade; the greeting still shows.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  function daypart(hour){return hour>=5&&hour<12?'morning':hour>=12&&hour<17?'afternoon':hour>=17&&hour<22?'evening':'night';}
  function greeting(part,name){
    const who=String(name||'').trim().split(/\s+/)[0]||'';
    const text={morning:t('Good morning'),afternoon:t('Good afternoon'),evening:t('Good evening'),night:t('Working late')}[part];
    return who?`${text}, ${who}`:text;
  }
  // Star targets: one cluster per family on a grid that fits the window; stars on a small spiral.
  function constellation(names,width,height){
    const families=new Map();
    for(const name of names){const at=String(name).indexOf('-');const key=at>0?String(name).slice(0,at+1):'·';if(!families.has(key))families.set(key,[]);families.get(key).push(name);}
    const groups=[...families.entries()].sort((a,b)=>b[1].length-a[1].length);
    const cols=Math.max(1,Math.ceil(Math.sqrt(groups.length*width/Math.max(1,height))));const rows=Math.max(1,Math.ceil(groups.length/cols));
    const cellW=width/cols,cellH=height/rows;const stars=[],labels=[];
    groups.forEach(([family,members],g)=>{
      const cx=cellW*(g%cols+0.5),cy=cellH*(Math.floor(g/cols)+0.5);labels.push({family,x:cx,y:cy-Math.min(cellH*0.42,70)});
      members.forEach((name,i)=>{const angle=i*2.4,r=7*Math.sqrt(i+1);stars.push({name,family,x:cx+r*Math.cos(angle),y:cy+r*Math.sin(angle)});});
    });
    return {stars,labels};
  }
  // Cube stickers: six faces of nine, each face its own colour, except that each repository that needs
  // you (storm = red, rain = amber) keeps one sticker in its colour, spread over the faces; the centre
  // of the front face holds the Git Deck mark. Returns {face: [9 colours]}.
  const cubeColors={front:'#0b6e47',right:'#2f81f7',back:'#d29922',left:'#e5534b',top:'#eef1f4',bottom:'#6e7781'};
  function cubeStickers(levels){
    const faces=Object.fromEntries(Object.entries(cubeColors).map(([face,color])=>[face,Array(9).fill(color)]));
    const marks=(levels||[]).filter(level=>level==='storm'||level==='rain').slice(0,16);
    const order=['front','top','right','left','back','bottom'];const spots=[0,2,6,8,4,1,3,5,7];let i=0;
    for(const level of marks){
      for(let tries=0;tries<54;tries++,i++){const face=order[i%6],spot=spots[Math.floor(i/6)%9];if(face==='front'&&spot===4)continue;if(faces[face][spot]===cubeColors[face]){faces[face][spot]=level==='storm'?'#f85149':'#f2b84b';i++;break;}}
    }
    return faces;
  }
  const helpers={daypart,greeting,constellation,cubeStickers,cubeColors};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const root=document.documentElement;root.dataset.daypart=daypart(new Date().getHours());
  const startup=window.GitDeckStartup;if(!startup)return;
  const mode=()=>window.GitDeckAppearance?.opening||'cube';
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  let name='';
  const whoAmI=fetch('/api/activity/me',{headers:{'X-Git-Deck':'1'}}).then(r=>r.json()).then(answer=>{name=answer?.identity?.name||'';}).catch(()=>{});
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  // Short facts for the greeting: open Inbox items and the stormiest family.
  function facts(){
    const out=[];const snap=readJson('gitdeck.pendingSnapshot',null);const inbox=window.GitDeckInboxHelpers;
    if(snap&&inbox){const items=(snap.items||[]).flatMap(item=>inbox.itemsFor({path:item.path,name:String(item.path).split(/[\\/]/).pop()},item.pending,{}));const open=inbox.sortItems(inbox.visibleItems(items,readJson('gitdeck.inboxState',{})));if(open.length)out.push({kind:'inbox',text:t('{count} thing(s) waiting for you',{count:open.length}),items:open.slice(0,3)});}
    const weather=window.GitDeckWeather;
    if(snap&&weather){const cache=readJson('gitdeck.forecastCache',{});const pending=new Map((snap.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));const fam=new Map();for(const repo of (typeof state!=='undefined'?state.repos||[]:[])){const w=weather.weatherFor(pending.get(String(repo.path).toLowerCase()),cache[String(repo.path).toLowerCase()]);if(w.level==='unknown')continue;const key=weather.familyOf(repo.name);if(!fam.has(key))fam.set(key,[]);fam.get(key).push({name:repo.name,w});}
      const skies=[...fam.entries()].map(([family,rows])=>({family,sky:weather.familySky(rows)})).filter(item=>item.sky.worst).sort((a,b)=>(b.sky.worst==='storm')-(a.sky.worst==='storm'));
      if(skies[0])out.push({kind:'weather',text:`${skies[0].family} ${skies[0].sky.icon} ${skies[0].sky.where.join(', ')}`});}
    return out;
  }
  function greetCard(){
    const part=daypart(new Date().getHours());
    const card=make('div','gd-greeting');card.setAttribute('role','status');
    card.append(make('strong','',greeting(part,name)));
    for(const fact of facts())card.append(make('span','',fact.text));
    if(part==='evening'&&window.GitDeckDayClose){const close=make('button','',t('Close the day'));close.type='button';close.onclick=()=>{card.remove();window.GitDeckDayClose.open();};card.append(close);}
    const x=make('button','gd-greeting-x','×');x.type='button';x.setAttribute('aria-label',t('Close'));x.onclick=()=>card.remove();card.append(x);
    document.body.append(card);setTimeout(()=>card.classList.add('out'),7000);setTimeout(()=>card.remove(),7600);
  }
  const shell=()=>document.querySelector('main.shell')||document.body;
  function growApp(duration){if(still()||typeof shell().animate!=='function')return;shell().animate([{opacity:.0,transform:'scale(.97)'},{opacity:1,transform:'scale(1)'}],{duration,easing:'cubic-bezier(.2,.8,.2,1)'});}

  // ---- logo: the splash logo flies into the corner ----------------------------------------------
  function logoOpening(original){
    const splash=document.getElementById('startup-splash');const logo=splash?.querySelector('.startup-logo');
    if(!splash?.open||!logo||still()||typeof logo.animate!=='function'){original();void whoAmI.then(greetCard);return;}
    document.getElementById('startup-background')?.remove();
    const from=logo.getBoundingClientRect();const size=26;const to={left:14,top:8};
    const dx=to.left-from.left,dy=to.top-from.top,scale=size/from.width;
    logo.style.transformOrigin='0 0';
    logo.animate([{transform:'translate(0,0) scale(1)'},{transform:`translate(${dx}px,${dy}px) scale(${scale})`}],{duration:620,easing:'cubic-bezier(.65,0,.25,1)',fill:'forwards'});
    splash.querySelector('.startup-wordmark')?.animate([{opacity:1},{opacity:0}],{duration:200,fill:'forwards'});
    splash.animate([{backgroundColor:getComputedStyle(splash).backgroundColor},{backgroundColor:'rgba(0,0,0,0)'}],{duration:520,delay:120,easing:'ease-in',fill:'forwards'});
    splash.querySelector('.startup-card')?.animate([{backgroundColor:getComputedStyle(splash.querySelector('.startup-card')).backgroundColor},{backgroundColor:'rgba(0,0,0,0)'}],{duration:420,delay:120,fill:'forwards'});
    growApp(620);
    setTimeout(()=>{if(splash.open)splash.close();void whoAmI.then(greetCard);},680);
  }

  // ---- cube: a Rubik's cube twists itself solved, then opens into the app -------------------------
  function weatherLevels(){
    const snap=readJson('gitdeck.pendingSnapshot',null);const weather=window.GitDeckWeather;if(!snap||!weather)return [];
    const cache=readJson('gitdeck.forecastCache',{});
    return (snap.items||[]).filter(item=>!/\.worktrees[\\/]/i.test(item.path)).map(item=>weather.weatherFor(item.pending,cache[String(item.path).toLowerCase()]).level);
  }
  function cubeOpening(){
    if(still()){void whoAmI.then(greetCard);return;}
    const S=Math.round(Math.min(220,Math.max(150,Math.min(window.innerWidth,window.innerHeight)*0.26))),third=S/3;
    const levels=weatherLevels();const stickers=cubeStickers(levels);
    const overlay=make('div','gd-cube-open');overlay.setAttribute('aria-hidden','true');
    const stage=make('div','gd-cube-stage');const cube=make('div','gd-cube');cube.style.setProperty('--s',S+'px');stage.append(cube);
    const caption=make('div','gd-cube-caption');
    const sideTurn={front:0,right:90,back:180,left:-90};const scrambled=[-90,90,180];const slices=[];
    for(let row=0;row<3;row++){
      const slice=make('div','gd-cube-slice');slice.style.top=row*third+'px';slice.style.height=third+'px';slice.style.transform=`rotateY(${scrambled[row]}deg)`;
      for(const [face,deg] of Object.entries(sideTurn)){
        const side=make('div','gd-cube-face');side.style.height=third+'px';side.style.transform=`rotateY(${deg}deg) translateZ(${S/2}px)`;
        for(let col=0;col<3;col++){const tile=make('i');tile.style.background=stickers[face][row*3+col];if(face==='front'&&row===1&&col===1)tile.className='gd-cube-logo';side.append(tile);}
        slice.append(side);
      }
      if(row!==1){
        const cap=make('div','gd-cube-face gd-cube-cap');cap.style.top=(third/2-S/2)+'px';cap.style.height=S+'px';cap.style.transform=row===0?`rotateX(90deg) translateZ(${third/2}px)`:`rotateX(-90deg) translateZ(${third/2}px)`;
        for(const color of stickers[row===0?'top':'bottom']){const tile=make('i');tile.style.background=color;cap.append(tile);}
        slice.append(cap);
      }
      cube.append(slice);slices.push(slice);
    }
    overlay.append(stage,caption);document.body.append(overlay);
    const need=levels.filter(level=>level==='storm'||level==='rain').length;
    let ended=false;const timers=[];
    const end=()=>{if(ended)return;ended=true;timers.forEach(clearTimeout);overlay.classList.add('gone');growApp(520);setTimeout(()=>overlay.remove(),520);void whoAmI.then(greetCard);};
    const at=(ms,run)=>timers.push(setTimeout(run,ms));
    requestAnimationFrame(()=>overlay.classList.add('in'));
    at(380,()=>{slices[0].style.transform='rotateY(0deg)';});
    at(800,()=>{slices[1].style.transform='rotateY(0deg)';});
    at(1220,()=>{slices[2].style.transform='rotateY(0deg)';});
    at(1700,()=>{cube.classList.add('solved');caption.textContent=need?t('{count} repositories need you: the red and amber stickers',{count:need}):greeting(daypart(new Date().getHours()),name);});
    at(2150,()=>{cube.classList.add('face');overlay.classList.add('opening');});
    at(2700,end);
    overlay.addEventListener('click',end);
    document.addEventListener('keydown',function skip(event){if(event.key==='Escape'){document.removeEventListener('keydown',skip);end();}});
  }

  // ---- stars: every repository flies in, coloured by its weather ---------------------------------
  function starsOpening(tries=0){
    const repos=(typeof state!=='undefined'?state.repos||[]:[]).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));
    // The repository list may still be loading when the splash ends: wait up to 3 seconds for it.
    if(!repos.length&&tries<30&&!still()){setTimeout(()=>starsOpening(tries+1),100);return;}
    if(still()||!repos.length){void whoAmI.then(greetCard);return;}
    const canvas=make('canvas','gd-stars');const ctx=canvas.getContext('2d');if(!ctx){greetCard();return;}
    const dpr=window.devicePixelRatio||1;const w=window.innerWidth,h=window.innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
    const caption=make('div','gd-stars-caption');document.body.append(canvas,caption);
    const {stars,labels}=constellation(repos.map(repo=>repo.name),w,h*0.86);
    const snap=readJson('gitdeck.pendingSnapshot',null);const cache=readJson('gitdeck.forecastCache',{});const pending=new Map((snap?.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));
    const byName=new Map(repos.map(repo=>[repo.name,repo]));
    const colors={storm:'#f85149',rain:'#d29922',cloud:'#58a6ff',sun:'#3fb950',unknown:'#8b949e'};
    for(const star of stars){const repo=byName.get(star.name);const level=window.GitDeckWeather?.weatherFor(pending.get(String(repo?.path).toLowerCase()),cache[String(repo?.path).toLowerCase()])?.level||'unknown';star.color=colors[level];star.glow=level==='storm'||level==='rain';const a=Math.random()*Math.PI*2,d=Math.max(w,h)*0.75;star.sx=w/2+Math.cos(a)*d;star.sy=h/2+Math.sin(a)*d;star.delay=Math.random()*350;star.y+=h*0.07;}
    for(const label of labels)label.y+=h*0.07;
    const start=performance.now();let ended=false;
    const end=()=>{if(ended)return;ended=true;canvas.animate?.([{opacity:1},{opacity:0}],{duration:380,fill:'forwards'});caption.remove();setTimeout(()=>canvas.remove(),400);growApp(420);void whoAmI.then(greetCard);};
    const ease=(x)=>1-Math.pow(1-x,3);
    const frame=(now)=>{
      if(ended)return;const time=now-start;ctx.clearRect(0,0,w,h);
      for(const star of stars){const p=ease(Math.min(1,Math.max(0,(time-star.delay)/1200)));const x=star.sx+(star.x-star.sx)*p,y=star.sy+(star.y-star.sy)*p;
        if(star.glow&&p>0.9){ctx.beginPath();ctx.fillStyle=star.color+'40';ctx.arc(x,y,7+2*Math.sin(time/160),0,Math.PI*2);ctx.fill();}
        ctx.beginPath();ctx.fillStyle=star.color;ctx.arc(x,y,3.4,0,Math.PI*2);ctx.fill();}
      const fade=Math.min(1,Math.max(0,(time-1000)/400));
      if(fade>0){ctx.globalAlpha=fade;ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text-secondary')||'#888';ctx.font='600 12px "Segoe UI", system-ui, sans-serif';ctx.textAlign='center';for(const label of labels)ctx.fillText(label.family,label.x,label.y);ctx.globalAlpha=1;}
      if(time>1300&&!caption.textContent)caption.textContent=greeting(daypart(new Date().getHours()),name);
      if(time>2600)return end();
      requestAnimationFrame(frame);
    };
    canvas.onclick=end;document.addEventListener('keydown',function skip(event){if(event.key==='Escape'){document.removeEventListener('keydown',skip);end();}});
    requestAnimationFrame(frame);
  }

  // ---- command: one box first ----------------------------------------------------------------------
  function commandOpening(){
    const part=daypart(new Date().getHours());
    const overlay=make('div','gd-command-open');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label',t('What will you do today?'));
    const box=make('div','gd-command-box');const title=make('h1','',greeting(part,name));
    const input=make('input','gd-command-input');input.placeholder=t('What will you do today?');input.setAttribute('aria-label',t('What will you do today?'));
    const list=make('div','gd-command-list');
    box.append(title,input,list);overlay.append(box);document.body.append(overlay);
    void whoAmI.then(()=>{title.textContent=greeting(part,name);});
    let closed=false;
    const close=(then)=>{if(closed)return;closed=true;const finish=()=>{overlay.remove();growApp(360);if(typeof then==='function')then();};if(still()||typeof overlay.animate!=='function')return finish();overlay.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(1.06)'}],{duration:260,easing:'ease-in',fill:'forwards'}).onfinish=finish;setTimeout(finish,400);};
    const row=(label,detail,run)=>{const button=make('button','gd-command-row');button.type='button';button.append(make('strong','',label));if(detail)button.append(make('small','',detail));button.onclick=()=>close(run);list.append(button);return button;};
    const entries=typeof commandPaletteEntries==='function'?commandPaletteEntries():[];
    for(const entry of entries.filter(item=>item.group===t('Suggested')).slice(0,3))row(entry.label,entry.shortcut,entry.run);
    for(const fact of facts())if(fact.kind==='inbox')for(const item of fact.items)row(`${item.repo.name} · ${item.title}`,item.detail,()=>{if(typeof showOperationsCenter==='function')showOperationsCenter('inbox');});
    else row(fact.text,t('Repository weather'),()=>{if(typeof showOperationsCenter==='function')showOperationsCenter('weather');});
    if(part==='evening'&&window.GitDeckDayClose)row(t('Close the day'),'',()=>window.GitDeckDayClose.open());
    if(!list.children.length)list.append(make('p','gd-command-empty',t('Type a command, or press Esc to go straight to work.')));
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Enter'){event.preventDefault();const text=input.value.trim();if(!text){const first=list.querySelector('.gd-command-row');if(first)first.click();else close();return;}close(()=>{if(typeof showCommandPalette!=='function')return;showCommandPalette();const search=document.getElementById('command-search');if(search){search.value=text;search.dispatchEvent(new Event('input',{bubbles:true}));}});}
    });
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    setTimeout(()=>input.focus(),50);
  }

  // For trying an opening again from the console or a future Preview button.
  // Appearance › Opening › Preview: play the chosen opening again without reloading.
  function preview(chosen=mode()){
    document.querySelectorAll('.theme-picker[open]').forEach(menu=>menu.removeAttribute('open'));
    if(chosen==='cube')return cubeOpening();
    if(chosen==='stars')return starsOpening();
    if(chosen==='command')return commandOpening();
    if(chosen==='off')return greetCard();
    const splash=document.getElementById('startup-splash');if(!splash)return greetCard();
    splash.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());
    if(!splash.open)splash.showModal();
    setTimeout(()=>logoOpening(()=>{if(splash.open)splash.close();}),900);
  }
  window.GitDeckEntrance={cube:cubeOpening,stars:()=>starsOpening(),command:commandOpening,greet:greetCard,preview};
  const original=startup.finish;
  startup.finish=function(){
    const chosen=mode();
    if(chosen==='logo')return logoOpening(original);
    original();
    if(chosen==='cube')setTimeout(cubeOpening,120);
    else if(chosen==='stars')setTimeout(starsOpening,240);
    else if(chosen==='command')setTimeout(commandOpening,200);
  };
})();
