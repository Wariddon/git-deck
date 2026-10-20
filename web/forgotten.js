'use strict';
// Forgotten work: stashes and branches that exist only on this computer and have not moved for a while,
// each with what is inside (message, date, files), so you can decide: push it, finish it or drop it.
// Nothing is deleted here; every button opens the repository on the right view.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Repositories worth asking, from the last Pending check (stashes or branches only here); all when unknown.
  function candidates(repos,snapshot){
    if(!snapshot?.items?.length)return repos;
    const flagged=new Set(snapshot.items.filter(item=>(item.pending?.stashes||[]).length||(item.pending?.unpushedBranches||[]).length).map(item=>String(item.path).toLowerCase()));
    const known=new Set(snapshot.items.map(item=>String(item.path).toLowerCase()));
    return repos.filter(repo=>flagged.has(repo.path.toLowerCase())||!known.has(repo.path.toLowerCase()));
  }
  const ageDays=(date,now=Date.now())=>Math.max(0,Math.floor((now-Date.parse(date))/864e5));
  const helpers={candidates,ageDays};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const readSnapshot=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.pendingSnapshot')||'null');}catch{return null;}};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const days=document.createElement('select');days.className='workflow-input';days.setAttribute('aria-label',t('Older than'));
    for(const value of [7,14,30,90])days.append(new Option(t('Older than {days} days',{days:value}),String(value)));days.value='14';
    const run=button(t('Find'),'primary');bar.append(folder,days,run);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Stashes and branches that exist only on this computer and have not moved for a while, with what is inside. Push what you still need, finish it, or drop it yourself; nothing is deleted here.')),status,out);
    const open=(repo,tab)=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(repo,tab,null);};
    run.onclick=async()=>{
      const all=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));const repos=candidates(all,readSnapshot());
      run.disabled=true;out.replaceChildren();let done=0;
      const found=await mapLimit(repos,8,async repo=>{
        let forgotten=null;try{forgotten=(await api('/api/repo/forgotten?'+query({path:repo.path,days:days.value}))).forgotten;}catch{}
        status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});return {repo,forgotten};
      });
      run.disabled=false;
      const hits=found.filter(item=>item.forgotten&&(item.forgotten.stashes.length||item.forgotten.branches.length)).sort((a,b)=>a.repo.name.localeCompare(b.repo.name));
      const pieces=hits.reduce((n,item)=>n+item.forgotten.stashes.length+item.forgotten.branches.length,0);
      status.textContent=t('{pieces} piece(s) of work in {repos} repositories (checked {checked} of {total})',{pieces,repos:hits.length,checked:repos.length,total:all.length});
      if(!hits.length){out.append(el('div','multi-repo-empty',t('Nothing forgotten: no old stash and no old branch that exists only here.')));return;}
      for(const item of hits){
        const card=el('section','family-edit-card');const head=el('div','family-edit-head');head.append(repoLink(item.repo));card.append(head);
        for(const stash of item.forgotten.stashes){
          const row=el('div','gd-card tone-warn');row.append(el('strong','',`📦 ${stash.ref} · ${stash.message}`),el('small','',t('{days} days old · {files}',{days:ageDays(stash.date),files:(stash.files||[]).join(', ')||'—'})));
          const go=button(t('Open stashes'),'gd-card-action');go.onclick=()=>open(item.repo,'stashes');row.append(go);card.append(row);
        }
        for(const branch of item.forgotten.branches){
          const row=el('div','gd-card tone-warn');row.append(el('strong','',`🌿 ${branch.name} · ${t('{count} commit(s) only here',{count:branch.commits})}`),el('small','',t('{days} days old · {subject} · {files}',{days:ageDays(branch.date),subject:branch.subject,files:(branch.files||[]).slice(0,5).join(', ')||'—'})));
          const go=button(t('Open branches'),'gd-card-action');go.onclick=()=>open(item.repo,'branches');row.append(go);card.append(row);
        }
        out.append(card);
      }
    };
  }

  addPanel('forgotten',t('Forgotten work'),build);
  window.GitDeckForgotten=helpers;
})();
