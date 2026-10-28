'use strict';
// Command bar that acts (Ctrl+K): type what you want across repositories and get a plan before
// anything runs. "tag crs- next", "push aml-", "pull lns-", "ticket AP2365-3320", or a ticket key alone.
// The plan lists every repository with what will happen (and why some are skipped); Run does it.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const ticketRe=/^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,12}$/;
  // "tag crs- next" -> {verb:'tag', target:'crs-', arg:'next'}; "AP2365-3320" -> {verb:'ticket', target:'AP2365-3320'}
  function parseIntent(text){
    const words=String(text||'').trim().split(/\s+/).filter(Boolean);if(!words.length)return null;
    const verb=words[0].toLowerCase();
    if(words.length===1&&ticketRe.test(words[0])&&/\d/.test(words[0]))return {verb:'ticket',target:words[0].toUpperCase()};
    if(['tag','push','pull'].includes(verb)&&words[1])return {verb,target:words[1],arg:(words[2]||'').toLowerCase()==='next'?'':words.slice(2).join(' ')};
    if(verb==='ticket'&&words[1]&&ticketRe.test(words[1]))return {verb:'ticket',target:words[1].toUpperCase()};
    if(['radar','releases','release'].includes(verb))return {verb:'radar',target:words[1]||''};
    return null;
  }
  // Repositories a target names: "crs-" or "crs-*" is a family prefix, otherwise an exact name, else a prefix.
  function matchRepos(target,repos){
    const text=String(target||'').toLowerCase().replace(/\*$/,'');if(!text)return [];
    const list=(repos||[]).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path||''));
    if(text.endsWith('-'))return list.filter(repo=>repo.name.toLowerCase().startsWith(text));
    const exact=list.filter(repo=>repo.name.toLowerCase()===text);if(exact.length)return exact;
    return list.filter(repo=>repo.name.toLowerCase().startsWith(text));
  }
  // One plan row per repository: {repo, run:boolean, what, note}.
  function planFor(intent,items,{nextTag=(tag)=>tag,tagGuard=()=>''}={}){
    return items.map(({repo,pending:p})=>{
      if(!p)return {repo,run:false,what:'',note:t('not checked')};
      if(intent.verb==='push'){
        if(!p.ahead)return {repo,run:false,what:'',note:t('nothing to push')};
        if(!p.upstream)return {repo,run:false,what:'',note:t('branch not published')};
        return {repo,run:true,what:t('push {count} commit(s) on {branch}',{count:p.ahead,branch:p.branch}),note:''};
      }
      if(intent.verb==='pull'){
        if(!p.behind)return {repo,run:false,what:'',note:t('up to date')};
        if(p.changed||p.untracked)return {repo,run:true,what:t('pull {count} commit(s) on {branch}',{count:p.behind,branch:p.branch}),note:t('local changes are stashed and restored')};
        return {repo,run:true,what:t('pull {count} commit(s) on {branch}',{count:p.behind,branch:p.branch}),note:''};
      }
      if(intent.verb==='tag'){
        const name=intent.arg||nextTag(p.latestTag);
        if(!intent.arg&&p.latestTag&&!Number(p.commitsSinceTag))return {repo,run:false,what:'',note:t('nothing new since {tag}',{tag:p.latestTag})};
        if(!name)return {repo,run:false,what:'',note:t('no tag to continue: type a name')};
        const hint=tagGuard(name,p.branch);
        if(hint)return {repo,run:true,what:t('tag {name}',{name:hint}),tag:hint,note:t('version tag on {branch}: word tag instead',{branch:p.branch})};
        return {repo,run:true,what:t('tag {name}',{name}),tag:name,note:p.latestTag?t('after {tag} ({count} commit(s))',{tag:p.latestTag,count:Number(p.commitsSinceTag)||0}):''};
      }
      return {repo,run:false,what:'',note:''};
    });
  }
  const helpers={parseIntent,matchRepos,planFor};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof commandPaletteEntries!=='function'||typeof api!=='function')return;

  const verbs={tag:t('Tag'),push:t('Push'),pull:t('Pull')};
  const readSnapshot=()=>{try{return JSON.parse(localStorage.getItem('gitdeck.pendingSnapshot')||'null');}catch{return null;}};
  async function showPlan(intent){
    const F=window.GitDeckFleet;if(!F)return;
    const repos=matchRepos(intent.target,(state.repos||[]).filter(repo=>repo.valid!==false));
    if(typeof hideCommandPalette==='function')hideCommandPalette();
    const ui=releaseDialog(t('{verb} · {target}',{verb:verbs[intent.verb],target:intent.target}));ui.dialog.classList.add('plan-dialog');
    if(!repos.length){ui.body.append(el('p','',t('No repository matches {target}.',{target:intent.target})));return;}
    const note=el('p','fleet-muted',t('Reading {count} repositories…',{count:repos.length}));ui.body.append(note);
    const items=await F.mapLimit(repos,8,async repo=>{let pending=null;try{pending=(await api('/api/repo/pending?'+F.query({path:repo.path}))).pending;}catch{}return {repo,pending};});
    const plan=planFor(intent,items,{nextTag:F.nextTag||((x)=>x),tagGuard:F.tagGuard||(()=>'')}).sort((a,b)=>Number(b.run)-Number(a.run)||a.repo.name.localeCompare(b.repo.name));
    const runnable=plan.filter(row=>row.run);
    note.textContent=t('{run} to do · {skip} skipped. Nothing runs until you press Run.',{run:runnable.length,skip:plan.length-runnable.length});
    const table=el('table','plan-table');const head=el('tr');for(const label of ['',t('Repository'),t('What'),t('Note'),t('Result')])head.append(el('th','',label));table.append(head);
    const rows=plan.map(row=>{
      const tr=el('tr',row.run?'':'plan-skip');const box=el('input');box.type='checkbox';box.checked=row.run;box.disabled=!row.run;box.setAttribute('aria-label',row.repo.name);
      const result=el('td','plan-result');tr.append(Object.assign(el('td'),{}),el('td','',row.repo.name),el('td','mono',row.what||'—'),el('td','fleet-muted',row.note),result);tr.firstChild.append(box);table.append(tr);
      return {...row,box,result};
    });
    const wrap=el('div','plan-wrap');wrap.append(table);ui.body.append(wrap);
    let notes=null;
    if(intent.verb==='tag'){const label=el('label','fleet-check');notes=el('input');notes.type='checkbox';notes.checked=true;label.append(notes,el('span','',t('Push each tag, with the commits since the last tag as its message')));ui.body.append(label);}
    const go=el('button','primary',t('Run'));go.type='button';go.disabled=!runnable.length;
    go.onclick=async()=>{
      const todo=rows.filter(row=>row.run&&row.box.checked);if(!todo.length)return;go.disabled=true;let ok=0,failed=0;
      await F.mapLimit(todo,2,async row=>{
        row.result.textContent=t('Working…');
        try{
          let answer;
          if(intent.verb==='push')answer=await F.runQuiet('push',row.repo);
          else if(intent.verb==='pull')answer=await F.runQuiet('pull',row.repo,{strategy:state.meta?.pullStrategy||'ff-only',autostash:true});
          else{
            const item=items.find(entry=>entry.repo===row.repo);let message='';
            if(notes?.checked&&F.releaseNotes){let commits=[];try{commits=(await api('/api/repo/commits-since?'+F.query({path:row.repo.path,tag:item?.pending?.latestTag||''}))).commits||[];}catch{}message=F.releaseNotes('',commits,item?.pending?.latestTag);}
            answer=await F.runQuiet('tag-create',row.repo,{tag:row.tag,message,push:Boolean(notes?.checked),remote:'origin'});
          }
          row.result.textContent=String(answer?.message||t('Done')).split('\n')[0];row.result.classList.add('tone-ok');ok++;row.box.checked=false;
        }catch(error){row.result.textContent=error.message.split('\n')[0];row.result.classList.add('tone-bad');failed++;}
      });
      note.textContent=t('{ok} done · {failed} failed',{ok,failed});showActionFeedback(t('{verb}: {ok} done · {failed} failed',{verb:verbs[intent.verb],ok,failed}),{error:failed>0});
    };
    ui.actions.prepend(go);
  }
  function runIntent(intent){
    if(intent.verb==='ticket'){if(typeof hideCommandPalette==='function')hideCommandPalette();window.GitDeckTicketMode?.enter?.(intent.target);try{localStorage.setItem('gitdeck.ticketKey',intent.target);}catch{}if(typeof showOperationsCenter==='function')showOperationsCenter('ticket');return;}
    if(intent.verb==='radar'){if(typeof hideCommandPalette==='function')hideCommandPalette();if(typeof showOperationsCenter==='function')showOperationsCenter('releases');return;}
    void showPlan(intent);
  }
  const base=commandPaletteEntries;
  commandPaletteEntries=function(){
    const entries=base();const term=(document.getElementById('command-search')?.value||'').trim();
    const intent=parseIntent(term);if(!intent)return entries;
    const label=intent.verb==='ticket'?t('Follow ticket {key} everywhere',{key:intent.target})
      :intent.verb==='radar'?t('Open Releases'):t('{verb} {target}: show the plan',{verb:verbs[intent.verb],target:intent.target});
    return [{label,group:t('Do it'),shortcut:'Enter',search:term,run:()=>runIntent(intent)},...entries];
  };
  window.GitDeckCommandActions=helpers;
})();
