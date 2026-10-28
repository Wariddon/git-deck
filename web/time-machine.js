'use strict';
// Time machine (server side: Get-GitDeckMoments in lib/GitDeck.Insight.ps1): pick two moments and see
// the whole family as it was at each: the main-line commit and newest tag of every repository, how
// many commits came in between, who made them and which files changed. The deploy repository (from
// Effective configuration) comes first, because image tags and ConfigMaps there are what ran.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  function summarize(m){
    if(!m?.to?.found)return {kind:'missing',tagMoved:false};
    if(!m.from?.found)return {kind:'new',tagMoved:Boolean(m.to.tag)};
    return {kind:m.from.commit===m.to.commit?'same':'moved',tagMoved:(m.from.tag||'')!==(m.to.tag||'')};
  }
  const localInput=(date)=>{const p=(n)=>String(n).padStart(2,'0');return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;};
  const helpers={summarize,localInput};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,table,row,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const at=(label,date)=>{const node=el('input','workflow-input');node.type='datetime-local';node.value=localInput(date);node.setAttribute('aria-label',label);node.title=label;return node;};
  const point=(side)=>{if(!side?.found)return el('span','fleet-muted','—');const box=el('div','tm-point');box.append(el('code','mono',side.short),side.tag?el('span','fleet-state tone-info',side.tag):'',el('small','fleet-muted',`${String(side.date).slice(0,16).replace('T',' ')} · ${side.subject}`));return box;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const from=at(t('From'),new Date(Date.now()-3*864e5)),to=at(t('To'),new Date());
    const presets=el('div','fleet-chips');
    for(const [label,hours] of [[t('Last 24 hours'),24],[t('Last 3 days'),72],[t('Last week'),168]]){const chip=button(label,'fleet-chip');chip.onclick=()=>{from.value=localInput(new Date(Date.now()-hours*36e5));to.value=localInput(new Date());go.click();};presets.append(chip);}
    const onlyMoved=el('label','settings-check');const moved=el('input');moved.type='checkbox';moved.checked=true;onlyMoved.append(moved,el('span','',t('Only what changed')));
    const go=button(t('Travel'),'primary');bar.append(folder,from,el('span','fleet-muted','→'),to,onlyMoved,go);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,presets,el('p','multi-repo-explain',t('The whole family at two moments: the main-line commit and newest tag of every repository, then what came in between. Use it when something broke between two times. Read-only; fetch first for remote work.')),status,out);
    let rows=[];
    const draw=()=>{
      out.replaceChildren();
      const shown=rows.filter(item=>!moved.checked||item.s.kind!=='same');
      if(!shown.length){out.append(el('div','multi-repo-empty',rows.length?t('Nothing changed between these moments.'):t('Nothing to show.')));return;}
      const grid=table([t('Repository'),t('Then'),t('Now'),t('In between')]);
      for(const item of shown){
        const m=item.m;const between=el('div','tm-between');
        if(item.error)between.append(el('span','tone-bad',item.error));
        else if(item.s.kind==='same')between.append(el('span','fleet-muted',t('No change')));
        else{
          between.append(el('strong','',t('{count} commit(s)',{count:m.commits})),m.authors?.length?el('small','fleet-muted',' · '+m.authors.join(', ')):'');
          if(item.s.tagMoved)between.append(el('div','tone-info',t('Tag {from} → {to}',{from:m.from?.tag||'—',to:m.to?.tag||'—'})));
          if(m.files?.length){const files=el('details','tm-files');files.append(el('summary','',t('{count} file(s)',{count:m.files.length})),el('div','mono',m.files.join('\n')));between.append(files);}
        }
        const name=el('div','');name.append(repoLink(item.repo));if(item.deploy)name.append(el('small','fleet-state tone-warn',t('deploy')));
        const tr=row([name,point(m?.from),point(m?.to),between]);if(item.deploy)tr.classList.add('tm-deploy');grid.append(tr);
      }
      out.append(grid);
    };
    moved.onchange=draw;
    go.onclick=async()=>{
      const a=new Date(from.value),b=new Date(to.value);if(!(a<b)){status.textContent=t('Pick a From moment before To.');return;}
      let deployPath='';try{deployPath=localStorage.getItem('gitdeck.deployRepo')||'';}catch{}
      const repos=reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path)).slice(0,80);
      const deploy=(state.repos||[]).find(repo=>repo.path===deployPath);
      const list=deploy&&!repos.includes(deploy)?[deploy,...repos]:repos;
      go.disabled=true;let done=0;out.replaceChildren();
      rows=await mapLimit(list,6,async repo=>{
        let m=null,error='';try{m=(await api('/api/repo/moments?'+query({path:repo.path,from:a.toISOString(),to:b.toISOString()}))).moments;}catch(e){error=e.message;}
        status.textContent=t('Reading {done} of {count}…',{done:++done,count:list.length});
        return {repo,m,error,s:summarize(m),deploy:repo===deploy};
      });
      go.disabled=false;
      rows.sort((x,y)=>Number(y.deploy)-Number(x.deploy)||Number(y.s.kind!=='same')-Number(x.s.kind!=='same')||(y.m?.commits||0)-(x.m?.commits||0)||x.repo.name.localeCompare(y.repo.name));
      const changed=rows.filter(item=>item.s.kind!=='same').length;
      status.textContent=t('{changed} of {count} repositories changed between {from} and {to}',{changed,count:rows.length,from:a.toLocaleString(),to:b.toLocaleString()});
      draw();
    };
  }
  addPanel('time-machine',t('Time machine'),build);
})();
