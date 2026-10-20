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
  const recentWork=(p,now=Date.now())=>{const at=Date.parse(p?.lastCommitDate||'');return Number.isFinite(at)&&now-at<7*864e5;};
  // What to do today, from the repository cache (changes, ahead, behind) and the last Pending check
  // (committed this week; clean, pushed and with commits after the latest tag = ready to tag).
  function todayPlan(repos,snapshot,now=Date.now()){
    const list=(repos||[]).filter(repo=>repo.valid!==false);
    const byPath=new Map(list.map(repo=>[String(repo.path).toLowerCase(),repo]));
    const commit=list.filter(repo=>Number(repo.changes)>0).sort((a,b)=>Number(b.changes)-Number(a.changes));
    const push=list.filter(repo=>Number(repo.ahead)>0).sort((a,b)=>Number(b.ahead)-Number(a.ahead));
    const pull=list.filter(repo=>Number(repo.behind)>0&&!Number(repo.changes)).sort((a,b)=>Number(b.behind)-Number(a.behind));
    const week=[],tag=[];
    for(const item of snapshot?.items||[]){
      const repo=byPath.get(String(item.path).toLowerCase());if(!repo||!recentWork(item.pending,now))continue;
      week.push({repo,pending:item.pending});
      const p=item.pending;if(Number(p.commitsSinceTag)>0&&!p.ahead&&!p.changed&&!p.untracked&&p.upstream&&!Number(repo.ahead)&&!Number(repo.changes))tag.push({repo,pending:p});
    }
    week.sort((a,b)=>Date.parse(b.pending.lastCommitDate)-Date.parse(a.pending.lastCommitDate));
    return {commit,push,pull,week,tag};
  }
  const helpers={releaseDrift,dayOf,todayPlan,recentWork};
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
  const readSnapshot=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.pendingSnapshot')||'null');}catch{return null;}};
  const readCache=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.deployMap')||'null');}catch{return null;}};

  function card(title,count,tone){const box=el('section',`briefing-card tone-${tone}`);const head=el('div','briefing-head');head.append(el('strong','',title),el('span',`fleet-state tone-${tone}`,String(count)));box.append(head);return box;}
  function list(box,items,render,empty){if(!items.length){box.append(el('p','fleet-muted',empty));return;}const ul=el('ul','briefing-list');for(const item of items.slice(0,12)){const li=el('li');render(li,item);ul.append(li);}box.append(ul);if(items.length>12)box.append(el('small','fleet-muted',t('and {count} more',{count:items.length-12})));}

  // Today in three columns: to do (one click each), in progress, news. Instant parts come from the
  // repository cache and the last Pending check; new tags need one light request per repository.
  function build(panel){
    const head=el('header','briefing-intro');const title=el('h2','',t('Today'));const sub=el('p','fleet-muted','');
    const read=button(t('Mark all as seen'));const refresh=button(t('Refresh'));const standup=button(t('📋 Standup draft'));
    const actions=el('div','fleet-actions');actions.append(standup,refresh,read);head.append(title,sub,actions);
    const columns=el('div','gd-today');const status=el('small','multi-repo-status');
    panel.append(head,status,columns);
    const column=(icon,name)=>{const box=el('section','gd-today-col');const h=el('h3','');h.append(el('span','',icon),el('span','',name),el('b','','…'));box.append(h);return {box,count:(n)=>{h.lastChild.textContent=String(n);}};};
    const openRepo=(repo,tab)=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(repo,tab,null);};
    const cardOf=(tone,titleText,detail,label,run)=>{const node=el('div',`gd-card tone-${tone}`);node.append(el('strong','',titleText),el('small','',detail));if(label){const go=button(label,tone==='warn'?'primary':'');go.onclick=()=>run(go);node.append(go);}return node;};
    const fill=(col,cards,empty)=>{col.count(cards.length);if(!cards.length)col.box.append(el('p','gd-empty',empty));for(const node of cards.slice(0,10))col.box.append(node);if(cards.length>10)col.box.append(el('p','gd-empty',t('and {count} more',{count:cards.length-10})));};
    const runAndMark=async(go,action,repo)=>{go.disabled=true;go.textContent=t('Working…');try{const answer=await F.runQuiet(action,repo,action==='pull'?{strategy:state.meta?.pullStrategy||'ff-only',autostash:true}:{});go.textContent=t('Done');showActionFeedback(`${repo.name} · ${String(answer?.message||t('Done')).split('\n')[0]}`);}catch(error){go.disabled=false;go.textContent=t('Retry');showActionFeedback(error.message,{error:true,context:repo.name});}};
    standup.onclick=()=>{const plan=todayPlan(usable(),readSnapshot());if(window.GitDeckStandup)window.GitDeckStandup.open(plan.week);};
    async function load(){
      const from=since();const repos=usable();
      sub.textContent=t('Since {time}',{time:new Date(from*1000).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})});
      columns.replaceChildren();
      const todo=column('✅',t('To do')),doing=column('🛠',t('In progress')),news=column('📰',t('News'));columns.append(todo.box,doing.box,news.box);
      const plan=todayPlan(repos,readSnapshot());
      const todoCards=[
        ...plan.commit.map(repo=>cardOf('warn',repo.name,t('{count} changed file(s) on {branch}',{count:repo.changes,branch:repo.branch||''}),t('Commit…'),()=>openRepo(repo,'changes'))),
        ...plan.push.map(repo=>cardOf('warn',repo.name,t('{count} commit(s) to push on {branch}',{count:repo.ahead,branch:repo.branch||''}),t('Push'),(go)=>runAndMark(go,'push',repo))),
        ...plan.pull.map(repo=>cardOf('info',repo.name,t('{count} new commit(s) on {branch}',{count:repo.behind,branch:repo.branch||''}),t('Pull'),(go)=>runAndMark(go,'pull',repo))),
        ...plan.tag.map(item=>cardOf('info',item.repo.name,t('{count} commit(s) after {tag}: ready to tag?',{count:item.pending.commitsSinceTag,tag:item.pending.latestTag||'—'}),t('Tag…'),()=>showOperationsCenter('tag-all'))),
      ];
      fill(todo,todoCards,t('Nothing to do: everything is committed, pushed and up to date.'));
      const drift=releaseDrift(readCache()?.entries);
      const newsCards=drift.map(item=>cardOf('warn',item.service,`PROD ${item.prod} · ${item.env.toUpperCase()} ${item.tag}`,t('Releases'),()=>showOperationsCenter('releases')));
      const doingCards=plan.week.map(item=>cardOf('muted',item.repo.name,`${item.pending.branch||''} · ${item.pending.lastCommitSubject||''}`,t('Open'),()=>openRepo(item.repo,'history')));
      fill(doing,doingCards,t('No commits this week (from the last Pending check).'));
      api('/api/ticket-workspaces').then(answer=>{
        const items=(answer.workspaces||[]).filter(item=>item.changes||item.ahead);if(!items.length)return;
        const cards=items.map(item=>cardOf('info',[item.key||item.branch,item.mainName].filter(Boolean).join(' · ')||item.path,[item.changes?t('{count} changed',{count:item.changes}):'',item.ahead?'↑'+item.ahead:''].filter(Boolean).join(' · '),t('Open'),()=>{const repo=(state.repos||[]).find(entry=>entry.path===item.path);if(repo)openRepo(repo,'changes');}));
        const heading=doing.box.querySelector('h3');for(const node of cards.reverse())heading.after(node);
        doing.count(doingCards.length+cards.length);doing.box.querySelector('.gd-empty')?.remove();
      }).catch(()=>{});
      let done=0;
      const found=await mapLimit(repos,6,async repo=>{let tags=[];try{tags=(await api('/api/repo/recent-tags?'+query({path:repo.path,since:from}))).tags||[];}catch{}status.textContent=t('Checking {done} of {total}…',{done:++done,total:repos.length});return {repo,tags};});
      status.textContent='';
      const withTags=found.filter(item=>item.tags.length).sort((a,b)=>String(b.tags[0].date).localeCompare(String(a.tags[0].date)));
      for(const item of withTags)newsCards.push(cardOf('info',item.repo.name,`🏷 ${item.tags.map(tag=>tag.name).join(', ')} · ${whenOf(item.tags[0].date)}`,t('Open'),()=>openRepo(item.repo,'tags')));
      fill(news,newsCards,t('No new tags since then.'));
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
