'use strict';
// Conflict forecast (server side: lib/GitDeck.Insight.ps1): every repository that is on a work
// branch is merged in memory into its main line (and develop when there is one) and, if you ask,
// into teammates' remote branches of the last 14 days that touch the same files. Nothing is checked
// out and no ref moves. Shows which files would conflict and who last changed them on the other side.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const mainBranches=new Set(['main','master','develop','development','HEAD','']);
  // Repositories worth forecasting: on a work branch, from the last Pending check.
  function workBranches(snapshotItems){
    return (snapshotItems||[]).filter(item=>item?.pending&&!mainBranches.has(String(item.pending.branch||''))&&!/\.worktrees[\\/]/i.test(item.path)).map(item=>({path:item.path,branch:item.pending.branch}));
  }
  // One verdict per repository: conflict (worst), behind, clean.
  function verdict(forecast){
    const results=forecast?.results||[];const others=forecast?.others||[];
    const conflicts=results.filter(item=>item.found&&!item.clean);const mates=others.filter(item=>!item.clean);
    if(conflicts.length)return {tone:'bad',text:t('Will conflict with {base} in {count} file(s)',{base:conflicts[0].base,count:conflicts[0].files.length})};
    if(mates.length)return {tone:'warn',text:t('Will conflict with {branch} ({who})',{branch:mates[0].branch,who:mates[0].author||'?'})};
    const behind=results.filter(item=>item.found&&item.behind>0).sort((a,b)=>b.behind-a.behind)[0];
    if(behind)return {tone:'info',text:t('Merges cleanly; {base} is {count} commit(s) ahead',{base:behind.base,count:behind.behind})};
    return {tone:'ok',text:t('Merges cleanly')};
  }
  const helpers={workBranches,verdict};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,mapLimit,query,repoLink}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const readSnapshot=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.pendingSnapshot')||'null');}catch{return null;}};
  const fileList=(files)=>{const list=el('ul','forecast-files');for(const file of files){const li=el('li');li.append(el('code','',file.file));if(file.author)li.append(el('small','fleet-muted',' '+t('{who} · {when} · {subject}',{who:file.author,when:String(file.date).slice(0,16).replace('T',' '),subject:file.subject})));list.append(li);}return list;};

  function build(panel){
    const bar=el('div','operations-toolbar');const mates=el('label','settings-check');const box=el('input');box.type='checkbox';box.checked=true;mates.append(box,el('span','',t('Also check teammates\' branches')));
    const run=button(t('Forecast'),'primary');bar.append(mates,run);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body forecast-list');
    panel.append(bar,el('p','multi-repo-explain',t('Each repository on a work branch is merged in memory into its main line and develop, and into teammates\' branches from the last 14 days that touch the same files. Nothing is checked out and nothing changes. Fetch first for the newest picture.')),status,out);
    run.onclick=async()=>{
      const items=workBranches(readSnapshot()?.items);
      out.replaceChildren();
      if(!items.length){status.textContent=t('No repository is on a work branch in the last Pending check.');return;}
      run.disabled=true;let done=0;status.textContent=t('Forecasting {count} branch(es)…',{count:items.length});
      const rows=await mapLimit(items,4,async item=>{
        const repo=(state.repos||[]).find(entry=>entry.path.toLowerCase()===item.path.toLowerCase())||{path:item.path,name:item.path.split(/[\\/]/).pop()};
        let forecast=null,error='';try{forecast=(await api('/api/repo/merge-forecast?'+query({path:item.path,branch:item.branch,others:box.checked?'1':''}))).forecast;}catch(e){error=e.message;}
        status.textContent=t('Forecasting {done} of {count}…',{done:++done,count:items.length});
        return {repo,item,forecast,error};
      });
      const order={bad:0,warn:1,info:2,ok:3};
      const scored=rows.map(row=>({...row,v:row.error?{tone:'warn',text:row.error}:row.forecast?.supported===false?{tone:'muted',text:t('Needs Git 2.38 or newer')}:verdict(row.forecast)})).sort((a,b)=>(order[a.v.tone]??4)-(order[b.v.tone]??4)||a.repo.name.localeCompare(b.repo.name));
      const bad=scored.filter(row=>row.v.tone==='bad'||row.v.tone==='warn').length;
      status.textContent=t('{count} branch(es) · {bad} need attention · checked {time}',{count:scored.length,bad,time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
      for(const row of scored){
        const card=el('article',`forecast-card tone-${row.v.tone}`);
        const head=el('div','forecast-head');head.append(repoLink(row.repo),el('code','mono',row.item.branch),el('strong','',row.v.text));card.append(head);
        for(const result of row.forecast?.results||[])if(result.found&&!result.clean){card.append(el('p','',t('Into {base}:',{base:result.base})),fileList(result.files));}
        for(const mate of row.forecast?.others||[])if(!mate.clean){card.append(el('p','',t('With {branch} ({who}):',{branch:mate.branch,who:mate.author||'?'})),fileList(mate.files));}
        out.append(card);
      }
      run.disabled=false;
    };
  }
  addPanel('forecast',t('Conflict forecast'),build);
  window.GitDeckForecast=helpers;
})();
