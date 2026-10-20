'use strict';
// Fleet map: every repository as a small tile, grouped by family (aml-, crs-, lns-…), coloured by
// state, so the whole folder fits in one window. Uses the last Pending check (kept on this computer)
// and can run a new one. Click a tile to open the repository.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // ok (tidy), warn (something to do), bad (stuck), info (only new commits to pull), stale (tidy and
  // untouched for 90 days).
  function tileState(p,{error='',now=Date.now()}={}){
    if(error)return 'bad';if(!p)return 'muted';
    if(p.conflicts||p.operation)return 'bad';
    if(p.changed||p.untracked||p.ahead||(p.unpushedBranches||[]).length||(!p.upstream&&p.branch&&!['main','master','develop','development'].includes(p.branch)))return 'warn';
    if(p.behind||p.upstreamGone)return 'info';
    const at=Date.parse(p.lastCommitDate||'');if(Number.isFinite(at)&&now-at>90*864e5)return 'stale';
    return 'ok';
  }
  const familyOf=(name)=>{const text=String(name||'');const at=text.indexOf('-');return (at>0?text.slice(0,at):text).toLowerCase();};
  // Families with two or more repositories, then "" for the single ones; tiles keep the given order.
  function groupFamilies(items){
    const groups=new Map();for(const item of items){const key=familyOf(item.repo.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
    const out=[];const single=[];
    for(const [key,list] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){if(list.length>1)out.push({family:key,items:list});else single.push(...list);}
    if(single.length)out.push({family:'',items:single});
    return out;
  }
  const helpers={tileState,groupFamilies,familyOf};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,mapLimit,query}=F;
  const snapshotKey='gitdeck.pendingSnapshot';
  const readSnapshot=()=>{try{return JSON.parse(localStorage.getItem(snapshotKey)||'null');}catch{return null;}};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const toneLabel={ok:'Tidy',warn:'Something to do',bad:'Stuck or failed',info:'New commits to pull',stale:'Untouched for 90 days',muted:'Not checked yet'};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const run=button(t('Check now'),'primary');bar.append(folder,run);
    const legend=el('div','gd-map-legend');
    for(const tone of ['warn','bad','info','ok','stale'])legend.append(el('span',`tone-${tone==='stale'?'muted':tone}`,t(toneLabel[tone])));
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Every repository of the folder as a tile, grouped by family and coloured by state, from the last Pending check. Hover a tile for details, click it to open the repository.')),legend,status,out);
    let fresh=new Map();
    const draw=()=>{
      const snap=readSnapshot();const saved=new Map((snap?.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));
      const items=repos.map(repo=>{const key=repo.path.toLowerCase();const hit=fresh.get(key);return {repo,pending:hit?hit.pending:saved.get(key),error:hit?.error||''};});
      out.replaceChildren();
      if(!items.length){out.append(el('div','multi-repo-empty',t('No repositories in this folder.')));return;}
      for(const group of groupFamilies(items.sort((a,b)=>a.repo.name.localeCompare(b.repo.name)))){
        const box=el('section','gd-map-family');const busy=group.items.filter(item=>['warn','bad'].includes(tileState(item.pending,{error:item.error}))).length;
        const head=el('h4','',group.family?group.family+'-':t('Others'));head.append(el('small','',t('{count} repositories · {busy} need something',{count:group.items.length,busy})));box.append(head);
        const tiles=el('div','gd-map-tiles');
        for(const item of group.items){
          const state=tileState(item.pending,{error:item.error});const p=item.pending||{};
          const tile=el('button',`gd-tile tone-${state==='stale'?'muted':state}${state==='stale'?' stale':''}`);tile.type='button';
          const short=group.family&&item.repo.name.toLowerCase().startsWith(group.family+'-')?item.repo.name.slice(group.family.length+1):item.repo.name;
          const labels=window.GitDeckMultiRepo?.pendingLabels?.(p)?.map(label=>label.text)||[];
          tile.append(el('strong','',short),el('small','',item.error?t('Could not check'):(labels[0]||p.branch||t('Not checked yet'))));
          tile.title=[item.repo.name,p.branch?`${t('Branch')}: ${p.branch}`:'',...labels,p.latestTag?`🏷 ${p.latestTag}`:'',p.lastCommitDate?`${t('Last commit')}: ${String(p.lastCommitDate).slice(0,10)} ${p.lastCommitSubject||''}`:'',item.error].filter(Boolean).join('\n');
          tile.onclick=()=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(item.repo,'history',null);};
          tiles.append(tile);
        }
        box.append(tiles);out.append(box);
      }
      const at=snap?.at?new Date(snap.at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
      if(!fresh.size)status.textContent=at?t('From the Pending check of {time}',{time:at}):t('Not checked yet: press Check now.');
    };
    run.onclick=async()=>{
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));if(!repos.length)return;
      run.disabled=true;fresh=new Map();let done=0;
      await mapLimit(repos,8,async repo=>{
        let pending=null,error='';try{pending=(await api('/api/repo/pending?'+query({path:repo.path}))).pending;}catch(problem){error=problem.message;}
        fresh.set(repo.path.toLowerCase(),{pending,error});status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});
      });
      // Keep the Pending snapshot in step, so Today and Pending start from the same picture.
      try{const snap=readSnapshot()||{items:[]};const map=new Map((snap.items||[]).map(item=>[String(item.path).toLowerCase(),item]));for(const [key,value] of fresh)if(value.pending)map.set(key,{path:repos.find(repo=>repo.path.toLowerCase()===key)?.path||key,pending:value.pending});localStorage.setItem(snapshotKey,JSON.stringify({at:Date.now(),items:[...map.values()]}));}catch{}
      run.disabled=false;status.textContent=t('Checked {total} repositories',{total:repos.length});draw();
    };
    folder.addEventListener('change',draw);
    window.addEventListener('gitdeck:repo-changed',async(event)=>{
      const path=String(event.detail?.path||'');if(!path||!panel.isConnected)return;
      try{const pending=(await api('/api/repo/pending?'+query({path}))).pending;fresh.set(path.toLowerCase(),{pending,error:''});draw();}catch{}
    });
    draw();
  }

  addPanel('fleet-map',t('Fleet map'),build);
  window.GitDeckFleetMap=helpers;
})();
