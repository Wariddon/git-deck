'use strict';
// Repository weather: one symbol per repository that sums up how it is doing, and one sentence per
// family ("crs-: mostly sunny; storm at crs-webview"). ☀ nothing open · ⛅ something to do soon
// (behind, unpushed, a branch deleted on the remote) · 🌧 likely trouble (a forecast clash with a
// teammate, far behind) · ⛈ broken now (conflicts, unfinished operation, a forecast conflict).
// Built from the last Pending check and the last Conflict forecast; nothing is read from Git here.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const icons={unknown:'○',sun:'☀',cloud:'⛅',rain:'🌧',storm:'⛈'};const rank={unknown:-1,sun:0,cloud:1,rain:2,storm:3};
  function weatherFor(p,forecast){
    const reasons=[];let level='sun';const raise=(to,why)=>{if(rank[to]>rank[level])level=to;reasons.push(why);};
    if(!p)return {level:'unknown',icon:icons.unknown,reasons:[t('Not checked yet')]};
    if(p.conflicts||p.operation)raise('storm',t('{operation} not finished',{operation:p.operation||'merge'}));
    if(forecast?.tone==='bad')raise('storm',forecast.text);
    if(forecast?.tone==='warn')raise('rain',forecast.text);
    if(p.behind>20)raise('rain',t('{count} commit(s) behind',{count:p.behind}));
    else if(p.behind)raise('cloud',t('{count} commit(s) behind',{count:p.behind}));
    if(p.ahead)raise('cloud',t('{count} commit(s) to push',{count:p.ahead}));
    if(p.changed||p.untracked)raise('cloud',t('{count} file(s) not committed',{count:(p.changed||0)+(p.untracked||0)}));
    if(p.upstreamGone)raise('cloud',t('{branch} was deleted on the remote',{branch:p.branch}));
    if((p.unpushedBranches||[]).length)raise('cloud',t('{count} branch(es) only on this computer',{count:p.unpushedBranches.length}));
    return {level,icon:icons[level],reasons};
  }
  const familyOf=(name)=>{const at=String(name).indexOf('-');return at>0?String(name).slice(0,at+1):String(name);};
  // One line per family: the overall sky and where the worst weather is.
  function familySky(rows){
    // Repositories not checked yet do not change the sky; a family with none checked is unknown.
    const counts={unknown:0,sun:0,cloud:0,rain:0,storm:0};for(const row of rows)counts[row.w.level]++;
    const worst=['storm','rain'].find(level=>counts[level]);
    const sky=counts.storm?'storm':counts.rain?'rain':counts.cloud>counts.sun?'cloud':counts.sun?'sun':'unknown';
    const where=worst?rows.filter(row=>row.w.level===worst).map(row=>row.name).slice(0,3):[];
    return {level:sky,icon:icons[sky],counts,worst:worst||'',where};
  }
  const helpers={weatherFor,familySky,familyOf,icons};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  window.GitDeckWeather=helpers;

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn}=F;
  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const skyText=()=>({unknown:t('Not checked yet'),sun:t('sunny'),cloud:t('cloudy'),rain:t('rain likely'),storm:t('storm')});

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const refresh=el('button','primary',t('Refresh'));refresh.type='button';bar.append(folder,refresh);
    const out=el('div','weather-board');const status=el('small','multi-repo-status');
    panel.append(bar,el('p','multi-repo-explain',t('Every repository as weather: ☀ nothing open, ⛅ something to do soon, 🌧 likely trouble, ⛈ broken now. From the last Pending check and Conflict forecast; run those for a fresh sky. Click a repository to open it.')),status,out);
    const draw=()=>{
      const snap=readJson('gitdeck.pendingSnapshot',null);const cache=readJson('gitdeck.forecastCache',{});
      const pending=new Map((snap?.items||[]).map(item=>[String(item.path).toLowerCase(),item.pending]));
      const rows=reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path)).map(repo=>({repo,name:repo.name,w:weatherFor(pending.get(repo.path.toLowerCase()),cache[repo.path.toLowerCase()])}));
      const families=new Map();for(const row of rows){const key=familyOf(row.name);if(!families.has(key))families.set(key,[]);families.get(key).push(row);}
      out.replaceChildren();
      status.textContent=snap?t('From the Pending check of {time}',{time:new Date(snap.at).toLocaleString()}):t('Run a Pending check first for real weather.');
      const sorted=[...families.entries()].map(([name,list])=>({name,list,sky:familySky(list)})).sort((a,b)=>rank[b.sky.level]-rank[a.sky.level]||b.list.length-a.list.length||a.name.localeCompare(b.name));
      for(const family of sorted){
        const box=el('section',`weather-family sky-${family.sky.level}`);
        const head=el('div','weather-head');head.append(el('span','weather-icon',family.sky.icon),el('strong','',family.name),el('span','',skyText()[family.sky.level]+(family.sky.where.length?` · ${t('{weather} at {repos}',{weather:skyText()[family.sky.worst],repos:family.sky.where.join(', ')})}`:'')));
        const tiles=el('div','weather-tiles');
        for(const row of family.list.sort((a,b)=>rank[b.w.level]-rank[a.w.level]||a.name.localeCompare(b.name))){
          const tile=el('button',`weather-tile w-${row.w.level}`);tile.type='button';tile.title=[row.name,...row.w.reasons].join('\n');
          tile.append(el('span','weather-icon',row.w.icon),el('span','',row.name));
          tile.onclick=()=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')void openWorkspace(row.repo,'changes');};
          tiles.append(tile);
        }
        box.append(head,tiles);out.append(box);
      }
    };
    refresh.onclick=draw;folder.addEventListener('change',draw);draw();
    window.addEventListener('storage',(event)=>{if(event.key==='gitdeck.pendingSnapshot'||event.key==='gitdeck.forecastCache')draw();});
  }
  addPanel('weather',t('Repository weather'),build);
})();
