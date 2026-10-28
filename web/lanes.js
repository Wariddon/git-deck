'use strict';
// Ticket lanes: one column per ticket you are working on, with every repository it touches, how far it
// has got (pushed, merged, first tag, environments from the last Releases load) and the next step.
// Lanes come from your current branches and ticket worktrees (AP2365-3320 in feature/AP2365-3320),
// plus keys you add. Read-only except the buttons you press.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // A key starts the branch or a path segment (feature/AP2365-3320-x), so feature/fatca-dec-2026 is not DEC-2026.
  // The number does not start with 0 (dev-01 is a name) and is not followed by more letters (24XX).
  const keyRe=/(?:^|[/_\s(\[])([A-Za-z][A-Za-z0-9]{1,9}-[1-9]\d{0,11})(?![A-Za-z0-9])/;
  const keyOf=(text)=>(String(text||'').match(keyRe)?.[1]||'').toUpperCase();
  // Ticket keys -> repositories, from the Pending snapshot and ticket worktrees.
  function detectLanes(snapshotItems,workspaces,extra=[]){
    const lanes=new Map();const add=(key,path,branch,source)=>{if(!key)return;if(!lanes.has(key))lanes.set(key,new Map());const list=lanes.get(key);if(!list.has(path.toLowerCase()))list.set(path.toLowerCase(),{path,branch,source});};
    for(const item of snapshotItems||[]){
      const p=item.pending||{};add(keyOf(p.branch),item.path,p.branch,'branch');
      for(const local of p.unpushedBranches||[])add(keyOf(local.branch),item.path,local.branch,'local branch');
    }
    for(const ws of workspaces||[])add(ws.key||keyOf(ws.branch),ws.main||ws.path,ws.branch,'worktree');
    for(const key of extra)if(!lanes.has(key))lanes.set(key,new Map());
    return [...lanes.entries()].map(([key,repos])=>({key,repos:[...repos.values()]})).sort((a,b)=>b.repos.length-a.repos.length||a.key.localeCompare(b.key));
  }
  // The next step of a lane from its repositories' state and journeys.
  function nextStep(cards){
    if(!cards.length)return {tone:'muted',text:t('Find the repositories of this ticket')};
    if(cards.some(c=>c.pending&&(c.pending.changed||c.pending.untracked)))return {tone:'warn',text:t('Commit your changes')};
    if(cards.some(c=>c.pending&&c.pending.ahead))return {tone:'warn',text:t('Push your commits')};
    if(cards.some(c=>c.journey&&!c.journey.pushed))return {tone:'warn',text:t('Push the ticket branch')};
    if(cards.some(c=>c.journey&&!(c.journey.merged||[]).length))return {tone:'info',text:t('Open or merge the merge request')};
    if(cards.some(c=>c.journey&&!c.journey.firstTag))return {tone:'info',text:t('Tag a build')};
    if(cards.some(c=>(c.journey?.environments||[]).some(env=>env.contains===false)))return {tone:'info',text:t('Promote to the next environment')};
    return {tone:'ok',text:t('Nothing left that Git Deck can see')};
  }
  const helpers={keyOf,detectLanes,nextStep};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,mapLimit,runQuiet,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};

  function build(panel){
    const bar=el('div','operations-toolbar');
    const input=el('input','workflow-input');input.type='search';input.placeholder=t('Ticket key, for example AP2365-3320');input.setAttribute('aria-label',t('Add a lane'));
    const add=button(t('Add lane'),'primary');const refresh=button(t('Refresh'));bar.append(input,add,refresh);
    const status=el('small','multi-repo-status');const board=el('div','lanes-board');
    panel.append(bar,el('p','multi-repo-explain',t('One lane per ticket you are working on: every repository it touches, how far it has got and the next step. Lanes come from your current branches and ticket worktrees; add others by key.')),status,board);
    const repoBy=(path)=>(state.repos||[]).find(repo=>repo.path.toLowerCase()===String(path).toLowerCase());
    async function load(){
      const snap=readJson('gitdeck.pendingSnapshot',null);let workspaces=[];try{workspaces=(await api('/api/ticket-workspaces')).workspaces||[];}catch{}
      const extra=readJson('gitdeck.lanes',[]);const hidden=new Set(readJson('gitdeck.lanesHidden',[]));
      const lanes=detectLanes(snap?.items||[],workspaces,extra).filter(lane=>!hidden.has(lane.key));
      status.textContent=lanes.length?t('{count} ticket(s)',{count:lanes.length}):t('No ticket branch found. Add a ticket key above, or run a Pending check.');
      const deployed=(repo)=>window.GitDeckIntegrations?.deployedTags?.(repo)||[];
      board.replaceChildren();
      for(const lane of lanes){
        const column=el('section','lane');column.setAttribute('aria-label',lane.key);
        const head=el('div','lane-head');const remove=button('×','lane-remove');remove.title=t('Hide this lane');remove.setAttribute('aria-label',t('Hide this lane'));
        remove.onclick=()=>{const list=new Set(readJson('gitdeck.lanesHidden',[]));list.add(lane.key);writeJson('gitdeck.lanesHidden',[...list]);writeJson('gitdeck.lanes',readJson('gitdeck.lanes',[]).filter(key=>key!==lane.key));load();};
        head.append(el('strong','mono',lane.key),remove);column.append(head);
        const steps=el('div','lane-steps');const next=el('div','lane-next');column.append(steps);
        const cards=[];
        const cardsBox=el('div','lane-cards');column.append(cardsBox,next);
        board.append(column);
        const found=await mapLimit(lane.repos,4,async entry=>{
          const repo=repoBy(entry.path);if(!repo)return null;
          let pending=null,journey=null;
          try{pending=(await api('/api/repo/pending?'+query({path:repo.path}))).pending;}catch{}
          try{journey=(await api('/api/repo/ticket-journey?'+query({path:repo.path,key:lane.key,envs:deployed(repo).map(item=>`${item.env}:${item.tag}`).join('|')}))).journey;}catch{}
          return {repo,entry,pending,journey:journey?.found?journey:null};
        });
        for(const card of found.filter(Boolean)){
          cards.push(card);const p=card.pending||{};const j=card.journey;
          const box=el('article','lane-card');
          const top=el('div','lane-card-top');top.append(el('strong','',card.repo.name));
          const state_=(p.changed||p.untracked)?el('span','tone-warn',t('{count} changed',{count:(p.changed||0)+(p.untracked||0)})):p.ahead?el('span','tone-warn','↑'+p.ahead):el('span','tone-ok',t('clean'));
          top.append(state_);box.append(top,el('span','mono lane-branch',card.entry.branch||p.branch||''));
          if(j){const chips=el('div','lane-chips');for(const step of (window.GitDeckFleet?.journeySteps?.(j)||[]))chips.append(el('span',`fleet-journey-step tone-${step.tone}`,step.text));box.append(chips);}
          const actions=el('div','lane-actions');const open=button(t('Open'));open.onclick=()=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(card.repo,(p.changed||p.untracked)?'changes':'history',null);};actions.append(open);
          if(p.ahead&&p.upstream){const push=button(t('Push'));push.onclick=async()=>{push.disabled=true;try{const answer=await runQuiet('push',card.repo);showActionFeedback(`${card.repo.name} · ${String(answer?.message||t('Done')).split('\n')[0]}`);load();}catch(error){push.disabled=false;showActionFeedback(error.message,{error:true,context:card.repo.name});}};actions.append(push);}
          box.append(actions);cardsBox.append(box);
        }
        if(!cards.length){const find=button(t('Find its repositories'));find.onclick=()=>{try{localStorage.setItem('gitdeck.ticketKey',lane.key);}catch{}window.GitDeckTicketMode?.enter?.(lane.key);if(typeof showOperationsCenter==='function')showOperationsCenter('ticket');};cardsBox.append(find);}
        const pushed=cards.filter(c=>c.journey?.pushed).length,merged=cards.filter(c=>(c.journey?.merged||[]).length).length,tagged=cards.filter(c=>c.journey?.firstTag).length;
        if(cards.length)for(const [label,count] of [[t('pushed'),pushed],[t('merged'),merged],[t('tagged'),tagged]])steps.append(el('span',`fleet-journey-step tone-${count===cards.length?'ok':count?'info':'muted'}`,`${count===cards.length?'✓':count+'/'+cards.length} ${label}`));
        const step=nextStep(cards);next.className=`lane-next tone-${step.tone}`;next.textContent=t('Next: {step}',{step:step.text});
        // Finished tickets step aside: last on the board, quieter.
        if(step.tone==='ok'){column.classList.add('lane-done');board.append(column);}
      }
    }
    add.onclick=()=>{const key=keyOf(input.value);if(!key){status.textContent=t('Use a ticket key, for example PAY-1234.');return;}const list=new Set(readJson('gitdeck.lanes',[]));list.add(key);writeJson('gitdeck.lanes',[...list]);writeJson('gitdeck.lanesHidden',readJson('gitdeck.lanesHidden',[]).filter(item=>item!==key));input.value='';load();};
    input.addEventListener('keydown',event=>{if(event.key==='Enter')add.click();});
    refresh.onclick=load;
    load();
  }

  addPanel('lanes',t('Ticket lanes'),build);
  window.GitDeckLanes=helpers;
})();
