'use strict';
// Git Deck and the tools around it (server side in lib/GitDeck.Integrations.ps1):
//   Releases        - which image tag each service runs in each environment, read from a deploy
//                     repository, next to the latest tag of the service's own repository
//   Merge requests  - open GitLab merge requests of every repository, and one merge request per
//                     repository for a ticket branch
//   Dependencies    - Maven versions (parent, dependencies, plugins, *.version properties) that differ
//                     between repositories
//   Notifications   - Windows notifications while Git Deck is in the background: new commits to
//                     pull, new tags, finished jobs and GitLab news
//   Editors         - open the repository or a file in IntelliJ IDEA or VS Code
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const envOrder=[[/^default$/,0],[/^dev\d*$/,1],[/^nonprod$/,2],[/^sit\d*$/,3],[/^(qa|test)\d*$/,4],[/^uat\d*$/,5],[/^(preprod|staging|perf|nft)$/,6],[/^prod$/,8],[/^drc?$/,9]];
  const envRank=(env)=>{for(const [pattern,rank] of envOrder)if(pattern.test(env))return rank;return 7;};
  const sortEnvs=(envs)=>[...new Set(envs)].sort((a,b)=>envRank(a)-envRank(b)||a.localeCompare(b,undefined,{numeric:true}));
  // The repository a deployed service comes from: the same name, else the longest name contained in it
  // (billing-svc-api -> billing-svc), never a short accidental match.
  function matchRepo(service,repos){
    const name=String(service||'').toLowerCase();if(!name)return null;
    const exact=repos.find(repo=>repo.name.toLowerCase()===name);if(exact)return exact;
    const close=repos.filter(repo=>{const own=repo.name.toLowerCase();return own.length>=4&&(name.includes(own)||own.includes(name));});
    return close.sort((a,b)=>Math.abs(a.name.length-name.length)-Math.abs(b.name.length-name.length))[0]||null;
  }
  // Deploy entries -> rows of {service, envs: {env: [{tag, file, line}]}}.
  function deployRows(entries){
    const rows=new Map();
    for(const entry of entries||[]){
      if(!rows.has(entry.service))rows.set(entry.service,{service:entry.service,envs:{}});
      const cell=rows.get(entry.service).envs[entry.env]||(rows.get(entry.service).envs[entry.env]=[]);
      if(!cell.some(item=>item.tag===entry.tag))cell.push({tag:entry.tag,file:entry.file,line:entry.line});
      else cell.find(item=>item.tag===entry.tag).more=true;
    }
    return [...rows.values()].sort((a,b)=>a.service.localeCompare(b.service));
  }
  // Environments where a repository runs one of the given tags (from the last Releases load).
  function deployedIn(cache,repo,tags){
    if(!cache?.entries||!repo)return [];const wanted=new Set(tags||[]);
    const envs=cache.entries.filter(entry=>wanted.has(entry.tag)&&matchRepo(entry.service,[repo])===repo).map(entry=>entry.env);
    return sortEnvs(envs);
  }
  // Every environment and the tag it runs for one repository (from the last Releases load).
  function deployedTags(cache,repo){
    if(!cache?.entries||!repo)return [];const seen=new Map();
    for(const entry of cache.entries)if(matchRepo(entry.service,[repo])===repo){const key=entry.env+'|'+entry.tag;if(!seen.has(key))seen.set(key,{env:entry.env,tag:entry.tag});}
    return [...seen.values()].sort((a,b)=>envRank(a.env)-envRank(b.env)||a.env.localeCompare(b.env));
  }
  // Maven versions worth comparing between repositories.
  const versionKey=(key)=>/^(parent|dependency|managed|plugin)\./.test(key)||/^property\..*version$/i.test(key);
  // pom maps per repository -> [{key, versions: Map(version -> [repo names])}], most different first.
  function dependencyRows(poms){
    const keys=new Map();
    for(const {repo,map} of poms)for(const [key,value] of map){
      if(!versionKey(key))continue;
      if(!keys.has(key))keys.set(key,new Map());const versions=keys.get(key);
      if(!versions.has(value))versions.set(value,[]);versions.get(value).push(repo.name);
    }
    const real=(versions)=>[...versions.keys()].filter(value=>!/^\(.*\)$/.test(value));
    return [...keys.entries()].map(([key,versions])=>({key,versions,distinct:new Set(real(versions).map(value=>value.replace(/ \[.*\]$/,''))).size,repos:[...versions.values()].reduce((n,list)=>n+list.length,0)}))
      .sort((a,b)=>b.distinct-a.distinct||b.repos-a.repos||a.key.localeCompare(b.key));
  }
  // Repositories whose count of commits to pull grew since the last look.
  function newlyBehind(before,repos){return repos.filter(repo=>(Number(repo.behind)||0)>(before.get(repo.path)||0)).map(repo=>({repo,count:(Number(repo.behind)||0)-(before.get(repo.path)||0)}));}
  const api_={envRank,sortEnvs,matchRepo,deployRows,deployedIn,deployedTags,dependencyRows,newlyBehind};
  if(typeof module!=='undefined'){module.exports=api_;return;}

  const F=window.GitDeckFleet;
  const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const recall=(key,fallback='')=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const cacheKey='gitdeck.deployMap';
  const readCache=()=>{try{return JSON.parse(localStorage.getItem(cacheKey)||'null');}catch{return null;}};
  window.GitDeckIntegrations={...api_,deployedIn:(repo,tags)=>deployedIn(readCache(),repo,tags),deployedTags:(repo)=>deployedTags(readCache(),repo)};
  if(!F||typeof el!=='function'||typeof api!=='function')return;
  const {addPanel,folderSelect,reposIn,repoLink,table,row,mapLimit,runQuiet,query,whenOf}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};
  const check=(label,checked)=>{const box=el('label','settings-check');const node=el('input');node.type='checkbox';node.checked=checked;box.append(node,el('span','',label));return {box,node};};
  const openUrl=(url)=>{if(url)api('/api/action',{method:'POST',body:JSON.stringify({action:'open-url',url})}).catch(error=>feedback(error.message,true));};
  const meter=()=>{const box=el('div','gd-meter');box.hidden=true;const fill=el('span','gd-meter-fill');box.append(fill);return {box,set:(done,total)=>{box.hidden=!total||done>=total;fill.style.width=total?Math.round(done/total*100)+'%':'0';}};};
  const copyText=async(text)=>{try{await navigator.clipboard.writeText(text);feedback(t('Copied'));}catch{feedback(t('Could not copy'),true);}};
  const usableRepos=()=>(state.repos||[]).filter(repo=>repo.valid!==false&&!repo.pending);
  async function latestTags(repos,progress,fresh=false){
    const known=new Map((fresh?[]:F.pendingResults()||[]).filter(item=>item.pending).map(item=>[item.repo.path,item.pending.latestTag||'']));let done=0;
    const list=await mapLimit(repos,6,async repo=>{let tag=known.get(repo.path);if(tag===undefined){try{tag=(await api('/api/repo/latest-tag?'+query({path:repo.path}))).tag.name||'';}catch{tag='';}}progress?.(++done,repos.length);return [repo.path,tag];});
    return new Map(list);
  }
  // Errors that are the same everywhere (GitLab CLI not signed in) are said once.
  function groupErrors(results,out){
    const count=new Map();results.forEach(item=>{if(item.error)count.set(item.error,(count.get(item.error)||0)+1);});
    for(const [message,n] of count)if(n>1)out.append(el('div','repo-alert tone-warn fleet-ci-note',t('{count} repositories: {message}',{count:n,message})));
    return count;
  }

  // ---- Releases -----------------------------------------------------------------------------
  function buildReleases(panel){
    const bar=el('div','operations-toolbar');
    const repo=document.createElement('select');repo.className='workflow-input';repo.setAttribute('aria-label',t('Deploy repository'));
    const ref=input(t('Branch or tag (empty: upstream or HEAD)'));ref.value=recall('gitdeck.deployRef','');ref.classList.add('fleet-ref');
    const fetchFirst=check(t('Fetch first'),recall('gitdeck.deployFetch','1')==='1');
    const load=button(t('Load'),'primary');const filter=input(t('Filter services'));const copy=button(t('Copy as Markdown'));copy.disabled=true;
    bar.append(repo,ref,fetchFirst.box,load,filter,copy);
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body fleet-releases');
    panel.append(bar,el('p','multi-repo-explain',t('Choose your Kubernetes, Helm or Kustomize repository. Tags are configured values from the selected Git ref, not verified live deployments. Environment names are inferred from file paths.')),status,bar2.box,out);
    const fill=()=>{
      const repos=usableRepos().sort((a,b)=>a.name.localeCompare(b.name));const keep=recall('gitdeck.deployRepo','');
      repo.replaceChildren(...repos.map(item=>new Option(item.name,item.path)));
      const guess=repos.find(item=>item.path===keep)||repos.find(item=>/deploy|gitops|helm|k8s|kube|manifest|infra|argocd/i.test(item.name));if(guess)repo.value=guess.path;
    };
    fill();panel.addEventListener('focusin',()=>{if(repo.options.length!==usableRepos().length)fill();});
    let rows=[];let latest=new Map();let envs=[];let deploy=null;
    const draw=()=>{
      const words=filter.value.trim().toLowerCase();out.replaceChildren();
      const shown=rows.filter(item=>!words||item.service.toLowerCase().includes(words)||(item.repo?.name||'').toLowerCase().includes(words));
      if(!shown.length){out.append(el('div','multi-repo-empty',t('Nothing to show.')));return;}
      const grid=table([t('Service'),...envs.map(env=>env.toUpperCase()),t('Latest tag')]);grid.classList.add('fleet-release-table');
      for(const item of shown){
        const newest=item.repo?latest.get(item.repo.path)||'':'';
        const cells=envs.map(env=>{
          const list=item.envs[env];if(!list)return el('span','fleet-muted','—');
          const box=el('span','fleet-release-cell');
          for(const entry of list){const chip=el('span',`fleet-state tone-${newest&&entry.tag===newest?'ok':newest?'info':'muted'}`,entry.tag);chip.title=`${entry.file}:${entry.line}${entry.more?' …':''}`;box.append(chip);}
          return box;
        });
        const name=el('div','fleet-release-service');name.append(el('b','',item.service));if(item.repo)name.append(repoLink(item.repo));
        grid.append(row([name,...cells,newest?el('span','pending-tag-badge','🏷 '+newest):el('span','fleet-muted',item.repo?t('No tag yet'):t('No repository'))]));
      }
      out.append(grid);
    };
    filter.addEventListener('input',draw);
    load.onclick=async()=>{
      const chosen=usableRepos().find(item=>item.path===repo.value);if(!chosen)return;
      remember('gitdeck.deployRepo',chosen.path);remember('gitdeck.deployRef',ref.value.trim());remember('gitdeck.deployFetch',fetchFirst.node.checked?'1':'0');
      load.disabled=true;copy.disabled=true;out.replaceChildren();
      try{
        if(fetchFirst.node.checked&&!ref.value.trim()){status.textContent=t('Fetching {name}…',{name:chosen.name});try{await runQuiet('fetch',chosen);}catch(error){feedback(error.message,true);}}
        status.textContent=t('Reading {name}…',{name:chosen.name});
        deploy=(await api('/api/repo/deploy-map?'+query({path:chosen.path,ref:ref.value.trim()}))).deploy;
      }catch(error){status.textContent='';out.append(el('div','repo-alert tone-bad',error.message));load.disabled=false;return;}
      if(!deploy.entries.length){status.textContent='';out.append(el('div','multi-repo-empty',t('No image tags were found in {name} at {ref}. Git Deck reads image:, repository: with tag:, and Kustomize newTag in .yaml files.',{name:chosen.name,ref:deploy.ref})));load.disabled=false;return;}
      const repos=usableRepos().filter(item=>item.path!==chosen.path);
      rows=deployRows(deploy.entries).map(item=>({...item,repo:matchRepo(item.service,repos)}));
      envs=sortEnvs(deploy.entries.map(entry=>entry.env));
      const linked=[...new Set(rows.map(item=>item.repo).filter(Boolean))];
      latest=await latestTags(linked,(done,total)=>bar2.set(done,total));bar2.set(0,0);load.disabled=false;copy.disabled=false;
      remember(cacheKey,JSON.stringify({repo:chosen.name,ref:deploy.ref,at:Date.now(),entries:deploy.entries.map(({env,service,tag})=>({env,service,tag}))}));
      status.textContent=t('{services} services · {envs} environments · {ref} at {commit} ({when})',{services:rows.length,envs:envs.length,ref:deploy.ref,commit:deploy.commit,when:deploy.date?whenOf(deploy.date):''});
      draw();
    };
    copy.onclick=()=>{
      const lines=[t('Configured in Git')+` · ${deploy.ref} @ ${deploy.commit}`,'',`| ${t('Service')} | ${envs.map(env=>env.toUpperCase()).join(' | ')} | ${t('Latest tag')} |`,`|---|${envs.map(()=>'---').join('|')}|---|`];
      for(const item of rows)lines.push(`| ${item.service} | ${envs.map(env=>(item.envs[env]||[]).map(entry=>entry.tag).join(', ')||'—').join(' | ')} | ${item.repo?latest.get(item.repo.path)||'':''} |`);
      copyText(lines.join('\n'));
    };
  }

  // ---- Merge requests -----------------------------------------------------------------------
  const gitlabRepo=(repo)=>Boolean(repo.remote)&&!/github\.com|bitbucket\.org/i.test(repo.remote||'');
  function buildMergeRequests(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const load=button(t('Load'),'primary');const filter=input(t('Filter by title, branch or author'));
    bar.append(folder,load,filter);
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body');
    // One merge request per repository for the same branch (a ticket that touches several services).
    const create=el('details','fleet-mr-create');create.append(el('summary','',t('Create merge requests for one branch in many repositories')));
    const form=el('div','fleet-options');const source=input(t('Source branch, for example feature/PAY-1234'));source.value=state.workspace?.branch&&!['main','master','develop'].includes(state.workspace.branch)?state.workspace.branch:'';
    const target=input(t('Target branch'));target.value=recall('gitdeck.mrTarget','develop');const title=input(t('Title (empty: the branch name)'));
    const draft=check(t('Draft'),false);const find=button(t('Find repositories'));const make=button(t('Create merge requests'),'primary');make.disabled=true;
    form.append(source,target,title,draft.box,find,make);const plan=el('div','multi-repo-body');create.append(form,plan);
    panel.append(bar,el('p','multi-repo-explain',t('Open GitLab merge requests of every repository, newest first, through the GitLab CLI (bin\\glab.exe).')),create,status,bar2.box,out);
    let open=[];
    const draw=()=>{
      const words=filter.value.trim().toLowerCase();out.querySelector('.fleet-mr-table')?.remove();
      const shown=open.filter(item=>!words||[item.title,item.source,item.target,item.author,item.repo.name].join(' ').toLowerCase().includes(words));
      if(!shown.length){if(!out.querySelector('.fleet-ci-note'))out.append(el('div','multi-repo-empty fleet-mr-table',t('No open merge requests.')));return;}
      const grid=table([t('Repository'),t('Merge request'),t('Branches'),t('Author'),t('Status'),t('Updated'),'']);grid.classList.add('fleet-mr-table');
      for(const item of shown){
        const name=el('div','fleet-mr-title');name.append(el('b','',`!${item.iid} `),document.createTextNode(item.title));if(item.draft)name.append(el('span','fleet-state tone-muted',t('Draft')));
        const actions=el('div','catalog-inline');const go=button(t('Open in GitLab'));go.onclick=()=>openUrl(item.url);
        const readiness=button(t('Check readiness'));const details=el('div','catalog-readiness');name.append(details);
        readiness.onclick=()=>window.GitDeckCatalog?.checkReadiness(item.repo,item.iid,details,readiness);
        actions.append(readiness,go);
        grid.append(row([repoLink(item.repo),name,el('code','',`${item.source} → ${item.target}`),item.author,el('span',`fleet-state tone-${['mergeable','can_be_merged'].includes(item.status)?'ok':/conflict|cannot|failed|blocked/.test(item.status)?'bad':'info'}`,item.status||'open'),item.updated?whenOf(item.updated):'',actions]));
      }
      out.append(grid);
    };
    filter.addEventListener('input',draw);
    load.onclick=async()=>{
      const repos=reposIn(folder.value).filter(gitlabRepo);if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      load.disabled=true;out.replaceChildren();open=[];let done=0;status.textContent=t('Asking GitLab about {count} repositories…',{count:repos.length});
      const results=await mapLimit(repos,3,async repo=>{let answer;try{answer={list:(await api('/api/repo/mrs?'+query({path:repo.path}))).mergeRequests||[]};}catch(error){answer={error:error.message};}bar2.set(++done,repos.length);return {repo,...answer};});
      bar2.set(0,0);load.disabled=false;
      const errors=groupErrors(results,out);
      results.filter(item=>item.error&&errors.get(item.error)===1).forEach(item=>out.append(el('div','repo-alert tone-warn',`${item.repo.name}: ${item.error}`)));
      open=results.flatMap(item=>(item.list||[]).map(mr=>({...mr,repo:item.repo}))).sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
      status.textContent=results.every(item=>item.error)?'':t('{count} open merge requests in {repos} repositories',{count:open.length,repos:new Set(open.map(item=>item.repo.path)).size});
      draw();
    };
    let targets=[];let plannedBranch='';let planRevision=0;
    source.addEventListener('input',()=>{planRevision++;plannedBranch='';targets=[];make.disabled=true;plan.replaceChildren(el('small','fleet-muted',t('Source branch changed. Find repositories again.')));});
    find.onclick=async()=>{
      const branch=source.value.trim();if(!branch){source.focus();return;}const request=++planRevision;
      const repos=reposIn(folder.value).filter(gitlabRepo);find.disabled=true;make.disabled=true;plan.replaceChildren(el('small','multi-repo-status',t('Looking in {count} repositories…',{count:repos.length})));
      const found=await mapLimit(repos,6,async repo=>{try{return {repo,found:(await api('/api/repo/find-branch?'+query({path:repo.path,name:branch}))).branch};}catch(error){return {repo,error:error.message};}});
      find.disabled=false;
      if(request!==planRevision)return;plannedBranch=branch;
      targets=found.filter(item=>item.found&&(item.found.local||item.found.remote)).map(item=>{
        const already=open.find(mr=>mr.repo.path===item.repo.path&&mr.source===branch);
        const box=el('input');box.type='checkbox';box.checked=!already;const result=el('span','multi-repo-result',already?t('Already open: !{iid}',{iid:already.iid}):item.found.dirty?t('Has uncommitted changes'):'');
        return {...item,box,result};
      });
      if(!targets.length){plan.replaceChildren(el('div','multi-repo-empty',t('No repository has the branch {branch}.',{branch})));return;}
      const grid=table(['',t('Repository'),t('Branch'),t('Result')]);
      targets.forEach(item=>grid.append(row([item.box,repoLink(item.repo),item.found.local?t('Local and pushed when created'):item.found.remote,item.result])));
      plan.replaceChildren(grid);make.disabled=false;
    };
    make.onclick=async()=>{
      const todo=targets.filter(item=>item.box.checked);const branch=source.value.trim();const into=target.value.trim();if(!todo.length||!branch||!into||branch!==plannedBranch)return;
      remember('gitdeck.mrTarget',into);
      if(!confirm(t('Create {count} merge requests {source} → {target}?',{count:todo.length,source:branch,target:into})+'\n\n'+todo.map(item=>item.repo.name).join('\n')))return;
      make.disabled=true;const inputs=[source,target,title,draft.node,find];inputs.forEach(input=>input.disabled=true);const requestTitle=title.value.trim()||branch;const requestDraft=draft.node.checked;let ok=0,failed=0;
      await mapLimit(todo,2,async item=>{
        item.result.className='multi-repo-result';item.result.textContent=t('Working…');
        try{await runQuiet('create-mr',item.repo,{source:branch,target:into,title:requestTitle,description:'',remote:'origin',draft:requestDraft});item.result.textContent=t('Created');item.result.classList.add('tone-ok');item.box.checked=false;ok++;}
        catch(error){item.result.textContent=error.message.split('\n')[0];item.result.classList.add('tone-bad');failed++;}
      });
      inputs.forEach(input=>input.disabled=false);make.disabled=false;feedback(t('{ok} merge requests created · {failed} failed',{ok,failed}),failed>0);
    };
  }

  // ---- Dependencies (Maven) -----------------------------------------------------------------
  function buildDependencies(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const ref=input(t('Branch or tag (empty: files on disk)'));ref.classList.add('fleet-ref');ref.value=recall('gitdeck.depsRef','');
    const load=button(t('Load'),'primary');const filter=input(t('Filter, for example spring or kafka'));const onlyDiff=check(t('Only versions that differ'),true);const copy=button(t('Copy as Markdown'));copy.disabled=true;
    bar.append(folder,ref,load,filter,onlyDiff.box,copy);
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Reads pom.xml of every repository and lists the parent, dependency, plugin and *.version property versions side by side, so a library that is behind in one service stands out.')),status,bar2.box,out);
    let rows=[];
    const shownRows=()=>{const words=filter.value.trim().toLowerCase();return rows.filter(item=>(!onlyDiff.node.checked||item.distinct>1)&&(!words||item.key.toLowerCase().includes(words)));};
    const draw=()=>{
      out.replaceChildren();const shown=shownRows();
      if(!shown.length){out.append(el('div','multi-repo-empty',onlyDiff.node.checked?t('Every repository uses the same versions.'):t('Nothing to show.')));return;}
      const grid=table([t('Setting'),t('Versions'),t('Repositories')]);grid.classList.add('fleet-deps-table');
      for(const item of shown.slice(0,400)){
        const versions=el('div','fleet-release-cell');
        [...item.versions.entries()].sort((a,b)=>b[1].length-a[1].length).forEach(([version,names],index)=>{const chip=el('span',`fleet-state tone-${item.distinct>1?(index?'warn':'ok'):'muted'}`,`${version} ×${names.length}`);chip.title=names.join('\n');versions.append(chip);});
        const who=el('details','fleet-deps-who');who.append(el('summary','',String(item.repos)));
        for(const [version,names] of item.versions)who.append(el('div','',`${version}: ${names.join(', ')}`));
        grid.append(row([el('code','',item.key),versions,who]));
      }
      out.append(grid);
    };
    filter.addEventListener('input',draw);onlyDiff.node.addEventListener('change',draw);
    load.onclick=async()=>{
      const repos=reposIn(folder.value);if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      remember('gitdeck.depsRef',ref.value.trim());load.disabled=true;copy.disabled=true;out.replaceChildren();let done=0;
      status.textContent=t('Reading {file} in {count} repositories…',{file:'pom.xml',count:repos.length});
      const files=await mapLimit(repos,6,async repo=>{let file;try{file=(await api('/api/repo/file?'+query({path:repo.path,file:'pom.xml',ref:ref.value.trim()}))).file;}catch(error){file={exists:false,error:error.message};}bar2.set(++done,repos.length);return {repo,...file};});
      bar2.set(0,0);load.disabled=false;
      const poms=[];const broken=[];
      for(const item of files.filter(file=>file.exists)){try{poms.push({repo:item.repo,map:F.flattenPom(item.content)});}catch{broken.push(item.repo.name);}}
      if(broken.length)out.append(el('div','repo-alert tone-warn',t('pom.xml could not be read')+': '+broken.join(', ')));
      if(!poms.length){status.textContent='';out.append(el('div','multi-repo-empty',t('{file} was not found in these repositories.',{file:'pom.xml'})));return;}
      rows=dependencyRows(poms);copy.disabled=false;
      status.textContent=t('{count} Maven repositories · {different} versions differ',{count:poms.length,different:rows.filter(item=>item.distinct>1).length});
      draw();
    };
    copy.onclick=()=>{const lines=[`| ${t('Setting')} | ${t('Versions')} |`,'|---|---|'];for(const item of shownRows())lines.push(`| ${item.key} | ${[...item.versions.entries()].map(([version,names])=>`${version} (${names.join(', ')})`).join('<br>')} |`);copyText(lines.join('\n'));};
  }

  // ---- Windows notifications ----------------------------------------------------------------
  const toastKey='gitdeck.windowsToast';
  const toastOn=()=>recall(toastKey,'1')==='1';
  const away=()=>document.visibilityState!=='visible'||!document.hasFocus();
  async function toast(title,text,force=false){
    if(!force&&(!toastOn()||!away()))return;
    try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'notify-toast',title,text})});}catch(error){if(force)feedback(error.message,true);}
  }
  if(typeof notifyComplete==='function'){
    const base=notifyComplete;
    // The browser notification when it is allowed, otherwise the Windows one.
    notifyComplete=function(title,body){
      const browser=state.meta?.notifyComplete&&'Notification' in window&&Notification.permission==='granted';
      base(title,body);if(!browser)void toast(title,body);
    };
  }
  // After a background fetch: new commits to pull, and tags that were not there before.
  const toastTagsKey='gitdeck.toastTags';
  if(typeof runSmartFetch==='function'){
    const baseFetch=runSmartFetch;
    runSmartFetch=async function(interactive=false){
      const before=new Map((state.repos||[]).map(repo=>[repo.path,Number(repo.behind)||0]));
      const scope=typeof smartFetchRepos==='function'?smartFetchRepos():[];
      const result=await baseFetch(interactive);
      if(!result||!toastOn())return result;
      const behind=newlyBehind(before,(state.repos||[]).filter(repo=>scope.some(item=>item.path===repo.path)));
      if(behind.length)void toast(t('New commits to pull'),behind.slice(0,4).map(item=>`${item.repo.name} +${item.count}`).join(', ')+(behind.length>4?' …':''));
      let known={};try{known=JSON.parse(localStorage.getItem(toastTagsKey)||'{}')||{};}catch{}
      const tags=await latestTags(scope.slice(0,60),null,true);const fresh=[];
      for(const [path,tag] of tags){if(tag&&known[path]&&known[path]!==tag)fresh.push(`${scope.find(repo=>repo.path===path)?.name}: ${tag}`);if(tag)known[path]=tag;}
      remember(toastTagsKey,JSON.stringify(known));
      if(fresh.length)void toast(t('New tags'),fresh.slice(0,4).join(', ')+(fresh.length>4?' …':''));
      return result;
    };
  }
  // A switch and a test button in Dashboard > Automation & Windows.
  const automation=document.getElementById('automation-save')?.closest('section,div');
  if(automation&&!document.getElementById('windows-toast')){
    const box=el('div','fleet-options windows-toast');box.id='windows-toast';
    const on=check(t('Windows notifications while Git Deck is in the background: new commits to pull, new tags, finished jobs, GitLab news'),toastOn());
    on.node.addEventListener('change',()=>remember(toastKey,on.node.checked?'1':'0'));
    const test=button(t('Test notification'));test.onclick=()=>toast('Git Deck',t('Notifications are working.'),true);
    box.append(on.box,test);automation.append(box);
  }

  // ---- Editors ------------------------------------------------------------------------------
  let editors={idea:false,code:false};
  api('/api/editors').then(answer=>{editors=answer.editors||editors;const idea=document.querySelector('[data-workspace-quick="open-idea"]');if(idea)idea.hidden=!editors.idea;}).catch(()=>{});
  const openIn=(editor,file,path=state.workspaceRepo?.path)=>{if(path)api('/api/action',{method:'POST',body:JSON.stringify({action:'open-editor',path,editor,file})}).then(answer=>feedback(answer.message)).catch(error=>feedback(error.message,true));};
  if(typeof workingFileContextItems==='function'){
    const baseWorking=workingFileContextItems;
    workingFileContextItems=function(file,...rest){
      const items=baseWorking(file,...rest);if(String(file.status||'').includes('D'))return items;
      const path=state.workspaceRepo?.path;
      const extra=[];if(editors.idea)extra.push({label:t('Open in IntelliJ IDEA'),run:()=>openIn('idea',file.path,path)});if(editors.code)extra.push({label:t('Open in VS Code'),run:()=>openIn('code',file.path,path)});
      return extra.length?items.concat([{separator:true},...extra]):items;
    };
  }
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;
    commandPaletteEntries=function(){const list=base();if(editors.idea)list.push({label:t('Open in IntelliJ IDEA'),group:'Open',shortcut:'',run:()=>openIn('idea',''),search:'Open in IntelliJ IDEA idea Open'});return list;};
  }

  // ---- Dashboard entries --------------------------------------------------------------------
  if(!document.querySelector('.operations-tabs'))return;
  addPanel('releases',t('Releases'),buildReleases);
  addPanel('merge-requests',t('Merge requests'),buildMergeRequests);
  addPanel('dependencies',t('Dependencies'),buildDependencies);
  const nav=document.querySelector('.operations-tabs');let after=nav?.querySelector('[data-operations-view="ci"]');
  if(after)for(const id of ['releases','merge-requests','dependencies']){const tab=nav.querySelector(`[data-operations-view="${id}"]`);if(tab){after.after(tab);after=tab;}}
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="releases"]')){
    let anchor=more.querySelector('[data-multi-repo="ci"]');
    for(const [view,label,hint] of [['releases',t('Releases by environment'),t('Tags configured in Git for each environment')],['merge-requests',t('Merge requests everywhere'),t('Open merge requests of every repository')],['dependencies',t('Dependency versions'),t('Maven versions that differ between repositories')]]){
      const item=el('button','');item.type='button';item.dataset.multiRepo=view;item.append(el('strong','',label),el('small','',hint));
      item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter(view);};
      if(anchor){anchor.after(item);anchor=item;}else more.append(item);
    }
  }
})();
