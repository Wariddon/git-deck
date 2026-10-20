'use strict';
// Meaning of a change: for pom.xml, application*.yml/.properties, JSON and Dockerfile, say what changed in
// words ("Spring Boot 3.5.6 → 3.5.16", "dependency x added [provided]", "redis.host: classic → cluster")
// instead of only showing lines. History › commit › "🧾 Meaning". Uses the parsers of web/fleet.js.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Two flattened maps -> [{kind: changed|added|removed, key, before, after}], changed first.
  function compareMaps(before,after){
    const out=[];const keys=new Set([...(before?.keys()||[]),...(after?.keys()||[])]);
    for(const key of keys){
      const a=before?.get(key),b=after?.get(key);
      if(a===undefined&&b!==undefined)out.push({kind:'added',key,after:b});
      else if(a!==undefined&&b===undefined)out.push({kind:'removed',key,before:a});
      else if(String(a)!==String(b))out.push({kind:'changed',key,before:a,after:b});
    }
    const order={changed:0,added:1,removed:2};
    // The parent (Spring Boot) and base images first: they change the most.
    const rank=(key)=>/^(parent\.|FROM )/.test(key)?0:1;
    return out.sort((x,y)=>order[x.kind]-order[y.kind]||rank(x.key)-rank(y.key)||x.key.localeCompare(y.key));
  }
  // Friendly names for pom keys: the Spring Boot parent, dependencies, plugins, properties.
  function label(key){
    const text=String(key);
    if(/^parent\.org\.springframework\.boot:spring-boot-starter-parent$/.test(text))return 'Spring Boot';
    let m=text.match(/^parent\.(.+)$/);if(m)return `parent ${m[1]}`;
    m=text.match(/^(dependency|managed|plugin)\.(?:[^:]+:)?(.+)$/);if(m)return `${m[1]==='managed'?'managed dependency':m[1]} ${m[2]}`;
    m=text.match(/^property\.(.+)$/);if(m)return m[1];
    return text;
  }
  // Dockerfile: base images (FROM) and exposed ports, the parts that change a running service.
  function dockerMap(text){
    const out=new Map();let stage=0;
    for(const raw of String(text||'').split(/\r?\n/)){
      const line=raw.trim();let m=line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
      if(m){out.set(`FROM ${m[2]||'#'+(++stage)}`,m[1]);continue;}
      m=line.match(/^EXPOSE\s+(.+)/i);if(m)out.set('EXPOSE',m[1].trim());
      m=line.match(/^(ENV|ARG)\s+([A-Za-z_][\w]*)[=\s]+(.*)$/i);if(m)out.set(`${m[1].toUpperCase()} ${m[2]}`,m[3].trim());
    }
    return out;
  }
  const isDockerfile=(file)=>/(^|\/)Dockerfile[^/]*$/i.test(file);
  const understood=(file)=>isDockerfile(file)||/(^|\/)pom\.xml$|\.(ya?ml|properties|json)$/i.test(file);
  const helpers={compareMaps,label,dockerMap,understood,isDockerfile};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function'||typeof api!=='function')return;

  const button=(text,className='')=>{const node=el('button',className,text);node.type='button';return node;};
  async function fileAt(path,file,ref){try{const answer=(await api('/api/repo/file?'+new URLSearchParams({path,file,ref}))).file;return answer.exists?answer.content:'';}catch{return null;}}
  function mapOf(file,text){
    if(text===null||text===undefined)return null;if(!text)return new Map();
    if(isDockerfile(file))return dockerMap(text);
    const F=window.GitDeckFleet;if(!F?.flatten||!F?.kindOf)return null;
    try{return F.flatten(F.kindOf(file),text)||null;}catch{return null;}
  }
  async function explain(repoPath,hash,box,go){
    go.disabled=true;go.textContent=t('Reading…');
    try{
      const commit=(await api('/api/repo/commit?'+new URLSearchParams({path:repoPath,commit:hash}))).commit;
      const files=(commit.files||[]).filter(item=>understood(item.path)).slice(0,12);
      box.replaceChildren(el('strong','',t('What this commit changes')));
      if(!files.length){box.append(el('p','fleet-muted',t('No pom.xml, configuration or Dockerfile in this commit: see the diff.')));return;}
      for(const item of files){
        const parent=commit.parents?.[0];
        const [before,after]=await Promise.all([parent&&item.status!=='A'?fileAt(repoPath,item.oldPath||item.path,parent):Promise.resolve(''),item.status==='D'?Promise.resolve(''):fileAt(repoPath,item.path,commit.fullHash)]);
        const a=mapOf(item.oldPath||item.path,before),b=mapOf(item.path,after);
        const head=el('div','semantic-file');head.append(el('code','',item.path));box.append(head);
        if(!a||!b){box.append(el('small','fleet-muted',t('Could not read this file as structure; see the diff.')));continue;}
        const changes=compareMaps(a,b);
        if(!changes.length){box.append(el('small','fleet-muted',t('Only formatting or comments changed.')));continue;}
        const list=el('ul','semantic-list');
        for(const change of changes.slice(0,40)){
          const li=el('li',`tone-${change.kind==='changed'?'warn':change.kind==='added'?'ok':'bad'}`);
          const name=/(^|\/)pom\.xml$/i.test(item.path)?label(change.key):change.key;
          li.append(el('b','',name),' ');
          if(change.kind==='changed')li.append(el('code','fleet-was',String(change.before)),' → ',el('code','fleet-now',String(change.after)));
          else if(change.kind==='added')li.append(el('span','',t('added')),' ',el('code','fleet-now',String(change.after)));
          else li.append(el('span','',t('removed')),' ',el('code','fleet-was',String(change.before)));
          list.append(li);
        }
        if(changes.length>40)list.append(el('li','fleet-muted',t('and {count} more',{count:changes.length-40})));
        box.append(list);
      }
    }catch(error){box.replaceChildren(el('span','tone-bad',error.message));}
    finally{go.disabled=false;go.textContent=t('🧾 Meaning');}
  }
  // History: a "🧾 Meaning" button on each commit's details.
  const attach=(root)=>{
    for(const actions of root.querySelectorAll?.('.commit-detail-actions:not([data-meaning])')||[]){
      actions.dataset.meaning='1';
      const hash=(actions.parentElement?.querySelector('p')?.textContent||'').split('·')[0].trim();
      if(!/^[0-9a-f]{4,40}$/i.test(hash)||!state.workspaceRepo)continue;
      const path=state.workspaceRepo.path;const go=button(t('🧾 Meaning'));go.title=t('Say in words what changed in pom.xml, configuration and Dockerfile');
      const box=el('section','semantic-box');box.hidden=true;
      go.onclick=()=>{box.hidden=false;void explain(path,hash,box,go);};
      actions.append(go);(actions.closest('.commit-detail-meta')||actions.parentElement).append(box);
    }
  };
  new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)attach(node.matches?.('.commit-detail-actions')?node.parentElement:node);}).observe(document.body,{childList:true,subtree:true});
  window.GitDeckSemanticDiff={...helpers,explain};
})();
