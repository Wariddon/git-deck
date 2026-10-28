'use strict';
// Lessons (server side: Get-GitDeckLessons in lib/GitDeck.Insight.ps1): notes you already wrote, for
// example a shared AI brain's knowledge\notes folder, shown where they matter. Choose the folder once
// (Dashboard › Lessons). Then the status bar shows 💡 when notes mention the open repository, its
// family, its ticket or the kind of files you changed, and the Push dialog lists them before you push.
// Read-only: notes are never changed, and lines that look like passwords or tokens are never shown.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const ticketRe=/(?:^|[/_\s(\[])([A-Za-z][A-Za-z0-9]{1,9}-[1-9]\d{0,11})(?![A-Za-z0-9])/;
  const meaningful=/^(pom\.xml|build\.gradle(\.kts)?|package\.json|Dockerfile|Jenkinsfile[^/]*|\.gitlab-ci\.ya?ml|application[^/]*\.(ya?ml|properties)|bootstrap[^/]*\.ya?ml|[^/]*configmap[^/]*\.ya?ml|values[^/]*\.ya?ml)$/i;
  function termsFor({repo='',branch='',files=[]}={}){
    const out=[];const add=(word)=>{word=String(word||'').trim();if(word.length>=3&&!out.some(item=>item.toLowerCase()===word.toLowerCase()))out.push(word);};
    add(repo);
    const family=String(repo).match(/^([A-Za-z][A-Za-z0-9]{1,15}-)/)?.[1];if(family)add(family);
    add((String(branch).match(ticketRe)||[])[1]);
    for(const file of files){const name=String(file).replaceAll('\\','/').split('/').pop();if(meaningful.test(name))add(/^application-/i.test(name)?'configmap':name);}
    return out.slice(0,10);
  }
  const helpers={termsFor};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof el!=='function'||typeof api!=='function')return;

  const cache=new Map();
  async function lessonsFor(terms){
    const key=terms.join('|');if(!key)return {configured:true,lessons:[]};
    if(cache.has(key))return cache.get(key);
    const promise=api('/api/lessons?terms='+encodeURIComponent(key)).then(answer=>answer.lessons).catch(()=>({configured:false,lessons:[]}));
    cache.set(key,promise);setTimeout(()=>cache.delete(key),60000);return promise;
  }
  function render(list,box){
    for(const lesson of list){
      const card=el('article','lesson-card');
      const head=el('div','lesson-head');head.append(el('strong','',lesson.title),el('small','fleet-muted',` ${lesson.file} · ${lesson.modified}`));card.append(head);
      if(lesson.description)card.append(el('p','',lesson.description));
      for(const line of lesson.snippets||[])card.append(el('div','lesson-snippet',line));
      card.append(el('small','fleet-muted',t('Mentions: {words}',{words:(lesson.matched||[]).join(', ')})));
      box.append(card);
    }
  }
  const currentTerms=()=>{try{const data=state.workspace;if(!state.workspaceRepo||!data)return [];return termsFor({repo:state.workspaceRepo.name,branch:data.branch,files:(data.files||[]).map(file=>file.path)});}catch{return [];}};

  // ---- status bar: 💡 when notes mention what you are working on -----------------------------
  const pill=el('button','gd-lessons');pill.type='button';pill.hidden=true;
  const bar=document.getElementById('workspace-statusbar');(bar?.querySelector('.gd-status-live')||null)?.before(pill);if(!pill.isConnected)bar?.append(pill);
  let shownKey='';
  async function refresh(){
    const terms=currentTerms();const key=terms.join('|');if(key===shownKey)return;shownKey=key;
    const answer=await lessonsFor(terms);if(shownKey!==key)return;
    const count=answer?.lessons?.length||0;pill.hidden=!count;pill.textContent=`💡 ${count}`;
    pill.title=t('{count} note(s) mention this work: {words}',{count,words:terms.join(', ')});
    pill.onclick=()=>{if(typeof releaseDialog!=='function')return;const ui=releaseDialog(t('Lessons for this work'));ui.body.append(el('p','fleet-muted',t('From your notes that mention: {words}',{words:terms.join(', ')})));render(answer.lessons,ui.body);};
  }
  setInterval(()=>{void refresh();},4000);

  // ---- Push dialog: the same lessons before you push -------------------------------------------
  window.GitDeckLessons={...helpers,lessonsFor,render,currentTerms};

  // ---- Dashboard › Lessons: choose the folder, search notes ------------------------------------
  const F=window.GitDeckFleet;
  if(!F||!document.querySelector('.operations-tabs'))return;
  function build(panel){
    const bar=el('div','operations-toolbar');
    const folder=el('input','workflow-input');folder.placeholder=t('Notes folder: the full path of a folder of Markdown notes');folder.setAttribute('aria-label',t('Notes folder'));
    const save=el('button','',t('Save folder'));save.type='button';
    const find=el('input','workflow-input');find.type='search';find.placeholder=t('Words to look for, for example src- pom.xml configmap');find.setAttribute('aria-label',t('Words to look for'));
    const go=el('button','primary',t('Find lessons'));go.type='button';
    bar.append(folder,save,find,go);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('Notes you already keep (Markdown files in one folder) become reminders: the status bar shows 💡 when a note mentions the open repository, its family, its ticket or the kind of files you changed, and the Push dialog lists them. Notes are only read; lines that look like passwords or tokens are never shown.')),status,out);
    api('/api/prefs').then(answer=>{folder.value=answer?.prefs?.brainFolder||'';}).catch(()=>{});
    save.onclick=async()=>{try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'prefs-save',key:'brainFolder',value:folder.value.trim()})});cache.clear();shownKey='';status.textContent=t('Saved.');void refresh();}catch(error){status.textContent=error.message;}};
    go.onclick=async()=>{
      out.replaceChildren();const terms=find.value.split(/[\s,|]+/).filter(word=>word.length>=3);const use=terms.length?terms:currentTerms();
      const answer=await lessonsFor(use);
      if(!answer.configured){status.textContent=t('Choose the notes folder first.');return;}
      status.textContent=t('{count} note(s) mention: {words}',{count:answer.lessons.length,words:use.join(', ')});render(answer.lessons,out);
    };
    find.addEventListener('keydown',event=>{if(event.key==='Enter')go.click();});
  }
  F.addPanel('lessons',t('Lessons'),build);
})();
