'use strict';
// More Dashboard views for many repositories at once (helpers from web/multi-repo.js,
// server side in lib/GitDeck.Fleet.ps1):
//   Tag many      - create the next tag in many repositories (e.g. ...-poc04 -> ...-poc05) and push them
//   Ticket        - everything one ticket key touched: branches, commits (pushed or not) and tags
//   Compare files - one file (pom.xml, application-*.yml...) across sibling repositories, against a reference
//   CI status     - the latest GitLab pipeline of each repository's branch or latest tag
(function(){
  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,table,row,mapLimit,runQuiet,query,whenOf}=F;
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const recall=(key,fallback='')=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder,label)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',label||placeholder);return node;};
  const openUrl=(url)=>{if(url)api('/api/action',{method:'POST',body:JSON.stringify({action:'open-url',url})}).catch(error=>feedback(error.message,true));};
  const meter=()=>{const box=el('div','gd-meter');box.hidden=true;const fill=el('span','gd-meter-fill');box.append(fill);return {box,set:(done,total)=>{box.hidden=!total||done>=total;fill.style.width=total?Math.round(done/total*100)+'%':'0';}};};
  // Latest pending data for these repositories: reuse the Pending work check, else ask each one.
  async function pendingFor(repos,progress){
    const known=new Map((F.pendingResults()||[]).filter(item=>item.pending).map(item=>[item.repo.path,item.pending]));
    let done=0;
    return mapLimit(repos,6,async repo=>{
      let pending=known.get(repo.path);let error='';
      if(!pending){try{pending=(await api('/api/repo/pending?'+query({path:repo.path}))).pending;}catch(problem){error=problem.message;}}
      progress?.(++done,repos.length);return {repo,pending,error};
    });
  }

  // ---- Tag many -----------------------------------------------------------------------------
  // The next tag continues the last number of the latest tag and keeps its zero padding:
  // feature-enhance-report-ci-poc04 -> -poc05, 1.2.2-poc14 -> 1.2.2-poc15, v1.0.9 -> v1.0.10.
  function nextTag(tag){
    const match=String(tag||'').match(/^(.*?)(\d+)(\D*)$/);if(!match)return '';
    const next=String(Number(match[2])+1).padStart(match[2].length,'0');return match[1]+next+match[3];
  }
  function buildTagMany(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const branch=input(t('Only repositories on this branch (empty: all)'));branch.value=recall('gitdeck.tagManyBranch','');
    const load=button(t('Load'),'primary');bar.append(folder,branch,load);
    const explain=el('p','multi-repo-explain',t('Each row suggests the next tag after the repository\'s latest tag. Edit any name, tick the rows to tag, then create them all at once.'));
    const options=el('div','fleet-options');
    const message=input(t('Tag message (optional)'));
    const pushBox=el('label','settings-check');const push=el('input');push.type='checkbox';push.checked=recall('gitdeck.tagManyPush','1')==='1';pushBox.append(push,el('span','',t('Push each tag to origin')));
    const same=input(t('Same name for all ticked rows'));const applySame=button(t('Use for all'));
    const create=button(t('Create tags'),'primary');create.disabled=true;
    options.append(message,pushBox,same,applySame,create);options.hidden=true;
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body');
    panel.append(bar,explain,options,status,bar2.box,out);
    let rows=[];
    const count=()=>rows.filter(item=>item.box.checked&&item.name.value.trim()).length;
    const refresh=()=>{const n=count();create.disabled=!n;create.textContent=n?t('Create {count} tags',{count:n}):t('Create tags');};
    load.onclick=async()=>{
      remember('gitdeck.tagManyBranch',branch.value.trim());
      const repos=reposIn(folder.value);if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      load.disabled=true;out.replaceChildren();options.hidden=true;status.textContent=t('Reading {count} repositories…',{count:repos.length});
      const found=await pendingFor(repos,(done,total)=>bar2.set(done,total));bar2.set(0,0);load.disabled=false;
      const wanted=branch.value.trim().toLowerCase();
      const list=found.filter(item=>item.pending&&(!wanted||String(item.pending.branch||'').toLowerCase()===wanted))
        .sort((a,b)=>(Number(b.pending.commitsSinceTag)>0)-(Number(a.pending.commitsSinceTag)>0)||a.repo.name.localeCompare(b.repo.name));
      if(!list.length){status.textContent=wanted?t('No repository is on {branch}.',{branch:branch.value.trim()}):t('Nothing to show.');return;}
      const grid=table(['',t('Repository'),t('Branch'),t('Latest tag'),t('Commits since'),t('New tag'),t('Result')]);grid.classList.add('fleet-tag-table');
      const all=el('input');all.type='checkbox';all.title=t('Tick all');grid.rows[0].cells[0].append(all);
      rows=list.map(item=>{
        const p=item.pending;const box=el('input');box.type='checkbox';box.checked=Number(p.commitsSinceTag)>0||!p.latestTag;
        const name=el('input','workflow-input fleet-tag-name');name.value=nextTag(p.latestTag);name.placeholder=t('Tag name');name.setAttribute('aria-label',t('New tag for {name}',{name:item.repo.name}));
        const result=el('span','multi-repo-result');
        const since=Number(p.commitsSinceTag)||0;
        const tr=row([box,repoLink(item.repo),p.branch||'—',p.latestTag?el('span','pending-tag-badge','🏷 '+p.latestTag):el('span','fleet-muted',t('No tag yet')),since?el('b','fleet-count',String(since)):el('span','fleet-muted','0'),name,result]);
        grid.append(tr);box.onchange=refresh;name.oninput=()=>{if(name.value.trim())box.checked=true;refresh();};
        return {...item,box,name,result};
      });
      all.onchange=()=>{rows.forEach(item=>{item.box.checked=all.checked;});refresh();};
      out.append(grid);options.hidden=false;refresh();
      status.textContent=t('{count} repositories. Rows with commits after their latest tag are ticked.',{count:rows.length});
    };
    applySame.onclick=()=>{const name=same.value.trim();if(!name)return;rows.filter(item=>item.box.checked).forEach(item=>{item.name.value=name;});refresh();};
    push.onchange=()=>remember('gitdeck.tagManyPush',push.checked?'1':'0');
    create.onclick=async()=>{
      const todo=rows.filter(item=>item.box.checked&&item.name.value.trim());if(!todo.length)return;
      const summary=todo.map(item=>`${item.repo.name}: ${item.name.value.trim()}`).join('\n');
      if(!confirm(t('Create {count} tags{push}?',{count:todo.length,push:push.checked?t(' and push them to origin'):''})+'\n\n'+summary))return;
      create.disabled=load.disabled=true;let ok=0,failed=0;
      await mapLimit(todo,2,async item=>{
        item.result.className='multi-repo-result';item.result.textContent=t('Working…');
        try{
          const answer=await runQuiet('tag-create',item.repo,{tag:item.name.value.trim(),message:message.value.trim(),push:push.checked,remote:'origin'});
          item.result.textContent=answer?.message||t('Done');item.result.classList.add('tone-ok');item.box.checked=false;ok++;F.markTagSeen?.(item.repo.path,item.name.value.trim());
        }catch(error){item.result.textContent=error.message;item.result.classList.add('tone-bad');failed++;}
      });
      load.disabled=false;refresh();
      status.textContent=t('{ok} tags created · {failed} failed',{ok,failed});
      feedback(t('{ok} tags created · {failed} failed',{ok,failed}),failed>0);
    };
  }

  // ---- Ticket -------------------------------------------------------------------------------
  const ticketPattern=/\b[A-Z][A-Z0-9]{1,9}-\d+\b/;
  function buildTicket(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const key=input(t('Ticket key, for example PAY-1234'));key.value=recall('gitdeck.ticketKey','')||(String(state.workspace?.branch||'').match(ticketPattern)?.[0]||'');
    const find=button(t('Find'),'primary');const copy=button(t('Copy as Markdown'));copy.disabled=true;
    bar.append(folder,key,find,copy);
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body fleet-ticket');
    panel.append(bar,el('p','multi-repo-explain',t('Every branch, commit and tag that mentions the ticket, in every repository: what is pushed, what is only on this computer, and which tags already contain it.')),status,bar2.box,out);
    let found=[];let searchedKey='';let revision=0;
    const invalidate=()=>{revision++;copy.disabled=true;};key.addEventListener('input',invalidate);folder.addEventListener('change',invalidate);
    const stateOf=(ticket)=>{
      const local=ticket.branches.filter(b=>!b.remote);
      const unpushed=ticket.commits.filter(c=>!c.pushed).length+local.filter(b=>!b.upstream).length+local.reduce((n,b)=>n+(b.ahead>0?1:0),0);
      if(unpushed)return {tone:'warn',text:t('Not pushed yet')};
      const released=ticket.tags.find(tag=>tag.contains);if(released)return {tone:'ok',text:t('In tag {tag}',{tag:released.name})};
      return {tone:'info',text:t('Pushed, not tagged yet')};
    };
    find.onclick=async()=>{
      const text=key.value.trim();if(!text){key.focus();return;}remember('gitdeck.ticketKey',text);const request=++revision;
      const repos=reposIn(folder.value);if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      find.disabled=true;copy.disabled=true;out.replaceChildren();found=[];let done=0;
      status.textContent=t('Looking in {count} repositories…',{count:repos.length});
      await mapLimit(repos,6,async repo=>{
        try{const ticket=(await api('/api/repo/ticket?'+query({path:repo.path,key:text}))).ticket;
          if(ticket.branches.length||ticket.commits.length||ticket.tags.length)found.push({repo,ticket});}
        catch(error){found.push({repo,error:error.message});}
        bar2.set(++done,repos.length);
      });
      bar2.set(0,0);find.disabled=false;
      if(request!==revision){out.replaceChildren(el('div','multi-repo-empty',t('Filters changed. Press Find to check again.')));status.textContent='';return;}searchedKey=text;
      found.sort((a,b)=>a.repo.name.localeCompare(b.repo.name));
      const hits=found.filter(item=>item.ticket);
      if(!found.length){out.append(el('div','multi-repo-empty',t('No branch, commit or tag mentions {key}.',{key:text})));status.textContent='';return;}
      const commits=hits.reduce((n,item)=>n+item.ticket.commits.length,0);const waiting=hits.filter(item=>stateOf(item.ticket).tone==='warn').length;
      status.textContent=t('{repos} repositories · {commits} commits · {waiting} not pushed yet',{repos:hits.length,commits,waiting});
      for(const item of found){
        const card=el('section','fleet-ticket-card');const head=el('div','fleet-ticket-head');head.append(repoLink(item.repo));
        if(item.error){head.append(el('span','multi-repo-result tone-bad',item.error));card.append(head);out.append(card);continue;}
        const tk=item.ticket;const s=stateOf(tk);
        if(tk.current)head.append(el('small','fleet-muted',t('on {branch}',{branch:tk.current})));
        head.append(el('span',`fleet-state tone-${s.tone}`,s.text));card.append(head);
        if(tk.branches.length){const line=el('div','fleet-chips');tk.branches.forEach(b=>{const chip=el('span',`fleet-chip${b.remote?' is-remote':''}${!b.remote&&(!b.upstream||b.ahead)?' is-local':''}`,b.name);
          chip.title=b.remote?t('Remote branch'):!b.upstream?t('Only on this computer'):b.ahead?t('{count} commit(s) to push',{count:b.ahead}):t('Pushed');if(!b.remote&&b.ahead)chip.append(el('b','',' ↑'+b.ahead));line.append(chip);});card.append(line);}
        if(tk.commits.length){const list=el('div','fleet-commits');tk.commits.slice(0,6).forEach(c=>{const line=el('div',`fleet-commit${c.pushed?'':' is-unpushed'}`);line.append(el('code','',c.hash),el('span','',c.subject),el('small','fleet-muted',c.date));if(!c.pushed)line.append(el('em','',t('not pushed')));list.append(line);});
          if(tk.commits.length>6)list.append(el('small','fleet-muted',t('and {count} more',{count:tk.commits.length-6})));card.append(list);}
        if(tk.tags.length){const line=el('div','fleet-chips');tk.tags.forEach(tag=>{const chip=el('span','pending-tag-badge','🏷 '+tag.name);chip.title=tag.contains?t('Contains the newest ticket commit'):t('Named after the ticket');line.append(chip);});card.append(line);}
        // Environments running a tag that contains the ticket (from the last Releases load).
        const envs=window.GitDeckIntegrations?.deployedIn(item.repo,tk.tags.filter(tag=>tag.contains).map(tag=>tag.name))||[];
        if(envs.length){const line=el('div','fleet-chips fleet-deployed');line.append(el('small','fleet-muted',t('Configured in Git')));envs.forEach(env=>line.append(el('span','fleet-state tone-info',env.toUpperCase())));card.append(line);}
        const readiness=button(t('Check MR readiness'));const details=el('div','catalog-readiness');
        readiness.onclick=()=>window.GitDeckCatalog?.checkTicket(item.repo,text,details,readiness);
        card.append(readiness,details);
        out.append(card);
      }
      copy.disabled=false;
    };
    key.addEventListener('keydown',event=>{if(event.key==='Enter')find.click();});
    copy.onclick=async()=>{
      const lines=[`### ${searchedKey}`,'',`| ${t('Repository')} | ${t('Branches')} | ${t('Commits')} | ${t('State')} | ${t('Tags')} |`,'|---|---|---|---|---|'];
      for(const item of found.filter(entry=>entry.ticket)){const tk=item.ticket;lines.push(`| ${item.repo.name} | ${tk.branches.map(b=>b.name).join(', ')} | ${tk.commits.length} | ${stateOf(tk).text} | ${tk.tags.map(tag=>tag.name).join(', ')} |`);}
      try{await navigator.clipboard.writeText(lines.join('\n'));feedback(t('Copied'));}catch{feedback(t('Could not copy'),true);}
    };
  }

  // ---- Compare files ------------------------------------------------------------------------
  // Structured files are compared by their settings, so a moved line or a comment does not count:
  // pom.xml by parent, properties and dependency versions; YAML, .properties and JSON by key.
  // YAML as "path.to.key" -> value. Enough for Spring configuration: nested maps, lists ("[0]"),
  // several documents ("[1].…" after ---); block scalars (| or >) are kept as one marker value.
  function flattenYaml(text){
    const out=new Map();const stack=[];const counters=new Map();let doc=0;let block=-1;
    const scalar=(value)=>value.replace(/^["']|["']$/g,'');
    for(const raw of String(text).split(/\r?\n/)){
      if(/^---\s*$/.test(raw)){doc++;stack.length=0;block=-1;continue;}
      if(!raw.trim()||/^\s*#/.test(raw))continue;
      const indent=raw.match(/^\s*/)[0].length;
      if(block>=0){if(indent>block)continue;block=-1;}
      while(stack.length&&stack[stack.length-1].indent>=indent)stack.pop();
      let path=stack.length?stack[stack.length-1].path:(doc?`[${doc}]`:'');
      let body=raw.replace(/\s+#.*$/,'').trim();
      const item=body.match(/^-(?:\s+(.*))?$/);
      if(item){
        const n=counters.get(path)||0;counters.set(path,n+1);path=`${path}[${n}]`;body=(item[1]||'').trim();
        stack.push({indent,path});if(!body)continue;
      }
      const pair=body.match(/^("[^"]*"|'[^']*'|[^:\s][^:]*?):(?:\s+(.*))?$/);
      if(!pair){out.set(path,scalar(body));continue;}
      const key=path?`${path}.${scalar(pair[1].trim())}`:scalar(pair[1].trim());const value=(pair[2]||'').trim();
      if(/^[|>][+-]?$/.test(value)){out.set(key,value);block=indent;continue;}
      if(value)out.set(key,scalar(value));else stack.push({indent:item?indent+1:indent,path:key});
    }
    return out;
  }
  function flattenProperties(text){const out=new Map();for(const raw of String(text).split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith('!'))continue;const match=line.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/);if(match)out.set(match[1],match[2]);}return out;}
  function flattenJson(text){const out=new Map();const walk=(value,key)=>{if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))walk(v,key?`${key}.${k}`:k);}else out.set(key,String(value));};walk(JSON.parse(text),'');return out;}
  function flattenPom(text){
    const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error(t('pom.xml could not be read'));
    const out=new Map();const kid=(node,name)=>[...(node?.children||[])].find(child=>child.localName===name);const val=(node,name)=>kid(node,name)?.textContent.trim()||'';
    const project=doc.documentElement;const props=new Map();
    const parent=kid(project,'parent');if(parent)out.set(`parent.${val(parent,'groupId')}:${val(parent,'artifactId')}`,val(parent,'version'));
    // The artifactId names the repository itself, so it always differs between siblings: not compared.
    for(const name of ['groupId','version','packaging'])if(val(project,name))out.set('project.'+name,val(project,name));
    const properties=kid(project,'properties');[...(properties?.children||[])].forEach(node=>{props.set(node.localName,node.textContent.trim());out.set('property.'+node.localName,node.textContent.trim());});
    const resolve=(value)=>value.replace(/\$\{([^}]+)\}/g,(match,name)=>props.has(name)?props.get(name):match);
    const deps=(holder,label)=>{[...(kid(holder,'dependencies')?.children||[])].forEach(dep=>{const id=`${val(dep,'groupId')}:${val(dep,'artifactId')}`;const version=val(dep,'version');const scope=val(dep,'scope');out.set(`${label}.${id}`,(version?resolve(version):t('(managed)'))+(scope&&scope!=='compile'?` [${scope}]`:''));});};
    deps(project,'dependency');deps(kid(project,'dependencyManagement'),'managed');
    [...(kid(kid(project,'build'),'plugins')?.children||[])].forEach(plugin=>{const id=`${val(plugin,'groupId')||'org.apache.maven.plugins'}:${val(plugin,'artifactId')}`;out.set(`plugin.${id}`,resolve(val(plugin,'version'))||t('(managed)'));});
    return out;
  }
  function kindOf(file){const name=file.toLowerCase();if(/(^|\/)pom\.xml$/.test(name))return 'pom';if(/\.ya?ml$/.test(name))return 'yaml';if(/\.(properties|env)$/.test(name)||/(^|\/)\.env/.test(name))return 'properties';if(/\.json$/.test(name))return 'json';return 'lines';}
  function flatten(kind,text){if(kind==='pom')return flattenPom(text);if(kind==='yaml')return flattenYaml(text);if(kind==='properties')return flattenProperties(text);if(kind==='json')return flattenJson(text);return null;}
  // Line diff (longest common subsequence) for files without a structure we understand.
  function lineDiff(a,b){
    const x=String(a).split(/\r?\n/),y=String(b).split(/\r?\n/);
    if(x.length*y.length>9e6)return null;
    const n=x.length,m=y.length;const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=x[i]===y[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    const lines=[];let i=0,j=0;
    while(i<n&&j<m){if(x[i]===y[j]){lines.push([' ',x[i]]);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1]){lines.push(['-',x[i]]);i++;}else{lines.push(['+',y[j]]);j++;}}
    while(i<n)lines.push(['-',x[i++]]);while(j<m)lines.push(['+',y[j++]]);
    return lines;
  }
  function buildCompare(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const file=input(t('File, for example pom.xml or src/main/resources/application-dev.yml'));file.value=recall('gitdeck.compareFile','pom.xml');
    const list=document.createElement('datalist');list.id='fleet-compare-files';file.setAttribute('list',list.id);
    const ref=input(t('Branch or tag (empty: files on disk)'));ref.value=recall('gitdeck.compareRef','');ref.classList.add('fleet-ref');
    const base=document.createElement('select');base.className='workflow-input';base.setAttribute('aria-label',t('Reference repository'));
    const go=button(t('Compare'),'primary');bar.append(folder,file,list,ref,base,go);
    const picks=el('div','fleet-chips fleet-picks');
    for(const name of ['pom.xml','src/main/resources/application.yml','src/main/resources/application-dev.yml','build.gradle','package.json','Dockerfile','.gitlab-ci.yml'])
      {const chip=button(name,'fleet-chip');chip.onclick=()=>{file.value=name;go.click();};picks.append(chip);}
    const status=el('small','multi-repo-status');const bar2=meter();const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Pick a file and a reference repository. Every other repository is compared with it: pom.xml by parent, properties and dependency versions; YAML, .properties and JSON by key; other files line by line.')),picks,status,bar2.box,out);
    const fillBase=()=>{const keep=base.value||recall('gitdeck.compareBase','');base.replaceChildren(new Option(t('Reference: first repository'),''));reposIn(folder.value).forEach(repo=>base.append(new Option(t('Reference: {name}',{name:repo.name}),repo.path)));if([...base.options].some(o=>o.value===keep))base.value=keep;};
    fillBase();folder.addEventListener('change',fillBase);base.onchange=()=>remember('gitdeck.compareBase',base.value);
    // Suggest tracked paths of the reference repository while typing.
    let suggestTimer=0;file.addEventListener('input',()=>{clearTimeout(suggestTimer);suggestTimer=setTimeout(async()=>{const repo=reposIn(folder.value).find(r=>r.path===base.value)||reposIn(folder.value)[0];if(!repo||file.value.trim().length<2)return;try{const files=(await api('/api/repo/files?'+query({path:repo.path,q:file.value.trim()}))).files||[];list.replaceChildren(...files.map(name=>new Option(name,name)));}catch{}},250);});
    file.addEventListener('keydown',event=>{if(event.key==='Enter')go.click();});
    go.onclick=async()=>{
      const name=file.value.trim();if(!name){file.focus();return;}remember('gitdeck.compareFile',name);remember('gitdeck.compareRef',ref.value.trim());
      const repos=reposIn(folder.value);if(repos.length<2){status.textContent=t('Choose a folder with at least two repositories.');return;}
      go.disabled=true;out.replaceChildren();let done=0;status.textContent=t('Reading {file} in {count} repositories…',{file:name,count:repos.length});
      const files=await mapLimit(repos,6,async repo=>{let answer;try{answer=(await api('/api/repo/file?'+query({path:repo.path,file:name,ref:ref.value.trim()}))).file;}catch(error){answer={exists:false,error:error.message};}bar2.set(++done,repos.length);return {repo,...answer};});
      bar2.set(0,0);go.disabled=false;
      const present=files.filter(item=>item.exists);const missing=files.filter(item=>!item.exists);
      if(!present.length){out.append(el('div','multi-repo-empty',t('{file} was not found in these repositories.',{file:name})));status.textContent='';return;}
      const reference=present.find(item=>item.repo.path===base.value)||present[0];
      const kind=kindOf(name);let maps=null;
      if(kind!=='lines'){try{maps=new Map(present.map(item=>[item.repo.path,flatten(kind,item.content)]));}catch(error){maps=null;status.textContent=error.message;}}
      renderCompare({name,kind:maps?kind:'lines',present,missing,reference,maps});
    };
    function renderCompare({name,kind,present,missing,reference,maps}){
      out.replaceChildren();
      const refMap=maps?.get(reference.repo.path);
      const rows=present.map(item=>{
        if(item===reference)return {item,same:true,diff:[],counts:[0,0,0]};
        if(maps){const mine=maps.get(item.repo.path);const diff=[];
          for(const [key,value] of refMap){if(!mine.has(key))diff.push({key,ref:value,mine:null});else if(mine.get(key)!==value)diff.push({key,ref:value,mine:mine.get(key)});}
          for(const [key,value] of mine)if(!refMap.has(key))diff.push({key,ref:null,mine:value});
          diff.sort((a,b)=>a.key.localeCompare(b.key));
          return {item,same:!diff.length,diff,counts:[diff.filter(d=>d.ref!==null&&d.mine!==null).length,diff.filter(d=>d.ref===null).length,diff.filter(d=>d.mine===null).length]};}
        const lines=lineDiff(reference.content,item.content);if(!lines)return {item,same:false,tooBig:true,diff:[],counts:[0,0,0]};
        const plus=lines.filter(l=>l[0]==='+').length,minus=lines.filter(l=>l[0]==='-').length;
        return {item,same:!plus&&!minus,lines,counts:[0,plus,minus]};
      }).sort((a,b)=>(a.item===reference?-1:b.item===reference?1:0)||(a.same-b.same)||a.item.repo.name.localeCompare(b.item.repo.name));
      const differing=rows.filter(r=>!r.same).length;
      status.textContent=t('{file}: {same} same as {reference} · {different} different · {missing} without the file',{file:name,same:rows.filter(r=>r.same).length-1,reference:reference.repo.name,different:differing,missing:missing.length});
      const headers=maps?[t('Repository'),t('Compared with {name}',{name:reference.repo.name}),t('Changed'),t('Only here'),t('Missing here'),'']:[t('Repository'),t('Compared with {name}',{name:reference.repo.name}),t('Lines added'),t('Lines removed'),''];
      const grid=table(headers);grid.classList.add('fleet-compare-table');
      for(const entry of rows){
        const verdict=entry.item===reference?el('span','fleet-state tone-info',t('Reference')):entry.same?el('span','fleet-state tone-ok',t('Same')):entry.tooBig?el('span','fleet-state tone-warn',t('Too large to compare')):el('span','fleet-state tone-warn',t('Different'));
        const show=button(t('Show'));show.hidden=entry.same||entry.tooBig;
        const cells=maps?[repoLink(entry.item.repo),verdict,num(entry.counts[0]),num(entry.counts[1]),num(entry.counts[2]),show]:[repoLink(entry.item.repo),verdict,num(entry.counts[1],'+'),num(entry.counts[2],'−'),show];
        const tr=row(cells);grid.append(tr);
        show.onclick=()=>{const open=tr.nextElementSibling?.classList.contains('fleet-detail-row');if(open){tr.nextElementSibling.remove();show.textContent=t('Show');return;}
          const detail=el('tr','fleet-detail-row');const td=el('td');td.colSpan=headers.length;td.append(maps?keyTable(entry.diff,reference.repo.name,entry.item.repo.name):diffView(entry.lines));detail.append(td);tr.after(detail);show.textContent=t('Hide');};
      }
      out.append(grid);
      if(missing.length){const note=el('p','multi-repo-note');note.textContent=t('Without {file}: {names}',{file:name,names:missing.map(item=>item.repo.name+(item.error?` (${item.error})`:'')).join(', ')});out.append(note);}
      // One setting in every repository: type a key (spring-boot version, a datasource URL…) to see its values side by side.
      if(maps){
        const keys=new Set();for(const map of maps.values())for(const key of map.keys())keys.add(key);
        const box=el('div','fleet-key-lookup');const keyInput=input(t('One setting in every repository, for example property.java.version'));const keyList=document.createElement('datalist');keyList.id='fleet-compare-keys';keyInput.setAttribute('list',keyList.id);
        keyList.append(...[...keys].sort().slice(0,2000).map(key=>new Option(key,key)));
        const values=el('div','fleet-key-values');box.append(el('strong','',t('Compare one setting')),keyInput,keyList,values);out.append(box);
        keyInput.addEventListener('input',()=>{const key=keyInput.value.trim();values.replaceChildren();if(!keys.has(key))return;
          const groups=new Map();for(const item of present){const value=maps.get(item.repo.path).get(key)??t('(not set)');if(!groups.has(value))groups.set(value,[]);groups.get(value).push(item.repo.name);}
          [...groups].sort((a,b)=>b[1].length-a[1].length).forEach(([value,names])=>{const line=el('div','fleet-key-value');line.append(el('code','',value),el('b','fleet-count',String(names.length)),el('span','fleet-muted',names.join(', ')));values.append(line);});});
      }
    }
    const num=(n,sign='')=>n?el('b','fleet-count',sign+n):el('span','fleet-muted','0');
    function keyTable(diff,refName,mineName){const grid=table([t('Setting'),refName,mineName]);grid.classList.add('fleet-key-table');
      diff.slice(0,300).forEach(d=>{const tr=row([el('code','',d.key),d.ref===null?el('span','fleet-muted',t('(not set)')):el('code','fleet-was',d.ref),d.mine===null?el('span','fleet-muted',t('(not set)')):el('code','fleet-now',d.mine)]);grid.append(tr);});
      if(diff.length>300)grid.append(row([t('and {count} more',{count:diff.length-300}),'','']));return grid;}
    function diffView(lines){const pre=el('div','diff-code fleet-diff');let shown=0;
      lines.forEach((line,index)=>{const near=lines.slice(Math.max(0,index-2),index+3).some(l=>l[0]!==' ');if(!near)return;if(shown++>600)return;pre.append(el('div',line[0]==='+'?'diff-add':line[0]==='-'?'diff-remove':'',`${line[0]} ${line[1]}`));});
      return pre;}
  }

  // ---- CI status ----------------------------------------------------------------------------
  function buildCi(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const which=document.createElement('select');which.className='workflow-input';which.setAttribute('aria-label',t('Pipeline of'));
    [['branch',t('Pipeline of the current branch')],['tag',t('Pipeline of the latest tag')]].forEach(([value,label])=>which.append(new Option(label,value)));which.value=recall('gitdeck.ciWhich','branch');
    const load=button(t('Load'),'primary');bar.append(folder,which,load);
    const status=el('small','multi-repo-status');const bar2=meter();const chips=el('div','pending-filters');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('The latest GitLab pipeline of each repository, through the GitLab CLI (bin\\glab.exe). Failed pipelines come first.')),chips,status,bar2.box,out);
    const tone={success:'ok',failed:'bad',running:'info',pending:'warn',created:'warn',canceled:'muted',skipped:'muted',manual:'warn',none:'muted'};
    load.onclick=async()=>{
      remember('gitdeck.ciWhich',which.value);const repos=reposIn(folder.value);if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      load.disabled=true;out.replaceChildren();chips.replaceChildren();let done=0;status.textContent=t('Asking GitLab about {count} repositories…',{count:repos.length});
      let refs=new Map();
      if(which.value==='tag'){const found=await pendingFor(repos);refs=new Map(found.map(item=>[item.repo.path,item.pending?.latestTag||'']));}
      const results=await mapLimit(repos,3,async repo=>{
        let answer;const ref=refs.get(repo.path)??'';
        if(which.value==='tag'&&!ref)answer={error:t('No tag yet')};
        else{try{answer=(await api('/api/repo/ci?'+query({path:repo.path,ref}))).ci;}catch(error){answer={error:error.message};}}
        bar2.set(++done,repos.length);return {repo,...answer};
      });
      bar2.set(0,0);load.disabled=false;
      const rank={failed:0,running:1,pending:2,created:2,manual:3,canceled:4,success:5,skipped:6,none:7};
      results.sort((a,b)=>(a.error?8:rank[a.status]??7)-(b.error?8:rank[b.status]??7)||a.repo.name.localeCompare(b.repo.name));
      const counts=new Map();results.forEach(item=>{const key=item.error?'error':item.status;counts.set(key,(counts.get(key)||0)+1);});
      for(const [key,n] of counts)chips.append(el('span',`pending-filter fleet-ci-chip tone-${key==='error'?'muted':tone[key]||'muted'}`,`${key==='error'?t('Not available'):key} ${n}`));
      // The same problem everywhere (GitLab CLI not signed in, say) is said once above the table.
      const errorCount=new Map();results.forEach(item=>{if(item.error)errorCount.set(item.error,(errorCount.get(item.error)||0)+1);});
      for(const [message,n] of errorCount)if(n>1)out.append(el('div','repo-alert tone-warn fleet-ci-note',t('{count} repositories: {message}',{count:n,message})));
      const grid=table([t('Repository'),t('Branch or tag'),t('Pipeline'),t('Updated'),'']);grid.classList.add('fleet-ci-table');
      for(const item of results){
        const pill=item.error?el('span','fleet-muted',errorCount.get(item.error)>1?t('Not available (see above)'):item.error):el('span',`fleet-state tone-${tone[item.status]||'muted'}`,item.status==='none'?t('No pipeline'):item.status);
        const open=button(t('Open in GitLab'));open.hidden=!item.url;open.onclick=()=>openUrl(item.url);
        grid.append(row([repoLink(item.repo),item.ref||'—',pill,item.updated?whenOf(item.updated):'',open]));
      }
      out.append(grid);
      const failed=counts.get('failed')||0;status.textContent=results.every(item=>item.error)?'':failed?t('{count} failed pipeline(s)',{count:failed}):t('No failed pipeline');
    };
  }

  addPanel('tag-all',t('Tag many'),buildTagMany);
  addPanel('ticket',t('Ticket'),buildTicket);
  addPanel('compare-files',t('Compare files'),buildCompare);
  addPanel('ci',t('CI status'),buildCi);
  // Place the new views after Search all, before Repository health and the job queue.
  const nav=document.querySelector('.operations-tabs');const anchor=nav?.querySelector('[data-operations-view="search-all"]');
  if(anchor){let after=anchor;for(const id of ['tag-all','ticket','compare-files','ci']){const tab=nav.querySelector(`[data-operations-view="${id}"]`);if(tab){after.after(tab);after=tab;}}}
  // The same views in the More menu, next to the other Dashboard entries (modern.js adds the icons).
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="tag-all"]')){
    const anchor=more.querySelector('[data-multi-repo="cleanup"]');
    for(const [view,label,hint] of [['tag-all',t('Tag many repositories'),t('The next tag in many repositories at once')],['ticket',t('Ticket across repositories'),t('Branches, commits and tags of one ticket')],['compare-files',t('Compare files across repositories'),t('pom.xml, application.yml… against a reference')],['ci',t('CI status'),t('Latest GitLab pipeline of every repository')]]){
      const item=el('button','');item.type='button';item.dataset.multiRepo=view;item.append(el('strong','',label),el('small','',hint));
      item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter(view);};
      if(anchor)anchor.before(item);else more.append(item);
    }
  }
  // Views over every repository get their own group in More, after the open repository's tools.
  if(more&&!more.querySelector('.fleet-more-group')){
    const heading=el('p','sync-more-group fleet-more-group',t('All repositories'));
    const cleanup=more.querySelector('[data-multi-repo="cleanup"]');const custom=more.querySelector('[data-custom-actions]');
    if(cleanup&&custom)custom.after(cleanup);
    const fleetItems=[more.querySelector('[data-work-report]'),...['pending','switch-all','search-all','tag-all','ticket','compare-files','ci'].map(id=>more.querySelector(`[data-multi-repo="${id}"]`))].filter(Boolean);
    more.append(heading,...fleetItems);
  }
  window.GitDeckFleet.nextTag=nextTag;window.GitDeckFleet.flattenYaml=flattenYaml;window.GitDeckFleet.flattenPom=flattenPom;window.GitDeckFleet.lineDiff=lineDiff;
})();
