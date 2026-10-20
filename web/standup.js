'use strict';
// Standup draft: "since the last working day / today / blocked", written from your own commits
// (/api/repo/activity, your Git identity) and the pending state of the repositories you worked on
// this week. Opened from Pending work > Worked on this week; the text is editable and copied as is.
(function(){
  const pad=(n)=>String(n).padStart(2,'0');
  const day=(date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const ticketPattern=/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;


  // The last working day before `today`: Monday looks back to Friday, the weekend too.
  function previousWorkday(today=new Date()){
    const d=new Date(today.getFullYear(),today.getMonth(),today.getDate());const back={0:2,1:3,6:1}[d.getDay()]??1;
    return new Date(d.getFullYear(),d.getMonth(),d.getDate()-back);
  }
  const tickets=(...texts)=>[...new Set(texts.join(' ').match(ticketPattern)||[])];

  // done:  [{repo:{name}, branch, commits:[{subject, ref}]}]  (your commits since the last working day)
  // state: [{repo:{name}, pending}]                          (repositories worked on this week)
  function buildStandup({done=[],state=[],since,today=new Date()}){
    const lines=[t('Standup {date}',{date:day(today)}),'',t('Since {date}:',{date:since})];
    const doneRows=done.filter(row=>row.commits?.length);
    if(!doneRows.length)lines.push('- '+t('No commits of mine.'));
    for(const row of doneRows){
      const subjects=[...new Set(row.commits.map(commit=>String(commit.subject||'').trim()).filter(Boolean))];
      const keys=tickets(row.branch||'',...row.commits.map(commit=>`${commit.subject} ${commit.ref||''}`));
      lines.push(`- ${row.repo.name}${row.branch?` (${row.branch})`:''}${keys.length?' '+keys.join(', '):''}`);
      for(const subject of subjects.slice(0,6))lines.push(`  - ${subject}`);
      if(subjects.length>6)lines.push('  - '+t('and {count} more',{count:subjects.length-6}));
    }
    const plan=[],blocked=[];
    for(const {repo,pending:p} of state){
      if(!p)continue;const todo=[];
      if(p.changed||p.untracked)todo.push(t('commit {count} changed file(s)',{count:(p.changed||0)+(p.untracked||0)}));
      if(p.ahead)todo.push(t('push {count} commit(s) on {branch}',{count:p.ahead,branch:p.branch}));
      else if(!p.upstream&&p.branch&&!['main','master','develop','development'].includes(p.branch))todo.push(t('publish {branch}',{branch:p.branch}));
      for(const item of p.unpushedBranches||[])todo.push(t('push {branch} ({count})',{branch:item.branch,count:item.commits}));
      if(p.behind)todo.push(t('pull {count} new commit(s)',{count:p.behind}));
      if(Number(p.commitsSinceTag)>0&&!todo.length)todo.push(p.latestTag?t('tag/deploy: {count} commit(s) after {tag}',{count:p.commitsSinceTag,tag:p.latestTag}):t('first tag'));
      if(todo.length)plan.push(`- ${repo.name}: ${todo.join(', ')}`);
      if(p.conflicts||p.operation)blocked.push(`- ${repo.name}: ${t('unfinished {operation} with {count} conflict(s)',{operation:p.operation||'merge',count:p.conflicts||0})}`);
      if(p.upstreamGone)blocked.push(`- ${repo.name}: ${t('{branch} was deleted on the remote; check it was merged',{branch:p.branch})}`);
    }
    lines.push('',t('Today:'),...(plan.length?plan:['- '+t('(write the plan)')]));
    lines.push('',t('Blocked:'),...(blocked.length?blocked:['- '+t('Nothing')]));
    return lines.join('\n');
  }
  const helpers={previousWorkday,buildStandup,day};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  async function open(items){
    if(typeof releaseDialog!=='function'||typeof api!=='function')return;
    const ui=releaseDialog(t('Standup draft'));ui.dialog.classList.add('standup-dialog');
    const note=el('p','fleet-muted',t('Reading your commits…'));ui.body.append(note);
    const today=new Date();const since=day(previousWorkday(today));
    let identity={name:'',email:''};try{identity=(await api('/api/activity/me')).identity||identity;}catch{}
    const author=[identity.name,identity.email].filter(Boolean).join(', ');
    const done=[];let next=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(next<items.length){const item=items[next++];
        try{const answer=await api('/api/repo/activity?'+new URLSearchParams({path:item.repo.path,since,until:day(today),author,merges:'false'}));
          const commits=(answer.commits||[]).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
          if(commits.length)done.push({repo:item.repo,branch:commits[commits.length-1].ref||item.pending?.branch||'',commits,last:commits[commits.length-1].date});
        }catch{}
      }
    }));
    done.sort((a,b)=>String(b.last).localeCompare(String(a.last)));
    const text=el('textarea','workflow-input standup-text');text.rows=18;text.spellcheck=false;
    text.value=buildStandup({done,state:items,since,today});
    note.textContent=author?t('Your commits ({author}) since {date}, and the state of this week\'s repositories. Edit before sending.',{author,date:since}):t('Commits by everyone since {date} (no Git identity found). Edit before sending.',{date:since});
    ui.body.append(text);
    const copy=el('button','primary',t('Copy'));copy.type='button';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(text.value);copy.textContent=t('Copied');}catch{text.select();document.execCommand('copy');copy.textContent=t('Copied');}};
    ui.actions.prepend(copy);text.focus();
  }
  window.GitDeckStandup={...helpers,open};
})();
