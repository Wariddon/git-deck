'use strict';
// Close the day (Ctrl+K › Close the day, or Dashboard › Every day › Close the day): one card that ends
// the working day: what moved today (tickets and minutes, actions), what is still only on this
// computer (uncommitted, unpushed, local-only branches) so nothing is left behind, how much time Git
// Deck saved, and a plan for tomorrow ready to paste into the standup.
// Also the time-saved counter (window.GitDeckSavings): features report what they did, with a modest
// estimate of the minutes it spared you; kept per day on this computer for 60 days.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Minutes each event saves: deliberately modest, so the total is believable.
  const estimates={'conflict-forecast':20,'teammate-conflict':20,'recipe-step':1,'quick-undo':5,'env-impact':10,'lesson':3,'predicted':1,'ticket-resume':3};
  const dayOf=(date)=>{const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function addSaving(log,kind,count=1,now=new Date()){
    if(!estimates[kind])return log||{};
    const next={...(log||{})};const day=dayOf(now);const entry={...(next[day]||{})};
    entry[kind]=(entry[kind]||0)+count;next[day]=entry;
    const oldest=dayOf(new Date(now.getTime()-60*864e5));for(const key of Object.keys(next))if(key<oldest)delete next[key];
    return next;
  }
  // {minutes, byKind:{kind:{count,minutes}}} from fromDay (YYYY-MM-DD) to today.
  function savedSince(log,fromDay){
    const byKind={};let minutes=0;
    for(const [day,kinds] of Object.entries(log||{}))if(day>=fromDay)for(const [kind,count] of Object.entries(kinds)){const m=count*(estimates[kind]||0);minutes+=m;byKind[kind]={count:(byKind[kind]?.count||0)+count,minutes:(byKind[kind]?.minutes||0)+m};}
    return {minutes,byKind};
  }
  const weekStart=(now=new Date())=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return dayOf(d);};
  // What would be left behind tonight: work only on this computer, from the last Pending snapshot.
  function leftBehind(items){
    const out=[];
    for(const {path,pending:p} of items||[]){
      if(!p||/\.worktrees[\\/]/i.test(path))continue;const name=String(path).split(/[\\/]/).pop();
      if(p.changed||p.untracked)out.push({name,path,kind:'commit',text:t('{count} file(s) not committed on {branch}',{count:(p.changed||0)+(p.untracked||0),branch:p.branch})});
      if(p.ahead)out.push({name,path,kind:'push',text:t('{count} commit(s) not pushed on {branch}',{count:p.ahead,branch:p.branch})});
      for(const local of p.unpushedBranches||[])out.push({name,path,kind:'branch',text:t('{branch}: {count} commit(s) only on this computer',{branch:local.branch,count:local.commits})});
    }
    const order={commit:0,push:1,branch:2};return out.sort((a,b)=>order[a.kind]-order[b.kind]||a.name.localeCompare(b.name));
  }
  function tomorrowPlan({left=[],tickets=[]}){
    const lines=[t('Tomorrow:')];
    for(const item of tickets.slice(0,5))lines.push(`- ${item.key}${item.note?`: ${item.note}`:''}`);
    for(const item of left.slice(0,6))lines.push(`- ${item.name}: ${item.text}`);
    if(lines.length===1)lines.push('- '+t('(write the plan)'));
    return lines.join('\n');
  }
  const helpers={estimates,addSaving,savedSince,weekStart,leftBehind,tomorrowPlan,dayOf};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const key='gitdeck.savings';
  const load=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}};
  const add=(kind,count=1)=>{try{localStorage.setItem(key,JSON.stringify(addSaving(load(),kind,count)));}catch{}};
  // once(): count an event only the first time it is seen (re-running a forecast is not a new save).
  const once=(kind,id)=>{let seen=[];try{seen=JSON.parse(localStorage.getItem('gitdeck.savingsSeen')||'[]')||[];}catch{}const tag=`${kind}|${id}`;if(seen.includes(tag))return false;try{localStorage.setItem('gitdeck.savingsSeen',JSON.stringify([...seen,tag].slice(-500)));}catch{}add(kind);return true;};
  window.GitDeckSavings={add,once,since:(day)=>savedSince(load(),day),weekStart};
  if(typeof el!=='function'||typeof releaseDialog!=='function')return;

  const duration=(minutes)=>{const h=Math.floor(minutes/60),m=Math.round(minutes%60);return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;};
  const kindLabel=()=>({'conflict-forecast':t('conflicts seen before merging'),'teammate-conflict':t('clashes with teammates seen early'),'recipe-step':t('recipe steps run for you'),'quick-undo':t('quick undos'),'env-impact':t('config changes checked per environment'),'lesson':t('lessons shown before a push'),'predicted':t('predicted commands'),'ticket-resume':t('tickets resumed where you left them')});
  function closeDay(){
    if(typeof hideCommandPalette==='function')hideCommandPalette();
    const ui=releaseDialog(t('Close the day'));ui.dialog.classList.add('day-close');
    const today=dayOf(new Date());
    let snap=null;try{snap=JSON.parse(localStorage.getItem('gitdeck.pendingSnapshot')||'null');}catch{}
    const tickets=(window.GitDeckTicketTime?.since?.(today)||[]).map(item=>({...item,note:window.GitDeckTicketTime?.noteFor?.(item.key)||''}));
    let actions=[];try{actions=(JSON.parse(localStorage.getItem('gitdeck.actionLog')||'[]')||[]).filter(item=>dayOf(item.at)===today);}catch{}
    const left=leftBehind(snap?.items);
    const saved=savedSince(load(),today),week=savedSince(load(),weekStart());
    const grid=el('div','day-close-grid');
    const card=(title,body)=>{const box=el('section','day-close-card');box.append(el('h3','',title),...body);grid.append(box);return box;};
    const moved=tickets.length?tickets.map(item=>{const row=el('div','day-close-row');row.append(el('strong','mono',item.key),el('span','',duration(item.minutes)));return row;}):[el('p','fleet-muted',t('No ticket time recorded today.'))];
    const counts={};for(const item of actions)counts[item.action]=(counts[item.action]||0)+1;
    if(actions.length)moved.push(el('p','fleet-muted',Object.entries(counts).map(([action,count])=>`${action} ×${count}`).join(' · ')));
    card(t('Today'),moved);
    const leftBox=left.length?left.slice(0,10).map(item=>{const row=el('div',`day-close-row tone-${item.kind==='commit'?'warn':'info'}`);row.append(el('strong','',item.name),el('span','',item.text));return row;}):[el('p','tone-ok',t('Nothing left only on this computer. ✓'))];
    if(!snap)leftBox.push(el('p','fleet-muted',t('Based on the last Pending check; run one for the newest picture.')));
    card(left.length?t('Still only on this computer ({count})',{count:left.length}):t('Nothing left behind'),leftBox);
    const savedRows=[el('p','day-close-big',t('~{time} today · ~{week} this week',{time:duration(saved.minutes),week:duration(week.minutes)}))];
    for(const [kind,item] of Object.entries(week.byKind).sort((a,b)=>b[1].minutes-a[1].minutes))savedRows.push(el('div','day-close-row',`${item.count} × ${kindLabel()[kind]||kind}`));
    savedRows.push(el('small','fleet-muted',t('Modest estimates of time Git Deck spared you, counted on this computer.')));
    card(t('Time saved'),savedRows);
    const plan=el('textarea','workflow-input day-close-plan');plan.rows=7;plan.value=tomorrowPlan({left,tickets});
    card(t('Plan for tomorrow'),[plan]);
    ui.body.append(grid);
    const copy=el('button','primary',t('Copy plan'));copy.type='button';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(plan.value);}catch{plan.select();document.execCommand('copy');}copy.textContent=t('Copied');try{localStorage.setItem('gitdeck.dayClosed',today);}catch{}};
    ui.actions.prepend(copy);
  }
  window.GitDeckDayClose={open:closeDay};
  if(typeof commandPaletteEntries==='function'){const base=commandPaletteEntries;commandPaletteEntries=function(){const label=t('Close the day'),group=t('Every day');return [...base(),{label,group,shortcut:'',run:closeDay,search:`${label} ${group} shutdown end of day`}];};}
  // Dashboard › Every day: the same card, one click away.
  const F=window.GitDeckFleet;
  if(F?.addPanel&&document.querySelector('.operations-tabs'))F.addPanel('day-close',t('Close the day'),(panel)=>{
    const go=el('button','primary',t('Close the day'));go.type='button';go.onclick=closeDay;
    panel.append(el('p','multi-repo-explain',t('End the day in one card: what moved, what is still only on this computer, the time Git Deck saved and a plan for tomorrow ready to paste.')),go);
  });
})();
