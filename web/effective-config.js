'use strict';
// Effective configuration: which value a Spring Boot service really gets in one environment
// (server side: lib/GitDeck.Config.ps1). Layers, lowest first, as Spring Boot applies them:
//   1 application.yml / .properties
//   2 application-{env}.yml / .properties
//   3 ConfigMap files (an application.yml or .properties block in a ConfigMap, mounted as config)
//   4 environment variables (ConfigMap keys used with envFrom, env: name/value in manifests or Helm)
// The usual surprise it shows: a value changed in application-{env}.yml that a ConfigMap overrides.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Spring relaxed binding: spring.kafka.bootstrap-servers, SPRING_KAFKA_BOOTSTRAPSERVERS and
  // my.list[0].name / MY_LIST_0_NAME are the same setting.
  const canon=(key)=>String(key||'').toLowerCase().replace(/\[(\d+)\]/g,'.$1').replace(/-/g,'').replace(/\./g,'_');
  const looksLikeEnv=(key)=>/^[A-Z][A-Z0-9_]*$/.test(String(key));
  function flattenProperties(text){
    const out=new Map();
    for(const raw of String(text).split(/\r?\n/)){
      const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith('!'))continue;
      const match=line.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/);if(match)out.set(match[1],match[2]);
    }
    return out;
  }
  const unquote=(value)=>String(value).trim().replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1');
  const indentOf=(line)=>line.match(/^\s*/)[0].length;
  // What a deploy file feeds the service: ConfigMap data (keys become environment variables, file-like
  // keys become mounted config files) and env: name/value pairs of Deployments or Helm values.
  // nameMatch: the file is named after the service (lns-app-configuration/{svc}.yml): a plain Spring file
  // there (no kind:/apiVersion:) is the configuration mounted for the service.
  function deployInputs(text,file='',nameMatch=false){
    const env=[],files=[];
    for(const doc of String(text).split(/^---\s*$/m)){
      const lines=doc.split(/\r?\n/);
      if(nameMatch&&doc.trim()&&!/^(kind|apiVersion):/m.test(doc)){files.push({name:String(file).split('/').pop(),via:file,kind:'yaml',content:doc});continue;}
      if(/^kind:\s*ConfigMap\s*$/m.test(doc)){
        const name=(doc.match(/^metadata:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+name:\s*["']?([^"'\s]+)/m)||[])[1]||file;
        const start=lines.findIndex(line=>/^data:\s*$/.test(line));
        if(start>=0){
          let child=-1;
          for(let i=start+1;i<lines.length;i++){
            const line=lines[i];if(!line.trim()||/^\s*#/.test(line))continue;
            const indent=indentOf(line);if(indent===0)break;if(child<0)child=indent;if(indent!==child)continue;
            const pair=line.trim().match(/^["']?([^"':]+)["']?:\s*(.*)$/);if(!pair)continue;
            const key=pair[1].trim();const rest=pair[2].trim();
            if(/^[|>][+-]?$/.test(rest)){
              const block=[];let j=i+1;
              for(;j<lines.length;j++){const next=lines[j];if(next.trim()&&indentOf(next)<=child)break;block.push(next);}
              const pad=Math.min(...block.filter(line=>line.trim()).map(indentOf),Infinity);
              const content=block.map(line=>line.slice(Number.isFinite(pad)?pad:0)).join('\n');
              i=j-1;
              if(/\.(ya?ml|properties)$/i.test(key))files.push({name:key,via:name,kind:/\.properties$/i.test(key)?'properties':'yaml',content});
              else env.push({name:key,value:content.trim(),via:name});
            }else if(/\.(ya?ml|properties)$/i.test(key)){files.push({name:key,via:name,kind:/\.properties$/i.test(key)?'properties':'yaml',content:unquote(rest)});}
            else env.push({name:key,value:unquote(rest),via:name});
          }
        }
        continue;
      }
      // - name: SPRING_PROFILES_ACTIVE  /  value: "uat"   (valueFrom entries have no literal value)
      for(let i=0;i<lines.length-1;i++){
        const name=lines[i].match(/^\s*-\s*name:\s*["']?([A-Za-z_][A-Za-z0-9_.]*)["']?\s*$/);if(!name)continue;
        const value=lines[i+1].match(/^\s*value:\s*(.*)$/);if(value)env.push({name:name[1],value:unquote(value[1]),via:file});
      }
    }
    return {env,files};
  }
  // Layers (lowest first) -> one row per setting with every layer's value and the winner.
  function mergeLayers(layers){
    const rows=new Map();
    layers.forEach((layer,index)=>{
      for(const [key,value] of layer.map){
        const id=canon(key);
        if(!rows.has(id))rows.set(id,{key,values:new Array(layers.length).fill(undefined),winner:-1});
        const row=rows.get(id);
        // Show the property form (spring.datasource.url) rather than the variable form when both appear.
        if(looksLikeEnv(row.key)&&!looksLikeEnv(key))row.key=key;
        row.values[index]=value;row.winner=index;
      }
    });
    const out=[...rows.values()];
    const lookup=new Map(out.map(row=>[canon(row.key),row.values[row.winner]]));
    for(const row of out){row.effective=resolvePlaceholders(row.values[row.winner],lookup);}
    return out.sort((a,b)=>a.key.localeCompare(b.key));
  }
  // ${NAME} and ${NAME:default}, looked up among the merged settings (both naming forms), three levels deep.
  function resolvePlaceholders(value,lookup,depth=0){
    if(typeof value!=='string'||depth>2||!value.includes('${'))return value;
    const next=value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g,(match,name,fallback)=>{const found=lookup.get(canon(name));return found!==undefined?String(found):fallback!==undefined?fallback:match;});
    return next===value?value:resolvePlaceholders(next,lookup,depth+1);
  }
  // What happened to a setting: a deployment value replacing a value in the service's own files is
  // the case worth seeing first.
  function classify(row,fileLayers){
    const fromFiles=row.values.slice(0,fileLayers).some(value=>value!==undefined);
    const fromDeploy=row.values.slice(fileLayers).some(value=>value!==undefined);
    if(fromFiles&&row.winner>=fileLayers){
      const fileValue=row.values.slice(0,fileLayers).filter(value=>value!==undefined).pop();
      return String(fileValue)===String(row.values[row.winner])?'same':'overridden';
    }
    if(fromDeploy&&!fromFiles)return 'deploy-only';
    if(row.values[0]!==undefined&&row.values[1]!==undefined&&String(row.values[0])!==String(row.values[1]))return 'profile';
    return 'file';
  }
  // "A ConfigMap that overrides only part of a group is more dangerous than none": groups (for example
  // spring.data.redis) where the deployment sets some keys while the service's files still set others.
  function partialOverrides(rows,fileLayers){
    const groups=new Map();
    for(const row of rows){
      const parts=String(row.key).split('.');if(parts.length<3)continue;
      const group=parts.slice(0,-1).join('.');if(!groups.has(group))groups.set(group,{group,deploy:[],files:[]});
      const entry=groups.get(group);const leaf=parts[parts.length-1];
      if(row.winner>=fileLayers)entry.deploy.push(leaf);else if(row.winner>=0)entry.files.push(leaf);
    }
    return [...groups.values()].filter(group=>group.deploy.length&&group.files.length).sort((a,b)=>a.group.localeCompare(b.group));
  }
  // Environments side by side: settings missing in some environments (drift) or with different values.
  const kindOrder={missing:0,different:1,same:2};
  // Effective configuration then and now: settings added, removed or changed, and the layer each
  // value came from (a service file, a ConfigMap, an environment variable).
  function diffEffective(before,after,labelsBefore=[],labelsAfter=[]){
    const then=new Map((before||[]).map(item=>[item.key,item])),now=new Map((after||[]).map(item=>[item.key,item]));
    const out=[];
    for(const key of new Set([...then.keys(),...now.keys()])){
      const a=then.get(key),b=now.get(key);
      const kind=!a?'added':!b?'removed':String(a.effective)!==String(b.effective)?'changed':a.winner!==b.winner?'moved':'';
      if(!kind)continue;
      out.push({key,kind,before:a?.effective,after:b?.effective,fromBefore:a?labelsBefore[a.winner]||'':'',fromAfter:b?labelsAfter[b.winner]||'':''});
    }
    const order={changed:0,removed:1,added:2,moved:3};
    return out.sort((x,y)=>order[x.kind]-order[y.kind]||x.key.localeCompare(y.key));
  }
  function compareEnvironments(byEnv){
    const envs=Object.keys(byEnv);const keys=new Map();
    for(const env of envs)for(const row of byEnv[env]){
      const id=canon(row.key);if(!keys.has(id))keys.set(id,{key:row.key,values:{},deploy:{}});
      const item=keys.get(id);if(looksLikeEnv(item.key)&&!looksLikeEnv(row.key))item.key=row.key;
      item.values[env]=row.effective;item.deploy[env]=row.fromDeploy===true;
    }
    const out=[];
    for(const item of keys.values()){
      const present=envs.filter(env=>item.values[env]!==undefined);
      const distinct=new Set(present.map(env=>String(item.values[env])));
      out.push({...item,missing:envs.filter(env=>item.values[env]===undefined),kind:present.length<envs.length?'missing':distinct.size>1?'different':'same'});
    }
    return out.sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||a.key.localeCompare(b.key));
  }
  const helpers={diffEffective,canon,looksLikeEnv,flattenProperties,deployInputs,mergeLayers,resolvePlaceholders,classify,partialOverrides,compareEnvironments};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,table,row:tableRow,query,repoLink}=F;
  const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const recall=(key,fallback='')=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};
  const select=(label)=>{const node=document.createElement('select');node.className='workflow-input';node.setAttribute('aria-label',label);return node;};
  const repos=()=>(state.repos||[]).filter(repo=>repo.valid!==false&&!repo.pending).sort((a,b)=>a.name.localeCompare(b.name));
  const flatten=(kind,text)=>kind==='properties'?flattenProperties(text):F.flattenYaml(text);
  const kindOf=(file)=>/\.properties$/i.test(file)?'properties':'yaml';

  function build(panel){
    const bar=el('div','operations-toolbar');
    const service=select(t('Service repository'));const env=input(t('Environment, for example uat'));const envList=document.createElement('datalist');envList.id='effective-config-envs';env.setAttribute('list',envList.id);env.value=recall('gitdeck.configEnv','');
    const deploy=select(t('Deploy repository'));const name=input(t('Name in the deploy repository (empty: repository name)'));
    const ref=input(t('Branch or tag (empty: files on disk)'));ref.classList.add('fleet-ref');
    const load=button(t('Show effective configuration'),'primary');
    bar.append(service,env,envList,deploy,name,ref,load);
    const chips=el('div','pending-filters');const find=input(t('Filter settings, for example datasource or kafka'));
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');const notes=el('div','effective-config-notes');
    panel.append(bar,el('p','multi-repo-explain',t('The value each Spring Boot setting really gets in one environment: application.yml, then application-{env}.yml, then ConfigMap files, then environment variables from ConfigMaps and manifests. Settings that the deployment overrides come first.')),chips,find,status,notes,out);
    const fill=()=>{
      const list=repos();const keepService=recall('gitdeck.configService','');const keepDeploy=recall('gitdeck.deployRepo','');
      service.replaceChildren(...list.map(repo=>new Option(repo.name,repo.path)));if(list.some(repo=>repo.path===keepService))service.value=keepService;
      deploy.replaceChildren(new Option(t('No deploy repository'),''),...list.map(repo=>new Option(repo.name,repo.path)));
      const guess=list.find(repo=>repo.path===keepDeploy)||list.find(repo=>/deploy|gitops|helm|k8s|kube|manifest|argocd/i.test(repo.name));deploy.value=guess?guess.path:'';
    };
    fill();panel.addEventListener('focusin',()=>{if(service.options.length!==repos().length)fill();});
    const profiles=async()=>{try{const answer=(await api('/api/repo/effective-config?'+query({path:service.value,env:'',ref:ref.value.trim()}))).config;envList.replaceChildren(...answer.profiles.map(profile=>new Option(profile,profile)));if(!env.value&&answer.profiles.length)env.placeholder=t('Environment, for example {env}',{env:answer.profiles[0]});}catch{}};
    service.addEventListener('change',profiles);profiles();
    let rows=[],filter='overridden',layerCount=0,fileLayers=2,labels=[];
    const counts=()=>{const by={};for(const item of rows)by[item.kind]=(by[item.kind]||0)+1;return by;};
    const drawChips=()=>{
      const by=counts();chips.replaceChildren();
      for(const [id,label] of [['overridden',t('Overridden by the deployment')],['deploy-only',t('Only in the deployment')],['profile',t('Changed by the profile')],['all',t('All settings')]]){
        const chip=button(`${label} ${id==='all'?rows.length:by[id]||0}`,'pending-filter'+(filter===id?' active':''));chip.onclick=()=>{filter=id;drawChips();draw();};chips.append(chip);
      }
    };
    const cell=(value)=>value===undefined?el('span','fleet-muted','—'):el('code','',String(value));
    let comparing=false;
    const draw=()=>{
      if(comparing)return;
      out.replaceChildren();const words=find.value.trim().toLowerCase();
      const shown=rows.filter(item=>(filter==='all'||item.kind===filter)&&(!words||item.key.toLowerCase().includes(words)||String(item.effective).toLowerCase().includes(words)));
      if(!shown.length){out.append(el('div','multi-repo-empty',filter==='overridden'?t('No setting from the service files is overridden by the deployment.'):t('Nothing to show.')));return;}
      const grid=table([t('Setting'),'application.yml',`application-${env.value.trim()||'{env}'}.yml`,t('Deployment'),t('Effective value')]);grid.classList.add('effective-config-table');
      for(const item of shown.slice(0,500)){
        const deployValue=item.values.slice(fileLayers).map((value,index)=>value===undefined?null:{value,label:labels[fileLayers+index]}).filter(Boolean).pop();
        const deployCell=deployValue?el('div','effective-config-deploy'):cell(undefined);
        if(deployValue){deployCell.append(el('code','',String(deployValue.value)),el('small','fleet-muted',deployValue.label));}
        const effective=el('div','effective-config-value');effective.append(el('code','',String(item.effective)));
        if(item.effective!==item.values[item.winner])effective.append(el('small','fleet-muted',t('from {value}',{value:item.values[item.winner]})));
        effective.append(el('small','fleet-muted',labels[item.winner]));
        const tr=tableRow([el('code','effective-config-key',item.key),cell(item.values[0]),cell(item.values[1]),deployCell,effective]);
        tr.classList.add('effective-config-'+item.kind);grid.append(tr);
      }
      out.append(grid);
      if(shown.length>500)out.append(el('p','multi-repo-note',t('Showing the first 500. Filter to narrow the list.')));
    };
    find.addEventListener('input',draw);
    // One environment: the service's files, then the deploy files for it, merged in Spring Boot order.
    const compute=(answer,envName,warn)=>{
      const layers=[];
      const base=new Map(),profile=new Map();const baseFiles=[],profileFiles=[];
      for(const source of answer.service){const target=source.role==='base'?base:profile;try{for(const [key,value] of flatten(kindOf(source.file),source.content))target.set(key,value);(source.role==='base'?baseFiles:profileFiles).push(source.file);}catch(error){warn(`${source.file}: ${error.message}`);}}
      layers.push({label:baseFiles.join(', ')||'application.yml',map:base});layers.push({label:profileFiles.join(', ')||`application-${envName}.yml`,map:profile});
      const mounted=[],variables=[];
      for(const file of answer.deploy?.files||[]){const inputs=deployInputs(file.content,file.file,file.nameMatch);for(const item of inputs.files)mounted.push(item);for(const item of inputs.env)variables.push(item);}
      for(const item of mounted){try{layers.push({label:t('ConfigMap file {name} ({via})',{name:item.name,via:item.via}),map:flatten(item.kind,item.content)});}catch(error){warn(`${item.via}: ${error.message}`);}}
      if(variables.length){const map=new Map();for(const item of variables)map.set(item.name,item.value);layers.push({label:t('Environment variable ({via})',{via:[...new Set(variables.map(item=>item.via))].slice(0,3).join(', ')}),map});}
      const merged=mergeLayers(layers).map(item=>({...item,kind:classify(item,2),fromDeploy:item.winner>=2}));
      return {rows:merged,labels:layers.map(layer=>layer.label)};
    };
    const request=(repo,envName,refs={})=>api('/api/repo/effective-config?'+query({path:repo.path,env:envName,ref:refs.ref??ref.value.trim(),deploy:deploy.value,deployRef:refs.deployRef||'',name:name.value.trim()})).then(answer=>answer.config);
    const warnNote=(text)=>notes.append(el('div','repo-alert tone-warn',text));
    const partialNotes=(list)=>{for(const group of list.slice(0,8))warnNote(t('{group}: the deployment sets {deploy} but the service files still set {files}. A partial override is more dangerous than none: check that they belong together.',{group:group.group,deploy:group.deploy.join(', '),files:group.files.join(', ')}));};
    load.onclick=async()=>{
      comparing=false;find.oninput=null;
      const repo=repos().find(item=>item.path===service.value);if(!repo)return;
      const envName=env.value.trim();remember('gitdeck.configEnv',envName);remember('gitdeck.configService',repo.path);if(deploy.value)remember('gitdeck.deployRepo',deploy.value);
      load.disabled=true;out.replaceChildren();notes.replaceChildren();status.textContent=t('Reading {name}…',{name:repo.name});
      let answer;
      try{answer=await request(repo,envName);}
      catch(error){load.disabled=false;status.textContent='';out.append(el('div','repo-alert tone-bad',error.message));return;}
      load.disabled=false;
      envList.replaceChildren(...answer.profiles.map(profile=>new Option(profile,profile)));
      const result=compute(answer,envName,warnNote);fileLayers=2;labels=result.labels;layerCount=labels.length;rows=result.rows;
      partialNotes(partialOverrides(rows,fileLayers));
      if(!answer.service.length)warnNote(t('No application.yml or application.properties was found in {name}.',{name:repo.name}));
      if(answer.deploy&&!(answer.deploy.files||[]).length)warnNote(t('No file in the deploy repository at {ref} names {name}. Set the name the deploy repository uses.',{ref:answer.deploy.ref,name:answer.deploy.name}));
      notes.append(el('p','fleet-muted',t('Assumes ConfigMap keys reach the container as environment variables (envFrom) and ConfigMap files are imported as configuration. Values from Spring Cloud Config, Vault or command-line arguments are not visible here.')));
      const by=counts();
      status.textContent=t('{settings} settings · {overridden} overridden by the deployment · {files} deploy files at {ref}',{settings:rows.length,overridden:by.overridden||0,files:(answer.deploy?.files||[]).length,ref:answer.deploy?.ref||'—'});
      if(!(by.overridden||0)&&filter==='overridden')filter='all';
      drawChips();draw();
    };
    // What changed since a moment: the same environment, service and deploy repository as they were then.
    const since=el('input','workflow-input');since.type='datetime-local';since.setAttribute('aria-label',t('Since'));since.title=t('Compare with the configuration at this moment');
    {const d=new Date(Date.now()-24*3600e3);const p=(n)=>String(n).padStart(2,'0');since.value=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
    const changedSince=button(t('What changed since'));bar.insertBefore(since,load.nextSibling);bar.insertBefore(changedSince,since.nextSibling);
    changedSince.onclick=async()=>{
      const repo=repos().find(item=>item.path===service.value);if(!repo)return;const envName=env.value.trim();
      comparing=true;changedSince.disabled=true;out.replaceChildren();notes.replaceChildren();chips.replaceChildren();status.textContent=t('Reading {name}…',{name:repo.name});
      try{
        const at=new Date(since.value).toISOString();
        const then=(await api('/api/repo/ref-at?'+query({path:repo.path,at,ref:ref.value.trim()}))).ref;
        const deployThen=deploy.value?(await api('/api/repo/ref-at?'+query({path:deploy.value,at}))).ref:null;
        if(!then.found){status.textContent='';warnNote(t('{name} has no commit before {time}.',{name:repo.name,time:new Date(at).toLocaleString()}));return;}
        const [nowAnswer,thenAnswer]=await Promise.all([request(repo,envName),request(repo,envName,{ref:then.commit,deployRef:deployThen?.found?deployThen.commit:''})]);
        const nowResult=compute(nowAnswer,envName,warnNote),thenResult=compute(thenAnswer,envName,()=>{});
        const changes=diffEffective(thenResult.rows,nowResult.rows,thenResult.labels,nowResult.labels);
        status.textContent=t('{count} effective setting(s) changed since {time} · service at {commit}{deploy}',{count:changes.length,time:new Date(at).toLocaleString(),commit:then.short,deploy:deployThen?.found?' · '+t('deploy repository at {commit}',{commit:deployThen.short}):''});
        if(!changes.length){out.append(el('div','multi-repo-empty',t('The effective configuration of {env} is the same as then.',{env:envName||'default'})));return;}
        const grid=table([t('Setting'),t('Then'),t('Now'),t('Where it changed')]);grid.classList.add('effective-config-table');
        const kinds={changed:t('changed'),removed:t('removed'),added:t('added'),moved:t('same value, other source')};
        for(const item of changes.slice(0,500)){
          const thenCell=item.before===undefined?el('span','fleet-muted','—'):el('code','fleet-was',String(item.before));
          const nowCell=item.after===undefined?el('span','fleet-muted','—'):el('code','fleet-now',String(item.after));
          const whereCell=el('div','');whereCell.append(el('span',`fleet-state tone-${item.kind==='changed'||item.kind==='removed'?'warn':'info'}`,kinds[item.kind]),el('small','fleet-muted',' '+(item.fromAfter||item.fromBefore)));
          grid.append(tableRow([el('code','effective-config-key',item.key),thenCell,nowCell,whereCell]));
        }
        out.append(grid);
      }catch(error){status.textContent='';out.append(el('div','repo-alert tone-bad',error.message));}
      finally{changedSince.disabled=false;}
    };
    // Every environment side by side: drift (a setting missing in some environments) first.
    const compareAll=button(t('Compare environments'));bar.insertBefore(compareAll,load.nextSibling);
    compareAll.onclick=async()=>{
      const repo=repos().find(item=>item.path===service.value);if(!repo)return;
      comparing=true;compareAll.disabled=true;out.replaceChildren();notes.replaceChildren();chips.replaceChildren();status.textContent=t('Reading {name}…',{name:repo.name});
      try{
        const first=await request(repo,'');
        const envs=[...new Set([...(first.profiles||[]),...(first.deploy?.files||[]).map(file=>file.env).filter(value=>value&&value!=='default')])].sort((a,b)=>(window.GitDeckIntegrations?.envRank?.(a)??0)-(window.GitDeckIntegrations?.envRank?.(b)??0)||a.localeCompare(b));
        if(!envs.length){status.textContent='';warnNote(t('No environments found: no application-{env} files and no deploy files per environment.'));return;}
        const byEnv={};const partial=[];
        for(const envName of envs){const answer=await request(repo,envName);const result=compute(answer,envName,warnNote);byEnv[envName]=result.rows;for(const group of partialOverrides(result.rows,2))partial.push({...group,group:`${envName.toUpperCase()} · ${group.group}`});}
        partialNotes(partial);
        const matrix=compareEnvironments(byEnv);
        const counts_={missing:matrix.filter(item=>item.kind==='missing').length,different:matrix.filter(item=>item.kind==='different').length};
        status.textContent=t('{settings} settings in {envs} environments · {missing} missing somewhere · {different} with different values',{settings:matrix.length,envs:envs.length,missing:counts_.missing,different:counts_.different});
        let mode=counts_.missing?'missing':'different';
        const drawMatrix=()=>{
          out.replaceChildren();const words=find.value.trim().toLowerCase();
          const shown=matrix.filter(item=>(mode==='all'||item.kind===mode)&&(!words||item.key.toLowerCase().includes(words)));
          if(!shown.length){out.append(el('div','multi-repo-empty',t('Nothing to show.')));return;}
          const grid=table([t('Setting'),...envs.map(value=>value.toUpperCase())]);grid.classList.add('effective-config-table');
          for(const item of shown.slice(0,500)){
            const cells=envs.map(value=>{if(item.values[value]===undefined)return el('span','fleet-state tone-bad',t('missing'));const node=el('code',item.deploy[value]?'fleet-now':'',String(item.values[value]));node.title=item.deploy[value]?t('From the deployment'):t('From the service files');return node;});
            const tr=tableRow([el('code','effective-config-key',item.key),...cells]);tr.classList.add('effective-config-'+(item.kind==='missing'?'overridden':item.kind==='different'?'deploy-only':'file'));grid.append(tr);
          }
          out.append(grid);
        };
        const drawModes=()=>{chips.replaceChildren();for(const [id,label] of [['missing',t('Missing in some environments')],['different',t('Different values')],['all',t('All settings')]]){const chip=button(`${label} ${id==='all'?matrix.length:counts_[id]}`,'pending-filter'+(mode===id?' active':''));chip.onclick=()=>{mode=id;drawModes();drawMatrix();};chips.append(chip);}};
        find.oninput=drawMatrix;drawModes();drawMatrix();
      }catch(error){status.textContent='';out.append(el('div','repo-alert tone-bad',error.message));}
      finally{compareAll.disabled=false;}
    };
  }

  addPanel('effective-config',t('Effective config'),build);
  const nav=document.querySelector('.operations-tabs');const after=nav?.querySelector('[data-operations-view="compare-files"]');const tab=nav?.querySelector('[data-operations-view="effective-config"]');if(after&&tab)after.after(tab);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="effective-config"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='effective-config';item.append(el('strong','',t('Effective config')),el('small','',t('What a service really gets in one environment')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('effective-config');};
    const anchor=more.querySelector('[data-multi-repo="compare-files"]');if(anchor)anchor.after(item);else more.append(item);
  }
  window.GitDeckEffectiveConfig=helpers;
})();
