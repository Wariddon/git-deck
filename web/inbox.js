'use strict';
// Inbox: everything that needs you across every repository, one item at a time (Superhuman / Linear
// triage). Built from the last Pending check (kept on this computer; Refresh runs a new one): work to
// commit, push or pull, branches deleted on the remote, branches only on this computer, new tags by
// others. E marks an item done (it comes back if it changes), H snoozes it until tomorrow, D or Enter
// runs the suggested step, J/K move. Nothing runs without your key or click.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const DAY=864e5;
  // One repository's pending state -> inbox items {key, sig, group, tone, kind, title, detail, action}.
  function itemsFor(repo,p,{me='',now=Date.now()}={}){
    if(!p)return [];const out=[];const add=(kind,group,tone,title,detail,action,sig)=>out.push({key:`${kind}|${repo.path.toLowerCase()}`,sig:String(sig),group,tone,kind,repo,title,detail,action});
    const branch=p.branch||'HEAD';
    const on=t('on {branch}',{branch});
    if(p.conflicts||p.operation)add('conflict','now','bad',t('{operation} not finished',{operation:p.operation||'merge'}),t('{count} conflict(s) on {branch}',{count:p.conflicts||0,branch}),'resolve',`${p.operation}${p.conflicts}`);
    if(p.upstreamGone)add('gone','now','info',t('{branch} was deleted on the remote',{branch}),t('Usually merged: switch to the main branch and delete it here'),'cleanup',branch);
    if(p.changed||p.untracked)add('commit','now','warn',t('{count} file(s) not committed',{count:(p.changed||0)+(p.untracked||0)}),on,'commit',(p.changed||0)+(p.untracked||0));
    if(p.ahead)add('push','now','warn',t('{count} commit(s) to push',{count:p.ahead}),on,'push',p.ahead);
    if(p.behind)add('pull','look','info',t('{count} new commit(s) to pull',{count:p.behind}),on,'pull',p.behind);
    for(const item of p.unpushedBranches||[])add(`local:${item.branch}`,'look','warn',t('{branch}: {count} commit(s) only on this computer',{branch:item.branch,count:item.commits}),t('Push it if you still need it'),'branches',item.commits);
    const tagAt=Date.parse(p.latestTagDate||'');
    if(p.latestTag&&Number.isFinite(tagAt)&&now-tagAt<3*DAY&&(!me||String(p.latestTagBy||'').toLowerCase()!==me))add(`tag:${p.latestTag}`,'fyi','muted',t('New tag {tag}',{tag:p.latestTag}),p.latestTagBy?t('by {who}',{who:p.latestTagBy}):'','tags',p.latestTag);
    return out;
  }
  // Hide what you marked done (until it changes) or snoozed (until the time passes).
  function visibleItems(items,state,now=Date.now()){
    return items.filter(item=>{const s=state?.[item.key];if(!s)return true;if(s.snoozeUntil&&s.snoozeUntil>now)return false;if(s.doneSig&&s.doneSig===item.sig)return false;return true;});
  }
  const order={now:0,look:1,fyi:2};const toneOrder={bad:0,warn:1,info:2,muted:3};
  const sortItems=(items)=>[...items].sort((a,b)=>order[a.group]-order[b.group]||toneOrder[a.tone]-toneOrder[b.tone]||a.repo.name.localeCompare(b.repo.name));
  const tomorrowMorning=(now=new Date())=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,9,0,0);return d.getTime();};
  const helpers={itemsFor,visibleItems,sortItems,tomorrowMorning};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,runQuiet,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const snapshotKey='gitdeck.pendingSnapshot',stateKey='gitdeck.inboxState';
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  let me='';try{Promise.resolve(api('/api/activity/me')).then(answer=>{me=String(answer?.identity?.email||'').toLowerCase();}).catch(()=>{});}catch{}
  const actionLabel={commit:t('Commit…'),push:t('Push'),pull:t('Pull'),cleanup:t('Clean up branches'),branches:t('Open branches'),tags:t('Open tags'),resolve:t('Resolve')};
  const groupLabel={now:t('Needs you now'),look:t('Worth a look'),fyi:t('For your information')};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const refresh=button(t('Refresh'),'primary');bar.append(folder,refresh);
    const status=el('small','multi-repo-status');
    const layout=el('div','inbox-layout');const filters=el('nav','inbox-filters');filters.setAttribute('aria-label',t('Inbox filters'));
    const list=el('section','inbox-list');list.setAttribute('aria-label',t('Items'));const detail=el('aside','inbox-detail');detail.setAttribute('aria-label',t('Selected item'));
    layout.append(filters,list,detail);
    panel.append(bar,el('p','multi-repo-explain',t('Everything that needs you across every repository, one item at a time. E marks it done (it comes back if it changes), H snoozes it until tomorrow 9:00, D or Enter runs the suggested step, J/K move.')),status,layout);
    let fresh=new Map();let view='inbox';let selected='';let family='';
    const snapshot=()=>{const snap=readJson(snapshotKey,null);const map=new Map((snap?.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));for(const [key,value] of fresh)map.set(key,value);return {at:snap?.at,map};};
    const allItems=()=>{const {map}=snapshot();const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));return sortItems(repos.flatMap(repo=>itemsFor(repo,map.get(repo.path.toLowerCase()),{me})));};
    const familyOf=(name)=>{const at=String(name).indexOf('-');return at>0?name.slice(0,at+1):'';};
    function draw(){
      const state=readJson(stateKey,{});const items=allItems();const now=Date.now();
      const open=visibleItems(items,state,now);const snoozed=items.filter(item=>state[item.key]?.snoozeUntil>now);
      const done=items.filter(item=>state[item.key]?.doneSig===item.sig);
      const families=[...new Set(open.map(item=>familyOf(item.repo.name)).filter(Boolean))].sort();
      // Filters with counts.
      filters.replaceChildren();
      const filterButton=(id,label,count)=>{const node=button('',`inbox-filter${view===id?' on':''}`);node.append(el('span','',label),el('b','',String(count)));node.onclick=()=>{view=id;selected='';draw();};filters.append(node);};
      filterButton('inbox',t('Needs you'),open.filter(item=>item.group!=='fyi').length);
      filterButton('fyi',t('For your information'),open.filter(item=>item.group==='fyi').length);
      filterButton('snoozed',t('Snoozed'),snoozed.length);
      filterButton('done',t('Done'),done.length);
      if(families.length){filters.append(el('p','inbox-filter-head',t('Families')));for(const name of families){const node=button('',`inbox-filter${family===name?' on':''}`);node.append(el('span','',name),el('b','',String(open.filter(item=>familyOf(item.repo.name)===name).length)));node.onclick=()=>{family=family===name?'':name;draw();};filters.append(node);}}
      // Items.
      let shown=view==='snoozed'?snoozed:view==='done'?done:view==='fyi'?open.filter(item=>item.group==='fyi'):open.filter(item=>item.group!=='fyi');
      if(family)shown=shown.filter(item=>familyOf(item.repo.name)===family);
      list.replaceChildren();
      if(!shown.length){list.append(el('div','inbox-empty',view==='inbox'?t('Inbox zero: nothing waiting anywhere.'):t('Nothing here.')));detail.replaceChildren();return;}
      if(!shown.some(item=>item.key===selected))selected=shown[0].key;
      let lastGroup='';
      for(const item of shown){
        if(view!=='snoozed'&&view!=='done'&&item.group!==lastGroup){lastGroup=item.group;list.append(el('p','inbox-group',groupLabel[item.group]));}
        const row=button('',`inbox-row tone-${item.tone}${item.key===selected?' on':''}`);row.dataset.key=item.key;
        const text=el('span','inbox-row-text');text.append(el('strong','',item.repo.name),document.createTextNode(` · ${item.title}`),el('small','',item.detail));
        row.append(el('span','inbox-dot'),text,el('span','inbox-key',item.action==='commit'?'C':item.action==='push'?'P':item.action==='pull'?'U':'D'));
        row.onclick=()=>{selected=item.key;draw();list.querySelector(`[data-key="${CSS.escape(item.key)}"]`)?.focus();};
        list.append(row);
      }
      const current=shown.find(item=>item.key===selected);drawDetail(current);
    }
    function drawDetail(item){
      detail.replaceChildren();if(!item)return;
      detail.append(el('p','fleet-muted',item.repo.name),el('h3','',item.title),el('p','',item.detail));
      const p=snapshot().map.get(item.repo.path.toLowerCase())||{};
      const facts=el('ul','inbox-facts');
      for(const line of [p.branch?`${t('Branch')}: ${p.branch}${p.upstream?' → '+p.upstream:''}`:'',p.latestTag?`🏷 ${p.latestTag}`:'',p.lastCommitSubject?`${t('Last commit')}: ${p.lastCommitSubject}`:''].filter(Boolean))facts.append(el('li','',line));
      detail.append(facts);
      const actions=el('div','inbox-actions');
      const go=button(actionLabel[item.action]||t('Open'),'primary');go.onclick=()=>run(item,go);
      const snooze=button(t('Snooze until tomorrow'));snooze.onclick=()=>mark(item,'snooze');
      const done=button(t('Done'));done.onclick=()=>mark(item,'done');
      actions.append(go,snooze,done);detail.append(actions);
    }
    function mark(item,how){
      const state=readJson(stateKey,{});
      if(how==='done')state[item.key]={doneSig:item.sig,at:Date.now()};
      else if(how==='snooze')state[item.key]={snoozeUntil:tomorrowMorning(),at:Date.now()};
      else delete state[item.key];
      // Keep the state small: forget marks older than 30 days.
      for(const [key,value] of Object.entries(state))if(Date.now()-(value.at||0)>30*DAY)delete state[key];
      writeJson(stateKey,state);selected='';draw();list.querySelector('.inbox-row')?.focus();
    }
    const openRepo=(repo,tab)=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(repo,tab,null);};
    async function run(item,go){
      if(item.action==='commit')return openRepo(item.repo,'changes');
      if(item.action==='resolve')return openRepo(item.repo,'conflicts');
      if(item.action==='branches')return openRepo(item.repo,'branches');
      if(item.action==='tags')return openRepo(item.repo,'tags');
      if(item.action==='cleanup'){document.getElementById('operations-close')?.click();return window.GitDeckMultiRepo?.openBranchCleanup?.(item.repo);}
      go.disabled=true;go.textContent=t('Working…');
      try{const answer=await runQuiet(item.action,item.repo,item.action==='pull'?{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}:{});
        showActionFeedback(`${item.repo.name} · ${String(answer?.message||t('Done')).split('\n')[0]}`);
        try{fresh.set(item.repo.path.toLowerCase(),(await api('/api/repo/pending?'+query({path:item.repo.path}))).pending);}catch{}
        draw();
      }catch(error){go.disabled=false;go.textContent=t('Retry');showActionFeedback(error.message,{error:true,context:item.repo.name});}
    }
    // Keys while an item has focus.
    list.addEventListener('keydown',(event)=>{
      const row=event.target.closest?.('.inbox-row');if(!row||event.ctrlKey||event.metaKey||event.altKey)return;
      const items=allItems();const item=items.find(entry=>entry.key===row.dataset.key);if(!item)return;
      const key=event.key.toLowerCase();
      if(key==='e'){event.preventDefault();mark(item,'done');}
      else if(key==='h'){event.preventDefault();mark(item,'snooze');}
      else if(key==='d'||key==='enter'||(key==='c'&&item.action==='commit')||(key==='p'&&item.action==='push')||(key==='u'&&item.action==='pull')){event.preventDefault();run(item,detail.querySelector('.inbox-actions .primary')||el('button'));}
      else if(key==='j'||key==='k'||event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();const rows=[...list.querySelectorAll('.inbox-row')];const at=rows.indexOf(row);const next=rows[Math.max(0,Math.min(rows.length-1,at+((key==='j'||event.key==='ArrowDown')?1:-1)))];
        if(next){selected=next.dataset.key;for(const r of rows)r.classList.toggle('on',r===next);next.focus();drawDetail(items.find(entry=>entry.key===selected));}
      }
    });
    refresh.onclick=async()=>{
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));if(!repos.length)return;
      refresh.disabled=true;let done=0;
      await mapLimit(repos,8,async repo=>{try{fresh.set(repo.path.toLowerCase(),(await api('/api/repo/pending?'+query({path:repo.path}))).pending);}catch{}status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});});
      try{const snap=readJson(snapshotKey,{items:[]});const map=new Map((snap.items||[]).map(item=>[String(item.path).toLowerCase(),item]));for(const repo of repos){const value=fresh.get(repo.path.toLowerCase());if(value)map.set(repo.path.toLowerCase(),{path:repo.path,pending:value});}writeJson(snapshotKey,{at:Date.now(),items:[...map.values()]});}catch{}
      refresh.disabled=false;status.textContent=t('Checked {total} repositories',{total:repos.length});draw();
    };
    folder.addEventListener('change',draw);
    window.addEventListener('gitdeck:repo-changed',async(event)=>{const path=String(event.detail?.path||'');if(!path||!panel.isConnected)return;try{fresh.set(path.toLowerCase(),(await api('/api/repo/pending?'+query({path}))).pending);draw();}catch{}});
    const snap=readJson(snapshotKey,null);status.textContent=snap?.at?t('From the Pending check of {time}',{time:new Date(snap.at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}):t('Not checked yet: press Refresh.');
    draw();
  }

  addPanel('inbox',t('Inbox'),build);
  window.GitDeckInbox=helpers;
})();
