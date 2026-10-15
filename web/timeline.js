'use strict';
// Undo timeline (server side: lib/GitDeck.Timeline.ps1): every recorded action in every repository,
// newest first. "Undo" when the repository is still right after the action; "Go back to before this"
// when newer work followed (the branch moves back, newer commits stay in a backup ref). Actions done
// together (the same action in several repositories within two minutes) can be undone together.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const when=(text)=>Date.parse(String(text||'').replace(' ','T'));
  // Consecutive entries with the same action within two minutes of each other form one batch.
  function batches(items){
    const out=[];
    for(const item of items||[]){
      const last=out[out.length-1];const prev=last?.items[last.items.length-1];
      if(last&&prev.action===item.action&&Math.abs(when(prev.createdAt)-when(item.createdAt))<=120000&&!last.items.some(entry=>entry.path===item.path))last.items.push(item);
      else out.push({action:item.action,day:String(item.createdAt||'').slice(0,10),items:[item]});
    }
    return out;
  }
  const helpers={batches};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,table,row}=F;
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const short=(hash)=>String(hash||'').slice(0,8);
  const restore=(item)=>api('/api/action',{method:'POST',body:JSON.stringify({action:'timeline-restore',path:item.path,id:item.id})});

  function build(panel){
    const bar=el('div','operations-toolbar');const filter=el('input','workflow-input');filter.type='search';filter.placeholder=t('Filter by repository or action');filter.setAttribute('aria-label',filter.placeholder);
    const refresh=button(t('Refresh'));bar.append(filter,refresh);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body timeline-list');
    panel.append(bar,el('p','multi-repo-explain',t('Every commit, pull, merge, switch, reset, absorb and similar action Git Deck made, in every repository. Undo puts a repository back exactly; Go back moves the branch to before an action and keeps the newer commits in a backup ref.')),status,out);
    let items=[];
    const statusLabel={undone:t('Already undone'),latest:t('Can be undone'),moved:t('Newer work since'),'other-branch':t('On another branch now'),missing:t('Repository not available')};
    const draw=()=>{
      out.replaceChildren();const words=filter.value.trim().toLowerCase();
      const shown=items.filter(item=>!words||[item.repository,item.action,item.summary].join(' ').toLowerCase().includes(words));
      if(!shown.length){out.append(el('div','multi-repo-empty',items.length?t('Nothing to show.'):t('No recorded actions yet.')));return;}
      let day='';
      for(const batch of batches(shown)){
        if(batch.day!==day){day=batch.day;out.append(el('h4','timeline-day',day));}
        const section=el('section','timeline-batch');
        if(batch.items.length>1){
          const head=el('div','timeline-batch-head');head.append(el('strong','',t('{action} in {count} repositories',{action:batch.action,count:batch.items.length})));
          const undoable=batch.items.filter(item=>item.status==='latest');
          if(undoable.length){const all=button(t('Undo all {count}',{count:undoable.length}));all.onclick=()=>undoMany(undoable);head.append(all);}
          section.append(head);
        }
        const grid=table([t('Time'),t('Repository'),t('Action'),t('Commits'),t('State'),'']);grid.classList.add('timeline-table');
        for(const item of batch.items){
          const actions=el('div','fleet-actions');
          if(item.status==='latest'){const undo=button(t('Undo'),'primary');undo.onclick=()=>undoMany([item]);actions.append(undo);}
          else if(item.status==='moved'){const back=button(t('Go back to before this'));back.onclick=()=>goBack(item);actions.append(back);}
          const tone={undone:'info',latest:'ok',moved:'warn','other-branch':'muted',missing:'muted'}[item.status]||'muted';
          const summary=el('div','timeline-action');summary.append(el('strong','',item.action),el('small','fleet-muted',item.summary||''));
          grid.append(row([String(item.createdAt||'').slice(11,16),item.repository,summary,el('code','',`${short(item.beforeHead)} → ${short(item.afterHead)}`),el('span',`fleet-state tone-${tone}`,statusLabel[item.status]||item.status),actions]));
        }
        section.append(grid);out.append(section);
      }
    };
    async function load(){
      status.textContent=t('Reading the action history…');
      try{items=(await api('/api/timeline')).timeline||[];}catch(error){status.textContent='';out.replaceChildren(el('div','repo-alert tone-bad',error.message));return;}
      const undoable=items.filter(item=>item.status==='latest').length;
      status.textContent=t('{count} recorded actions · {undoable} can be undone exactly',{count:items.length,undoable});
      draw();
    }
    async function undoMany(list){
      if(!confirm(list.length>1?t('Undo {action} in {count} repositories?',{action:list[0].action,count:list.length}):t('Undo {action} in {name}?',{action:list[0].action,name:list[0].repository})))return;
      const errors=[];
      for(const item of list){try{await restore(item);}catch(error){errors.push(`${item.repository}: ${error.message.split('\n')[0]}`);}}
      feedback(errors.length?errors.join('\n'):t('Undone in {count} repositories',{count:list.length}),errors.length>0);
      if(typeof loadRepositoryCache==='function')try{await loadRepositoryCache(false);}catch{}
      await load();
    }
    async function goBack(item){
      if(!confirm(t('Move {branch} in {name} back to before {action} ({time})? Newer commits on it are kept in a backup ref, and Undo can bring them back.',{branch:item.beforeBranch,name:item.repository,action:item.action,time:item.createdAt})))return;
      try{const answer=await restore(item);feedback(answer.message);}catch(error){feedback(error.message,true);}
      await load();
    }
    filter.addEventListener('input',draw);refresh.onclick=load;
    load();
  }

  addPanel('timeline',t('Undo timeline'),build);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="timeline"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='timeline';item.append(el('strong','',t('Undo timeline')),el('small','',t('Every action in every repository, and undo')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('timeline');};
    more.append(item);
  }
  window.GitDeckTimeline=helpers;
})();
