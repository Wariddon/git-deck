'use strict';
// Work report: what was done across every repository in a date range, oldest first, so a
// handover or progress document can be written without remembering it all. Reads
// /api/repo/activity per repository (all branches, numstat) and exports Markdown.
(function(){
  const pad=(n)=>String(n).padStart(2,'0');
  const day=(date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const ticketPattern=/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

  // Presets are computed from "today" so tests can pin the clock.
  function range(preset,today=new Date()){
    const d=new Date(today.getFullYear(),today.getMonth(),today.getDate());const shift=(n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
    if(preset==='today')return {since:day(d),until:day(d)};
    if(preset==='week'){const monday=shift(-((d.getDay()+6)%7));return {since:day(monday),until:day(d)};}
    if(preset==='last-week'){const monday=shift(-((d.getDay()+6)%7)-7);return {since:day(monday),until:day(new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+6))};}
    if(preset==='month')return {since:day(new Date(d.getFullYear(),d.getMonth(),1)),until:day(d)};
    if(preset==='last-month')return {since:day(new Date(d.getFullYear(),d.getMonth()-1,1)),until:day(new Date(d.getFullYear(),d.getMonth(),0))};
    if(preset==='30')return {since:day(shift(-29)),until:day(d)};
    return {since:day(shift(-6)),until:day(d)};
  }
  const tickets=(...texts)=>[...new Set(texts.join(' ').match(ticketPattern)||[])];

  // One row per repository with commits, ordered by its first commit in the range.
  function summarize(results,order='oldest'){
    const rows=results.filter(item=>item.commits?.length).map(item=>{
      const commits=[...item.commits].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const sum=(key)=>commits.reduce((total,commit)=>total+(Number(commit[key])||0),0);
      return {repo:item.repo,commits,first:commits[0].date,last:commits[commits.length-1].date,count:commits.length,
        files:sum('files'),added:sum('added'),deleted:sum('deleted'),
        branches:[...new Set(commits.map(commit=>commit.ref).filter(Boolean))],
        tickets:tickets(...commits.map(commit=>`${commit.subject} ${commit.ref}`))};
    });
    rows.sort((a,b)=>order==='newest'?String(b.last).localeCompare(String(a.last)):String(a.first).localeCompare(String(b.first)));
    return rows;
  }
  // Every commit by calendar day, oldest day first: the "what did I do on Tuesday" view.
  function timeline(rows){
    const days=new Map();
    for(const row of rows)for(const commit of row.commits){const key=String(commit.date).slice(0,10);if(!days.has(key))days.set(key,[]);days.get(key).push({repo:row.repo,commit});}
    return [...days.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,items])=>({date,items:items.sort((a,b)=>String(a.commit.date).localeCompare(String(b.commit.date)))}));
  }
  const time=(iso)=>String(iso).replace('T',' ').slice(0,16);
  const cell=(text)=>String(text??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');

  function toMarkdown(report){
    const {since,until,author,rows}=report;const total=rows.reduce((n,row)=>n+row.count,0);
    const lines=[`# ${t('Work report')} ${since} – ${until}`,''];
    lines.push(`- ${t('Author')}: ${author||t('Everyone')}`,`- ${t('Repositories')}: ${rows.length}`,`- ${t('Commits')}: ${total}`,'');
    lines.push(`## ${t('Summary')}`,'',`| # | ${t('Repository')} | ${t('First')} | ${t('Last')} | ${t('Commits')} | ${t('Files')} | +/- | ${t('Tickets')} |`,'|---|---|---|---|---|---|---|---|');
    rows.forEach((row,index)=>lines.push(`| ${index+1} | ${cell(row.repo.name)} | ${time(row.first)} | ${time(row.last)} | ${row.count} | ${row.files} | +${row.added} / -${row.deleted} | ${cell(row.tickets.join(', '))} |`));
    lines.push('',`## ${t('Details')}`);
    for(const row of rows){
      lines.push('',`### ${row.repo.name}`,'',`${t('Branches')}: ${row.branches.join(', ')||'-'}`,'');
      for(const commit of row.commits)lines.push(`- ${time(commit.date)} \`${String(commit.hash).slice(0,8)}\` ${commit.subject}${commit.ref?` _(${commit.ref})_`:''}`);
    }
    return lines.join('\n')+'\n';
  }

  async function mapLimit(items,limit,run){
    const results=new Array(items.length);let next=0;
    await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;results[index]=await run(items[index],index);}}));
    return results;
  }

  const option=(value,label,selected=false)=>{const item=new Option(label,value);item.selected=selected;return item;};
  const input=(type,label,value='')=>{const field=el('input','workflow-input');field.type=type;field.value=value;field.setAttribute('aria-label',label);return field;};

  async function openWorkReport(){
    if(typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Work report'));ui.dialog.classList.add('modern-action-dialog','work-report-dialog');
    ui.actions.querySelector('button').textContent=t('Close');
    const form=el('div','work-report-filters');
    const preset=document.createElement('select');preset.className='workflow-input';preset.setAttribute('aria-label',t('Period'));
    [['today',t('Today')],['week',t('This week')],['last-week',t('Last week')],['7',t('Last 7 days')],['30',t('Last 30 days')],['month',t('This month')],['last-month',t('Last month')],['custom',t('Custom…')]].forEach(([value,label])=>preset.append(option(value,label,value==='week')));
    const since=input('date',t('From')),until=input('date',t('To'));
    const folder=document.createElement('select');folder.className='workflow-input';folder.setAttribute('aria-label',t('Folder'));
    folder.append(option('all',t('All folders')));(state.scanLocations||[]).forEach(root=>folder.append(option(root,root)));
    const author=input('text',t('Author'));author.placeholder=t('Everyone');
    const mine=document.createElement('input');mine.type='checkbox';mine.checked=true;
    const mineLabel=el('label','modern-dialog-check');mineLabel.append(mine,el('span','',t('Only my commits')));
    const merges=document.createElement('input');merges.type='checkbox';
    const mergeLabel=el('label','modern-dialog-check');mergeLabel.append(merges,el('span','',t('Include merges')));
    const run=el('button','primary',t('Show'));run.type='button';
    form.append(preset,since,until,folder,author,mineLabel,mergeLabel,run);
    const status=el('p','work-report-status');const views=el('div','work-report-tabs');const out=el('div','work-report-body');
    ui.body.append(form,status,views,out);
    const copy=el('button','',t('Copy Markdown'));copy.type='button';copy.disabled=true;
    const save=el('button','',t('Save .md'));save.type='button';save.disabled=true;
    ui.actions.prepend(copy,save);

    let identity={name:'',email:''};
    try{identity=(await api('/api/activity/me')).identity||identity;}catch{}
    const me=[identity.name,identity.email].filter(Boolean).join(', ');
    const syncAuthor=()=>{author.disabled=mine.checked;author.value=mine.checked?me:(author.value===me?'':author.value);};
    mine.onchange=syncAuthor;syncAuthor();
    const syncDates=()=>{const custom=preset.value==='custom';since.disabled=until.disabled=!custom;if(!custom){const r=range(preset.value);since.value=r.since;until.value=r.until;}};
    preset.onchange=syncDates;syncDates();

    let report=null,view='repos',order='oldest';
    const render=()=>{
      out.replaceChildren();if(!report)return;
      views.replaceChildren();
      for(const [id,label] of [['repos',t('By repository')],['days',t('By day')]]){const tab=el('button',view===id?'active':'',label);tab.type='button';tab.onclick=()=>{view=id;render();};views.append(tab);}
      const sort=el('button','',order==='oldest'?t('Oldest first'):t('Newest first'));sort.type='button';sort.title=t('Change order');
      sort.onclick=()=>{order=order==='oldest'?'newest':'oldest';report.rows=summarize(report.results,order);render();};views.append(sort);
      if(!report.rows.length){out.append(el('p','work-report-empty',t('No commits in this period.')));return;}
      if(view==='repos'){
        const table=el('table','work-report-table');const head=el('tr');
        ['#',t('Repository'),t('First'),t('Last'),t('Commits'),'+/-',t('Tickets')].forEach(label=>head.append(el('th','',label)));table.append(head);
        report.rows.forEach((row,index)=>{
          const tr=el('tr');const name=el('button','work-report-repo',row.repo.name);name.type='button';name.title=row.repo.path;
          name.onclick=()=>{ui.dialog.close();openWorkspace(row.repo,'history',null);};
          const details=el('details');details.append(el('summary','',t('{count} commit(s)',{count:row.count})));
          const list=el('ul');row.commits.forEach(commit=>list.append(el('li','',`${time(commit.date)} · ${commit.subject}${commit.ref?` (${commit.ref})`:''}`)));details.append(list);
          const cells=[el('td','',String(index+1)),el('td'),el('td','',time(row.first)),el('td','',time(row.last)),el('td'),el('td','',`+${row.added} / -${row.deleted}`),el('td','',row.tickets.join(', '))];
          cells[1].append(name);cells[4].append(details);tr.append(...cells);table.append(tr);
        });
        out.append(table);
      }else{
        for(const group of timeline(report.rows)){
          const box=el('section','work-report-day');box.append(el('h3','',group.date));const list=el('ul');
          group.items.forEach(({repo,commit})=>{const item=el('li');item.append(el('span','work-report-time',time(commit.date).slice(11)),el('strong','',repo.name),el('span','',commit.subject));list.append(item);});
          box.append(list);out.append(box);
        }
      }
    };

    run.onclick=async()=>{
      if(!since.value||!until.value||since.value>until.value){status.textContent=t('Pick a valid date range.');return;}
      const repos=(state.repos||[]).filter(repo=>repo.valid!==false&&!repo.pending&&(folder.value==='all'||repo.path.toLowerCase()===folder.value.toLowerCase()||repo.path.toLowerCase().startsWith(folder.value.toLowerCase()+'\\')));
      run.disabled=copy.disabled=save.disabled=true;let done=0,failed=0;
      const query=(repo)=>new URLSearchParams({path:repo.path,since:since.value,until:until.value,author:mine.checked?me:author.value.trim(),merges:String(merges.checked)});
      status.textContent=t('Reading {done} of {total} repositories…',{done:0,total:repos.length});
      const results=await mapLimit(repos,4,async(repo)=>{
        let commits=[];try{commits=(await api('/api/repo/activity?'+query(repo))).commits||[];}catch{failed++;}
        done++;status.textContent=t('Reading {done} of {total} repositories…',{done,total:repos.length});return {repo,commits};
      });
      report={since:since.value,until:until.value,author:mine.checked?me:author.value.trim(),results,rows:summarize(results,order)};
      const total=report.rows.reduce((n,row)=>n+row.count,0);
      status.textContent=t('{commits} commit(s) in {repos} of {total} repositories',{commits:total,repos:report.rows.length,total:repos.length})+(failed?' · '+t('{count} could not be read',{count:failed}):'');
      run.disabled=false;copy.disabled=save.disabled=!report.rows.length;render();
    };
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(toMarkdown(report));showActionFeedback(t('Work report copied as Markdown'));}catch(error){showActionFeedback(error.message,{error:true});}};
    save.onclick=()=>{const blob=new Blob([toMarkdown(report)],{type:'text/markdown'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`work-report-${report.since}_${report.until}.md`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
    run.click();
  }

  if(typeof document!=='undefined'&&typeof el==='function'){
    const buttons=document.querySelector('.panel-buttons');
    if(buttons&&!buttons.querySelector('#work-report')){const button=el('button','btn soft',t('Work report'));button.id='work-report';button.type='button';button.title=t('What changed across repositories in a date range');button.onclick=openWorkReport;buttons.insertBefore(button,buttons.querySelector('#gitlab'));}
    const more=document.querySelector('.sync-more > div');
    if(more&&!more.querySelector('[data-work-report]')){const button=el('button','');button.type='button';button.dataset.workReport='1';button.append(el('strong','',t('🗓 Work report')),el('small','',t('What changed across repositories in a date range')));button.onclick=()=>{more.parentElement?.removeAttribute('open');openWorkReport();};more.append(button);}
    if(typeof commandPaletteEntries==='function'){const base=commandPaletteEntries;commandPaletteEntries=function(){const label=t('Work report…'),group=t('Tools');return [...base(),{label,group,shortcut:'',run:openWorkReport,search:`${label} ${group} activity report`}];};}
  }
  window.GitDeckWorkReport={openWorkReport,range,summarize,timeline,toMarkdown,tickets};
})();
