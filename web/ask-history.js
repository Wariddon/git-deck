'use strict';
// Ask history: a question in plain words, in Thai or English (Thai words are written as \u escapes
// below so the source stays English), e.g. "who changed redis.host in crs- this month" or "who changed `timeout: 30s` in lns- this week") becomes git log -S (or -G for a pattern) over every
// matching repository and all branches (server side: lib/GitDeck.Insight.ps1). The answer lists the
// commits that added or removed the text, newest first, with who, when and which files.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const stop=new Set(['who','changed','change','edit','edited','added','removed','in','the','this','last','where','when','what','did','from','which','commit','value','who','\u0e43\u0e04\u0e23','\u0e41\u0e01\u0e49','\u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19','\u0e43\u0e19','\u0e17\u0e35\u0e48','\u0e0a\u0e48\u0e27\u0e07','\u0e02\u0e2d\u0e07','\u0e04\u0e48\u0e32','\u0e21\u0e32','\u0e08\u0e32\u0e01','\u0e44\u0e2b\u0e19','\u0e2d\u0e30\u0e44\u0e23']);
  // `repos`: repository names; one named in the question narrows the search instead of being the text.
  function parseQuestion(text,{repos=[]}={}){
    const raw=String(text||'').trim();let rest=raw;
    const quoted=raw.match(/[`"'“”‘’]([^`"'“”‘’]{1,200})[`"'“”‘’]/);
    let term=quoted?quoted[1]:'';if(quoted)rest=raw.replace(quoted[0],' ');
    const family=(rest.match(/(?:^|\s)([A-Za-z][A-Za-z0-9]{1,15}-)(?=\s|$)/)||[])[1]||'';
    if(family)rest=rest.replace(family,' ');
    const names=new Set(repos.map(name=>String(name).toLowerCase()));
    const repo=rest.split(/\s+/).find(word=>names.has(word.toLowerCase()))||'';
    if(repo)rest=rest.replace(repo,' ');
    let sinceDays=0;
    const n=rest.match(/(\d{1,4})\s*(?:\u0e27\u0e31\u0e19|days?|d\b)/i);
    if(n)sinceDays=Number(n[1]);
    else if(/\u0e27\u0e31\u0e19\u0e19\u0e35\u0e49|today/i.test(rest))sinceDays=1;
    else if(/\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e27\u0e32\u0e19|yesterday/i.test(rest))sinceDays=2;
    else if(/\u0e2a\u0e31\u0e1b\u0e14\u0e32\u0e2b\u0e4c|\u0e2d\u0e32\u0e17\u0e34\u0e15\u0e22\u0e4c|this week|last week/i.test(rest))sinceDays=7;
    else if(/\u0e40\u0e14\u0e37\u0e2d\u0e19|this month|last month/i.test(rest))sinceDays=31;
    else if(/\u0e1b\u0e35\u0e19\u0e35\u0e49|this year|last year/i.test(rest))sinceDays=366;
    if(!term){
      // The most code-like word: dots, underscores, slashes, colons, camelCase or digits beat plain words.
      const words=rest.split(/\s+/).map(word=>word.replace(/^[^\w./:=-]+|[^\w./:=-]+$/g,'')).filter(word=>word.length>=2&&!stop.has(word.toLowerCase())&&!/^\d+$/.test(word)&&!/^(\u0e27\u0e31\u0e19|days?)$/i.test(word));
      const score=(word)=>(/[._/:=]/.test(word)?4:0)+(/[a-z][A-Z]/.test(word)?3:0)+(/\d/.test(word)?1:0)+(/^[\x20-\x7e]+$/.test(word)?1:0);
      term=words.sort((a,b)=>score(b)-score(a)||b.length-a.length)[0]||'';
    }
    const mode=/[|()*+?\\[\]^$]/.test(term)||/\b(pattern|regex)\b|\u0e41\u0e1e\u0e17\u0e40\u0e17\u0e34\u0e23\u0e4c\u0e19/i.test(raw)?'G':'S';
    return {term,mode,family,repo,sinceDays};
  }
  const sinceDate=(days,now=new Date())=>days?new Date(now.getTime()-days*864e5).toISOString().slice(0,10):'';
  const helpers={parseQuestion,sinceDate};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const ask=el('input','workflow-input ask-input');ask.type='search';ask.placeholder=t('Ask, for example: who changed redis.host in crs- this month');ask.setAttribute('aria-label',t('Question'));
    const go=button(t('Ask'),'primary');bar.append(ask,folder,go);
    const meaning=el('p','ask-meaning');const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Ask in your own words. Put the exact text in quotes for an exact search; a family such as crs- narrows the repositories; words like today, this week, this month or 14 days set how far back. Every branch is searched; nothing changes.')),meaning,status,out);
    go.onclick=async()=>{
      const q=parseQuestion(ask.value,{repos:(state.repos||[]).map(repo=>repo.name)});out.replaceChildren();
      if(!q.term){meaning.textContent=t('Which text should I look for? Put it in quotes, for example "redis.host".');return;}
      let repos=reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path));
      if(q.repo)repos=repos.filter(repo=>repo.name.toLowerCase()===q.repo.toLowerCase());
      else if(q.family)repos=repos.filter(repo=>repo.name.toLowerCase().startsWith(q.family.toLowerCase()));
      const total=repos.length;repos=repos.slice(0,120);
      const since=sinceDate(q.sinceDays);
      meaning.replaceChildren(el('span','',t('Looking for')+' '),el('code','',q.term),el('span','',' '+(q.mode==='G'?t('(lines matching the pattern)'):t('(added or removed)'))+' · '+(q.repo?t('in {family}',{family:q.repo}):q.family?t('in {family}',{family:q.family}):(total>repos.length?t('in the first {count} of {total} repositories',{count:repos.length,total}):t('in {count} repositories',{count:repos.length})))+(since?' · '+t('since {date}',{date:since}):'')));
      if(!repos.length){status.textContent=t('No repository matches {family}.',{family:q.family});return;}
      go.disabled=true;let done=0;
      const found=await mapLimit(repos,6,async repo=>{
        let commits=[];try{commits=(await api('/api/repo/history-find?'+query({path:repo.path,term:q.term,mode:q.mode,since,limit:'20'}))).history.commits||[];}catch{}
        status.textContent=t('Searching {done} of {count}…',{done:++done,count:repos.length});
        return commits.map(commit=>({...commit,repo}));
      });
      go.disabled=false;
      const all=found.flat().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      status.textContent=t('{count} commit(s) in {repos} repositories',{count:all.length,repos:new Set(all.map(item=>item.repo.path)).size});
      if(!all.length){out.append(el('div','multi-repo-empty',t('No commit added or removed this text.')));return;}
      for(const item of all.slice(0,200)){
        const card=el('article','ask-commit');
        const head=el('div','ask-head');head.append(repoLink(item.repo),el('code','mono',item.short),el('strong','',item.subject));
        const meta=el('small','fleet-muted',`${item.author} · ${String(item.date).slice(0,16).replace('T',' ')}${item.refs?` · ${item.refs}`:''}`);
        card.append(head,meta);if(item.files?.length)card.append(el('div','ask-files',item.files.join('  ·  ')));
        out.append(card);
      }
    };
    ask.addEventListener('keydown',event=>{if(event.key==='Enter')go.click();});
  }
  addPanel('ask-history',t('Ask history'),build);
})();
