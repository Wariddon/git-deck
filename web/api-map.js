'use strict';
// API map (server side: lib/GitDeck.ApiMap.ps1): which repository provides each HTTP endpoint and which
// repositories call it (Feign clients, URLs in application.yml, path literals), plus Kafka topics with
// their producers and consumers. Before changing an endpoint or a message, see who depends on it. It
// also spots one downstream API called with different versions across services (v2 here, v1 there).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const normalizePath=(path)=>String(path||'').trim().toLowerCase().replace(/\{[^}]*\}/g,'{}').replace(/\$\{[^}]*\}/g,'{}').replace(/\/+$/,'')||'/';
  const segments=(path)=>normalizePath(path).split('/').filter(Boolean);
  // A call reaches a provided endpoint when the endpoint's path is the end of the call's path
  // (calls often carry a gateway prefix); at least two segments must match.
  function callMatches(call,provided){
    const a=segments(call),b=segments(provided);if(b.length<2||a.length<b.length)return false;
    const tail=a.slice(a.length-b.length);return tail.every((part,i)=>part===b[i]||part==='{}'||b[i]==='{}');
  }
  // [{repo, surface}] -> endpoints with providers and callers, and calls nobody in the folder provides.
  function buildMap(results){
    const endpoints=new Map();
    for(const {repo,surface} of results)for(const item of surface?.provides||[]){
      const key=`${item.method} ${normalizePath(item.path)}`;if(!endpoints.has(key))endpoints.set(key,{method:item.method,path:item.path,providers:[],callers:[]});
      endpoints.get(key).providers.push({repo,file:item.file,line:item.line});
    }
    const outside=new Map();
    for(const {repo,surface} of results)for(const call of surface?.calls||[]){
      const hits=[...endpoints.values()].filter(entry=>callMatches(call.path,entry.path)&&!entry.providers.some(p=>p.repo===repo));
      if(hits.length){for(const entry of hits)entry.callers.push({repo,file:call.file,line:call.line,via:call.via});continue;}
      const key=normalizePath(call.path);if(!outside.has(key))outside.set(key,{path:call.path,callers:[]});outside.get(key).callers.push({repo,file:call.file,line:call.line,via:call.via});
    }
    return {endpoints:[...endpoints.values()].sort((a,b)=>b.callers.length-a.callers.length||a.path.localeCompare(b.path)),outside:[...outside.values()].sort((a,b)=>b.callers.length-a.callers.length||a.path.localeCompare(b.path))};
  }
  // The same downstream operation (same last two segments) called with different paths, e.g.
  // /v2/customerServices/promptPay/findByProxy and /sales-services/v1/customerServices/promptPay/findByProxy.
  function versionDrift(results){
    const groups=new Map();
    for(const {repo,surface} of results)for(const call of surface?.calls||[]){
      const parts=segments(call.path);if(parts.length<3)continue;const key=parts.slice(-2).join('/');
      if(!groups.has(key))groups.set(key,new Map());const paths=groups.get(key);const full=normalizePath(call.path);
      if(!paths.has(full))paths.set(full,{path:call.path,repos:new Set()});paths.get(full).repos.add(repo.name);
    }
    return [...groups.entries()].filter(([,paths])=>paths.size>1).map(([key,paths])=>({operation:key,variants:[...paths.values()].map(item=>({path:item.path,repos:[...item.repos].sort()}))}));
  }
  function topics(results){
    const map=new Map();const add=(name,kind,entry)=>{if(!map.has(name))map.set(name,{topic:name,producers:[],consumers:[]});map.get(name)[kind].push(entry);};
    for(const {repo,surface} of results){
      for(const item of surface?.listens||[])add(item.resolved||item.topic,'consumers',{repo,file:item.file,line:item.line,raw:item.topic});
      for(const item of surface?.sends||[])add(item.topic,'producers',{repo,file:item.file,line:item.line});
    }
    return [...map.values()].sort((a,b)=>a.topic.localeCompare(b.topic));
  }
  const helpers={normalizePath,callMatches,buildMap,versionDrift,topics};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,table,row,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};
  const where=(item)=>{const box=el('div','api-where');box.append(repoLink(item.repo),el('small','fleet-muted',` ${item.file}:${item.line}${item.via?` · ${item.via}`:''}`));return box;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const family=input(t('Family, for example depinq- or crs-'));try{family.value=localStorage.getItem('gitdeck.familyPrefix')||'';}catch{}
    const ref=input(t('Branch or tag (empty: files on disk)'));ref.classList.add('fleet-ref');
    const run=button(t('Scan'),'primary');const filter=input(t('Filter, for example findByProxy'));
    // Results are kept per commit; tick this to also read edits you have not staged yet.
    const freshLabel=el('label','fleet-check');const fresh=el('input');fresh.type='checkbox';freshLabel.append(fresh,el('span','',t('Re-read files')));freshLabel.title=t('Scans are remembered per commit; tick to also read edits that are not staged yet');
    bar.append(folder,family,ref,run,freshLabel,filter);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Who provides each HTTP endpoint and who calls it (Feign clients, URLs in application.yml, path literals), plus Kafka topics with producers and consumers, read from the source of every repository. Check it before changing an endpoint, a request body or a message.')),status,out);
    let results=[];
    const draw=()=>{
      out.replaceChildren();if(!results.length)return;
      const words=filter.value.trim().toLowerCase();const keep=(text)=>!words||String(text).toLowerCase().includes(words);
      const map=buildMap(results);const drift=versionDrift(results).filter(item=>keep(item.operation)||item.variants.some(v=>keep(v.path)));
      if(drift.length){
        const box=el('section','repo-alert tone-warn api-drift');box.append(el('strong','',t('The same API called with different paths')));
        for(const item of drift){const line=el('div','');line.append(el('code','',item.operation));for(const v of item.variants)line.append(el('div','fleet-muted',`${v.path} ← ${v.repos.join(', ')}`));box.append(line);}
        out.append(box);
      }
      const endpoints=map.endpoints.filter(item=>keep(item.path)||item.providers.concat(item.callers).some(entry=>keep(entry.repo.name)));
      if(endpoints.length){
      out.append(el('h4','',t('Endpoints in this folder ({count})',{count:endpoints.length})));
      const grid=table([t('Endpoint'),t('Provided by'),t('Called from')]);grid.classList.add('api-table');
      for(const item of endpoints.slice(0,400)){
        const name=el('div','');name.append(el('span','fleet-state tone-info',item.method),el('code','',' '+item.path));
        const providers=el('div','');item.providers.forEach(entry=>providers.append(where(entry)));
        const callers=el('div','');if(item.callers.length)item.callers.forEach(entry=>callers.append(where(entry)));else callers.append(el('span','fleet-muted',t('No caller found in this folder')));
        grid.append(row([name,providers,callers]));
      }
      out.append(grid);
      }
      const outside=map.outside.filter(item=>keep(item.path)||item.callers.some(entry=>keep(entry.repo.name)));
      if(outside.length){
        out.append(el('h4','',t('Called, provided outside this folder ({count})',{count:outside.length})));
        const other=table([t('Path'),t('Called from')]);other.classList.add('api-table');
        for(const item of outside.slice(0,300)){const callers=el('div','');item.callers.forEach(entry=>callers.append(where(entry)));other.append(row([el('code','',item.path),callers]));}
        out.append(other);
      }
      const kafka=topics(results).filter(item=>keep(item.topic)||item.producers.concat(item.consumers).some(entry=>keep(entry.repo.name)));
      if(kafka.length){
        out.append(el('h4','',t('Kafka topics ({count})',{count:kafka.length})));
        const grid2=table([t('Topic'),t('Producers'),t('Consumers')]);grid2.classList.add('api-table');
        for(const item of kafka){const p=el('div','');item.producers.forEach(entry=>p.append(where(entry)));if(!item.producers.length)p.append(el('span','fleet-muted','—'));const c=el('div','');item.consumers.forEach(entry=>c.append(where(entry)));if(!item.consumers.length)c.append(el('span','fleet-muted','—'));grid2.append(row([el('code','',item.topic),p,c]));}
        out.append(grid2);
      }
    };
    filter.addEventListener('input',draw);
    run.onclick=async()=>{
      const prefix=family.value.trim().toLowerCase();
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path)&&(!prefix||repo.name.toLowerCase().startsWith(prefix)));
      if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      run.disabled=true;let done=0;results=[];
      const found=await mapLimit(repos,6,async repo=>{
        let surface=null;try{surface=(await api('/api/repo/api-surface?'+query({path:repo.path,ref:ref.value.trim(),fresh:fresh.checked?'1':''}))).surface;}catch{}
        status.textContent=t('Scanning {done} of {total}…',{done:++done,total:repos.length});return {repo,surface};
      });
      results=found.filter(item=>item.surface);run.disabled=false;
      const provided=results.reduce((n,item)=>n+item.surface.provides.length,0);const calls=results.reduce((n,item)=>n+item.surface.calls.length,0);
      status.textContent=t('{repos} repositories · {provided} endpoints · {calls} calls',{repos:results.length,provided,calls});
      draw();
    };
  }

  addPanel('api-map',t('API map'),build);
  window.GitDeckApiMap=helpers;
})();
