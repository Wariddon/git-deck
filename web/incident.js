'use strict';
// Incident timeline: "UAT broke between Tuesday 10:00 and Thursday 18:00 — what changed?" One list in
// time order of every commit in the family (all branches), every change in the deploy repository
// (image tags, ConfigMaps) and every tag created in that window. Read-only; uses /api/repo/activity
// and /api/repo/recent-tags.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const pad=(n)=>String(n).padStart(2,'0');
  const day=(date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const local=(date)=>`${day(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  // Commits and tags of several repositories, inside [from, to], newest first. Deploy-repository commits
  // are marked so they stand out; a commit seen on several branches is listed once.
  function mergeTimeline(entries,from,to){
    const start=Date.parse(from),end=Date.parse(to);const seen=new Set();const out=[];
    for(const entry of entries){
      const at=Date.parse(entry.date);if(!Number.isFinite(at)||at<start||at>end)continue;
      const key=entry.kind+'|'+entry.repo.path+'|'+(entry.hash||entry.tag);if(seen.has(key))continue;seen.add(key);
      out.push({...entry,at});
    }
    return out.sort((a,b)=>b.at-a.at||a.repo.name.localeCompare(b.repo.name));
  }
  // Files of a deploy commit worth showing: values, ConfigMaps, kustomizations, app configuration.
  const deployFiles=(paths)=>(paths||[]).filter(file=>/values|configmap|kustomization|lns-app-configuration|application[^/]*\.ya?ml|manifestvalues|helm|\.ya?ml$/i.test(file)).slice(0,6);
  const helpers={mergeTimeline,deployFiles,local};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder,type='search')=>{const node=el('input','workflow-input');node.type=type;node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const family=input(t('Family, for example depinq- or crs-'));try{family.value=localStorage.getItem('gitdeck.familyPrefix')||'';}catch{}
    const now=new Date();const from=input(t('From'),'datetime-local');const to=input(t('To'),'datetime-local');
    from.value=local(new Date(now.getTime()-48*3600e3));to.value=local(now);
    const deploy=document.createElement('select');deploy.className='workflow-input';deploy.setAttribute('aria-label',t('Deploy repository'));
    const run=button(t('Build timeline'),'primary');bar.append(folder,family,from,to,deploy,run);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Everything that changed in a time window, in one list: commits of the family on every branch, changes in the deploy repository (image tags, ConfigMaps, app configuration) and new tags. Pick the window in which an environment broke.')),status,out);
    const fillDeploy=()=>{const list=(state.repos||[]).filter(repo=>repo.valid!==false).sort((a,b)=>a.name.localeCompare(b.name));let keep='';try{keep=localStorage.getItem('gitdeck.deployRepo')||'';}catch{}deploy.replaceChildren(new Option(t('No deploy repository'),''),...list.map(repo=>new Option(repo.name,repo.path)));const guess=list.find(repo=>repo.path===keep)||list.find(repo=>/deploy/i.test(repo.name));if(guess)deploy.value=guess.path;};
    fillDeploy();
    run.onclick=async()=>{
      const start=new Date(from.value),end=new Date(to.value);if(!(start<end)){status.textContent=t('Pick a window where From is before To.');return;}
      const prefix=family.value.trim().toLowerCase();
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path)&&(!prefix||repo.name.toLowerCase().startsWith(prefix))&&repo.path!==deploy.value);
      const deployRepo=(state.repos||[]).find(repo=>repo.path===deploy.value);
      const targets=[...repos,...(deployRepo?[deployRepo]:[])];if(!targets.length){status.textContent=t('No repositories in this folder.');return;}
      run.disabled=true;out.replaceChildren();let done=0;const entries=[];
      await mapLimit(targets,6,async repo=>{
        const isDeploy=repo===deployRepo;
        try{const answer=await api('/api/repo/activity?'+query({path:repo.path,since:day(start),until:day(end),merges:'false'}));
          for(const commit of answer.commits||[])entries.push({kind:isDeploy?'deploy':'commit',repo,hash:commit.hash,date:commit.date,text:commit.subject,who:commit.author,ref:commit.ref,paths:commit.paths,pushed:commit.pushed});}catch{}
        try{const answer=await api('/api/repo/recent-tags?'+query({path:repo.path,since:Math.floor(start.getTime()/1000)}));
          for(const tag of answer.tags||[])entries.push({kind:'tag',repo,tag:tag.name,date:tag.date,text:tag.name});}catch{}
        status.textContent=t('Reading {done} of {total}…',{done:++done,total:targets.length});
      });
      run.disabled=false;
      const list=mergeTimeline(entries,start.toISOString(),end.toISOString());
      status.textContent=t('{count} changes between {from} and {to}',{count:list.length,from:start.toLocaleString(),to:end.toLocaleString()});
      if(!list.length){out.append(el('div','multi-repo-empty',t('Nothing changed in this window.')));return;}
      let lastDay='';
      for(const item of list){
        const when=new Date(item.at);const d=when.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
        if(d!==lastDay){lastDay=d;out.append(el('h4','incident-day',d));}
        const line=el('div',`incident-line incident-${item.kind}`);
        const icon=item.kind==='deploy'?'🚀':item.kind==='tag'?'🏷':'●';
        line.append(el('span','incident-time',when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})),el('span','incident-icon',icon),repoLink(item.repo));
        const body=el('div','incident-body');body.append(el('span','',item.text));
        const meta=[item.who,item.ref,item.hash?String(item.hash).slice(0,8):'',item.kind==='commit'&&item.pushed===false?t('not pushed'):''].filter(Boolean).join(' · ');if(meta)body.append(el('small','fleet-muted',meta));
        if(item.kind==='deploy'){const files=deployFiles(item.paths);if(files.length)body.append(el('small','incident-files',files.join(' · ')));}
        line.append(body);out.append(line);
      }
    };
  }

  addPanel('incident',t('Incident timeline'),build);
  window.GitDeckIncident=helpers;
})();
