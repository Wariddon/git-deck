'use strict';
// Flow UI: the screen follows what you are doing.
// - Context morph: the action bar puts the next sensible step forward (commit when files changed, pull
//   when behind, push when ahead, fetch when all is clean); the rest stay as small icons.
// - Status sentence: the status bar says the repository's state as one clickable sentence.
// - Zen: writing a commit message hides everything around it; move the pointer to an edge to see it all
//   again. Ctrl+Alt+Z switches zen on and off by hand.
// - Focus lens (off unless chosen): the part of the window under the pointer stays sharp, the rest fades.
// - Peek: hold Space over a commit or a changed file to see it in a floating card; let go to close.
// - Timeline (Ctrl+Alt+T): history as one line from old to now; "Now" holds the changed files, drag a
//   file onto Stage to stage it.
// - Command-first: Ctrl+K understands plain requests in English and Thai ("open txi", "fetch all in SCB",
//   "go history", "theme dark").
// - Desks (Dashboard › Desks): worksets and open tabs as desks on a canvas you pan and zoom; each desk
//   keeps a note.
// Each part can be switched off in the theme menu (Flow); choices are kept on this computer.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The next steps for a repository, most important first.
  function nextActions({files=0,ahead=0,behind=0,conflicts=0}={}){
    if(Number(conflicts)>0)return ['commit'];
    const out=[];
    if(Number(files)>0)out.push('commit');
    if(Number(behind)>0)out.push('pull');
    if(Number(ahead)>0)out.push('push');
    if(!out.length)out.push('fetch');
    return out;
  }
  // The status sentence as parts; `go` names what a click on the part does.
  function sentence({branch='',files=0,ahead=0,behind=0,conflicts=0,upstream=''}={}){
    const parts=[{text:branch||'detached HEAD',go:'branches',kind:'branch'}];
    if(Number(conflicts)>0)parts.push({text:`${conflicts} conflict${conflicts==1?'':'s'} to resolve`,go:'conflicts',kind:'bad',count:Number(conflicts)});
    if(Number(files)>0)parts.push({text:`${files} file${files==1?'':'s'} to commit`,go:'changes',kind:'work',count:Number(files)});
    if(Number(behind)>0)parts.push({text:`${behind} commit${behind==1?'':'s'} to pull`,go:'pull',kind:'pull',count:Number(behind)});
    if(Number(ahead)>0)parts.push({text:`${ahead} commit${ahead==1?'':'s'} to push`,go:'push',kind:'push',count:Number(ahead)});
    if(parts.length===1)parts.push({text:upstream?`clean and up to date with ${upstream}`:'clean, no upstream',go:'fetch',kind:'ok',upstream});
    return parts;
  }
  // Plain requests for Ctrl+K. Returns what the text asks for, or null.
  const views={changes:'changes',change:'changes','\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e41\u0e1b\u0e25\u0e07':'changes','\u0e44\u0e1f\u0e25\u0e4c':'changes',history:'history','\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34':'history',log:'history',branches:'branches',branch:'branches','\u0e01\u0e34\u0e48\u0e07':'branches','\u0e41\u0e1a\u0e23\u0e19\u0e0a\u0e4c':'branches',stashes:'stashes',stash:'stashes',tags:'tags',tag:'tags','\u0e41\u0e17\u0e47\u0e01':'tags',compare:'compare','\u0e40\u0e17\u0e35\u0e22\u0e1a':'compare'};
  const themes={dark:'dark','\u0e21\u0e37\u0e14':'dark',light:'light','\u0e2a\u0e27\u0e48\u0e32\u0e07':'light',paper:'paper','\u0e01\u0e23\u0e30\u0e14\u0e32\u0e29':'paper',midnight:'midnight','\u0e40\u0e17\u0e35\u0e48\u0e22\u0e07\u0e04\u0e37\u0e19':'midnight',focus:'focus','\u0e42\u0e1f\u0e01\u0e31\u0e2a':'focus',system:'system','\u0e23\u0e30\u0e1a\u0e1a':'system'};
  function parseIntent(text){
    const raw=String(text||'').trim();const lower=raw.toLowerCase();if(raw.length<2)return null;
    let m=/^(?:fetch|\u0e14\u0e36\u0e07)\s+(?:all|\u0e17\u0e38\u0e01\s*(?:repo|\u0e23\u0e35\u0e42\u0e1b)?|everything)?\s*(?:repos?\s*)?(?:in|\u0e43\u0e19)\s+(.+)$/i.exec(lower);
    if(m)return {kind:'fetch-folder',folder:m[1].trim()};
    m=/^(?:theme|\u0e18\u0e35\u0e21)\s*(\S+)/i.exec(lower);if(m&&themes[m[1]])return {kind:'theme',theme:themes[m[1]]};
    m=/^(?:go|goto|\u0e44\u0e1b|\u0e44\u0e1b\u0e17\u0e35\u0e48|\u0e14\u0e39)\s*(\S+)/i.exec(lower);if(m&&views[m[1]])return {kind:'view',view:views[m[1]]};
    m=/^(?:open|\u0e40\u0e1b\u0e34\u0e14)\s+(.+)$/i.exec(raw);
    if(m){const words=m[1].trim();const ticket=/[A-Z][A-Z0-9]+-\d+/.exec(words.toUpperCase());const name=words.replace(/\b(?:branch|\u0e1a\u0e23\u0e32\u0e19\u0e0a\u0e4c|\u0e01\u0e34\u0e48\u0e07)\b/ig,' ').replace(/[A-Z][A-Z0-9]+-\d+/ig,' ').trim();return {kind:'open',name,ticket:ticket?ticket[0]:''};}
    return null;
  }
  // How well a repository name matches typed words (0 = not at all).
  function score(name,words){
    const n=String(name).toLowerCase();const parts=String(words||'').toLowerCase().split(/[\s/]+/).filter(Boolean);
    if(!parts.length)return 0;let total=0;
    for(const part of parts){const at=n.indexOf(part);if(at<0)return 0;total+=at===0?3:n[at-1]==='-'||n[at-1]==='_'?2:1;}
    return total+1/(1+n.length);
  }
  // Zoom for the desk canvas: wheel steps, kept between 0.3 and 2.
  const zoomBy=(zoom,deltaY)=>Math.round(Math.max(0.3,Math.min(2,zoom*(deltaY>0?0.9:1.1)))*100)/100;
  const helpers={nextActions,sentence,parseIntent,score,zoomBy};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  // ---- settings ------------------------------------------------------------------------------------
  const defaults={morph:true,sentence:true,zen:true,lens:false,peek:true};
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const flow={...defaults,...readJson('gitdeck.flow',{})};
  const body=document.body;
  const applyFlow=()=>{for(const key of Object.keys(defaults))body.classList.toggle(`gd-flow-${key}`,Boolean(flow[key]));};
  applyFlow();
  const labels={morph:t('Next step first'),sentence:t('Status as a sentence'),zen:t('Zen while writing'),lens:t('Focus lens'),peek:t('Peek with Space')};
  function addPicker(menu){
    if(menu.querySelector('.flow-choice'))return;
    const block=el('div','look-choice flow-choice');block.append(el('strong','',t('Flow')));
    for(const key of Object.keys(defaults)){
      const button=el('button','',labels[key]);button.type='button';button.dataset.flow=key;button.setAttribute('aria-pressed',String(flow[key]));
      button.onclick=()=>{flow[key]=!flow[key];writeJson('gitdeck.flow',flow);applyFlow();button.setAttribute('aria-pressed',String(flow[key]));update(true);};
      block.append(button);
    }
    menu.append(block);
  }
  document.querySelectorAll('.theme-menu').forEach(addPicker);

  // ---- what the open repository looks like now ----------------------------------------------------------
  const ws=()=>(typeof state!=='undefined'&&state.workspaceRepo&&state.workspace)||null;
  const facts=()=>{const w=ws();if(!w)return null;const sync=w.sync||{};return {branch:w.branch||'',files:(w.files||[]).length,ahead:sync.ahead||0,behind:sync.behind||0,conflicts:(w.files||[]).filter(file=>/U/.test(String(file.status||''))).length,upstream:sync.upstream||''};};
  function run(go){
    if(['changes','branches','conflicts','history'].includes(go)&&typeof selectWorkspaceTab==='function'){if(window.GitDeckRubik?.dashboardOpen?.()&&typeof hideOperationsCenter==='function')hideOperationsCenter();selectWorkspaceTab(go);return;}
    if(typeof runWorkspaceAction!=='function')return;
    if(go==='fetch')runWorkspaceAction('fetch');
    else if(go==='pull')runWorkspaceAction('pull',{strategy:state.meta.pullStrategy},typeof syncConfirmation==='function'?syncConfirmation('pull'):'Pull?');
    else if(go==='push')runWorkspaceAction('push',{},typeof syncConfirmation==='function'?syncConfirmation('push'):'Push?');
  }

  // ---- context morph + status sentence -----------------------------------------------------------
  const sentenceNode=el('span','gd-sentence');sentenceNode.setAttribute('aria-live','polite');
  let lastKey='';
  function update(force){
    const f=facts();const key=f?JSON.stringify(f)+flow.morph+flow.sentence:'none';
    if(!force&&key===lastKey&&sentenceNode.isConnected)return;lastKey=key;
    const next=f?nextActions(f):[];
    document.querySelectorAll('.modern-actions button[data-act]').forEach(button=>{
      const rank=next.indexOf(button.dataset.act);
      button.classList.toggle('gd-next',flow.morph&&rank===0);button.classList.toggle('gd-next-2',flow.morph&&rank>0);
      button.classList.toggle('gd-quiet',flow.morph&&Boolean(f)&&rank<0);
    });
    const bar=document.getElementById('workspace-statusbar');
    if(bar&&!sentenceNode.isConnected)bar.prepend(sentenceNode);
    sentenceNode.replaceChildren();
    if(f&&flow.sentence)sentence(f).forEach((part,index)=>{
      if(index)sentenceNode.append(el('i','',' · '));
      const words={bad:()=>t('{count} conflicts to resolve',{count:part.count}),work:()=>t('{count} files to commit',{count:part.count}),pull:()=>t('{count} commits to pull',{count:part.count}),push:()=>t('{count} commits to push',{count:part.count}),ok:()=>part.upstream?t('clean and up to date with {upstream}',{upstream:part.upstream}):t('clean, no upstream')}[part.kind];
      const button=el('button',`gd-sentence-part is-${part.kind}`,words?words():part.text);button.type='button';
      button.title={branches:t('Open Branches'),conflicts:t('Open the Conflict Center'),changes:t('Open Changes'),pull:t('Pull (asks first)'),push:t('Push (asks first)'),fetch:t('Fetch')}[part.go]||'';
      button.onclick=()=>run(part.go);sentenceNode.append(button);
    });
  }
  setInterval(()=>{if(!document.hidden)update(false);},800);
  document.addEventListener('gitdeck:appearance',()=>update(true));

  // ---- zen -------------------------------------------------------------------------------------------
  const zen=(on)=>body.classList.toggle('gd-zen',Boolean(on));
  document.addEventListener('focusin',(event)=>{if(flow.zen&&event.target.matches?.('#workspace-content textarea'))zen(true);});
  document.addEventListener('focusout',(event)=>{if(event.target.matches?.('#workspace-content textarea'))setTimeout(()=>{if(!document.activeElement?.matches?.('#workspace-content textarea'))zen(false);},120);});
  document.addEventListener('pointermove',(event)=>{
    if(!body.classList.contains('gd-zen'))return;
    const edge=26;const near=event.clientX<edge||event.clientY<edge||event.clientX>innerWidth-edge||event.clientY>innerHeight-edge;
    body.classList.toggle('gd-zen-peek',near||Boolean(event.target.closest?.('.gd-zen-peek-keep')));
  },{passive:true});
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  document.addEventListener('keydown',(event)=>{
    if(event.ctrlKey&&event.altKey&&!event.shiftKey&&event.code==='KeyZ'){event.preventDefault();zen(!body.classList.contains('gd-zen'));}
    else if(event.key==='Escape'&&body.classList.contains('gd-zen')&&!typing(event.target))zen(false);
    else if(event.ctrlKey&&event.altKey&&!event.shiftKey&&event.code==='KeyT'){event.preventDefault();toggleTimeline();}
  });

  // ---- focus lens ----------------------------------------------------------------------------------
  const regions='.panel.repos, .modern-rail, .workbench-tree, #workspace-content, .workspace-modal-head, #workspace-statusbar, #repo-tabs';
  let lensOn=null;
  document.addEventListener('pointerover',(event)=>{
    if(!flow.lens)return;const region=event.target.closest?.(regions);if(region===lensOn)return;
    lensOn?.classList.remove('gd-lens-on');lensOn=region;region?.classList.add('gd-lens-on');body.classList.toggle('gd-lens-active',Boolean(region));
  },{passive:true});
  document.addEventListener('pointerleave',()=>{lensOn?.classList.remove('gd-lens-on');lensOn=null;body.classList.remove('gd-lens-active');});

  // ---- peek ------------------------------------------------------------------------------------------
  let hover=null,peekCard=null,peeking=false,pointer={x:0,y:0};
  document.addEventListener('pointermove',(event)=>{pointer={x:event.clientX,y:event.clientY};hover=event.target;},{passive:true});
  const esc=(text)=>String(text??'');
  function place(card){const w=Math.min(560,innerWidth-24);card.style.width=`${w}px`;card.style.left=`${Math.min(innerWidth-w-12,Math.max(12,pointer.x+16))}px`;card.style.top=`${Math.min(innerHeight-120,Math.max(12,pointer.y+16))}px`;}
  async function peek(){
    const repo=state?.workspaceRepo;if(!repo||!hover)return;
    const commit=hover.closest?.('.commit-row[data-commit]');const file=hover.closest?.('.commit-file-main[data-path]');
    if(!commit&&!file)return;
    peeking=true;peekCard?.remove();peekCard=el('div','gd-peek');peekCard.setAttribute('role','tooltip');place(peekCard);body.append(peekCard);
    peekCard.append(el('small','fleet-muted',t('Loading…')));
    try{
      if(commit){
        const c=(await api('/api/repo/commit?'+new URLSearchParams({path:repo.path,commit:commit.dataset.commit}))).commit;if(!peeking)return;
        const list=el('ul','gd-peek-files');for(const f of (c.files||[]).slice(0,14))list.append(el('li','',`${f.status} ${f.path}  +${f.added||0} −${f.removed||0}`));
        if((c.files||[]).length>14)list.append(el('li','fleet-muted',t('and {count} more',{count:c.files.length-14})));
        peekCard.replaceChildren(el('strong','',esc(c.subject)),el('small','fleet-muted',`${c.hash} · ${esc(c.author)} · ${esc(c.date)}`),el('pre','gd-peek-body',esc(String(c.body||'').replace(/\r/g,'').split('\n').slice(1).join('\n').trim())||''),list);
      }else if(state.workspaceTab==='changes'){
        const path=file.dataset.path;let data=await api(`/api/repo/working-diff?path=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(path)}&staged=false`);
        let text=String(data.diff||data.patch||data.text||'');
        if(!text.trim()){data=await api(`/api/repo/working-diff?path=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(path)}&staged=true`);text=String(data.diff||data.patch||data.text||'');}
        if(!peeking)return;
        const pre=el('pre','gd-peek-diff');for(const line of text.split('\n').slice(0,60)){pre.append(el('span',line.startsWith('+')?'add':line.startsWith('-')?'del':line.startsWith('@@')?'hunk':'',line+'\n'));}
        peekCard.replaceChildren(el('strong','',path),pre);
      }else{
        peekCard.replaceChildren(el('strong','',file.dataset.path),el('small','fleet-muted',file.textContent.trim().slice(0,160)));
      }
      place(peekCard);
    }catch(error){if(peeking)peekCard.replaceChildren(el('small','fleet-muted',error.message||String(error)));}
  }
  document.addEventListener('keydown',(event)=>{
    if(event.code!=='Space'||event.repeat||!flow.peek||typing(event.target)||event.ctrlKey||event.altKey)return;
    if(!hover?.closest?.('.commit-row[data-commit], .commit-file-main[data-path]'))return;
    event.preventDefault();void peek();
  });
  document.addEventListener('keyup',(event)=>{if(event.code==='Space'&&peeking){peeking=false;peekCard?.remove();peekCard=null;}});
  window.addEventListener('blur',()=>{peeking=false;peekCard?.remove();peekCard=null;});

  // ---- timeline ------------------------------------------------------------------------------------
  let line=null;
  function drawTimeline(){
    const w=ws();line.body.replaceChildren();
    if(!w){line.body.append(el('p','fleet-muted',t('Open a repository to see its timeline.')));return;}
    const track=el('div','gd-timeline-track');
    const commits=(w.history||[]).slice(0,80).reverse();
    for(const c of commits){
      const card=el('button','gd-tl-commit');card.type='button';card.title=`${c.hash} · ${c.author} · ${c.date}\n${c.subject}`;
      const refs=String(c.decorations||'').split(',').map(r=>r.trim().replace(/^HEAD -> /,'')).filter(Boolean).slice(0,2);
      card.append(el('i','gd-tl-dot'),el('small','',`${c.hash} · ${String(c.date||'').slice(5,10)}`),el('b','',c.subject||''),...refs.map(r=>el('em','',r)));
      card.onclick=()=>{if(typeof selectWorkspaceTab==='function')selectWorkspaceTab('history');let tries=0;const pick=()=>{const row=document.querySelector(`.commit-row[data-commit="${c.fullHash}"]`);if(row){row.click();row.scrollIntoView({block:'center'});}else if(tries++<20)setTimeout(pick,150);};pick();};
      track.append(card);
    }
    const now=el('div','gd-tl-now');now.append(el('strong','',t('Now')),el('small','',(w.files||[]).length?t('{count} changed files: drag one onto Stage',{count:w.files.length}):t('Nothing changed')));
    const chips=el('div','gd-tl-files');
    for(const file of (w.files||[]).slice(0,40)){const chip=el('span','gd-tl-file',file.path.split('/').pop());chip.title=file.path;chip.draggable=true;chip.ondragstart=(event)=>{event.dataTransfer.setData('text/plain',file.path);};chips.append(chip);}
    const stage=el('div','gd-tl-stage',t('Stage'));stage.ondragover=(event)=>{event.preventDefault();stage.classList.add('over');};stage.ondragleave=()=>stage.classList.remove('over');
    stage.ondrop=async(event)=>{event.preventDefault();stage.classList.remove('over');const path=event.dataTransfer.getData('text/plain');if(path&&typeof runWorkspaceAction==='function'){await runWorkspaceAction('stage-file',{file:path});drawTimeline();}};
    const commitButton=el('button','primary',t('Write the commit…'));commitButton.type='button';commitButton.onclick=()=>{toggleTimeline(false);if(typeof selectWorkspaceTab==='function')selectWorkspaceTab('changes');setTimeout(()=>document.querySelector('#workspace-content textarea')?.focus(),300);};
    now.append(chips,stage,commitButton);track.append(now);
    line.body.append(track);requestAnimationFrame(()=>{track.scrollLeft=track.scrollWidth;});
    track.addEventListener('wheel',(event)=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){event.preventDefault();track.scrollLeft+=event.deltaY;}},{passive:false});
  }
  function toggleTimeline(force){
    const open=force??!(line&&line.node.isConnected);
    if(!open){line?.node.remove();return;}
    if(!line){const node=el('section','gd-timeline');node.setAttribute('aria-label',t('Timeline'));const head=el('div','gd-timeline-head');const close=el('button','',t('Close'));close.type='button';close.onclick=()=>toggleTimeline(false);head.append(el('strong','',t('Timeline')),el('small','fleet-muted',t('old on the left, now on the right · Ctrl+Alt+T')),close);const inner=el('div','gd-timeline-body');node.append(head,inner);line={node,body:inner};}
    body.append(line.node);drawTimeline();
  }

  // ---- command-first: plain requests in Ctrl+K ----------------------------------------------------------
  async function fetchFolder(folder){
    const repos=(state.repos||[]).filter(repo=>repo.valid!==false&&String(repo.path).toLowerCase().includes(folder.toLowerCase()));
    if(!repos.length){showActionFeedback?.(t('No repositories in "{folder}"',{folder}),{error:true});return;}
    if(!confirm(t('Fetch {count} repositories in "{folder}"?',{count:repos.length,folder})))return;
    let done=0,failed=0;
    for(const repo of repos){try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'fetch',path:repo.path})});done++;}catch{failed++;}}
    showActionFeedback?.(t('Fetched {done} of {count} repositories',{done,count:repos.length})+(failed?` · ${t('{count} failed',{count:failed})}`:''),{error:failed>0});
    if(typeof refresh==='function')void refresh();
  }
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;
    commandPaletteEntries=function(...args){
      const list=base.apply(this,args);const text=document.getElementById('command-search')?.value||'';
      const extra=[{label:t('Timeline'),group:t('Flow'),shortcut:'Ctrl+Alt+T',run:()=>toggleTimeline(true)},{label:t('Zen mode'),group:t('Flow'),shortcut:'Ctrl+Alt+Z',run:()=>zen(!body.classList.contains('gd-zen'))}];
      const intent=parseIntent(text);const asked=[];
      if(intent?.kind==='fetch-folder')asked.push({label:t('Fetch every repository in "{folder}"',{folder:intent.folder}),group:t('You asked'),run:()=>fetchFolder(intent.folder)});
      if(intent?.kind==='theme'&&typeof setTheme==='function')asked.push({label:t('Theme: {theme}',{theme:intent.theme}),group:t('You asked'),run:()=>setTheme(intent.theme)});
      if(intent?.kind==='view')asked.push({label:t('Go to {view}',{view:intent.view}),group:t('You asked'),run:()=>{if(window.GitDeckRubik?.dashboardOpen?.()&&typeof hideOperationsCenter==='function')hideOperationsCenter();if(typeof selectWorkspaceTab==='function')selectWorkspaceTab(intent.view);}});
      if(intent?.kind==='open'&&intent.name){
        const found=(state.repos||[]).map(repo=>({repo,s:score(repo.name,intent.name)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,6);
        for(const {repo} of found)asked.push({label:t('Open {name}',{name:repo.name})+(intent.ticket?` · ${intent.ticket}`:''),group:t('You asked'),run:()=>{document.getElementById('operations-close')?.click();void openWorkspace(repo,intent.ticket?'branches':'changes');}});
      }
      // Asked-for entries must pass the palette's own filter: they carry the typed text.
      return [...asked.map(item=>({...item,shortcut:'',search:`${text} ${item.label}`})),...list,...extra.map(item=>({...item,search:`${item.label} ${item.group} flow`}))];
    };
  }

  // ---- desks: worksets and open tabs on a canvas ------------------------------------------------------
  const F=window.GitDeckFleet;
  if(F&&document.querySelector('.operations-tabs'))F.addPanel('desks',t('Desks'),(panel)=>{
    const saved=readJson('gitdeck.desks',{});const view={x:0,y:0,zoom:1,...(saved.$view||{})};
    const explain=el('p','multi-repo-explain',t('Each workset and your open tabs as a desk. Drag the empty space to move around, the wheel to zoom, a desk by its title; click a repository to open it. Notes stay on this computer.'));
    const stage=el('div','gd-desks');const world=el('div','gd-desks-world');stage.append(world);panel.append(explain,stage);
    const save=()=>{saved.$view=view;writeJson('gitdeck.desks',saved);};
    const show=()=>{world.style.transform=`translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;};
    function draw(){
      world.replaceChildren();
      const sets=typeof readWorksets==='function'?readWorksets():[];
      const desks=[{name:t('Open tabs'),paths:(state.meta?.openRepos||[]).map(key=>(state.repos||[]).find(repo=>repoKey(repo)===key)?.path).filter(Boolean)},...sets.map(set=>({name:set.name,paths:set.paths}))];
      desks.forEach((desk,index)=>{
        const spot=saved[desk.name]||{x:40+(index%3)*380,y:40+Math.floor(index/3)*300,note:''};
        const card=el('div','gd-desk');card.style.left=`${spot.x}px`;card.style.top=`${spot.y}px`;
        const title=el('div','gd-desk-title',desk.name);const chips=el('div','gd-desk-repos');
        for(const path of desk.paths){
          const repo=(state.repos||[]).find(item=>String(item.path).toLowerCase()===String(path).toLowerCase());if(!repo)continue;
          const kind=window.GitDeckSpeedcube?.tabSticker?.({changes:repo.changes,ahead:repo.ahead,behind:repo.behind})||'clean';
          const chip=el('button',`gd-desk-repo is-${kind}`,repo.name);chip.type='button';chip.title=repo.path;
          chip.onclick=()=>{document.getElementById('operations-close')?.click();void openWorkspace(repo,'changes');};chips.append(chip);
        }
        if(!chips.childElementCount)chips.append(el('small','fleet-muted',t('No repositories')));
        const note=document.createElement('textarea');note.className='gd-desk-note';note.placeholder=t('Note for this desk…');note.value=spot.note||'';
        note.oninput=()=>{saved[desk.name]={...spot,note:note.value};spot.note=note.value;save();};
        card.append(title,chips,note);world.append(card);
        title.onpointerdown=(event)=>{event.stopPropagation();const start={x:event.clientX,y:event.clientY,sx:spot.x,sy:spot.y};title.setPointerCapture(event.pointerId);
          title.onpointermove=(move)=>{spot.x=Math.round(start.sx+(move.clientX-start.x)/view.zoom);spot.y=Math.round(start.sy+(move.clientY-start.y)/view.zoom);card.style.left=`${spot.x}px`;card.style.top=`${spot.y}px`;};
          title.onpointerup=()=>{title.onpointermove=null;saved[desk.name]=spot;save();};};
      });
      show();
    }
    stage.addEventListener('pointerdown',(event)=>{
      if(event.target!==stage&&event.target!==world)return;const start={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};stage.setPointerCapture(event.pointerId);stage.classList.add('dragging');
      stage.onpointermove=(move)=>{view.x=start.vx+move.clientX-start.x;view.y=start.vy+move.clientY-start.y;show();};
      stage.onpointerup=()=>{stage.onpointermove=null;stage.classList.remove('dragging');save();};
    });
    stage.addEventListener('wheel',(event)=>{if(event.target.closest('.gd-desk-note'))return;event.preventDefault();view.zoom=zoomBy(view.zoom,event.deltaY);show();save();},{passive:false});
    draw();
  });

  window.GitDeckFlow={...helpers,update,zen,toggleTimeline};
})();
