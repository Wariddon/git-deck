'use strict';
// Review mode: History › commit › "✔ Review". The commit's files ordered by risk (configuration,
// build and deployment files, database migrations and security code first; tests and docs last),
// each with a one-line reason and a "read" tick kept on this computer per commit. Clicking a file
// opens its diff in the commit view below. Progress shows how much is left.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const rules=[
    [/(^|\/)(application[^/]*\.(ya?ml|properties)|bootstrap[^/]*\.ya?ml)$/i,3,'Configuration: a ConfigMap may override it per environment'],
    [/(^|\/)(configmap|deployment|values)[^/]*\.ya?ml$|(^|\/)(k8s|helm|deploy|manifests?)\//i,3,'Deployment: changes what runs in an environment'],
    [/(^|\/)(db\/migration|migrations?|liquibase|flyway)\/|\.sql$/i,3,'Database migration: hard to undo once applied'],
    [/(^|\/)(pom\.xml|build\.gradle(\.kts)?|package\.json|go\.mod|requirements\.txt)$/i,2,'Build and dependencies'],
    [/(^|\/)(Dockerfile[^/]*|Jenkinsfile[^/]*|\.gitlab-ci\.ya?ml)$|(^|\/)\.github\/workflows\//i,2,'Build pipeline or image'],
    [/(security|auth|token|crypto|password|secret|permission)/i,2,'Security-related code'],
    [/(^|\/)src\/test\/|(^|\/)tests?\/|(^|\/)test-[^/]+$|\.(test|spec)\.[a-z]+$|Test\.java$/i,0,'Tests'],
    [/\.(md|txt|adoc)$|(^|\/)docs?\//i,0,'Documentation'],
  ];
  function risk(path){
    const file=String(path||'').replaceAll('\\','/');
    for(const [pattern,level,reason] of rules)if(pattern.test(file))return {level,reason};
    return {level:1,reason:'Code'};
  }
  // Files most risky first; deleted files before modified at the same level; then by path.
  function reviewOrder(files){
    return (files||[]).map(file=>({...file,...risk(file.path)}))
      .sort((a,b)=>b.level-a.level||(String(a.status).startsWith('D')?0:1)-(String(b.status).startsWith('D')?0:1)||a.path.localeCompare(b.path));
  }
  // Remember ticks for at most `limit` commits (the newest reviewed).
  function tick(store,hash,path,on,limit=200){
    const next={...(store||{})};const done=new Set(next[hash]?.paths||[]);
    if(on)done.add(path);else done.delete(path);
    next[hash]={at:Date.now(),paths:[...done]};
    const keys=Object.keys(next).sort((a,b)=>(next[b].at||0)-(next[a].at||0));
    for(const key of keys.slice(limit))delete next[key];
    return next;
  }
  const helpers={risk,reviewOrder,tick};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function'||typeof api!=='function')return;

  const key='gitdeck.reviewed';
  const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}};
  const save=(value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const levelLabel=()=>({3:t('High'),2:t('Medium'),1:t('Normal'),0:t('Low')});
  const reasonText=(reason)=>({
    'Configuration: a ConfigMap may override it per environment':t('Configuration: a ConfigMap may override it per environment'),
    'Deployment: changes what runs in an environment':t('Deployment: changes what runs in an environment'),
    'Database migration: hard to undo once applied':t('Database migration: hard to undo once applied'),
    'Build and dependencies':t('Build and dependencies'),'Build pipeline or image':t('Build pipeline or image'),
    'Security-related code':t('Security-related code'),'Tests':t('Tests'),'Documentation':t('Documentation'),'Code':t('Code'),
  })[reason]||reason;

  async function open(repoPath,hash,box,go){
    go.disabled=true;
    try{
      const commit=(await api('/api/repo/commit?'+new URLSearchParams({path:repoPath,commit:hash}))).commit;
      const full=commit.fullHash||hash;const files=reviewOrder(commit.files||[]);
      const draw=()=>{
        const done=new Set(read()[full]?.paths||[]);const count=files.filter(file=>done.has(file.path)).length;
        box.replaceChildren();
        const head=el('div','review-head');const bar=el('progress','review-progress');bar.max=files.length||1;bar.value=count;
        head.append(el('strong','',t('Review: {done} of {count} file(s) read',{done:count,count:files.length})),bar);box.append(head);
        const list=el('ol','review-list');
        for(const file of files){
          const li=el('li',`review-file level-${file.level}${done.has(file.path)?' review-read':''}`);
          const check=document.createElement('input');check.type='checkbox';check.checked=done.has(file.path);check.setAttribute('aria-label',t('Read {file}',{file:file.path}));
          check.onchange=()=>{save(tick(read(),full,file.path,check.checked));draw();};
          const name=el('button','review-name',file.path);name.type='button';name.title=`${file.path} · ${t('Show the diff')}`;
          name.onclick=()=>{const target=[...document.querySelectorAll('.commit-file-main')].find(node=>node.dataset.path===file.path);if(target){target.click();target.scrollIntoView({block:'nearest'});}if(!check.checked){save(tick(read(),full,file.path,true));draw();}};
          li.append(check,el('span','review-level',levelLabel()[file.level]),name,el('small','',reasonText(file.reason)));list.append(li);
        }
        box.append(list);
      };
      draw();
    }catch(error){box.replaceChildren(el('span','tone-bad',error.message));}
    finally{go.disabled=false;}
  }
  const attach=(root)=>{
    for(const actions of root.querySelectorAll?.('.commit-detail-actions:not([data-review])')||[]){
      actions.dataset.review='1';
      const hash=(actions.parentElement?.querySelector('p')?.textContent||'').split('·')[0].trim();
      if(!/^[0-9a-f]{4,40}$/i.test(hash)||!state.workspaceRepo)continue;
      const path=state.workspaceRepo.path;const go=el('button','',t('✔ Review'));go.type='button';go.title=t('Files ordered by risk, with a tick for each one you have read');
      const box=el('section','review-box');box.hidden=true;
      go.onclick=()=>{if(!box.hidden){box.hidden=true;return;}box.hidden=false;void open(path,hash,box,go);};
      actions.append(go);(actions.closest('.commit-detail-meta')||actions.parentElement).append(box);
    }
  };
  new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)attach(node.matches?.('.commit-detail-actions')?node.parentElement:node);}).observe(document.body,{childList:true,subtree:true});
  attach(document);
})();
