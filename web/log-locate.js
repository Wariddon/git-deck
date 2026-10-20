'use strict';
// Find from an error log: paste a stack trace or log lines; Git Deck finds which repository and file
// each of your own frames lives in (framework frames are skipped), with the line and the last commits
// that changed that file. Server side: /api/repo/find-files (one "git ls-files" per repository).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const frameworkPrefixes=['java.','javax.','jakarta.','jdk.','sun.','com.sun.','org.springframework.','org.apache.','org.hibernate.','io.netty.','reactor.','io.micrometer.','com.fasterxml.','org.junit.','kotlin.','kotlinx.','feign.','io.github.resilience4j.','org.postgresql.','com.zaxxer.','ch.qos.','org.slf4j.','lombok.','io.opentelemetry.','okhttp3.','com.google.','net.bytebuddy.','org.mockito.','org.eclipse.'];
  // Java/Kotlin frames ("at com.x.Foo.bar(Foo.java:42)"), Go/JS/TS file:line, and exception names.
  function parseLog(text,skip=frameworkPrefixes){
    const frames=[];const seen=new Set();const exceptions=new Set();
    const source=String(text||'');
    for(const m of source.matchAll(/\bat\s+([\w$.]+)\.([\w$<>]+)\(([\w$-]+\.(?:java|kt|groovy|scala)):(\d+)\)/g)){
      const className=m[1].replace(/\$.*$/,'');if(skip.some(prefix=>className.startsWith(prefix)))continue;
      const pkg=className.split('.').slice(0,-1).join('/');const file=(pkg?pkg+'/':'')+m[3];
      const key=file+':'+m[4];if(seen.has(key))continue;seen.add(key);
      frames.push({className,method:m[2],file,line:Number(m[4])});
    }
    for(const m of source.matchAll(/([\w./-]+\.(?:go|ts|js|py)):(\d+)/g)){
      const file=m[1].replace(/^\.?\//,'');if(/node_modules|\/go\/(src|pkg\/mod)\/|^runtime\//.test(file))continue;
      const key=file+':'+m[2];if(seen.has(key))continue;seen.add(key);frames.push({className:'',method:'',file,line:Number(m[2])});
    }
    for(const m of source.matchAll(/\b((?:[a-z][\w]*\.)+[A-Z]\w*(?:Exception|Error))\b/g))exceptions.add(m[1]);
    return {frames,exceptions:[...exceptions]};
  }
  const helpers={parseLog,frameworkPrefixes};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const run=button(t('Find'),'primary');bar.append(folder,run);
    const text=el('textarea','workflow-input log-locate-text');text.rows=10;text.spellcheck=false;text.placeholder=t('Paste a stack trace or error log');text.setAttribute('aria-label',t('Paste a stack trace or error log'));
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Paste a stack trace or log. Your own frames (framework ones are skipped) are looked up in every repository of the folder: the repository, the file and line, and the last commits that changed it. Nothing leaves this computer.')),text,status,out);
    run.onclick=async()=>{
      const parsed=parseLog(text.value);out.replaceChildren();
      if(!parsed.frames.length){status.textContent=t('No frames of your own code found (only framework lines, or no file:line).');return;}
      const names=[...new Set(parsed.frames.map(frame=>frame.file))].slice(0,20);
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path));
      run.disabled=true;let done=0;status.textContent=t('Looking in {done} of {total}…',{done,total:repos.length});
      const hits=[];
      await mapLimit(repos,6,async repo=>{
        try{const files=(await api('/api/repo/find-files?'+query({path:repo.path,names:names.join('|')}))).files||[];for(const found of files)hits.push({repo,...found});}catch{}
        status.textContent=t('Looking in {done} of {total}…',{done:++done,total:repos.length});
      });
      run.disabled=false;
      if(parsed.exceptions.length)out.append(el('p','log-locate-exceptions',parsed.exceptions.join(' · ')));
      let located=0;
      for(const frame of parsed.frames){
        const matches=hits.filter(hit=>hit.name===frame.file);
        const card=el('div','family-edit-card');const head=el('div','family-edit-head');
        head.append(el('code','',`${frame.file}:${frame.line}`),el('small','fleet-muted',frame.method?`${frame.className.split('.').pop()}.${frame.method}()`:''));card.append(head);
        if(!matches.length){card.append(el('small','fleet-muted',t('Not in any repository of this folder')));out.append(card);continue;}
        located++;
        for(const hit of matches){
          const line=el('div','log-locate-hit');const open=button(t('Open'));
          open.onclick=()=>{document.getElementById('operations-close')?.click();if(typeof openWorkspace==='function')openWorkspace(hit.repo,'history',null);};
          line.append(repoLink(hit.repo),el('code','',`${hit.file}:${frame.line}`),open);card.append(line);
          for(const commit of hit.commits||[])card.append(el('small','log-locate-commit',`${commit.date} · ${commit.author} · ${commit.hash} ${commit.subject}`));
        }
        out.append(card);
      }
      status.textContent=t('{located} of {frames} frame(s) found in your repositories',{located,frames:parsed.frames.length});
    };
  }

  addPanel('log-locate',t('Find from an error log'),build);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="log-locate"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='log-locate';item.append(el('strong','',t('Find from an error log')),el('small','',t('Which repository, file and commit a stack trace points to')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('log-locate');};
    const anchor=more.querySelector('[data-multi-repo="family-edit"]');if(anchor)anchor.after(item);else more.append(item);
  }
  window.GitDeckLogLocate=helpers;
})();
