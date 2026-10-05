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
      return {repo:item.repo,mainline:item.mainline||'',commits,first:commits[0].date,last:commits[commits.length-1].date,count:commits.length,
        files:sum('files'),added:sum('added'),deleted:sum('deleted'),
        unpushed:commits.filter(commit=>commit.pushed===false).length,unmerged:commits.filter(commit=>commit.merged===false).length,
        branches:[...new Set(commits.map(commit=>commit.ref).filter(Boolean))],
        tickets:tickets(...commits.map(commit=>`${commit.subject} ${commit.ref}`)),hotFiles:hotFiles(commits)};
    });
    rows.sort((a,b)=>order==='newest'?String(b.last).localeCompare(String(a.last)):String(a.first).localeCompare(String(b.first)));
    return rows;
  }
  // The files touched most often: the "scope of change" part of a handover.
  function hotFiles(commits,limit=5){
    const counts=new Map();
    for(const commit of commits)for(const file of commit.paths||[])counts.set(file,(counts.get(file)||0)+1);
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([file,count])=>({file,count}));
  }
  // Work grouped by ticket key (from the subject or branch); commits without one share a group.
  function byTicket(rows){
    const groups=new Map();
    for(const row of rows)for(const commit of row.commits){
      const keys=tickets(`${commit.subject} ${commit.ref}`);
      for(const key of keys.length?keys:['']){if(!groups.has(key))groups.set(key,{ticket:key,repos:new Set(),commits:[]});const group=groups.get(key);group.repos.add(row.repo.name);group.commits.push({repo:row.repo,commit});}
    }
    return [...groups.values()].map(group=>({ticket:group.ticket,repos:[...group.repos],commits:group.commits.sort((a,b)=>String(a.commit.date).localeCompare(String(b.commit.date)))}))
      .sort((a,b)=>(a.ticket?0:1)-(b.ticket?0:1)||String(a.commits[0].commit.date).localeCompare(String(b.commits[0].commit.date)));
  }
  // Every commit by calendar day, oldest day first: the "what did I do on Tuesday" view.
  function timeline(rows){
    const days=new Map();
    for(const row of rows)for(const commit of row.commits){const key=String(commit.date).slice(0,10);if(!days.has(key))days.set(key,[]);days.get(key).push({repo:row.repo,commit});}
    return [...days.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,items])=>({date,items:items.sort((a,b)=>String(a.commit.date).localeCompare(String(b.commit.date)))}));
  }
  const time=(iso)=>String(iso).replace('T',' ').slice(0,16);
  const cell=(text)=>String(text??'').replace(/\|/g,'\|').replace(/\r?\n/g,' ');
  function statusText(row){
    const parts=[];
    if(row.unpushed)parts.push(t('{count} not pushed',{count:row.unpushed}));
    if(row.unmerged)parts.push(t('{count} not in {branch}',{count:row.unmerged,branch:row.mainline||'main'}));
    return parts.join(', ')||(row.commits.some(commit=>commit.merged===true)?t('All in {branch}',{branch:row.mainline}):row.commits.some(commit=>commit.pushed===true)?t('All pushed'):'-');
  }
  const commitStatus=(commit)=>commit.pushed===false?t('not pushed'):commit.merged===false?t('not merged'):'';

  function toMarkdown(report){
    const {since,until,author,rows}=report;const total=rows.reduce((n,row)=>n+row.count,0);
    const lines=[`# ${t('Work report')} ${since} – ${until}`,''];
    lines.push(`- ${t('Author')}: ${author||t('Everyone')}`,`- ${t('Repositories')}: ${rows.length}`,`- ${t('Commits')}: ${total}`,'');
    lines.push(`## ${t('Summary')}`,'',`| # | ${t('Repository')} | ${t('First')} | ${t('Last')} | ${t('Commits')} | ${t('Files')} | +/- | ${t('Status')} | ${t('Tickets')} |`,'|---|---|---|---|---|---|---|---|---|');
    rows.forEach((row,index)=>lines.push(`| ${index+1} | ${cell(row.repo.name)} | ${time(row.first)} | ${time(row.last)} | ${row.count} | ${row.files} | +${row.added} / -${row.deleted} | ${cell(statusText(row))} | ${cell(row.tickets.join(', '))} |`));
    const ticketGroups=byTicket(rows).filter(group=>group.ticket);
    if(ticketGroups.length){
      lines.push('',`## ${t('By ticket')}`,'');
      for(const group of ticketGroups)lines.push(`- **${group.ticket}** (${group.repos.join(', ')}): ${[...new Set(group.commits.map(item=>item.commit.subject))].join('; ')}`);
    }
    lines.push('',`## ${t('Details')}`);
    for(const row of rows){
      lines.push('',`### ${row.repo.name}`,'',`${t('Branches')}: ${row.branches.join(', ')||'-'}`);
      if(row.hotFiles.length)lines.push(`${t('Most changed files')}: ${row.hotFiles.map(item=>`\`${item.file}\` (${item.count})`).join(', ')}`);
      lines.push('');
      for(const commit of row.commits){const status=commitStatus(commit);lines.push(`- ${time(commit.date)} \`${String(commit.hash).slice(0,8)}\` ${commit.subject}${commit.ref?` _(${commit.ref})_`:''}${status?` — ${status}`:''}`);}
    }
    return lines.join('\n')+'\n';
  }
  // One line per commit for a spreadsheet or timesheet. The BOM lets Excel read Thai text.
  function toCsv(report){
    const quote=(value)=>{const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
    const flag=(value)=>value===true?'yes':value===false?'no':'';
    const lines=[['date','repository','branch','commit','subject','tickets','files','added','deleted','pushed','merged','author'].join(',')];
    for(const row of report.rows)for(const commit of row.commits)
      lines.push([time(commit.date),row.repo.name,commit.ref,String(commit.hash).slice(0,12),commit.subject,tickets(`${commit.subject} ${commit.ref}`).join(' '),commit.files,commit.added,commit.deleted,flag(commit.pushed),flag(commit.merged),commit.author].map(quote).join(','));
    return '﻿'+lines.join('\r\n')+'\r\n';
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
    try{const saved=localStorage.getItem('gitdeck.reportPeriod');if(saved&&[...preset.options].some(item=>item.value===saved))preset.value=saved;}catch{}
    preset.addEventListener('change',()=>{try{localStorage.setItem('gitdeck.reportPeriod',preset.value);}catch{}});
    const since=input('date',t('From')),until=input('date',t('To'));
    const folder=document.createElement('select');folder.className='workflow-input';folder.setAttribute('aria-label',t('Folder'));
    folder.append(option('all',t('All folders')));(state.scanLocations||[]).forEach(root=>folder.append(option(root,root)));
    try{const saved=localStorage.getItem('gitdeck.folder');if(saved&&[...folder.options].some(item=>item.value===saved))folder.value=saved;}catch{}
    folder.addEventListener('change',()=>{try{localStorage.setItem('gitdeck.folder',folder.value);}catch{}});
    const author=input('text',t('Author'));author.placeholder=t('Everyone');
    const mine=document.createElement('input');mine.type='checkbox';mine.checked=true;
    const mineLabel=el('label','modern-dialog-check');mineLabel.append(mine,el('span','',t('Only my commits')));
    const merges=document.createElement('input');merges.type='checkbox';
    const mergeLabel=el('label','modern-dialog-check');mergeLabel.append(merges,el('span','',t('Include merges')));
    const run=el('button','primary',t('Show'));run.type='button';
    form.append(preset,since,until,folder,author,mineLabel,mergeLabel,run);
    const status=el('p','work-report-status');const views=el('div','work-report-tabs');const out=el('div','work-report-body');
    ui.body.append(form,status,views,out);
    const copy=el('button','',t('Copy Markdown'));copy.type='button';
    const save=el('button','',t('Save .md'));save.type='button';
    const csv=el('button','',t('Save CSV'));csv.type='button';csv.title=t('One line per commit, for Excel or a timesheet');
    const ai=el('button','',t('✨ AI summary'));ai.type='button';ai.title=t('Draft a progress report from the commit messages');
    const exports=[copy,save,csv,ai];exports.forEach(button=>button.disabled=true);
    ui.actions.prepend(...exports);

    let identity={name:'',email:''};
    try{identity=(await api('/api/activity/me')).identity||identity;}catch{}
    const me=[identity.name,identity.email].filter(Boolean).join(', ');
    const syncAuthor=()=>{author.disabled=mine.checked;author.value=mine.checked?me:(author.value===me?'':author.value);};
    mine.onchange=syncAuthor;syncAuthor();
    const syncDates=()=>{const custom=preset.value==='custom';since.disabled=until.disabled=!custom;if(!custom){const r=range(preset.value);since.value=r.since;until.value=r.until;}};
    preset.onchange=syncDates;syncDates();

    let report=null,view='repos',order='oldest';
    const commitLine=(commit)=>{const status=commitStatus(commit);return `${time(commit.date)} · ${commit.subject}${commit.ref?` (${commit.ref})`:''}${status?` — ${status}`:''}`;};
    const render=()=>{
      out.replaceChildren();if(!report)return;
      views.replaceChildren();
      for(const [id,label] of [['repos',t('By repository')],['tickets',t('By ticket')],['days',t('By day')],['files',t('Most changed files')]]){const tab=el('button',view===id?'active':'',label);tab.type='button';tab.onclick=()=>{view=id;render();};views.append(tab);}
      const sort=el('button','',order==='oldest'?t('Oldest first'):t('Newest first'));sort.type='button';sort.title=t('Change order');
      sort.onclick=()=>{order=order==='oldest'?'newest':'oldest';report.rows=summarize(report.results,order);render();};views.append(sort);
      if(!report.rows.length){out.append(el('p','work-report-empty',t('No commits in this period.')));return;}
      const repoButton=(repo)=>{const name=el('button','work-report-repo',repo.name);name.type='button';name.title=repo.path;name.onclick=()=>{ui.dialog.close();openWorkspace(repo,'history',null);};return name;};
      if(view==='repos'){
        const table=el('table','work-report-table');const head=el('tr');
        ['#',t('Repository'),t('First'),t('Last'),t('Commits'),'+/-',t('Status'),t('Tickets')].forEach(label=>head.append(el('th','',label)));table.append(head);
        report.rows.forEach((row,index)=>{
          const tr=el('tr');
          const details=el('details');details.append(el('summary','',t('{count} commit(s)',{count:row.count})));
          const list=el('ul');row.commits.forEach(commit=>list.append(el('li','',commitLine(commit))));details.append(list);
          const pending=row.unpushed||row.unmerged;
          const cells=[el('td','',String(index+1)),el('td'),el('td','',time(row.first)),el('td','',time(row.last)),el('td'),el('td','',`+${row.added} / -${row.deleted}`),el('td',pending?'work-report-pending':'work-report-done',statusText(row)),el('td','',row.tickets.join(', '))];
          cells[1].append(repoButton(row.repo));cells[4].append(details);tr.append(...cells);table.append(tr);
        });
        out.append(table);
      }else if(view==='tickets'){
        for(const group of byTicket(report.rows)){
          const box=el('section','work-report-day');box.append(el('h3','',group.ticket?`${group.ticket} · ${group.repos.join(', ')}`:t('Without a ticket')));const list=el('ul');
          group.commits.forEach(({repo,commit})=>{const item=el('li');const status=commitStatus(commit);item.append(el('span','work-report-time',time(commit.date).slice(5,10)),el('strong','',repo.name),el('span','',commit.subject+(status?` — ${status}`:'')));list.append(item);});
          box.append(list);out.append(box);
        }
      }else if(view==='files'){
        for(const row of report.rows){
          const box=el('section','work-report-day');const title=el('h3');title.append(repoButton(row.repo));box.append(title);const list=el('ul');
          row.hotFiles.forEach(item=>{const line=el('li');line.append(el('span','work-report-time',`×${item.count}`),el('code','',item.file));list.append(line);});
          if(!row.hotFiles.length)list.append(el('li','',t('No file details')));
          box.append(list);out.append(box);
        }
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
      run.disabled=true;exports.forEach(button=>button.disabled=true);let done=0,failed=0;
      const query=(repo)=>new URLSearchParams({path:repo.path,since:since.value,until:until.value,author:mine.checked?me:author.value.trim(),merges:String(merges.checked)});
      status.textContent=t('Reading {done} of {total} repositories…',{done:0,total:repos.length});
      const results=await mapLimit(repos,4,async(repo)=>{
        let commits=[],mainline='';try{const answer=await api('/api/repo/activity?'+query(repo));commits=answer.commits||[];mainline=answer.mainline||'';}catch{failed++;}
        done++;status.textContent=t('Reading {done} of {total} repositories…',{done,total:repos.length});return {repo,commits,mainline};
      });
      report={since:since.value,until:until.value,author:mine.checked?me:author.value.trim(),results,rows:summarize(results,order)};
      const total=report.rows.reduce((n,row)=>n+row.count,0);
      status.textContent=t('{commits} commit(s) in {repos} of {total} repositories',{commits:total,repos:report.rows.length,total:repos.length})+(failed?' · '+t('{count} could not be read',{count:failed}):'');
      run.disabled=false;exports.forEach(button=>button.disabled=!report.rows.length);render();
    };
    const download=(text,type,name)=>{const blob=new Blob([text],{type});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(toMarkdown(report));showActionFeedback(t('Work report copied as Markdown'));}catch(error){showActionFeedback(error.message,{error:true});}};
    save.onclick=()=>download(toMarkdown(report),'text/markdown',`work-report-${report.since}_${report.until}.md`);
    csv.onclick=()=>download(toCsv(report),'text/csv',`work-report-${report.since}_${report.until}.csv`);
    // AI draft: only the report text (commit messages, branch and file names) is sent, never code.
    ai.onclick=async()=>{
      let info;try{info=(await api('/api/ai/status')).ai;}catch(error){showActionFeedback(error.message,{error:true,context:t('AI')});return;}
      if(!info?.ready){showActionFeedback(info?.hint||t('AI is not available.'),{error:true,context:t('AI')});return;}
      const where=info.provider==='ollama'?t('Ollama ({model}) on this computer',{model:info.model}):`Anthropic (${info.model})`;
      if(!confirm(t('Send the commit messages, branch and file names in this report to {where}? No code is sent.',{where})))return;
      const label=ai.textContent;ai.disabled=true;ai.textContent=t('Thinking…');
      try{
        const answer=await api('/api/action',{method:'POST',body:JSON.stringify({action:'ai-work-summary',paths:report.rows.map(row=>row.repo.path),report:toMarkdown(report)})});
        out.querySelector('.work-report-ai')?.remove();
        const box=el('section','work-report-ai');const text=document.createElement('textarea');text.className='workflow-input';text.value=answer.summary;text.rows=12;text.setAttribute('aria-label',t('AI summary'));
        const copyAi=el('button','',t('Copy'));copyAi.type='button';copyAi.onclick=async()=>{try{await navigator.clipboard.writeText(text.value);showActionFeedback(t('Copied'));}catch(error){showActionFeedback(error.message,{error:true});}};
        box.append(el('strong','',t('AI summary')),text,el('small','',[t('AI generated · check before sending'),answer.note].filter(Boolean).join(' · ')),copyAi);
        out.prepend(box);text.focus();
      }catch(error){showActionFeedback(error.message,{error:true,context:t('AI')});}
      finally{ai.disabled=false;ai.textContent=label;}
    };
    run.click();
  }

  if(typeof document!=='undefined'&&typeof el==='function'){
    const buttons=document.querySelector('.panel-buttons');
    if(buttons&&!buttons.querySelector('#work-report')){const button=el('button','btn soft',t('Work report'));button.id='work-report';button.type='button';button.title=t('What changed across repositories in a date range');button.onclick=openWorkReport;buttons.insertBefore(button,buttons.querySelector('#gitlab'));}
    const more=document.querySelector('.sync-more > div');
    if(more&&!more.querySelector('[data-work-report]')){const button=el('button','');button.type='button';button.dataset.workReport='1';button.append(el('strong','',t('🗓 Work report')),el('small','',t('What changed across repositories in a date range')));button.onclick=()=>{more.parentElement?.removeAttribute('open');openWorkReport();};more.append(button);}
    if(typeof commandPaletteEntries==='function'){const base=commandPaletteEntries;commandPaletteEntries=function(){const label=t('Work report…'),group=t('Tools');return [...base(),{label,group,shortcut:'',run:openWorkReport,search:`${label} ${group} activity report`}];};}
  }
  window.GitDeckWorkReport={openWorkReport,range,summarize,timeline,byTicket,hotFiles,toMarkdown,toCsv,tickets};
})();
