'use strict';
// Today: a morning briefing in one page — new tags since you last looked, repositories with commits to
// pull or work to push, ticket workspaces with changes (for example an agent's work), and environments
// where production runs an older tag than UAT (from the last Releases load). Read-only and local,
// except the GitLab line, which appears only when the GitLab CLI is signed in.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const lowerEnvs=['uat','preprod','staging','sit','qa','dev'];
  // Services whose production tag differs from the nearest lower environment.
  function releaseDrift(entries){
    const byService=new Map();
    for(const entry of entries||[]){if(!byService.has(entry.service))byService.set(entry.service,new Map());byService.get(entry.service).set(String(entry.env).replace(/\d+$/,''),entry.tag);}
    const out=[];
    for(const [service,envs] of byService){
      const prod=envs.get('prod');if(!prod)continue;
      const lower=lowerEnvs.find(env=>envs.has(env));if(!lower)continue;
      if(envs.get(lower)!==prod)out.push({service,prod,env:lower,tag:envs.get(lower)});
    }
    return out.sort((a,b)=>a.service.localeCompare(b.service));
  }
  const dayOf=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const helpers={releaseDrift,dayOf};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,mapLimit,query,repoLink,whenOf}=F;
  const recall=(key,fallback='')=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
  const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const sinceKey='gitdeck.briefingSince';
  const since=()=>Number(recall(sinceKey,''))||Math.floor(Date.now()/1000)-24*3600;
  const usable=()=>(state.repos||[]).filter(repo=>repo.valid!==false&&!repo.pending);
  const readCache=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.deployMap')||'null');}catch{return null;}};

  function card(title,count,tone){const box=el('section',`briefing-card tone-${tone}`);const head=el('div','briefing-head');head.append(el('strong','',title),el('span',`fleet-state tone-${tone}`,String(count)));box.append(head);return box;}
  function list(box,items,render,empty){if(!items.length){box.append(el('p','fleet-muted',empty));return;}const ul=el('ul','briefing-list');for(const item of items.slice(0,12)){const li=el('li');render(li,item);ul.append(li);}box.append(ul);if(items.length>12)box.append(el('small','fleet-muted',t('and {count} more',{count:items.length-12})));}

  function build(panel){
    const head=el('header','briefing-intro');const title=el('h2','',t('Today'));const sub=el('p','fleet-muted','');
    const read=button(t('Mark all as seen'));const refresh=button(t('Refresh'));const actions=el('div','fleet-actions');actions.append(refresh,read);
    head.append(title,sub,actions);
    const grid=el('div','briefing-grid');const status=el('small','multi-repo-status');
    panel.append(head,status,grid);
    async function load(){
      const from=since();const repos=usable();
      sub.textContent=t('Since {time}',{time:new Date(from*1000).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})});
      grid.replaceChildren();
      // Local, instant: from the repository status cache.
      const pull=repos.filter(repo=>Number(repo.behind)>0).sort((a,b)=>Number(b.behind)-Number(a.behind));
      const push=repos.filter(repo=>Number(repo.ahead)>0||Number(repo.changes)>0).sort((a,b)=>Number(b.ahead)+Number(b.changes)-Number(a.ahead)-Number(a.changes));
      const pullCard=card(t('Commits to pull'),pull.length,pull.length?'info':'ok');
      list(pullCard,pull,(li,repo)=>li.append(repoLink(repo),el('span','fleet-muted',` ↓${repo.behind} · ${repo.branch||''}`)),t('Every repository is up to date with its remote (as of the last fetch).'));
      const pushCard=card(t('Your work not pushed'),push.length,push.length?'warn':'ok');
      list(pushCard,push,(li,repo)=>li.append(repoLink(repo),el('span','fleet-muted',[Number(repo.ahead)?` ↑${repo.ahead}`:'',Number(repo.changes)?` · ${t('{count} changed',{count:repo.changes})}`:''].join(''))),t('Nothing waiting: everything is committed and pushed.'));
      const drift=releaseDrift(readCache()?.entries);
      const driftCard=card(t('Production behind'),drift.length,drift.length?'warn':'ok');
      list(driftCard,drift,(li,item)=>li.append(el('strong','',item.service),el('span','fleet-muted',` PROD ${item.prod} · ${item.env.toUpperCase()} ${item.tag}`)),readCache()?t('Production runs the same tags as the lower environments.'):t('Load Releases once to compare environments.'));
      const tagsCard=card(t('New tags'),'…','muted');tagsCard.append(el('p','fleet-muted',t('Checking {count} repositories…',{count:repos.length})));
      const workCard=card(t('Ticket workspaces'),'…','muted');
      grid.append(tagsCard,pullCard,pushCard,workCard,driftCard);
      // Ticket workspaces (one request) and new tags (one light request per repository).
      api('/api/ticket-workspaces').then(answer=>{
        const items=(answer.workspaces||[]).filter(item=>item.changes||item.ahead);
        const box=card(t('Ticket workspaces'),items.length,items.length?'info':'ok');
        list(box,items,(li,item)=>li.append(el('strong','',`${item.key||item.branch} · ${item.mainName}`),el('span','fleet-muted',` ${item.changes?t('{count} changed',{count:item.changes}):''}${item.ahead?' ↑'+item.ahead:''}`)),t('No ticket workspace has unfinished work.'));
        workCard.replaceWith(box);
      }).catch(()=>workCard.remove());
      let done=0;
      const found=await mapLimit(repos,6,async repo=>{let tags=[];try{tags=(await api('/api/repo/recent-tags?'+query({path:repo.path,since:from}))).tags||[];}catch{}status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});return {repo,tags};});
      status.textContent='';
      const withTags=found.filter(item=>item.tags.length).sort((a,b)=>String(b.tags[0].date).localeCompare(String(a.tags[0].date)));
      const box=card(t('New tags'),withTags.reduce((n,item)=>n+item.tags.length,0),withTags.length?'info':'ok');
      list(box,withTags,(li,item)=>li.append(repoLink(item.repo),el('span','fleet-muted',' '+item.tags.map(tag=>tag.name).join(', ')+' · '+whenOf(item.tags[0].date))),t('No new tags since then.'));
      tagsCard.replaceWith(box);
    }
    read.onclick=()=>{remember(sinceKey,String(Math.floor(Date.now()/1000)));load();};
    refresh.onclick=load;
    load();
  }

  addPanel('briefing',t('Today'),build);
  // Once a day, shortly after start: a small card with the instant numbers and a way into Today.
  setTimeout(()=>{
    const today=dayOf(new Date());if(recall('gitdeck.briefingDay','')===today)return;
    const repos=usable();if(!repos.length)return;
    remember('gitdeck.briefingDay',today);
    const pull=repos.filter(repo=>Number(repo.behind)>0).length;const push=repos.filter(repo=>Number(repo.ahead)>0||Number(repo.changes)>0).length;
    const cardNode=el('section','action-feedback briefing-toast');cardNode.setAttribute('role','status');
    cardNode.append(el('strong','',t('Good morning')),el('p','',t('{pull} repositories have commits to pull · {push} have your work not pushed. Today shows new tags and releases too.',{pull,push})));
    const actions=el('div','feedback-actions');const open=button(t('Open Today'),'primary');open.onclick=()=>{cardNode.remove();if(typeof showOperationsCenter==='function')showOperationsCenter('briefing');};
    const later=button(t('Later'));later.onclick=()=>cardNode.remove();actions.append(open,later);cardNode.append(actions);
    let stack=document.getElementById('action-feedback-stack');if(!stack){stack=el('div','action-feedback-stack');stack.id='action-feedback-stack';document.body.append(stack);}
    stack.append(cardNode);setTimeout(()=>cardNode.remove(),60000);
  },15000);
  window.GitDeckBriefing=helpers;
})();
