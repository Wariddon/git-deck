'use strict';

const state = { repos: [], scanLocations: [], selected: null, mode: null, busy: false, activeJob: null, repoRefreshJob: null, repoCache: null, repoFilter: 'all', repoGroup: 'all', repoPage: 1, repoPageSize: 12, gitlabProjects: [], projectPage: 1, projectPageSize: 12, mrRepo: null, mrSource: '', mrRemote: 'origin', cloneName: '', workspaceRepo: null, workspace: null, workspaceTab: 'history', tagCreateOpen: false, tagTargetCommit: '', pendingCompare: null, selectedPatch: '', lastFetchAt: '', activity: [], commandIndex: 0, viewHistory: [], viewIndex: -1, initializing: true, launchPath: new URLSearchParams(location.search).get('path') || '', meta: loadMeta() };
let workspaceLoadVersion=0;
// Display-only, bounded session cache. Mutations still use the live Git endpoints.
const workspaceSnapshots=new Map();
try{const saved=JSON.parse(localStorage.getItem('git-deck-workspaces-v2')||'[]');for(const [key,value] of saved.slice(-6)){if(value?.data&&Array.isArray(value.data.files)&&Date.now()-value.checkedAt<7*86400000)workspaceSnapshots.set(key,value);}}catch{}
function persistWorkspaceSnapshots(){try{const values=[...workspaceSnapshots].slice(-6);const json=JSON.stringify(values);if(json.length<3000000)localStorage.setItem('git-deck-workspaces-v2',json);else localStorage.removeItem('git-deck-workspaces-v2');}catch{}}
let workspaceReadInFlight=null;
function rememberWorkspace(repo,data){
  const key=repoKey(repo);workspaceSnapshots.delete(key);
  workspaceSnapshots.set(key,{data,checkedAt:Date.now()});
  while(workspaceSnapshots.size>12)workspaceSnapshots.delete(workspaceSnapshots.keys().next().value);
  persistWorkspaceSnapshots();
}
function workspaceNeedsExtras(){return ['settings','tools','health'].includes(state.workspaceTab);}
function paintWorkspace(data){
  state.workspace=data;$('workspace-branch').textContent=`Current branch: ${data.branch||'detached HEAD'}`;
  renderSyncSummary(data.sync);renderWorkspaceStatus();renderWorkbenchTree(data);renderWorkspace();
}
let repoDetailRepo=null;
let repoDetailLoadVersion=0;
let lastViewSaveTimer=null;
const $ = (id) => document.getElementById(id);
document.querySelector('.grid').append($('workspace-backdrop'));

function setRepositoryPaneWidth(width,save=false){const grid=document.querySelector('.grid');const bounds=grid.getBoundingClientRect();const maximum=Math.max(240,bounds.width-540);const value=Math.round(Math.min(Math.max(width,240),maximum));const handle=$('pane-resizer');grid.style.setProperty('--repo-pane-width',`${value}px`);handle.setAttribute('aria-valuemin','240');handle.setAttribute('aria-valuemax',String(maximum));handle.setAttribute('aria-valuenow',String(value));handle.setAttribute('aria-valuetext',`${value} pixels`);if(save){try{localStorage.setItem('git-deck-pane-width',String(value));}catch{}}}

function initializePaneResizer(){const handle=$('pane-resizer');const grid=document.querySelector('.grid');let preferred=270;try{preferred=Number(localStorage.getItem('git-deck-pane-width'))||270;}catch{}setRepositoryPaneWidth(preferred);
  handle.addEventListener('pointerdown',(event)=>{if(window.innerWidth<=1100)return;event.preventDefault();handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-pane');});
  handle.addEventListener('pointermove',(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;preferred=event.clientX-grid.getBoundingClientRect().left;setRepositoryPaneWidth(preferred);});
  const finish=(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);handle.classList.remove('dragging');document.body.classList.remove('resizing-pane');preferred=parseFloat(getComputedStyle(grid).getPropertyValue('--repo-pane-width'))||preferred;setRepositoryPaneWidth(preferred,true);};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('dblclick',()=>{preferred=270;setRepositoryPaneWidth(preferred,true);});
  handle.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();preferred=event.key==='Home'?270:preferred+(event.key==='ArrowLeft'?-20:20);setRepositoryPaneWidth(preferred,true);});
  window.addEventListener('resize',()=>setRepositoryPaneWidth(preferred));
}

function initializeTreeResizer(){const handle=$('tree-resizer');const body=document.querySelector('.workbench-body');let preferred=220;try{preferred=Number(localStorage.getItem('git-deck-tree-width'))||220;}catch{}
  const set=(width,save=false)=>{const value=Math.round(Math.min(Math.max(width,180),360));body.style.setProperty('--tree-width',`${value}px`);handle.setAttribute('aria-valuemin','180');handle.setAttribute('aria-valuemax','360');handle.setAttribute('aria-valuenow',String(value));if(save){try{localStorage.setItem('git-deck-tree-width',String(value));}catch{}}};set(preferred);
  handle.addEventListener('pointerdown',(event)=>{event.preventDefault();handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-pane');});handle.addEventListener('pointermove',(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;preferred=event.clientX-body.getBoundingClientRect().left;set(preferred);});const finish=(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);handle.classList.remove('dragging');document.body.classList.remove('resizing-pane');set(preferred,true);};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('dblclick',()=>{preferred=220;set(preferred,true);});handle.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();preferred=event.key==='Home'?220:preferred+(event.key==='ArrowLeft'?-15:15);set(preferred,true);});
}

function initializeCommitDetailResizer(split,handle){const storageKey='git-deck-commit-files-width:'+repoKey(state.workspaceRepo);let preferred=280;try{preferred=Number(localStorage.getItem(storageKey))||280;}catch{}
  const set=(width,save=false)=>{const bounds=split.getBoundingClientRect();const maximum=Math.max(170,bounds.width-280);const value=Math.round(Math.min(Math.max(width,170),maximum));preferred=value;split.style.setProperty('--commit-files-width',`${value}px`);handle.setAttribute('aria-valuemin','170');handle.setAttribute('aria-valuemax',String(maximum));handle.setAttribute('aria-valuenow',String(value));handle.setAttribute('aria-valuetext',`${value} pixels`);if(save){try{localStorage.setItem(storageKey,String(value));}catch{}}};set(preferred);
  handle.addEventListener('pointerdown',(event)=>{if(window.innerWidth<=680)return;event.preventDefault();handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-pane');});
  handle.addEventListener('pointermove',(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;set(event.clientX-split.getBoundingClientRect().left);});
  const finish=(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);handle.classList.remove('dragging');document.body.classList.remove('resizing-pane');set(preferred,true);};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('dblclick',()=>set(280,true));
  handle.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();set(event.key==='Home'?280:preferred+(event.key==='ArrowLeft'?-20:20),true);});
}

function initializeHistorySplitResizer(layout,handle,viewKey){let preferred=260;const storageKey=`git-deck-history-graph-height:${viewKey}`;try{preferred=Number(localStorage.getItem(storageKey))||260;}catch{}
  const set=(height,save=false)=>{if(!layout.classList.contains('layout-stacked'))return;const bounds=layout.getBoundingClientRect();const maximum=Math.max(150,bounds.height-187);const value=Math.round(Math.min(Math.max(height,150),maximum));preferred=value;layout.style.setProperty('--history-graph-height',`${value}px`);handle.setAttribute('aria-valuemin','150');handle.setAttribute('aria-valuemax',String(maximum));handle.setAttribute('aria-valuenow',String(value));handle.setAttribute('aria-valuetext',`${value} pixels`);if(save){try{localStorage.setItem(storageKey,String(value));}catch{}}};
  requestAnimationFrame(()=>set(preferred));
  handle.addEventListener('pointerdown',(event)=>{if(!layout.classList.contains('layout-stacked')||window.innerWidth<=760)return;event.preventDefault();handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-rows');});
  handle.addEventListener('pointermove',(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;set(event.clientY-layout.getBoundingClientRect().top);});
  const finish=(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);handle.classList.remove('dragging');document.body.classList.remove('resizing-rows');set(preferred,true);};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('dblclick',()=>set(260,true));
  handle.addEventListener('keydown',(event)=>{if(!['ArrowUp','ArrowDown','Home'].includes(event.key)||!layout.classList.contains('layout-stacked'))return;event.preventDefault();set(event.key==='Home'?260:preferred+(event.key==='ArrowUp'?-20:20),true);});
}

function loadMeta() {
  try {
    const saved = JSON.parse(localStorage.getItem('git-deck-meta-v1') || '{}');
    return { favorites: saved.favorites || {}, recent: Array.isArray(saved.recent) ? saved.recent : [], tags: saved.tags || {}, openRepos: Array.isArray(saved.openRepos) ? saved.openRepos : [], lastRepo: typeof saved.lastRepo==='string'?saved.lastRepo:'', lastWorkspaceTab:['changes','history','compare','gitlab-inbox','github','search-history','rebase','conflicts','health','worktrees','patches','branches','stashes','tags','remotes','recovery','tools','settings'].includes(saved.lastWorkspaceTab)?saved.lastWorkspaceTab:'history', libraryPinned: saved.libraryPinned === true, compactRepos: saved.compactRepos !== false, pullStrategy: ['ff-only','rebase','merge'].includes(saved.pullStrategy)?saved.pullStrategy:'ff-only', theme:['system','light','dark','midnight'].includes(saved.theme)?saved.theme:'light', accentColor:/^#[0-9a-f]{6}$/i.test(saved.accentColor||'')?saved.accentColor:'#0969da', uiScale:[90,100,110,120].includes(Number(saved.uiScale))?Number(saved.uiScale):100, layoutPreset:['compact','comfortable','review'].includes(saved.layoutPreset)?saved.layoutPreset:'compact', autoFetchMinutes:[0,15,30,60].includes(Number(saved.autoFetchMinutes))?Number(saved.autoFetchMinutes):0, autoFetchScope:['open','favorites','all'].includes(saved.autoFetchScope)?saved.autoFetchScope:'open', notifyComplete:saved.notifyComplete===true, commitDrafts:saved.commitDrafts||{}, historyViews: saved.historyViews || {}, historyLayouts:saved.historyLayouts||{}, historyDensity:saved.historyDensity||{}, historyColumns:saved.historyColumns||{}, diffPreferences:{mode:saved.diffPreferences?.mode==='split'?'split':'unified',wrap:saved.diffPreferences?.wrap===true,fontVersion:[2,3].includes(saved.diffPreferences?.fontVersion)?saved.diffPreferences.fontVersion:1,fontSize:Math.min(20,Math.max(10,Number(saved.diffPreferences?.fontSize)||13))} };
  } catch { return { favorites: {}, recent: [], tags: {}, openRepos: [], lastRepo:'', lastWorkspaceTab:'history', libraryPinned: false, compactRepos: true, pullStrategy: 'ff-only', theme:'light', accentColor:'#0969da', uiScale:100, layoutPreset:'compact', autoFetchMinutes:0, autoFetchScope:'open', notifyComplete:false, commitDrafts:{}, historyViews: {}, historyLayouts:{}, historyDensity:{}, historyColumns:{}, diffPreferences:{mode:'unified',wrap:false,fontSize:9} }; }
}

function saveMeta() {
  try { localStorage.setItem('git-deck-meta-v1', JSON.stringify(state.meta)); } catch { setNotice('Could not save local preferences.'); }
}

const workspaceTabs=new Set(['changes','history','compare','gitlab-inbox','github','search-history','rebase','conflicts','health','worktrees','patches','branches','stashes','tags','remotes','recovery','tools','settings']);
function savedOpenRepoPaths(activeRepo=null){const paths=state.meta.openRepos.map((key)=>state.repos.find((repo)=>repoKey(repo)===key)?.path).filter(Boolean);if(activeRepo?.path&&!paths.some((path)=>path.toLowerCase()===activeRepo.path.toLowerCase()))paths.push(activeRepo.path);return paths;}
function saveLastView(repo,tab){if(!repo?.path||!workspaceTabs.has(tab))return;const openRepos=savedOpenRepoPaths(repo);try{localStorage.setItem('git-deck-last-view-v1',JSON.stringify({path:repo.path.toLowerCase(),tab,openRepos:openRepos.map((path)=>path.toLowerCase())}));}catch{}clearTimeout(lastViewSaveTimer);lastViewSaveTimer=setTimeout(()=>{lastViewSaveTimer=null;void api('/api/action',{method:'POST',body:JSON.stringify({action:'ui-state-save',path:repo.path,tab,openRepos})}).catch(()=>{});},120);}
function loadLastView(){try{const saved=JSON.parse(localStorage.getItem('git-deck-last-view-v1')||'{}');return {path:typeof saved.path==='string'?saved.path:'',tab:workspaceTabs.has(saved.tab)?saved.tab:'history',openRepos:Array.isArray(saved.openRepos)?saved.openRepos:state.meta.openRepos};}catch{return {path:'',tab:'history',openRepos:state.meta.openRepos};}}
async function loadPersistentView(){const local=loadLastView();try{const response=await api('/api/ui-state');const path=typeof response.view?.path==='string'?response.view.path.toLowerCase():'';const tab=workspaceTabs.has(response.view?.tab)?response.view.tab:'history';const remoteOpenRepos=Array.isArray(response.view?.openRepos)?response.view.openRepos:(typeof response.view?.openRepos==='string'?[response.view.openRepos]:null);let openRepos=remoteOpenRepos?remoteOpenRepos.map((item)=>String(item).toLowerCase()):local.openRepos;if(path&&Number(response.view?.schemaVersion||1)<2)openRepos=[...new Set([...(local.openRepos||[]),...openRepos])];return path||openRepos.length?{path,tab,openRepos}:local;}catch{return local;}}
function clearLastView(){clearTimeout(lastViewSaveTimer);lastViewSaveTimer=null;try{localStorage.removeItem('git-deck-last-view-v1');}catch{}void api('/api/action',{method:'POST',body:JSON.stringify({action:'ui-state-clear'})}).catch(()=>{});}

let autoFetchTimer=null;
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
function accentContrast(hex){const value=hex.replace('#','');const rgb=[0,2,4].map(index=>parseInt(value.slice(index,index+2),16)/255).map(channel=>channel<=.03928?channel/12.92:((channel+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.43?'#122019':'#ffffff';}
function applyAppearance(){const selected=state.meta.theme;const resolved=selected==='system'?(systemTheme.matches?'dark':'light'):selected;document.body.classList.toggle('theme-dark',resolved==='dark'||resolved==='midnight');document.body.classList.toggle('theme-midnight',resolved==='midnight');document.body.dataset.theme=selected;document.body.dataset.layout=state.meta.layoutPreset;document.body.style.zoom='';document.documentElement.style.setProperty('--ui-scale',String(state.meta.uiScale/100));document.documentElement.style.colorScheme=resolved==='light'?'light':'dark';document.documentElement.style.setProperty('--green',state.meta.accentColor);document.documentElement.style.setProperty('--accent-contrast',accentContrast(state.meta.accentColor));document.querySelectorAll('[data-theme-choice]').forEach(button=>{const active=button.dataset.themeChoice===selected;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});document.querySelectorAll('.theme-custom-color').forEach(input=>input.value=state.meta.accentColor);const icons={system:'◐',light:'☀',dark:'☾',midnight:'◆'};document.querySelectorAll('.theme-picker-icon').forEach(node=>node.textContent=icons[selected]||'◐');scheduleAutoFetch();}
function setTheme(theme){if(!['system','light','dark','midnight'].includes(theme))return;state.meta.theme=theme;saveMeta();applyAppearance();setNotice(`Theme: ${theme[0].toUpperCase()+theme.slice(1)}`);}
function setAccentColor(color){if(!/^#[0-9a-f]{6}$/i.test(color))return;state.meta.accentColor=color;saveMeta();applyAppearance();setNotice(`Accent color: ${color.toUpperCase()}`);}
systemTheme.addEventListener?.('change',()=>{if(state.meta.theme==='system')applyAppearance();});
function smartFetchRepos(){const valid=state.repos.filter((repo)=>repo.valid&&!repo.pending&&repo.remote);if(state.meta.autoFetchScope==='favorites')return valid.filter(isFavorite);if(state.meta.autoFetchScope==='all')return valid;const open=new Set(state.meta.openRepos);return valid.filter((repo)=>open.has(repoKey(repo)));}
async function runSmartFetch(interactive=false){const repos=smartFetchRepos();if(!repos.length){if(interactive)setNotice('Smart Fetch: no repositories with remotes match this scope');return null;}if(interactive&&!confirm(`Fetch ${repos.length} repositories in the Smart Fetch scope?\nThis does not change working files`))return null;try{let result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'smart-fetch',repositories:repos.map((repo)=>repo.path)})});if(interactive){setBusy(true);showLoading('Running Smart Fetch…',`${repos.length} repositories`);}result=await resolveActionResult(result);state.lastFetchAt=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});await refreshRepositoryStatuses(false);if(interactive){setNotice(result.message);setOutput(result.output||result.message);}return result;}catch(error){setNotice(error.message);if(interactive)setOutput(error.message,{status:'error'});return null;}finally{if(interactive){setBusy(false);hideLoading();}}}
function scheduleAutoFetch(){clearInterval(autoFetchTimer);autoFetchTimer=null;const minutes=Number(state.meta.autoFetchMinutes)||0;if(!minutes)return;autoFetchTimer=setInterval(()=>{if(!state.busy&&!state.activeJob)void runSmartFetch(false);},minutes*60000);}
function notifyComplete(title,body){if(!state.meta.notifyComplete||!('Notification' in window)||Notification.permission!=='granted')return;new Notification(title,{body});}

function canPinLibrary(){return window.innerWidth>1350;}
function updateLibraryPinButton(){const pinned=state.meta.libraryPinned&&canPinLibrary();const button=$('library-pin');button.classList.toggle('active',pinned);button.setAttribute('aria-pressed',String(pinned));button.textContent=pinned?'Pinned':'Pin';button.title=canPinLibrary()?(pinned?'Unpin Repositories':'Keep Repositories open'):'Pin is available on wide screens';button.disabled=!canPinLibrary();const opener=$('library-open');opener.classList.toggle('active',pinned);opener.textContent=pinned?'📌 Repositories':'☰ Repositories';}
function setLibraryPinned(value){state.meta.libraryPinned=Boolean(value);saveMeta();updateLibraryPinButton();if(state.meta.libraryPinned&&canPinLibrary())document.body.classList.remove('library-collapsed');}
function setFocusWorkbench(value){document.body.classList.toggle('focus-workbench',Boolean(value));const button=$('focus-workbench');button.classList.toggle('active',Boolean(value));button.setAttribute('aria-pressed',String(Boolean(value)));button.textContent=value?'⛶ Exit focus':'⛶ Focus';button.title=value?'Show Git navigator again':'Hide Git navigator and focus on the current view';}
function updateRepositoryDensity(renderList=false){const compact=state.meta.compactRepos!==false;state.repoPageSize=compact?16:12;document.querySelector('.repos').classList.toggle('compact-repos',compact);const button=$('repo-density');button.classList.toggle('active',compact);button.setAttribute('aria-pressed',String(compact));button.textContent=compact?'Compact':'Detail';button.title=compact?'Compact rows are on · click for details':'Detailed rows are on · click for compact rows';if(renderList&&state.repos.length){state.repoPage=1;render();}}
function toggleRepositoryDensity(){state.meta.compactRepos=state.meta.compactRepos===false;saveMeta();updateRepositoryDensity(true);}

function repoKey(repo) { return repo.path.toLowerCase(); }
function isFavorite(repo) { return Boolean(state.meta.favorites[repoKey(repo)]); }
function repoTags(repo) { return state.meta.tags[repoKey(repo)] || []; }
function isRecent(repo) { return state.meta.recent.includes(repoKey(repo)); }

function touchRecent(repo) {
  const key = repoKey(repo);
  state.meta.recent = [key, ...state.meta.recent.filter((item) => item !== key)].slice(0, 12);
  saveMeta();
}

function rememberOpenRepo(repo){const key=repoKey(repo);if(!state.meta.openRepos.includes(key))state.meta.openRepos=[...state.meta.openRepos,key];saveMeta();}

function renderRepoTabs(){
  const tabs=$('repo-tabs');tabs.replaceChildren();
  const repos=state.meta.openRepos.map((key)=>state.repos.find((repo)=>repoKey(repo)===key)).filter(Boolean);state.meta.openRepos=repos.map(repoKey);
  repos.filter(repo=>repoKey(repo)===(state.workspaceRepo?repoKey(state.workspaceRepo):'')||repos.filter(isFavorite).slice(0,11).includes(repo)).forEach((repo)=>{const tab=el('span',`repo-tab ${state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo)?'active':''}`);tab.dataset.repoKey=repoKey(repo);const open=el('button','repo-tab-open',repo.name);open.type='button';open.title=repo.path;open.addEventListener('click',()=>openWorkspace(repo,state.workspaceTab||'history',null));const close=el('button','repo-tab-close','×');close.type='button';close.setAttribute('aria-label',`Close ${repo.name} tab`);close.addEventListener('click',(event)=>{event.stopPropagation();const key=repoKey(repo);state.meta.openRepos=state.meta.openRepos.filter((item)=>item!==key);saveMeta();if(state.workspaceRepo&&repoKey(state.workspaceRepo)===key){const next=state.meta.openRepos.map((item)=>state.repos.find((entry)=>repoKey(entry)===item)).filter(Boolean).pop();if(next)openWorkspace(next,state.workspaceTab||'history',null);else{state.meta.lastRepo='';clearLastView();saveMeta();closeWorkspace();}}else{renderRepoTabs();if(state.workspaceRepo)saveLastView(state.workspaceRepo,state.workspaceTab||'history');}});tab.append(open,close);tabs.append(tab);});
  const search=el('button','repo-tab-search',`Repos · ${repos.length}`);search.type='button';search.title='Find or switch repository (Ctrl+P)';search.setAttribute('aria-label','Find or switch repository');search.addEventListener('click',showRepoSwitcher);
  const add=el('button','repo-tab-add','＋');add.type='button';add.title='Show repository library';add.addEventListener('click',()=>document.body.classList.remove('library-collapsed'));
  tabs.append(search,add);if(!$('repo-switcher').classList.contains('hidden'))renderRepoSwitcher();
}

let repoSwitcherIndex=0,repoSwitcherPage=0,repoSwitcherScope='all';
function appendSearchHighlight(node,value,term){
  const text=String(value||''),words=term.toLowerCase().split(/\s+/).filter(Boolean);let offset=0;
  while(offset<text.length){let at=text.length,word='';for(const candidate of words){const index=text.toLowerCase().indexOf(candidate,offset);if(index>=0&&(index<at||(index===at&&candidate.length>word.length))){at=index;word=candidate;}}if(at>offset)node.append(document.createTextNode(text.slice(offset,at)));if(!word)break;node.append(el('mark','search-match',text.slice(at,at+word.length)));offset=at+word.length;}
  return node;
}
function repoSwitcherCandidates(){
  const term=$('repo-switcher-search').value.trim();const openOrder=new Map(state.meta.openRepos.map((key,index)=>[key,index]));const recentOrder=new Map(state.meta.recent.map((key,index)=>[key,index]));
  return state.repos.filter((repo)=>!term||matchesSearch(`${repo.name} ${repo.path} ${repo.branch||''} ${repo.remote||''}`,term,repoTags(repo))).sort((a,b)=>{const ak=repoKey(a),bk=repoKey(b),ao=openOrder.has(ak),bo=openOrder.has(bk);if(ao!==bo)return ao?-1:1;if(ao&&bo)return openOrder.get(ak)-openOrder.get(bk);const ar=recentOrder.has(ak),br=recentOrder.has(bk);if(ar!==br)return ar?-1:1;if(ar&&br)return recentOrder.get(ak)-recentOrder.get(bk);return a.name.localeCompare(b.name);});
}
function renderRepoSwitcher(){
  const list=$('repo-switcher-list'),term=$('repo-switcher-search').value.trim().toLowerCase();
  $('repo-switcher-search').placeholder='Search repos, branches, tags…';$('repo-switcher-search').setAttribute('aria-label','Search repos, branches and tags');
  const refs=state.workspace?[...(state.workspace.branches||[]).map(b=>({name:b.name,kind:'Branch',ref:b.name})),...(state.workspace.remoteBranches||[]).map(b=>({name:b.name,kind:'Remote branch',ref:b.name})),...(state.workspace.tags||[]).map(name=>({name,kind:'Tag',ref:'refs/tags/'+name}))].filter(x=>!term||x.name.toLowerCase().includes(term)):[];
  const allEntries=[...repoSwitcherCandidates().map(repo=>({name:repo.name,kind:'Repository',detail:repo.path,run:()=>openWorkspace(repo,state.workspaceTab||'history',true)})),...refs.map(ref=>({...ref,detail:'View History · '+state.workspaceRepo.name,run:()=>viewRefHistory(ref.ref)}))];
  const groups=[['all','All'],['Repository','Repositories'],['Branch','Branches'],['Remote branch','Remote branches'],['Tag','Tags']];
  let filters=document.getElementById('repo-switcher-filters');if(!filters){filters=el('div','repo-switcher-filters');filters.id='repo-switcher-filters';filters.setAttribute('role','group');filters.setAttribute('aria-label','Search result type');list.before(filters);}filters.replaceChildren();
  for(const [value,label] of groups){const count=value==='all'?allEntries.length:allEntries.filter(item=>item.kind===value).length;const button=el('button','',`${label} · ${count}`);button.type='button';button.setAttribute('aria-pressed',String(value===repoSwitcherScope));button.onclick=()=>{repoSwitcherScope=value;repoSwitcherPage=0;repoSwitcherIndex=0;renderRepoSwitcher();};filters.append(button);}
  const filtered=allEntries.filter(item=>repoSwitcherScope==='all'||item.kind===repoSwitcherScope);
  const pageCount=Math.max(1,Math.ceil(filtered.length/40));repoSwitcherPage=Math.min(repoSwitcherPage,pageCount-1);const entries=filtered.slice(repoSwitcherPage*40,(repoSwitcherPage+1)*40);
  repoSwitcherIndex=Math.max(0,Math.min(repoSwitcherIndex,entries.length-1));list.replaceChildren();$('repo-switcher-count').textContent=entries.length+' results · refs from current repo';
  entries.forEach((item,index)=>{if(index===0||entries[index-1].kind!==item.kind){const heading=el('div','repo-switcher-group',groups.find(group=>group[0]===item.kind)?.[1]||item.kind);heading.setAttribute('role','presentation');list.append(heading);}const button=el('button','repo-switcher-item '+(index===repoSwitcherIndex?'active':''));button.type='button';button.title=`${item.name}\n${item.detail}`;button.setAttribute('role','option');button.setAttribute('aria-label',`${item.kind}: ${item.name}. ${item.detail}`);button.setAttribute('aria-selected',String(index===repoSwitcherIndex));const text=el('span','repo-switcher-text');text.append(appendSearchHighlight(el('strong'),item.name,term),appendSearchHighlight(el('small'),item.detail,term));button.append(text,el('small','',item.kind));button.onclick=()=>{hideRepoSwitcher();item.run();};list.append(button);});
  $('repo-switcher-count').textContent=`${filtered.length} results · Page ${repoSwitcherPage+1}/${pageCount}`;
  if(pageCount>1){const pager=el('div','ref-filter-tabs');for(const [label,delta] of [['Previous',-1],['Next',1]]){const button=el('button','',label);button.type='button';button.disabled=repoSwitcherPage+delta<0||repoSwitcherPage+delta>=pageCount;button.onclick=()=>{repoSwitcherPage+=delta;repoSwitcherIndex=0;renderRepoSwitcher();list.scrollTop=0;};pager.append(button);}list.append(pager);}
  if(!entries.length)list.append(el('p','repo-switcher-empty','No matches in this category. Try All or a different search. Branches and tags are from the current repository.'));
}
function showRepoSwitcher(){repoSwitcherIndex=0;$('repo-switcher').classList.remove('hidden');renderRepoSwitcher();requestAnimationFrame(()=>{$('repo-switcher-search').focus();$('repo-switcher-search').select();});}
function hideRepoSwitcher(){$('repo-switcher').classList.add('hidden');}

function updateViewNavigation(){const back=$('view-back'),forward=$('view-forward');if(back)back.disabled=state.viewIndex<=0;if(forward)forward.disabled=state.viewIndex<0||state.viewIndex>=state.viewHistory.length-1;}
function selectWorkspaceTab(tab,record=true){state.workspaceTab=tab;state.meta.lastWorkspaceTab=tab;if(state.workspaceRepo){state.meta.lastRepo=repoKey(state.workspaceRepo);saveLastView(state.workspaceRepo,tab);}saveMeta();if(record){const key=`${state.workspaceRepo?.path||''}|${tab}`;if(state.viewHistory[state.viewIndex]!==key){state.viewHistory=state.viewHistory.slice(0,state.viewIndex+1);state.viewHistory.push(key);state.viewIndex=state.viewHistory.length-1;}}updateViewNavigation();syncWorkspaceTabButtons(tab);renderWorkspace();}
// Top tabs and the File Status / History switcher must always agree with the open view.
function syncWorkspaceTabButtons(tab){document.querySelectorAll('#workspace-tabs button').forEach((item)=>item.classList.toggle('active',item.dataset.workspaceTab===tab));document.querySelectorAll('[data-tree-view]').forEach((item)=>{const active=item.dataset.treeView===tab;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});}
function moveViewHistory(delta){const next=state.viewIndex+delta;if(next<0||next>=state.viewHistory.length)return;state.viewIndex=next;const [path,tab]=state.viewHistory[next].split('|');const repo=state.repos.find(item=>item.path===path);if(repo&&(!state.workspaceRepo||state.workspaceRepo.path!==path))openWorkspace(repo,tab,null,false);else selectWorkspaceTab(tab,false);updateViewNavigation();}
function openTagCreator(commit=''){state.tagCreateOpen=true;state.tagTargetCommit=commit;selectWorkspaceTab('tags');setTimeout(()=>showTagDialog(commit),0);}

let activeTreeRepo='';
function historyMemory(repo=state.workspaceRepo){
  const key='git-deck-history-position:'+repoKey(repo);
  let value={};try{value=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  return {value,save(update){Object.assign(value,update);try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
}
function viewRefHistory(name){
  const key=repoKey(state.workspaceRepo);state.meta.historyViews[key]={...(state.meta.historyViews[key]||{}),scope:'ref:'+name};saveMeta();selectWorkspaceTab('history');
}
function refMenuButton(items,label){
  const button=el('button','ref-more','⋯');button.type='button';button.title=label;button.setAttribute('aria-label',label);
  button.onclick=event=>{const rect=button.getBoundingClientRect();showContextMenu({preventDefault(){event.preventDefault();},stopPropagation(){event.stopPropagation();},clientX:rect.left,clientY:rect.bottom},items());};return button;
}
function renderHistoryContext(data){
  const bar=el('div','history-context');bar.setAttribute('role','status');
  const scope=state.meta.historyViews[repoKey(state.workspaceRepo)]?.scope||'all';
  const labels=el('span','history-context-labels');labels.append(el('span','working-context',`Working on: ${data.branch||'Detached HEAD'}`),el('span','viewing-context',`Viewing: ${scope==='all'?'All branches':scope==='current'?data.branch:scope.slice(4)}`));labels.title='History selection is view-only. Use Checkout to change your working branch.';bar.append(labels);
  const current=el('button','','Show current');current.type='button';current.onclick=()=>viewRefHistory(data.branch||'HEAD');bar.append(current);
  if(data.previousBranch&&data.previousBranch!==data.branch&&(data.branches||[]).some(b=>b.name===data.previousBranch)){
    const back=el('button','',`Return to ${data.previousBranch}`);back.type='button';back.title='Checkout after checking pending changes and confirming';back.onclick=()=>runWorkspaceAction('branch-switch',{branch:data.previousBranch},`Checkout and return to ${data.previousBranch}?\nPending changes will be checked again before switching branches`);bar.append(back);
  }
  return bar;
}
function renderWorkbenchTree(data){
  const content=$('tree-content'),key=repoKey(state.workspaceRepo),storageKey='git-deck-ref-tree:'+key;
  const changedRepo=activeTreeRepo!==key;activeTreeRepo=key;
  const input=$('tree-search');input.placeholder='Search branch, tag, stash…';input.setAttribute('aria-label','Search branch, tag or stash');
  content.replaceChildren();
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
  if(changedRepo)input.value=typeof saved.search==='string'?saved.search:'';
  const term=input.value.trim().toLowerCase();saved.search=input.value;
  const pins=new Set(Array.isArray(saved.pins)?saved.pins:[]),folds=Object.assign(Object.create(null),saved.folds&&typeof saved.folds==='object'?saved.folds:{});
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify({...saved,pins:[...pins],folds}));}catch{}};
  save();
  const matches=value=>!term||String(value).toLowerCase().includes(term);
  const section=(id,title,count,defaultOpen=false)=>{
    const box=el('details','ref-section');box.open=term?true:(folds[id]??defaultOpen);
    const head=el('summary');head.append(el('span','',title),el('small','',String(count)));box.append(head);
    box.addEventListener('toggle',()=>{if(!term&&box.isConnected){folds[id]=box.open;save();}});return box;
  };
  const top=el('div','ref-tree-options'),emptyLabel=el('label'),empty=document.createElement('input');empty.type='checkbox';empty.checked=saved.showEmpty===true;
  emptyLabel.append(empty,document.createTextNode('Show empty groups'));empty.onchange=()=>{saved.showEmpty=empty.checked;save();renderWorkbenchTree(data);};top.append(emptyLabel);content.append(top);
  const filter=['home','all','pinned','recent'].includes(saved.filter)?saved.filter:'home';
  const recent=Array.isArray(saved.recent)?saved.recent.filter(id=>typeof id==='string').slice(0,20):[];
  const filters=el('div','ref-filter-tabs');filters.setAttribute('aria-label','Branch filters');
  for(const [id,label] of [['home','Overview'],['all','All'],['pinned','Pinned'],['recent','Recent']]){const button=el('button','',label);button.type='button';button.setAttribute('aria-pressed',String(filter===id));button.onclick=()=>{saved.filter=id;save();renderWorkbenchTree(data);};filters.append(button);}content.prepend(filters);
  const currentCard=el('section','ref-current-card');currentCard.append(el('small','','Current'),el('strong','',data.branch||'Detached HEAD'));
  const sync=data.sync||{};currentCard.append(el('small','',[(sync.ahead>0?`Outgoing ${sync.ahead} commits`:''),(sync.behind>0?`Behind ${sync.behind} commits`:'')].filter(Boolean).join(' · ')||'Up to date with the known tracking ref'));currentCard.title='Based on local tracking refs, not a live remote check';content.prepend(currentCard);
  let resultCount=0;
  const selectionUpdates=[];
  const openHistory=(name,kind='local')=>{
    saved.recent=[kind+':'+name,...recent.filter(id=>id!==kind+':'+name)].slice(0,20);save();
    state.meta.historyViews[key]={...(state.meta.historyViews[key]||{}),scope:'ref:'+name};
    saveMeta();
    // Keep the clicked DOM node alive through both clicks of a native double-click.
    preserveBranchTree=true;
    try{selectWorkspaceTab('history');}finally{preserveBranchTree=false;}
    selectionUpdates.forEach(update=>update());
  };
  const branchRow=(branch,kind,label=branch.name)=>{
    const id=kind+':'+branch.name,row=el('div','ref-branch-row');
    const viewing=state.workspaceTab==='history'&&state.meta.historyViews[key]?.scope==='ref:'+branch.name;
    row.classList.toggle('viewing',viewing);
    const view=el('button','ref-view');view.type='button';view.title=branch.name+' · Click: History · Double-click: Checkout';
    view.setAttribute('aria-label',branch.name);
    view.append(el('span','ref-name',label));if(branch.current)view.append(el('small','ref-current','● Current'));
    const viewed=el('small','ref-viewed','Viewing');viewed.hidden=!viewing;view.append(viewed);
    selectionUpdates.push(()=>{const selected=state.meta.historyViews[key]?.scope==='ref:'+branch.name;row.classList.toggle('viewing',selected);viewed.hidden=!selected;});
    if(branch.upstream){
      const sync=branch.current&&!Object.hasOwn(branch,'ahead')?data.sync:branch;
      if(Number.isFinite(sync?.ahead)&&Number.isFinite(sync?.behind)){
        const badge=el('small','ref-sync',[sync.ahead>0?'↑'+sync.ahead:'',sync.behind>0?'↓'+sync.behind:''].filter(Boolean).join(' '));badge.title='Based on local tracking refs, not a live remote check · '+branch.upstream;if((sync.ahead>0||sync.behind>0)&&!branch.current)view.append(badge);
      }
    }
    view.onclick=event=>{if(repoKey(state.workspaceRepo)!==key||state.busy)return;if((event?.detail||0)<2)openHistory(branch.name,kind);};
    view.ondblclick=event=>{
      event.preventDefault();event.stopPropagation();
      if(repoKey(state.workspaceRepo)!==key||state.busy||branch.current||(kind==='local'&&state.workspace?.branch===branch.name))return;
      runWorkspaceAction(kind==='remote'?'branch-track':'branch-switch',{branch:branch.name},`Checkout ${branch.name}?`);
    };
    const pin=el('button','ref-pin',pins.has(id)?'★':'☆');pin.type='button';pin.title=(pins.has(id)?'Unpin ':'Pin ')+branch.name;pin.setAttribute('aria-label',pin.title);
    const togglePin=()=>{pins.has(id)?pins.delete(id):pins.add(id);save();renderWorkbenchTree(data);};pin.onclick=togglePin;
    row.append(view,pin,refMenuButton(()=>[{label:'View History',run:()=>openHistory(branch.name)},...branchContextItems(data,branch,kind)],'Actions for '+branch.name));row.addEventListener('contextmenu',event=>showContextMenu(event,[
      {label:'View History',run:()=>openHistory(branch.name)},
      {label:pins.has(id)?'Unpin branch':'Pin branch',run:togglePin},
      {separator:true},...branchContextItems(data,branch,kind)
    ]));return row;
  };
  const grouped=(parent,items,kind,prefix='',id=kind)=>{
    const folders=new Map();
    for(const branch of items){const rest=branch.name.slice(prefix.length),cut=rest.indexOf('/');
      if(cut<0)parent.append(branchRow(branch,kind,rest));
      else{const folder=rest.slice(0,cut+1);if(!folders.has(folder))folders.set(folder,[]);folders.get(folder).push(branch);}
    }
    for(const [folder,children] of folders){const box=section(id+'/'+prefix+folder,folder,children.length,true);grouped(box,children,kind,prefix+folder,id);parent.append(box);}
  };
  if(filter==='home'&&!term){
    const entries=[...(data.branches||[]).map(b=>({b,kind:'local'})),...(data.remoteBranches||[]).map(b=>({b,kind:'remote'}))];
    const pinned=entries.filter(({b,kind})=>pins.has(kind+':'+b.name));
    const pinBox=section('home-pins','Pinned',pinned.length,true);pinned.slice(0,10).forEach(({b,kind})=>pinBox.append(branchRow(b,kind)));if(pinned.length)content.append(pinBox);
    const last=recent.map(id=>entries.find(({b,kind})=>kind+':'+b.name===id)).filter(Boolean).slice(0,5);
    const lastBox=section('home-recent','Recently viewed',last.length,true);last.forEach(({b,kind})=>lastBox.append(branchRow(b,kind)));if(last.length)content.append(lastBox);
    const all=el('button','ref-manage',`Show all · ${entries.length} branches`);all.type='button';all.onclick=()=>{saved.filter='all';save();renderWorkbenchTree(data);};content.append(all);return;
  }
  const accepts=(b,kind)=>matches(b.name)&&(['all','home'].includes(filter)||filter==='pinned'&&pins.has(kind+':'+b.name)||filter==='recent'&&recent.includes(kind+':'+b.name));
  const allRefs=[...(data.branches||[]).filter(b=>accepts(b,'local')).map(b=>'local:'+b.name),...(data.remoteBranches||[]).filter(b=>accepts(b,'remote')).map(b=>'remote:'+b.name),...(data.tags||[]).filter(matches).map(t=>'tag:'+t),...(data.stashes||[]).filter(s=>matches(s.ref+' '+s.message)).map(s=>'stash:'+s.ref)];
  const pageKey=filter+'|'+term;if(saved.pageKey!==pageKey){saved.pageKey=pageKey;saved.page=0;}
  const pages=Math.max(1,Math.ceil(allRefs.length/80)),page=Math.min(Math.max(0,Number(saved.page)||0),pages-1),visibleIds=new Set(allRefs.slice(page*80,(page+1)*80)),paged=['home','all'].includes(filter);
  if(paged&&pages>1){const pager=el('div','ref-filter-tabs');for(const [label,delta] of [['‹',-1],[`${page+1}/${pages} ›`,1]]){const button=el('button','',label);button.type='button';button.disabled=page+delta<0||page+delta>=pages;button.onclick=()=>{saved.page=page+delta;save();renderWorkbenchTree(data);};pager.append(button);}content.append(pager);}
  const local=(data.branches||[]).filter(b=>accepts(b,'local')&&(!paged||visibleIds.has('local:'+b.name))),remote=(data.remoteBranches||[]).filter(b=>accepts(b,'remote')&&(!paged||visibleIds.has('remote:'+b.name)));
  if(filter==='recent'){const box=section('recent','Recently viewed',local.length+remote.length,true);recent.forEach(id=>{const kind=id.startsWith('remote:')?'remote':'local';const branch=(kind==='remote'?remote:local).find(b=>kind+':'+b.name===id);if(branch)box.append(branchRow(branch,kind));});content.append(box);if(!local.length&&!remote.length)box.append(el('p','ref-empty','No recently viewed branches match your search'));return;}
  const pinned=[...local.map(b=>({b,kind:'local'})),...remote.map(b=>({b,kind:'remote'}))].filter(({b,kind})=>pins.has(kind+':'+b.name));
  if(pinned.length){const box=section('pinned','PINNED',pinned.length,true);pinned.forEach(({b,kind})=>box.append(branchRow(b,kind)));content.append(box);}
  if(filter==='pinned'){if(!pinned.length)content.append(el('p','ref-empty','No pinned branches match your search. Use the star or context menu to pin one.'));return;}
  const branches=section('local','BRANCHES',local.length,true);grouped(branches,local.filter(b=>!pins.has('local:'+b.name)),'local');if(local.length||saved.showEmpty)content.append(branches);resultCount+=local.length;
  const remoteNames=[...new Set([...(data.remotes||[]).map(r=>r.name),...(data.remoteBranches||[]).map(b=>b.name.split('/')[0])])];
  const remotes=section('remotes','REMOTES',remote.length);
  for(const name of remoteNames){
    const all=remote.filter(b=>b.name.startsWith(name+'/'));if(term&&!all.length&&!matches(name))continue;
    const box=section('remote:'+name,name,all.length);const manage=el('button','ref-manage','Manage remote URL…');manage.type='button';manage.onclick=()=>selectWorkspaceTab('remotes');box.append(manage);
    grouped(box,all.filter(b=>!pins.has('remote:'+b.name)),'remote',name+'/','remote:'+name);remotes.append(box);
  }
  if(remote.length||(!term&&remoteNames.length)||saved.showEmpty)content.append(remotes);resultCount+=remote.length;
  const tags=(data.tags||[]).filter(t=>matches(t)&&(!paged||visibleIds.has('tag:'+t))),tagBox=section('tags','TAGS',tags.length);
  tags.forEach(tag=>{const detail=(data.tagDetails||[]).find(t=>t.name===tag)||{name:tag,hash:''};const button=el('button','ref-simple',tag);button.type='button';button.title=tag;button.onclick=()=>showTagDetails(detail);button.oncontextmenu=event=>showContextMenu(event,tagContextItems(data,detail));const row=el('div','ref-branch-row');row.append(button,refMenuButton(()=>tagContextItems(data,detail),'Actions for tag '+tag));tagBox.append(row);});
  if(tags.length||saved.showEmpty)content.append(tagBox);resultCount+=tags.length;
  const stashes=(data.stashes||[]).filter(s=>matches(s.ref+' '+s.message)&&(!paged||visibleIds.has('stash:'+s.ref))),stashBox=section('stashes','STASHES',stashes.length);
  stashes.forEach(stash=>{const button=el('button','ref-simple',stash.ref+' · '+stash.message);button.type='button';button.title=stash.message;button.onclick=()=>selectWorkspaceTab('stashes');stashBox.append(button);});
  if(stashes.length||saved.showEmpty)content.append(stashBox);resultCount+=stashes.length;
  if(term)top.append(el('span','ref-result-count',resultCount+' matches'));
  if(term&&!resultCount){content.append(el('p','ref-empty','No local Git matches. The remote may have newer data.'));const fetch=el('button','ref-manage','Fetch and search again');fetch.disabled=state.busy;fetch.onclick=()=>runWorkspaceAction('fetch',{},'Fetch remote data and search again?');content.append(fetch);}
  const hint=el('small','ref-help','Click: History · Double-click: Checkout · Right-click: actions · ↑↓ local tracking refs');content.append(hint);
}

async function api(path, options = {}) {
  // Never reuse a display snapshot across a write, including failed/partial writes.
  if(options.method&&options.method.toUpperCase()!=='GET'){
    let action='';try{action=JSON.parse(options.body||'{}').action;}catch{}
    if(!['ui-state-save','ui-state-clear'].includes(action)){workspaceSnapshots.clear();persistWorkspaceSnapshots();}
  }
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Git-Deck': '1', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(response.ok ? 'Local Git service returned an invalid response.' : `Local Git service error (${response.status}).`); }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setNotice(message) { $('notice').textContent = message;if(/\b(copied|saved|complete|completed)\b/i.test(message||'')&&!/\b(error|failed|not|cannot)\b/i.test(message||''))showActionFeedback(message); }
let feedbackTimer;
function showActionFeedback(message,{error=false,retry=null,context=''}={}){
  const id=error?'action-error-feedback':'action-success-feedback';document.getElementById(id)?.remove();
  const card=el('section','action-feedback '+(error?'feedback-error':'feedback-success'));card.id=id;card.setAttribute('role',error?'alert':'status');
  const text=String(message||'Done');card.append(el('strong','',error?'Action did not complete':'Done'),el('p','',text.split(/\r?\n/)[0].slice(0,180)));
  if(context)card.append(el('small','feedback-context',context));
  const actions=el('div','feedback-actions');const button=(label,run)=>{const b=el('button','',label);b.type='button';b.onclick=run;actions.append(b);return b;};
  if(error){const details=el('details');details.append(el('summary','','Details'),el('pre','',text));card.append(details);const copy=button('Copy',async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='Copied';}catch{copy.textContent='Select details to copy';}});if(retry)button('Retry',()=>{card.remove();retry();});}
  button('Dismiss',()=>card.remove());card.append(actions);let stack=document.getElementById('action-feedback-stack');if(!stack){stack=el('div','action-feedback-stack');stack.id='action-feedback-stack';stack.setAttribute('aria-label','Operation notifications');document.body.append(stack);}stack.append(card);
  if(!error){clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>card.remove(),3500);}
}
function actionContext(repo,data,payload={}){
  const lines=[`Repository: ${repo?.name||'Unknown'}`,`Folder: ${repo?.path||'Unknown'}`,`Working on: ${data?.branch||'Detached HEAD'}`];
  if(payload.remote)lines.push(`Remote: ${payload.remote}`);
  if(payload.branches?.length)lines.push('Destination: '+payload.branches.map(b=>`${b.local} → ${payload.remote||'remote'}/${b.remote||b.target}`).join(', '));
  else if(payload.branch)lines.push(`Selected branch: ${payload.branch}`);
  if(payload.commit)lines.push(`Commit: ${payload.commit}`);
  if(payload.tag)lines.push(`Tag: ${payload.tag}`);
  return lines.join('\n');
}
function setDisabledReason(button,disabled,reason){button.disabled=Boolean(disabled);button.title=disabled?reason:'';button.setAttribute('aria-description',disabled?reason:'');return button;}
function outputLooksImportant(message){return /error|failed|fatal|conflict|cancel|working|running|queued|loading|checking|reading|failed/i.test(message||'');}
function recordActivity(message,status='info'){const text=(message||'Done.').trim();state.activity.unshift({time:new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'}),text:text.split(/\r?\n/)[0],status});state.activity=state.activity.slice(0,40);}
function setOutput(message,options={}) { const text=message||'Done.';if(options.status==='error')showActionFeedback(text,{error:true});$('output').textContent=text;$('output-summary').textContent=text.split(/\r?\n/)[0].slice(0,100);recordActivity(text,options.status||'info');const expand=options.expand===true||outputLooksImportant(text);if(expand)$('console').classList.remove('collapsed');else if(options.collapse!==false)$('console').classList.add('collapsed');$('output-toggle').textContent=$('console').classList.contains('collapsed')?'⌃':'⌄';$('output-toggle').setAttribute('aria-label',$('console').classList.contains('collapsed')?'Expand output':'Collapse output');renderWorkspaceStatus(); }
function setBusy(value){state.busy=value;document.body.classList.toggle('git-operation-busy',value);renderWorkspaceStatus();}
function setJobControls(visible){$('job-cancel').classList.toggle('hidden',!visible);$('output-cancel').classList.toggle('hidden',!visible);$('job-cancel').disabled=false;$('output-cancel').disabled=false;}

// Fetch freshness from the repository's FETCH_HEAD time, so it survives restarts.
function fetchAgeText(iso,now=Date.now()){if(!iso)return 'Never fetched';const minutes=Math.max(0,Math.floor((now-Date.parse(iso))/60000));if(minutes<1)return 'Fetched just now';if(minutes<60)return `Fetched ${minutes} min ago`;const hours=Math.floor(minutes/60);if(hours<24)return `Fetched ${hours} h ago`;return `Fetched ${Math.floor(hours/24)} d ago`;}
function renderFetchStatus(data,now=Date.now()){const node=$('status-fetch');if(!node)return;const iso=data.lastFetchAt||'';const hasRemote=Boolean(data.remotes?.length);const stale=hasRemote&&(!iso||now-Date.parse(iso)>60*60*1000);node.textContent=hasRemote?fetchAgeText(iso,now)+(stale?' · Fetch now':''):'No remote';node.classList.toggle('status-stale',stale);node.disabled=!hasRemote;node.title=hasRemote?`${iso?`Last contact with a remote: ${new Date(iso).toLocaleString('en-US')}`:'This repository has never been fetched'}\nAhead/behind counts come from the last fetch. Click to fetch now.`:'This repository has no remote';}
function renderWorkspaceStatus(){const data=state.workspace||{};const sync=data.sync||{};const files=data.files||[];$('status-branch').textContent=data.branch||'Detached HEAD';$('status-changes').textContent=`${files.length} change${files.length===1?'':'s'}`;$('status-sync').textContent=`↑ ${sync.ahead||0} · ↓ ${sync.behind||0}`;$('status-remote').textContent=sync.upstream||data.remotes?.[0]?.name||'No remote';renderFetchStatus(data);$('status-job').textContent=state.activeJob?`${state.activeJob.action||'Git'} running…`:state.busy?'Working…':'Idle';}

async function trackJob(started){
  if(!started?.async||!started.jobId)return started;
  const jobId=started.jobId;state.activeJob={id:jobId,action:started.action||''};setJobControls(true);setNotice(started.message);setOutput(started.message);
  try{
    while(true){
      const job=await api(`/api/job?id=${encodeURIComponent(jobId)}`);const progress=Number.isFinite(Number(job.progress))?Number(job.progress):0;
      showLoading(job.message||'Git job is running…',`${progress}% complete · Other Git actions are paused to prevent duplicate operations`);
      setNotice(job.message||`Running ${job.action}…`);setOutput(job.output||`${job.message||'Working…'}\n\nProgress: ${progress}%`);
      if(job.state==='completed'){notifyComplete('Git Deck',job.message||`${job.action} completed`);return job;}
      if(job.state==='failed')throw new Error(job.output||job.message||'Git job failed.');
      if(job.state==='cancelled')throw new Error('Git job was cancelled.');
      await new Promise((resolve)=>setTimeout(resolve,750));
    }
  }finally{if(state.activeJob?.id===jobId)state.activeJob=null;setJobControls(false);}
}

async function resolveActionResult(result){return result?.async?trackJob(result):result;}
async function cancelActiveJob(){const job=state.activeJob;if(!job)return;$('job-cancel').disabled=true;$('output-cancel').disabled=true;try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'cancel-job',jobId:job.id})});setNotice(result.message);setOutput(result.message);}catch(error){setNotice(error.message);setOutput(error.message);}}

function showLoading(title, detail = '') {
  window.GitDeckStartup?.update(title);
  $('loading-title').textContent = title;
  $('loading-detail').textContent = detail;
  $('loading-banner').classList.remove('hidden');
  $('refresh').disabled = true;
  document.body.setAttribute('aria-busy','true');
}

function hideLoading() {
  $('loading-banner').classList.add('hidden');
  $('refresh').disabled = false;
  document.body.removeAttribute('aria-busy');
}

function renderSkeleton(containerId, count = 6) {
  const container=$(containerId); container.replaceChildren(); container.setAttribute('aria-busy','true');
  for(let index=0;index<count;index+=1){const row=el('div','skeleton-row');row.append(el('span','skeleton-icon'),el('span','skeleton-lines'),el('span','skeleton-badge'));container.append(row);}
}

function repositoryCacheLabel(data=state.repoCache){
  if(!data?.cachedAt)return 'saved repository list';
  const date=new Date(data.cachedAt);if(Number.isNaN(date.getTime()))return 'saved repository list';
  return `saved ${date.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
}

function applyRepositoryData(data){
  state.repoCache=data;state.repos=data.repos||[];state.scanLocations=data.scanLocations||[];renderRepoGroups();
  if(state.selected)state.selected=state.repos.find((repo)=>repo.path===state.selected.path)||null;
  let openInitial=false;
  if(!state.selected&&!state.workspaceRepo&&state.repos.length){const recent=state.meta.recent[0];state.selected=state.repos.find((repo)=>repoKey(repo)===recent)||state.repos[0];const index=state.repos.indexOf(state.selected);state.repoPage=Math.floor(index/state.repoPageSize)+1;openInitial=true;}
  renderRepoTabs();render();if(openInitial&&!state.initializing)void openWorkspace(state.selected,state.meta.lastWorkspaceTab||'history',true);
}

async function loadRepositoryCache(showIndicator=false){
  if(showIndicator)showLoading('Loading saved repositories…','Showing the list before checking all Git repositories');
  try{const data=await api('/api/repos');applyRepositoryData(data);setNotice(`${state.repos.length} repositories ready · ${repositoryCacheLabel(data)}`);return data;}
  catch(error){setNotice(error.message);setOutput(error.message);return null;}
  finally{$('repo-list').removeAttribute('aria-busy');if(showIndicator)hideLoading();}
}

async function refreshRepositoryStatuses(manual=false){
  if(state.repoRefreshJob)return;
  const button=$('refresh');const originalText=button.textContent;button.disabled=true;button.textContent='Refreshing…';
  try{
    const started=await api('/api/action',{method:'POST',body:JSON.stringify({action:'refresh-repos'})});
    state.repoRefreshJob=started.jobId;
    if(manual){state.activeJob={id:started.jobId,action:'refresh-repos'};setBusy(true);setJobControls(true);showLoading('Refreshing repository status…','Running in the background. You can cancel this operation.');}
    else setNotice(`${state.repos.length} repositories ready · Refreshing the cache in the background`);
    while(true){
      const job=await api(`/api/job?id=${encodeURIComponent(started.jobId)}`);
      if(manual){showLoading(job.message||'Checking repositories…',`${job.progress||0}% complete`);setNotice(job.message||'Refreshing repository status…');}
      if(job.state==='completed')break;
      if(job.state==='failed')throw new Error(job.output||job.message||'Repository refresh failed.');
      if(job.state==='cancelled')throw new Error('Repository refresh was cancelled.');
      await new Promise((resolve)=>setTimeout(resolve,900));
    }
    const data=await loadRepositoryCache(false);if(data)setNotice(`${state.repos.length} repositories ready · updated now`);
  }catch(error){setNotice(error.message);if(manual)setOutput(error.message);}
  finally{state.repoRefreshJob=null;if(state.activeJob?.action==='refresh-repos')state.activeJob=null;setJobControls(false);if(manual){setBusy(false);hideLoading();}button.disabled=false;button.textContent=originalText;}
}

async function refresh(force=false){
  if(force===true){await refreshRepositoryStatuses(true);return;}
  const data=await loadRepositoryCache(!state.repos.length);
  if(data?.stale)void refreshRepositoryStatuses(false);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function matchesSearch(value, term, tags = []) {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = value.toLowerCase();
  return words.every((word) => word.startsWith('tag:') ? tags.some((tag) => tag.toLowerCase().includes(word.slice(4))) : haystack.includes(word));
}

function matchesRepoFilter(repo) {
  if (state.repoFilter === 'favorite') return isFavorite(repo);
  if (state.repoFilter === 'recent') return isRecent(repo);
  if (state.repoFilter === 'dirty') return repo.valid && repo.changes > 0;
  if (state.repoFilter === 'clean') return repo.valid && repo.changes === 0;
  if (state.repoFilter === 'sync') return repo.valid && (repo.ahead > 0 || repo.behind > 0);
  if (state.repoFilter === 'missing') return !repo.valid;
  return true;
}

function matchesRepoGroup(repo) {
  if(state.repoGroup==='all')return true;
  const path=repo.path.toLowerCase();
  if(state.repoGroup==='other')return !state.scanLocations.some((root)=>path===root.toLowerCase()||path.startsWith(`${root.toLowerCase()}\\`));
  const root=state.repoGroup.toLowerCase();return path===root||path.startsWith(`${root}\\`);
}

function renderRepoGroups() {
  const select=$('repo-group');const current=state.scanLocations.some((path)=>path===state.repoGroup)||['all','other'].includes(state.repoGroup)?state.repoGroup:'all';state.repoGroup=current;select.replaceChildren();
  const all=el('option','','All scan locations');all.value='all';select.append(all);
  state.scanLocations.forEach((path)=>{const option=el('option','',path);option.value=path;select.append(option);});
  const other=el('option','','Other saved repositories');other.value='other';select.append(other);select.value=current;$('bulk-fetch').disabled=!state.scanLocations.includes(current);
}

function setRepoFilter(filter) {
  state.repoFilter = filter;
  state.repoPage = 1;
  document.querySelectorAll('#quick-filters button').forEach((item) => item.classList.toggle('active', item.dataset.filter === filter));
  render();
}

function renderPagination(containerId, page, totalPages, onChange) {
  const container=$(containerId); container.replaceChildren();
  container.classList.toggle('hidden',totalPages<=1);
  if(totalPages<=1)return;
  const previous=el('button','','‹ Previous'); previous.disabled=page===1; previous.addEventListener('click',()=>onChange(page-1));
  const label=el('span','',`Page ${page} of ${totalPages}`);
  const next=el('button','','Next ›'); next.disabled=page===totalPages; next.addEventListener('click',()=>onChange(page+1));
  container.append(previous,label,next);
}

function renderOverview() {
  $('stat-total').textContent = state.repos.length;
  $('stat-favorite').textContent = state.repos.filter(isFavorite).length;
  $('stat-changed').textContent = state.repos.filter((repo) => repo.valid && repo.changes > 0).length;
  $('stat-sync').textContent = state.repos.filter((repo) => repo.valid && (repo.ahead > 0 || repo.behind > 0)).length;
  $('stat-missing').textContent = state.repos.filter((repo) => !repo.valid).length;
  document.querySelectorAll('.repo-overview button').forEach((item) => item.classList.toggle('active', item.dataset.overviewFilter === state.repoFilter));
}

function fleetHealth(repo){if(!repo.valid)return {level:'bad',label:'Folder missing'};if(repo.pending)return {level:'warn',label:'Status not checked'};if(!repo.branch||repo.branch==='-')return {level:'bad',label:'Detached HEAD'};if(!repo.remote)return {level:'warn',label:'No remote'};if(Number(repo.changes)>0)return {level:'warn',label:`${repo.changes} working change${Number(repo.changes)===1?'':'s'}`};if(Number(repo.ahead)>0||Number(repo.behind)>0)return {level:'warn',label:`Sync ↑${repo.ahead||0} ↓${repo.behind||0}`};return {level:'good',label:'Healthy'};}
function renderFleetDashboard(){const table=$('fleet-table'),summary=$('fleet-summary');if(!table||!summary)return;const term=$('fleet-search').value.trim().toLowerCase(),filter=$('fleet-filter').value;const repos=state.repos.filter((repo)=>{const health=fleetHealth(repo);const matches=!term||`${repo.name} ${repo.path} ${repo.branch||''} ${repo.remote||''}`.toLowerCase().includes(term);const filtered=filter==='all'||(filter==='attention'&&health.level!=='good')||(filter==='changed'&&Number(repo.changes)>0)||(filter==='sync'&&(Number(repo.ahead)>0||Number(repo.behind)>0))||(filter==='missing'&&!repo.valid);return matches&&filtered;});const counts={total:state.repos.length,healthy:state.repos.filter((repo)=>fleetHealth(repo).level==='good').length,attention:state.repos.filter((repo)=>fleetHealth(repo).level!=='good').length,changed:state.repos.filter((repo)=>Number(repo.changes)>0).length,sync:state.repos.filter((repo)=>Number(repo.ahead)>0||Number(repo.behind)>0).length};summary.replaceChildren();[['total','Repositories'],['healthy','Healthy'],['attention','Need attention'],['changed','Working changes'],['sync','Ahead / behind']].forEach(([key,label])=>{const card=el('article');card.append(el('b','',String(counts[key])),el('small','',label));summary.append(card);});table.replaceChildren();const head=el('div','fleet-row fleet-head');['Repository','Branch','Changes','Sync','Health','Actions'].forEach((label)=>head.append(el('span','',label)));table.append(head);if(!repos.length){table.append(workspaceEmpty('No matching repositories','Try a different search or filter'));return;}repos.forEach((repo)=>{const health=fleetHealth(repo),row=el('section','fleet-row');const name=el('div','fleet-name');name.append(el('strong','',`${isFavorite(repo)?'★ ':''}${repo.name}`),el('small','',repo.path));const branch=el('code','fleet-branch',repo.branch||'-');const changes=el('span',Number(repo.changes)>0?'dirty':'clean',repo.pending?'…':String(repo.changes||0));const sync=el('span','fleet-sync',repo.pending?'…':`↑${repo.ahead||0} ↓${repo.behind||0}`);const healthCell=el('span',`fleet-health ${health.level}`);healthCell.append(el('i'),el('span','',health.label));const actions=el('div','fleet-actions');const open=el('button','primary','Open');open.addEventListener('click',async()=>{hideOperationsCenter();await openWorkspace(repo,'health',true);});const fetch=el('button','','Fetch');fetch.disabled=!repo.valid||!repo.remote;fetch.addEventListener('click',()=>runSingleFleetFetch(repo));const mr=el('button','','MR');mr.disabled=!repo.valid||!repo.remote;mr.addEventListener('click',async()=>{hideOperationsCenter();await openWorkspace(repo,'compare',true);showMrDialog(repo);});actions.append(open,fetch,mr);row.append(name,branch,changes,sync,healthCell,actions);table.append(row);});}
async function runSingleFleetFetch(repo){if(!confirm(`Fetch ${repo.name}?\nThis does not change working files`))return;setBusy(true);showLoading('Fetching…',repo.name);try{let result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'smart-fetch',repositories:[repo.path]})});result=await resolveActionResult(result);setNotice(result.message);setOutput(result.output||result.message);await refreshRepositoryStatuses(false);renderFleetDashboard();loadJobs();}catch(error){setNotice(error.message);setOutput(error.message,{status:'error'});}finally{setBusy(false);hideLoading();}}
async function loadJobs(){const list=$('jobs-list');if(!list)return;try{const response=await api('/api/jobs');const jobs=response.jobs||[];const active=jobs.filter((job)=>['queued','running'].includes(job.state));$('operations-job-count').textContent=String(active.length);list.replaceChildren();if(!jobs.length){list.append(workspaceEmpty('No background operations yet','Clone, fetch, refresh and maintenance jobs appear here'));return;}jobs.slice(0,30).forEach((job)=>{const row=el('section','job-row');row.append(el('code','',job.action||'git'),el('small','',job.path||'Git Deck'),el('small','',job.message||''));const progress=el('span','job-progress');const bar=el('i');bar.style.width=`${Math.max(0,Math.min(100,Number(job.progress)||0))}%`;progress.append(bar);const tail=el('div');tail.append(el('span',`job-state ${job.state}`,job.state));if(['queued','running'].includes(job.state)){const cancel=el('button','','Cancel');cancel.addEventListener('click',async()=>{if(!confirm(`Cancel ${job.action}?`))return;await api('/api/action',{method:'POST',body:JSON.stringify({action:'cancel-job',jobId:job.id})});loadJobs();});tail.append(cancel);}row.append(progress,tail);list.append(row);});}catch(error){list.replaceChildren(workspaceEmpty('Job queue unavailable',error.message));}}
async function loadIntegrationState(){const box=$('integration-state');try{const response=await api('/api/integration');const item=response.integration;box.textContent=item.installed?`✓ Explorer menu installed\n${item.exePath}`:item.exePresent?`GitDeck.exe Ready\nExplorer menu Not installed`:'GitDeck.exe not found. Build the application before installing the menu.';$('integration-install').disabled=!item.exePresent||item.installed;$('integration-remove').disabled=!item.installed;}catch(error){box.textContent=error.message;}}
async function runIntegrationAction(action){try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action})});setNotice(result.message);setOutput(result.output||result.message);await loadIntegrationState();}catch(error){setNotice(error.message);setOutput(error.message,{status:'error'});}}
function updateSmartFetchSummary(){const repos=smartFetchRepos();$('smart-fetch-summary').textContent=`Current scope: ${repos.length} repositories with remotes`;}
function switchOperationsView(view){document.querySelectorAll('[data-operations-view]').forEach((button)=>button.classList.toggle('active',button.dataset.operationsView===view));document.querySelectorAll('[data-operations-panel]').forEach((panel)=>panel.classList.toggle('hidden',panel.dataset.operationsPanel!==view));if(view==='fleet')renderFleetDashboard();else if(view==='jobs')loadJobs();else{loadIntegrationState();updateSmartFetchSummary();}}
function showOperationsCenter(view='fleet'){$('operations-backdrop').classList.remove('hidden');$('operations-fetch-interval').value=String(state.meta.autoFetchMinutes);$('operations-fetch-scope').value=state.meta.autoFetchScope;switchOperationsView(view);loadJobs();clearInterval(state.operationsTimer);state.operationsTimer=setInterval(()=>{if(!$('operations-backdrop').classList.contains('hidden'))loadJobs();},2000);}
function hideOperationsCenter(){$('operations-backdrop').classList.add('hidden');clearInterval(state.operationsTimer);state.operationsTimer=null;}

function renderScanLocations() {
  const list=$('scan-location-list');list.replaceChildren();$('scan-location-count').textContent=state.scanLocations.length;
  if(!state.scanLocations.length){list.append(el('p','scan-location-empty','No scan history. Click Scan to add a root folder.'));return;}
  state.scanLocations.forEach((path)=>{const row=el('div','scan-location-row');const label=el('code','',path);label.title=path;const actions=el('span','scan-location-actions');const rescan=el('button','','Rescan');rescan.type='button';rescan.addEventListener('click',()=>runScanLocation('scan',path));const forget=el('button','','×');forget.type='button';forget.title='Forget this scan location';forget.setAttribute('aria-label',`Forget scan location ${path}`);forget.addEventListener('click',()=>runScanLocation('forget-scan-location',path));actions.append(rescan,forget);row.append(label,actions);list.append(row);});
}

async function runScanLocation(action,path) {
  if(state.busy)return;
  if(action==='forget-scan-location'&&!confirm(`Remove “${path}” from Scan locations?\nSaved repositories will not be deleted`))return;
  if(action==='bulk-fetch'&&!confirm(`Fetch all saved repositories under “${path}”?\nThis does not change working files`))return;
  setBusy(true);showLoading(action==='scan'?'Scanning for Git repositories…':action==='bulk-fetch'?'Preparing bulk fetch…':'Updating scan locations…',path);
  try{let result=await api('/api/action',{method:'POST',body:JSON.stringify({action,path})});result=await resolveActionResult(result);setNotice(result.message);setOutput(result.output||result.message);await refresh();}
  catch(error){setNotice(error.message);setOutput(error.message);}
  finally{setBusy(false);hideLoading();}
}

function render() {
  const list = $('repo-list');
  list.replaceChildren();
  const term = $('search').value.trim().toLowerCase();
  const repos = state.repos.filter((repo) => matchesRepoGroup(repo) && matchesRepoFilter(repo) && (!term || matchesSearch(`${repo.name} ${repo.path} ${repo.remote || ''} ${repo.branch || ''} ${repo.lastCommit || ''} ${repoTags(repo).join(' ')} ${repo.valid ? 'valid' : 'missing'} ${repo.pending?'saved unchecked':repo.changes?'changed dirty':'clean'}`, term, repoTags(repo))));
  if (state.repoFilter === 'recent') repos.sort((a, b) => state.meta.recent.indexOf(repoKey(a)) - state.meta.recent.indexOf(repoKey(b)));
  const totalPages=Math.max(1,Math.ceil(repos.length/state.repoPageSize));
  state.repoPage=Math.min(state.repoPage,totalPages);
  const first=(state.repoPage-1)*state.repoPageSize;
  const visibleRepos=repos.slice(first,first+state.repoPageSize);
  $('search-clear').classList.toggle('hidden', !term);
  $('repo-search-clear').classList.toggle('hidden', !term);
  renderScanLocations();
  $('repo-summary').textContent = repos.length ? `Showing ${first+1}–${Math.min(first+state.repoPageSize,repos.length)} of ${repos.length}${term || state.repoFilter !== 'all' || state.repoGroup !== 'all' ? ` matching (${state.repos.length} total)` : ''}` : `0 of ${state.repos.length} repositories`;
  renderOverview();
  if (!repos.length) {
    const empty = el('div', 'empty');
    empty.append(el('strong', '', state.repos.length ? 'No matching repositories' : 'No repositories yet'), el('p', '', state.repos.length ? 'Try another search.' : 'Add an existing folder or clone a remote project.'));
    list.append(empty);
  }
  visibleRepos.forEach((repo) => {
    const row = el('button', `repo ${state.selected?.path === repo.path ? 'selected' : ''}`);
    const icon = el('span', `repo-icon ${repo.valid ? '' : 'invalid'}`, repo.name.slice(0, 1).toUpperCase());
    const main = el('span', 'repo-main');
    const repoName = el('strong', '', `${isFavorite(repo) ? '★ ' : ''}${repo.name}`);
    main.append(repoName, el('small', '', repo.path), el('em', '', repo.lastCommit));
    const tags = repoTags(repo);
    if (tags.length) { const tagList = el('span', 'repo-tags'); tags.forEach((tag) => tagList.append(el('i', '', tag))); main.append(tagList); }
    const meta = el('span', 'repo-meta');
    meta.append(el('b', '', `⑂ ${repo.branch || 'unknown'}`), el('i', repo.pending?'cached':repo.changes?'dirty':'clean', repo.pending?'Saved':repo.valid?(repo.changes?`${repo.changes} changed`:'Clean'):'Missing'));
    row.append(icon, main, meta);
    row.addEventListener('click', () => { state.selected = repo; touchRecent(repo); render(); openWorkspace(repo,state.workspaceTab); });
    row.addEventListener('contextmenu',(event)=>{state.selected=repo;render();showContextMenu(event,repositoryContextItems(repo));});
    list.append(row);
  });
  renderPagination('repo-pagination',state.repoPage,totalPages,(page)=>{state.repoPage=page;render();$('repo-list').scrollTop=0;});
  renderDetails();
}

function renderDetails() {
  const panel = $('details');
  panel.replaceChildren();
  const repo = state.selected;
  if (!repo) {
    const empty = el('div', 'empty detail-empty');
    empty.append(el('span', '', '⌘'), el('h2', '', 'Select a repository'), el('p', '', 'Choose a working copy to see its status and quick actions.'));
    panel.append(empty); return;
  }
  const heading = el('div', 'detail-head');
  const title = el('div'); title.append(el('p', '', 'SELECTED REPOSITORY'), el('h2', '', repo.name));
  const favorite = el('button', `detail-favorite ${isFavorite(repo) ? 'active' : ''}`, isFavorite(repo) ? '★' : '☆');
  favorite.title = isFavorite(repo) ? 'Remove from favorites' : 'Add to favorites';
  favorite.setAttribute('aria-label', favorite.title);
  favorite.addEventListener('click', () => { const key=repoKey(repo); if(isFavorite(repo)) delete state.meta.favorites[key]; else state.meta.favorites[key]=true; saveMeta(); render(); });
  heading.append(el('span', 'repo-icon large', repo.name.slice(0, 1).toUpperCase()), title, favorite);
  const facts = el('dl');
  [['Branch', repo.branch], ['Sync', `↑ ${repo.ahead}   ↓ ${repo.behind}`], ['Tags', repoTags(repo).join(', ') || 'No tags'], ['Remote', repo.remote || 'No origin']].forEach(([key, value]) => {
    const row = el('div'); row.append(el('dt', '', key), el('dd', '', value)); facts.append(row);
  });
  const actions = el('div', 'actions');
  const workspaceButton = el('button', 'primary-action', 'Git workspace'); workspaceButton.addEventListener('click', () => openWorkspace(repo)); actions.append(workspaceButton);
  [['open-folder','Open folder'],['open-terminal','Terminal'],['open-code','VS Code'],['open-remote','Remote URL'],['status','Status'],['fetch','Fetch']].forEach(([action,label]) => {
    const button = el('button', '', label); button.addEventListener('click', () => run(action, repo)); actions.append(button);
  });
  const mrButton = el('button', '', 'Create MR'); mrButton.addEventListener('click', () => showMrDialog(repo)); actions.append(mrButton);
  const tagButton = el('button', '', 'Edit tags'); tagButton.addEventListener('click', () => {
    const value=prompt('Tags separated by commas\nExample: LNS, Java, Deployment',repoTags(repo).join(', '));
    if(value===null)return;
    const tags=[...new Set(value.split(',').map((tag)=>tag.trim()).filter(Boolean))].slice(0,8);
    const key=repoKey(repo); if(tags.length)state.meta.tags[key]=tags;else delete state.meta.tags[key];saveMeta();render();
  }); actions.append(tagButton);
  const remove = el('button', 'btn danger', 'Remove from list'); remove.addEventListener('click', () => run('remove', repo));
  panel.append(heading, facts, actions, remove);
}

async function run(action, repo) {
  if (state.busy) return;
  if (action === 'remove' && !confirm(`Remove ${repo.name} from the saved list?\nRepository files will not be deleted.`)) return;
  setBusy(true); setNotice(`Running ${action}…`); setOutput('Working…'); showLoading(`Running ${action}…`,repo.name);
  try {
    let data = await api('/api/action', { method: 'POST', body: JSON.stringify({ action, path: repo.path }) });
    data = await resolveActionResult(data);
    setNotice(data.message || `${action} completed`); setOutput(data.output || data.message);
    if (action === 'remove') state.selected = null;
    if(['fetch','remove','status'].includes(action))await refresh();
  } catch (error) { setNotice(error.message); setOutput(error.message); }
  finally { setBusy(false); hideLoading(); }
}

function showDialog(mode, remoteUrl = '', cloneName = '') {
  state.mode = mode;state.cloneName=cloneName||getCloneRepositoryName(remoteUrl);
  $('repo-form').reset(); $('form-message').textContent = '';
  $('form-eyebrow').textContent = mode === 'scan' ? 'DISCOVER WORKING COPIES' : mode === 'add' ? 'REGISTER WORKING COPY' : mode==='create'?'NEW LOCAL REPOSITORY':'NEW WORKING COPY';
  $('form-title').textContent = mode === 'scan' ? 'Scan folder for repositories' : mode === 'add' ? 'Add existing repository' : mode==='create'?'Create repository':'Clone repository';
  $('path-label').textContent = mode === 'scan' ? 'Folder to scan' : mode === 'add' ? 'Repository folder' : 'Destination folder';
  $('submit-label').textContent = mode === 'scan' ? 'Scan and add' : mode === 'add' ? 'Add repository' : mode==='create'?'Create repository':'Clone';
  document.querySelector('.clone-only').classList.toggle('hidden', mode !== 'clone');
  document.querySelectorAll('.create-only').forEach((node)=>node.classList.toggle('hidden',mode!=='create'));
  document.querySelectorAll('.destination-root-only').forEach((node)=>node.classList.toggle('hidden',!['clone','create'].includes(mode)));
  document.querySelector('.browse-only').classList.toggle('hidden', !['scan','create'].includes(mode));
  document.querySelector('.scan-only').classList.toggle('hidden', mode !== 'scan');
  $('repo-url').required = mode === 'clone';
  $('create-name').required=mode==='create';$('create-branch').required=mode==='create';
  $('repo-path').readOnly = mode === 'clone';
  if (remoteUrl) $('repo-url').value = remoteUrl;
  const root=$('clone-root');root.replaceChildren();const placeholder=el('option','','Choose a scan location…');placeholder.value='';root.append(placeholder);state.scanLocations.forEach((path)=>{const option=el('option','',path);option.value=path;root.append(option);});
  if(['clone','create'].includes(mode)&&state.scanLocations.length){root.value=state.scanLocations[0];if(mode==='clone')updateCloneDestination();else updateCreateDestination();}
  if(mode==='create'){$('create-branch').value='main';$('create-readme').checked=true;$('create-gitignore').value='none';}
  $('backdrop').classList.remove('hidden'); (mode==='clone' ? $('repo-url') : mode==='create'?$('create-name'):$('repo-path')).focus();
}

function getCloneRepositoryName(remoteUrl=''){
  let value=remoteUrl.trim().replace(/[?#].*$/,'').replace(/[\\/]+$/,'');
  if(!value)return '';
  let name=(value.split(/[\\/]/).pop()||'').replace(/\.git$/i,'');
  try{name=decodeURIComponent(name);}catch{}
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/,'').trim();
}

function updateCloneDestination(){
  const root=$('clone-root').value;state.cloneName=getCloneRepositoryName($('repo-url').value);
  $('repo-path').value=root&&state.cloneName?`${root.replace(/[\\/]$/,'')}\\${state.cloneName}`:'';
}

function updateCreateDestination(){const root=$('clone-root').value;const name=$('create-name').value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/,'');if(root&&name)$('repo-path').value=`${root.replace(/[\\/]$/,'')}\\${name}`;}

function hideDialog() { $('backdrop').classList.add('hidden'); state.mode = null; }

async function showGitLab() {
  $('gitlab-backdrop').classList.remove('hidden');
  $('gitlab-status').textContent = 'Checking GitLab connections…';
  showLoading('Checking the GitLab connection…','Checking host and login status');
  try {
    const data = await api('/api/gitlab/hosts');
    const select = $('gitlab-host'); select.replaceChildren();
    data.hosts.forEach((item) => { const option=el('option','',`${item.host}${item.authenticated?' — connected':' — login required'}`); option.value=item.host; option.dataset.authenticated=item.authenticated; select.append(option); });
    updateGitLabStatus();
  } catch(error) { $('gitlab-status').textContent=error.message; }
  finally { hideLoading(); }
}

function updateGitLabStatus() {
  const option=$('gitlab-host').selectedOptions[0];
  if(!option){$('gitlab-status').textContent='No GitLab host detected.';return;}
  $('gitlab-status').textContent=option.dataset.authenticated==='true'?'Connected. Load projects to browse your access.':'Login is required for this host.';
}

async function loadGitLabProjects() {
  const host=$('gitlab-host').value; if(!host)return;
  $('gitlab-status').textContent='Loading accessible projects…';
  $('gitlab-load').disabled=true; showLoading('Loading GitLab projects…',host); renderSkeleton('project-list',8);
  try {
    const data=await api(`/api/gitlab/projects?host=${encodeURIComponent(host)}`);
    state.gitlabProjects=data.projects; state.projectPage=1; $('gitlab-status').textContent=`${data.projects.length} accessible projects`; renderProjects();
  } catch(error) { $('gitlab-status').textContent=error.message; const empty=el('div','empty project-empty');empty.append(el('strong','','Could not load projects'),el('p','',error.message));$('project-list').replaceChildren(empty); }
  finally { $('project-list').removeAttribute('aria-busy'); $('gitlab-load').disabled=false; hideLoading(); }
}

function renderProjects() {
  const list=$('project-list'); list.replaceChildren();
  const term=$('gitlab-search').value.trim().toLowerCase();
  const projects=state.gitlabProjects.filter(project=>!term||matchesSearch(`${project.name_with_namespace||''} ${project.description||''} ${project.web_url||''} ${project.ssh_url_to_repo||''} ${project.http_url_to_repo||''} ${project.default_branch||''}`,term));
  const totalPages=Math.max(1,Math.ceil(projects.length/state.projectPageSize)); state.projectPage=Math.min(state.projectPage,totalPages);
  const first=(state.projectPage-1)*state.projectPageSize; const visibleProjects=projects.slice(first,first+state.projectPageSize);
  $('gitlab-search-clear').classList.toggle('hidden',!term);
  const count=$('gitlab-result-count');
  count.classList.toggle('hidden',!state.gitlabProjects.length);
  count.textContent=term?`${projects.length} of ${state.gitlabProjects.length} matching projects`:`${state.gitlabProjects.length} accessible projects`;
  if(!projects.length&&state.gitlabProjects.length){const empty=el('div','empty project-empty');empty.append(el('strong','','No matching projects'),el('p','','Try a project name, group, URL or default branch.'));list.append(empty);}
  visibleProjects.forEach(project=>{
    const card=el('article','project-card');
    card.append(el('h3','',project.name_with_namespace),el('p','',project.description||'No description'),el('small','',`Default: ${project.default_branch||'-'}`));
    const actions=el('div','project-actions');
    const clone=el('button','','Clone'); clone.addEventListener('click',()=>{ $('gitlab-backdrop').classList.add('hidden'); showDialog('clone',project.ssh_url_to_repo||project.http_url_to_repo,project.path||project.name); });
    const open=el('button','','Open'); open.addEventListener('click',()=>window.open(project.web_url,'_blank','noopener'));
    const mrs=el('button','','Merge requests'); mrs.addEventListener('click',()=>loadMergeRequests(project,card));
    const pipelines=el('button','','Pipelines');pipelines.addEventListener('click',()=>loadPipelines(project,card));
    actions.append(clone,open,mrs,pipelines); card.append(actions); list.append(card);
  });
  renderPagination('project-pagination',state.projectPage,totalPages,(page)=>{state.projectPage=page;renderProjects();$('project-list').scrollIntoView({behavior:'smooth',block:'start'});});
}

async function loadMergeRequests(project, card) {
  const old=card.querySelector('.mr-list'); if(old)old.remove();
  const box=el('div','mr-list','Loading merge requests…'); card.append(box);
  try {
    const data=await api(`/api/gitlab/mrs?project=${encodeURIComponent(project.web_url)}`); box.replaceChildren();
    if(!data.mergeRequests.length){box.textContent='No open merge requests.';return;}
    data.mergeRequests.forEach(mr=>{const row=el('section','gitlab-item');const button=el('button','gitlab-item-title',`!${mr.iid||mr.id} ${mr.title}`);button.addEventListener('click',()=>window.open(mr.web_url,'_blank','noopener'));const actions=el('div','gitlab-item-actions');const approve=el('button','','Approve');approve.addEventListener('click',()=>runGitLabAction('gitlab-mr-approve',{project:project.web_url,iid:mr.iid||mr.id},`Approve MR !${mr.iid||mr.id}?`,()=>loadMergeRequests(project,card)));const merge=el('button','danger','Merge');merge.addEventListener('click',()=>runGitLabAction('gitlab-mr-merge',{project:project.web_url,iid:mr.iid||mr.id},`Merge MR !${mr.iid||mr.id} on GitLab now?`,()=>loadMergeRequests(project,card)));const comment=el('input','','');comment.placeholder='Comment…';const send=el('button','','Send');send.addEventListener('click',()=>{if(comment.value.trim())runGitLabAction('gitlab-mr-comment',{project:project.web_url,iid:mr.iid||mr.id,comment:comment.value.trim()},`Send comment to MR !${mr.iid||mr.id}?`,()=>{comment.value='';});});actions.append(approve,merge,comment,send);row.append(button,actions);box.append(row);});
  } catch(error){box.textContent=error.message;}
}

async function runGitLabAction(action,payload,confirmation,onDone){if(state.busy||!confirm(confirmation))return;setBusy(true);showLoading(`Running ${action}…`,'GitLab');try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action,...payload})});setNotice(result.message);setOutput(result.output||result.message);if(onDone)await onDone();}catch(error){setNotice(error.message);setOutput(error.message,{expand:true,status:'error'});}finally{setBusy(false);hideLoading();}}
async function loadPipelines(project,card){const old=card.querySelector('.pipeline-list');if(old)old.remove();const box=el('div','pipeline-list','Loading pipelines…');card.append(box);try{const data=await api(`/api/gitlab/pipelines?project=${encodeURIComponent(project.web_url)}`);box.replaceChildren();if(!data.pipelines.length){box.textContent='No recent pipelines.';return;}data.pipelines.forEach((pipeline)=>{const row=el('section','gitlab-item');const title=el('a','gitlab-item-title',`#${pipeline.id} · ${pipeline.ref||'-'} · ${pipeline.status||'unknown'}`);title.href=pipeline.web_url;title.target='_blank';title.rel='noopener';const actions=el('div','gitlab-item-actions');const retry=el('button','','Retry');retry.disabled=['running','pending'].includes(pipeline.status);retry.addEventListener('click',()=>runGitLabAction('gitlab-pipeline-retry',{project:project.web_url,pipeline:pipeline.id},`Retry pipeline #${pipeline.id}?`,()=>loadPipelines(project,card)));actions.append(retry);row.append(title,actions);box.append(row);});}catch(error){box.textContent=error.message;}}

async function openWorkspace(repo, tab='history', collapseLibrary=true, record=true) {
  const loadVersion=++workspaceLoadVersion;
  const snapshot=workspaceSnapshots.get(repoKey(repo));
  state.workspaceRepo=repo; state.workspaceTab=tab; state.workspace=snapshot?.data||null;
  state.meta.lastRepo=repoKey(repo);state.meta.lastWorkspaceTab=tab;hideRepoSwitcher();rememberOpenRepo(repo);saveLastView(repo,tab);renderRepoTabs();document.body.classList.add('workbench-mode');if(collapseLibrary===true&&!(state.meta.libraryPinned&&canPinLibrary()))document.body.classList.add('library-collapsed');else if(collapseLibrary===false)document.body.classList.remove('library-collapsed');updateLibraryPinButton();
  $('workspace-title').textContent=repo.name; $('workspace-branch').textContent='Reading repository data…';
  $('workspace-backdrop').classList.remove('workspace-idle');
  const favoriteButton=document.querySelector('[data-workspace-quick="favorite"]');favoriteButton.textContent=isFavorite(repo)?'★':'☆';favoriteButton.classList.toggle('active',isFavorite(repo));
  syncWorkspaceTabButtons(tab);
  if(record){const key=`${repo.path}|${tab}`;if(state.viewHistory[state.viewIndex]!==key){state.viewHistory=state.viewHistory.slice(0,state.viewIndex+1);state.viewHistory.push(key);state.viewIndex=state.viewHistory.length-1;}}updateViewNavigation();
  if(snapshot){paintWorkspace(snapshot.data);$('workspace-branch').textContent+=` · Cached data ${new Date(snapshot.checkedAt).toLocaleTimeString('en-US')} · Checking for updates…`;}
  else renderSkeleton('workspace-content',5);
  await loadWorkspace(true,loadVersion);
}

function closeWorkspace(){ workspaceLoadVersion++;hideRepoSwitcher();state.workspaceRepo=null;state.workspace=null;document.body.classList.remove('workbench-mode','library-collapsed','focus-workbench');setFocusWorkbench(false);$('workspace-backdrop').classList.add('workspace-idle');$('workspace-title').textContent='Select a repository';$('workspace-branch').textContent='Choose a repository from the list.';$('tree-content').replaceChildren();$('workspace-content').replaceChildren(workspaceEmpty('Select a repository','Select a repository on the left to get started'));renderRepoTabs(); }

function showWorkspaceRetry(message){
  document.getElementById('workspace-retry')?.remove();const box=el('div','history-context');box.id='workspace-retry';box.setAttribute('role','status');box.append(el('span','',message));const retry=el('button','','Retry');retry.type='button';retry.onclick=()=>loadWorkspace();box.append(retry);$('workspace-content').prepend(box);
}
async function loadWorkspace(showReady=false,loadVersion=++workspaceLoadVersion) {
  const repo=state.workspaceRepo;if(!repo)return;
  document.getElementById('workspace-retry')?.remove();const startedAt=Date.now();let readStage='Queued for reading';
  const progressTimer=setInterval(()=>{if(loadVersion===workspaceLoadVersion)$('workspace-branch').textContent=`${repo.name} · ${readStage} · ${((Date.now()-startedAt)/1000).toFixed(1)}s`;},250);
  const current=()=>loadVersion===workspaceLoadVersion&&state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo);
  if(!state.workspace)showLoading('Reading Git workspace…',repo.name);
  else $('workspace-branch').textContent=`Current branch: ${state.workspace.branch||'detached HEAD'} · Checking for updates…`;
  try{
    // Coalesce rapid tab switches before dispatch; only the latest waiter proceeds.
    await new Promise(resolve=>setTimeout(resolve,80));
    while(workspaceReadInFlight){try{await workspaceReadInFlight;}catch{}if(!current())return;}
    if(!current())return;
    readStage='Reading status / refs / history'+(workspaceNeedsExtras()?' / LFS / submodules':'');
    const request=api(`/api/repo/workspace?path=${encodeURIComponent(repo.path)}&extras=${workspaceNeedsExtras()}`);
    workspaceReadInFlight=request;
    let data;try{data=await request;}finally{if(workspaceReadInFlight===request)workspaceReadInFlight=null;}
    if(!current())return;
    const unchanged=JSON.stringify(state.workspace)===JSON.stringify(data.workspace);
    rememberWorkspace(repo,data.workspace);
    if(!unchanged)paintWorkspace(data.workspace);
    $('workspace-branch').textContent=`Current branch: ${data.workspace.branch||'detached HEAD'} · Files checked ${new Date().toLocaleTimeString('en-US')} (local) · ${((Date.now()-startedAt)/1000).toFixed(2)}s`;
    if(showReady){const sync=data.workspace.sync||{};setOutput(`Ready: ${repo.name}\nBranch: ${data.workspace.branch||'detached HEAD'}\nChanges: ${data.workspace.files.length} · Ahead: ${sync.ahead||0} · Behind: ${sync.behind||0}`,{collapse:true});}
  }catch(error){if(!current())return;if(state.workspace){$('workspace-branch').textContent+=' · Refresh failed (cached data)';showWorkspaceRetry(error.message);setNotice(error.message);return;}const empty=el('div','empty workspace-empty');empty.append(el('strong','','Could not load Git workspace'),el('p','',error.message));$('workspace-content').replaceChildren(empty);showWorkspaceRetry(error.message);}
  finally{clearInterval(progressTimer);if(loadVersion===workspaceLoadVersion){$('workspace-content').removeAttribute('aria-busy');hideLoading();}}
}

function renderSyncSummary(sync={}){const pull=document.querySelector('[data-git-action="pull"] small');const push=document.querySelector('[data-git-action="push"] small');pull.textContent=sync.behind?`${sync.behind} commit${sync.behind===1?'':'s'} ready to pull`:'Fast-forward update';push.textContent=sync.ahead?`${sync.ahead} commit${sync.ahead===1?'':'s'} ready to push`:'Send commits to remote';}

function syncConfirmation(action){const sync=state.workspace?.sync||{};const items=action==='push'?sync.outgoing:sync.incoming;const count=action==='push'?sync.ahead:sync.behind;const verb=action==='push'?'Push':'Pull';const lines=(items||[]).map((item)=>`• ${item}`).join('\n');return `${verb} ${count||0} commit${count===1?'':'s'} ${action==='push'?'to remote':'into the current branch'}?${lines?`\n\n${lines}`:''}${action==='pull'?`\n\nPull strategy: ${state.meta.pullStrategy}`:''}`;}

function workspaceHeading(title,description){const box=el('div','workspace-section-head');const text=el('div');text.append(el('h3','',title),el('p','',description));box.append(text);return {box,text};}
function workspaceList(){return el('div','workspace-list');}
function workspaceEmpty(title,description){const empty=el('div','empty workspace-empty');empty.append(el('strong','',title),el('p','',description));return empty;}

function hideContextMenu(){$('context-menu').classList.add('hidden');$('context-menu').replaceChildren();}
function showContextMenu(event,items){event.preventDefault();event.stopPropagation();const menu=$('context-menu');menu.replaceChildren();items.filter(Boolean).forEach((item)=>{if(item.separator){menu.append(el('hr'));return;}const button=el('button',item.danger?'danger':'',item.label);button.type='button';button.disabled=Boolean(item.disabled);if(button.disabled)button.title=item.disabledReason||'This action is unavailable for the current selection.';if(button.disabled||item.hint)button.append(el('small','',button.disabled?button.title:item.hint));button.addEventListener('click',()=>{hideContextMenu();item.run();});menu.append(button);});menu.classList.remove('hidden');const width=285;const height=Math.min(430,items.length*36);menu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-width-8))}px`;menu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-height-8))}px`;}
async function copyRepositoryValue(value,label){if(!value)return;try{await navigator.clipboard.writeText(value);setNotice(`Copied ${label}`);}catch{setNotice(`Copy ${label} failed`);}}
function repositoryDetailRow(label,value,copyLabel=''){
  const row=el('div','repository-detail-row');const text=el('code','',value||'—');text.title=value||'—';row.append(el('span','',label),text);
  if(copyLabel&&value){const copy=el('button','','Copy');copy.type='button';copy.addEventListener('click',()=>copyRepositoryValue(value,copyLabel));row.append(copy);}
  return row;
}
function renderRepositoryDetails(repo,details=null,error=''){
  const body=$('repo-detail-body');body.replaceChildren();const data=details||{};const remotes=Array.isArray(data.remotes)?data.remotes:(repo.remote?[{name:'origin',fetchUrl:repo.remote,pushUrl:repo.remote}]:[]);const changes=Number(data.changes??repo.changes??0);const ahead=Number(data.ahead??repo.ahead??0)||0;const behind=Number(data.behind??repo.behind??0)||0;
  const summary=el('section','repository-detail-summary');const identity=el('article');identity.append(el('span',`repo-icon ${repo.valid?'':'invalid'}`,repo.name.slice(0,1).toUpperCase()));const identityText=el('div');identityText.append(el('strong','',repo.name),el('small','',data.valid===false||!repo.valid?'Folder missing / invalid':data.shallow?'Shallow working copy':'Git working copy'));identity.append(identityText);summary.append(identity);
  [['Branch',data.branch||repo.branch||'—'],['Changes',String(changes)],['Sync',`↑${ahead} ↓${behind}`],['Remotes',String(remotes.length)]].forEach(([label,value])=>{const card=el('article');const number=el('b','',value);number.title=value;card.append(number,el('small','',label));summary.append(card);});body.append(summary);
  if(error){const warning=el('div','repository-detail-note',error);warning.style.color='var(--danger)';body.append(warning);}
  const grid=el('section','repository-detail-grid');
  const location=el('article','repository-detail-card');location.append(el('h3','','Local working copy'),repositoryDetailRow('Folder',data.path||repo.path,'folder path'),repositoryDetailRow('Git directory',data.gitDir||'—',data.gitDir?'Git directory':''),repositoryDetailRow('Type',data.shallow?'Shallow clone':'Full clone'));
  const tracking=el('article','repository-detail-card');tracking.append(el('h3','','Branch & working status'),repositoryDetailRow('Current branch',data.branch||repo.branch||'—'),repositoryDetailRow('Upstream',data.upstream||'Not configured'),repositoryDetailRow('Staged',String(data.staged??0)),repositoryDetailRow('Unstaged',String(data.unstaged??changes)),repositoryDetailRow('Untracked',String(data.untracked??0)),repositoryDetailRow('Git operation',data.operation?.active?`${data.operation.type} in progress`:'None'));
  const remoteCard=el('article','repository-detail-card wide');remoteCard.append(el('h3','','Clone / remote URLs'));if(remotes.length){remotes.forEach((remote)=>{remoteCard.append(repositoryDetailRow(`${remote.name} · Fetch`,remote.fetchUrl||'—',`${remote.name} fetch URL`));if(remote.pushUrl&&remote.pushUrl!==remote.fetchUrl)remoteCard.append(repositoryDetailRow(`${remote.name} · Push`,remote.pushUrl,`${remote.name} push URL`));});remoteCard.append(el('p','repository-detail-note','These are the current fetch/push URLs in Git. They usually match the original clone URL unless the remote was changed later.'));}else remoteCard.append(el('p','repository-detail-note','This repository has no remote URL in Git config'));
  const refs=el('article','repository-detail-card');refs.append(el('h3','','References'),repositoryDetailRow('Local branches',String(data.branchCount??'—')),repositoryDetailRow('Remote branches',String(data.remoteBranchCount??'—')),repositoryDetailRow('Tags',String(data.tagCount??'—')),repositoryDetailRow('Stashes',String(data.stashCount??'—')));
  const commit=el('article','repository-detail-card');commit.append(el('h3','','Latest commit'));if(data.lastCommit){const info=el('div','repository-detail-commit');const subject=el('strong','',data.lastCommit.subject);subject.title=data.lastCommit.subject;info.append(el('code','',data.lastCommit.hash),subject,el('small','',`${data.lastCommit.author} · ${data.lastCommit.date}`));commit.append(info);}else commit.append(el('p','repository-detail-note',repo.lastCommit||'No commits yet'));
  grid.append(location,tracking,remoteCard,refs,commit);body.append(grid);$('repo-detail-open-workspace').disabled=!repo.valid;$('repo-detail-open-folder').disabled=!repo.valid;$('repo-detail-open-remote').disabled=!remotes.length;$('repo-detail-copy-path').disabled=!(data.path||repo.path);
}
async function showRepositoryDetails(repo){
  repoDetailRepo=repo;const version=++repoDetailLoadVersion;$('repo-detail-title').textContent=repo.name;$('repo-detail-subtitle').textContent=repo.path;$('repo-detail-backdrop').classList.remove('hidden');renderRepositoryDetails(repo);$('repo-detail-body').setAttribute('aria-busy','true');
  if(!repo.valid){renderRepositoryDetails(repo,null,'This folder is missing or is no longer a Git repository');$('repo-detail-body').removeAttribute('aria-busy');return;}
  try{const response=await api(`/api/repo/details?path=${encodeURIComponent(repo.path)}`);if(version!==repoDetailLoadVersion||repoDetailRepo!==repo)return;renderRepositoryDetails(repo,response.details);}
  catch(error){if(version===repoDetailLoadVersion&&repoDetailRepo===repo)renderRepositoryDetails(repo,null,error.message);}
  finally{if(version===repoDetailLoadVersion)$('repo-detail-body').removeAttribute('aria-busy');}
}
function hideRepositoryDetails(){repoDetailLoadVersion++;repoDetailRepo=null;$('repo-detail-backdrop').classList.add('hidden');}
function repositoryContextItems(repo){return [
  {label:'Repository details…',hint:'folder, remote, branch',run:()=>showRepositoryDetails(repo)},
  {label:'Open repository workspace',disabled:!repo.valid,run:()=>openWorkspace(repo,state.workspaceTab||'history',true)},
  {separator:true},
  {label:'Open folder',disabled:!repo.valid,run:()=>run('open-folder',repo)},
  {label:'Open terminal here',disabled:!repo.valid,run:()=>run('open-terminal',repo)},
  {label:'Open in VS Code',disabled:!repo.valid,run:()=>run('open-code',repo)},
  {label:'Open remote URL',disabled:!repo.remote,run:()=>run('open-remote',repo)},
  {separator:true},
  {label:'Copy local folder',run:()=>copyRepositoryValue(repo.path,'folder path')},
  {label:'Copy remote URL',disabled:!repo.remote,run:()=>copyRepositoryValue(repo.remote,'remote URL')},
  {label:isFavorite(repo)?'Remove from favorites':'Add to favorites',run:()=>{const key=repoKey(repo);if(isFavorite(repo))delete state.meta.favorites[key];else state.meta.favorites[key]=true;saveMeta();render();}}
];}
function openCompareRefs(source,target){state.pendingCompare={source,target};selectWorkspaceTab('compare');}
function showTagDetails(tag){selectWorkspaceTab('tags');setTimeout(()=>{const search=document.querySelector('.tag-search');if(!search)return;search.value=tag.name;search.dispatchEvent(new Event('input',{bubbles:true}));search.focus();},0);}
function tagContextItems(data,tag){const remotes=(data.remotes||[]).map(item=>item.name);const items=[{label:`Checkout ${tag.name} (detached)…`,hint:tag.hash||'tag commit',disabled:!tag.hash,run:()=>runWorkspaceAction('checkout-commit',{commit:tag.hash},`Checkout tag ${tag.name} as detached HEAD?\nCommit or stash pending changes first`)},{label:'Details…',hint:tag.hash||'',run:()=>showTagDetails(tag)},{label:'Diff Against Current',hint:`${tag.name} ↔ ${data.branch}`,run:()=>openCompareRefs(tag.name,data.branch)},{separator:true}];remotes.forEach(remote=>items.push({label:`Push ${tag.name} to ${remote}`,run:()=>runWorkspaceAction('tag-push',{tag:tag.name,remote},`Push tag “${tag.name}” to ${remote}?`)}));items.push({separator:true},{label:`Delete local tag ${tag.name}`,danger:true,run:()=>runWorkspaceAction('tag-delete',{tag:tag.name,deleteLocal:true,deleteRemote:false,remote:''},`Delete local tag “${tag.name}”?\nThe remote tag will not be deleted`)});remotes.forEach(remote=>items.push({label:`Delete ${tag.name} from ${remote}`,danger:true,run:()=>runWorkspaceAction('tag-delete',{tag:tag.name,deleteLocal:false,deleteRemote:true,remote},`Delete remote tag “${tag.name}” from ${remote}?\nThe local tag will be kept`)}));items.push({separator:true},{label:'Copy tag name',run:async()=>{await navigator.clipboard.writeText(tag.name);setNotice(`Copied ${tag.name}`);}});return items;}
function branchOperationContextItems(data,branch,kind){const repo=state.workspaceRepo;if(kind==='remote'){const parts=branch.name.split('/');const remote=parts.shift();const source=parts.join('/');return [{label:`Checkout ${source}…`,hint:`track ${branch.name}`,run:()=>runWorkspaceAction('branch-track',{branch:branch.name},`Create local branch ${source} to track ${branch.name}?`)},{label:`Pull ${branch.name} into current`,hint:`${data.branch} · ${state.meta.pullStrategy}`,run:()=>runWorkspaceAction('pull-ref',{remote,branch:source,strategy:state.meta.pullStrategy},`Pull ${branch.name} into ${data.branch} using ${state.meta.pullStrategy}?`)},{label:'Diff Against Current',hint:`${branch.name} ↔ ${data.branch}`,run:()=>openCompareRefs(branch.name,data.branch)},{separator:true},{label:`Fetch ${remote}`,run:()=>runWorkspaceAction('fetch')},{label:'Create Merge Request…',hint:`${source} → target`,run:()=>showMrDialog(repo,source,remote)},{separator:true},{label:`Delete remote branch ${source}`,danger:true,run:()=>runWorkspaceAction('branch-delete-remote',{remote,branch:source},`Delete ${branch.name} from remote?`)}];}
  const remote=branch.upstream?.includes('/')?branch.upstream.split('/')[0]:'origin';return [{label:'Compare with current',run:()=>openCompareRefs(branch.name,data.branch)},{label:`Checkout ${branch.name}…`,disabled:branch.current,disabledReason:'This is the working branch. Choose a different branch for this action.',run:()=>runWorkspaceAction('branch-switch',{branch:branch.name},`Switch to branch ${branch.name}?`)},{label:`Merge ${branch.name} into current`,disabled:branch.current,disabledReason:'This is the working branch. Choose a different branch for this action.',hint:data.branch,run:()=>runWorkspaceAction('merge',{branch:branch.name,mode:'default'},`Merge ${branch.name} into ${data.branch}?`)},{label:`Rebase current onto ${branch.name}`,disabled:branch.current,disabledReason:'This is the working branch. Choose a different branch for this action.',hint:data.branch,run:()=>runWorkspaceAction('rebase-start',{branch:branch.name},`Rebase ${data.branch} on ${branch.name}?`)},{separator:true},{label:`Fetch ${remote}`,run:()=>runWorkspaceAction('fetch')},{label:`Push ${branch.name} to ${remote}`,run:()=>runWorkspaceAction('branch-push',{branch:branch.name,remote},`Push branch ${branch.name} to ${remote}?`)},{separator:true},{label:`Rename ${branch.name}…`,run:()=>{const name=prompt(`New name for ${branch.name}`,branch.name);if(name&&name.trim()!==branch.name)runWorkspaceAction('branch-rename',{branch:branch.name,newName:name.trim()},`Rename ${branch.name} to ${name.trim()}?`);}},{label:`Delete local branch ${branch.name}`,danger:true,disabled:branch.current,disabledReason:'This is the working branch. Choose a different branch for this action.',run:()=>runWorkspaceAction('branch-delete',{branch:branch.name,force:false},`Delete local branch ${branch.name}?`)},{separator:true},{label:'Create Merge Request…',hint:`${branch.name} → target`,run:()=>showMrDialog(repo,branch.name,remote)}];}
function commitContextItems(item){return [{label:`Checkout ${item.hash} (detached)…`,run:()=>runWorkspaceAction('checkout-commit',{commit:item.fullHash},`Checkout ${item.hash} as detached HEAD?\nCommit or stash pending changes first`)},{label:'Create branch at this commit…',run:()=>{const branch=prompt(`New branch name at ${item.hash}`,'recovery/'+item.hash);if(branch)runWorkspaceAction('branch-create-at',{branch:branch.trim(),commit:item.fullHash},`Create branch ${branch.trim()} at ${item.hash}?`);}},{label:'Add tag at this commit…',run:()=>openTagCreator(item.fullHash)},{separator:true},{label:'Cherry-pick onto current branch',run:()=>runWorkspaceAction('cherry-pick',{commit:item.fullHash},`Cherry-pick ${item.hash} onto ${state.workspace.branch}?`)},{label:'Reverse commit (Revert)…',run:()=>runWorkspaceAction('revert-commit',{commit:item.fullHash},`Create a revert commit for ${item.hash}?`)},{separator:true},{label:'Reset current branch here · Soft',run:()=>runWorkspaceAction('reset-commit',{commit:item.fullHash,mode:'soft'},`Soft reset ${state.workspace.branch} to ${item.hash}?`)},{label:'Reset current branch here · Mixed',run:()=>runWorkspaceAction('reset-commit',{commit:item.fullHash,mode:'mixed'},`Mixed reset ${state.workspace.branch} to ${item.hash}?`)},{label:'Reset current branch here · Hard',danger:true,run:()=>runWorkspaceAction('reset-commit',{commit:item.fullHash,mode:'hard'},`Hard reset ${state.workspace.branch} to ${item.hash}?\nWorking changes will be discarded`)},{separator:true},{label:`Copy SHA ${item.hash}`,run:async()=>{await navigator.clipboard.writeText(item.fullHash);setNotice(`Copied ${item.hash}`);}}];}

function repositoryTabContextItems(repo,close){return [
  {label:'Copy repository path',hint:repo.path,run:()=>copyRepositoryValue(repo.path,'repository path')},
  {label:'Open in Explorer',disabled:!repo.valid,run:()=>run('open-folder',repo)},
  {label:'Open in Terminal',disabled:!repo.valid,run:()=>run('open-terminal',repo)},
  {label:'Repository details…',run:()=>showRepositoryDetails(repo)},
  {separator:true},
  {label:isFavorite(repo)?'Unpin repository':'Pin repository',run:()=>{const key=repoKey(repo);if(isFavorite(repo))delete state.meta.favorites[key];else state.meta.favorites[key]=true;saveMeta();renderRepoTabs();}},
  {label:'Close tab',run:close}
];}
function branchContextItems(data,branch,kind){return [...branchCopyContextItems(branch,kind),{separator:true},...branchOperationContextItems(data,branch,kind)];}
function branchCopyContextItems(branch,kind){
  const name=kind==='remote'?branch.name.slice(branch.name.indexOf('/')+1):branch.name;
  const items=[{label:'Copy branch name',hint:name,run:()=>copyRepositoryValue(name,'branch name')}];
  if(kind==='remote')items.push({label:'Copy full ref',hint:branch.name,run:()=>copyRepositoryValue(branch.name,'full ref')});
  return items;
}
function bindDiffPathMenu(label,path,repo){
  label.title=path+'\n'+fileFullPath(repo,path)+'\nRight-click to copy path. Historical files may no longer exist in the working copy.';
  label.tabIndex=0;label.setAttribute('aria-label','File path: '+path);
  label.addEventListener('contextmenu',event=>showContextMenu(event,filePathContextItems({path},repo)));
  label.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){const rect=label.getBoundingClientRect();showContextMenu({preventDefault:()=>event.preventDefault(),stopPropagation:()=>event.stopPropagation(),clientX:rect.left,clientY:rect.bottom},filePathContextItems({path},repo));}});
}
function fileFullPath(repo,path){
  const root=String(repo?.path||'');
  if(!root)return '';
  const windows=/^[A-Za-z]:[\\/]|^\\\\/.test(root),separator=windows?'\\':'/';
  return root.replace(/[\\/]+$/,'').replace(/\//g,separator)+separator+String(path).replace(/^[\\/]+/,'').replace(/\//g,separator);
}
function filePathContextItems(file,repo=state.workspaceRepo){
  const relative=String(file.path),full=fileFullPath(repo,relative);
  return [
    {label:'Copy relative path',hint:relative,run:()=>copyRepositoryValue(relative,'relative path')},
    {label:'Copy full path',hint:full,disabled:!full,run:()=>copyRepositoryValue(full,'full path')}
  ];
}
function attachCommitFileMenu(row,button,file,repo,diff,tools){
  button.title=file.path+'\n'+fileFullPath(repo,file.path)+'\nPath in the working copy; historical files may no longer exist.';
  const items=()=>[...filePathContextItems(file,repo),{separator:true},
    {label:'File history',run:()=>loadFileHistory(file,diff)},
    {label:'Blame current working revision',run:()=>loadFileBlame(file,diff)}];
  row.addEventListener('contextmenu',event=>showContextMenu(event,items()));
  tools.replaceChildren(refMenuButton(items,'File actions for '+file.path));
}
function workingFileContextItems(file,staged,diffPane,button){return [
  {label:'Open',run:()=>runWorkspaceAction('open-working-file',{file:file.path})},
  {label:'Show in Explorer',run:()=>runWorkspaceAction('reveal-working-file',{file:file.path})},
  ...filePathContextItems(file),
  {separator:true},
  {label:'Preview diff',hint:staged?'Staged':'Working tree',run:()=>loadWorkingDiff(file,staged,diffPane,button)},
  {label:staged?'Unstage file':'Stage file',run:()=>runWorkspaceAction(staged?'unstage-file':'stage-file',{file:file.path})},
  {separator:true},
  {label:'File history',run:()=>loadFileHistory(file,diffPane)},
  {label:'Blame',disabled:file.status==='??',run:()=>loadFileBlame(file,diffPane)},
  !staged&&file.status!=='??'?{separator:true}:null,
  !staged&&file.status!=='??'?{label:'Discard file changes…',danger:true,run:()=>runWorkspaceAction('discard-file',{file:file.path},`Discard changes in ${file.path}?\nThis cannot be undone`)}:null
];}

function commandPaletteEntries(){const entries=[['File Status / Commit','Workspace','Ctrl+1',()=>selectWorkspaceTab('changes')],['Commit history / All branches','Workspace','Ctrl+2',()=>selectWorkspaceTab('history')],['Compare branches / MR readiness','Review','',()=>selectWorkspaceTab('compare')],['Search code history','Review','',()=>selectWorkspaceTab('search-history')],['GitLab Inbox','GitLab','',()=>selectWorkspaceTab('gitlab-inbox')],['Conflict Center','Safety','',()=>selectWorkspaceTab('conflicts')],['Interactive Rebase','Git','',()=>selectWorkspaceTab('rebase')],['Worktree Manager','Git','',()=>selectWorkspaceTab('worktrees')],['Patch Center','Git','',()=>selectWorkspaceTab('patches')],['Advanced Git Tools','Git','',()=>selectWorkspaceTab('tools')],['Branches','Workspace','',()=>selectWorkspaceTab('branches')],['Stashes','Workspace','',()=>selectWorkspaceTab('stashes')],['Tags / Add tag','Workspace','',()=>openTagCreator()],['Remotes','Workspace','',()=>selectWorkspaceTab('remotes')],['Recovery Center / Reflog','Workspace','',()=>selectWorkspaceTab('recovery')],['Repository settings','Workspace','',()=>selectWorkspaceTab('settings')],['Fetch current repository','Git','',()=>runWorkspaceAction('fetch')],['Pull current branch','Git','',()=>runWorkspaceAction('pull',{strategy:state.meta.pullStrategy},syncConfirmation('pull'))],['Push branches…','Git','',showPushDialog],['Open Explorer','Open','',()=>state.workspaceRepo&&run('open-folder',state.workspaceRepo)],['Open Terminal','Open','',()=>state.workspaceRepo&&run('open-terminal',state.workspaceRepo)],['Open VS Code','Open','',()=>state.workspaceRepo&&run('open-code',state.workspaceRepo)],['Open Remote URL','Open','',()=>state.workspaceRepo&&run('open-remote',state.workspaceRepo)],['Create Merge Request','GitLab','',()=>state.workspaceRepo&&showMrDialog(state.workspaceRepo)]];return entries.map(([label,group,shortcut,run])=>({label,group,shortcut,run,search:`${label} ${group}`})).concat(state.repos.map((repo)=>({label:repo.name,group:'Switch repository',shortcut:repo.branch||'',search:`${repo.name} ${repo.path} ${repo.branch||''}`,run:()=>openWorkspace(repo,state.workspaceTab||'history',true)})));}
function renderCommandPalette(){const list=$('command-list');const term=$('command-search').value.trim().toLowerCase();const entries=commandPaletteEntries().filter((item)=>!term||item.search.toLowerCase().includes(term)).slice(0,50);state.commandIndex=Math.max(0,Math.min(state.commandIndex,entries.length-1));list.replaceChildren();entries.forEach((item,index)=>{const button=el('button',index===state.commandIndex?'active':'');button.type='button';button.setAttribute('role','option');const text=el('span');text.append(el('strong','',item.label),el('small','',item.group));button.append(text,el('kbd','',item.shortcut));button.addEventListener('mouseenter',()=>{state.commandIndex=index;list.querySelectorAll('button').forEach((node,i)=>node.classList.toggle('active',i===index));});button.addEventListener('click',()=>{hideCommandPalette();item.run();});list.append(button);});if(!entries.length)list.append(workspaceEmpty('No command found','Search by command or repository name'));}
function showCommandPalette(){state.commandIndex=0;hideRepoSwitcher();$('command-palette').classList.remove('hidden');$('command-search').value='';renderCommandPalette();requestAnimationFrame(()=>$('command-search').focus());}
function hideCommandPalette(){$('command-palette').classList.add('hidden');}

function renderSafetyCenter(content,data){const operation=data.operation||{};if(!operation.active)return;const center=el('section','safety-center');const info=el('div');info.append(el('strong','',`${operation.type.toUpperCase()} paused`),el('p','',operation.conflicts?.length?`${operation.conflicts.length} conflicted file(s) — Open Conflict Center and resolve all conflicts before continuing`:'All conflicts are staged. Ready to continue.'));const actions=el('div','workspace-row-actions');if(operation.conflicts?.length){const resolve=el('button','primary','Open Conflict Center');resolve.addEventListener('click',()=>selectWorkspaceTab('conflicts'));actions.append(resolve);}const go=el('button','primary','Continue');setDisabledReason(go,Boolean(operation.conflicts?.length),'Resolve and stage all conflicts in Conflict Center first.');go.addEventListener('click',()=>runWorkspaceAction('operation-continue',{},`Continue ${operation.type}?`));const abort=el('button','danger','Abort');abort.addEventListener('click',()=>runWorkspaceAction('operation-abort',{},`Abort ${operation.type} and return to the state before the operation?`));actions.append(go,abort);center.append(info,actions);if(operation.conflicts?.length){const files=el('div','conflict-files');operation.conflicts.forEach((file)=>files.append(el('code','',file)));center.append(files);}content.append(center);}

async function runWorkspaceAction(action,payload={},confirmation='',options={}) {
  const repo=state.workspaceRepo;if(!repo||state.busy)return;
  const context=actionContext(repo,state.workspace,payload);
  const preview=gitCommandPreview(action,payload);if(confirmation&&!confirm(`${context}\n\n${confirmation}${preview?`\n\nCommand preview:\n${preview}`:''}`))return;
  setBusy(true);showLoading(`Running ${action}…`,repo.name);setOutput('Working…');
  try{
    let result=await api('/api/action',{method:'POST',body:JSON.stringify({action,path:repo.path,...payload})});
    result=await resolveActionResult(result);
    setNotice(result.message);setOutput(result.output||result.message,{collapse:true});if(action==='fetch')state.lastFetchAt=new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
    showActionFeedback(result.message||`${action} completed`,{context:`${repo.name} · ${action}`});
    const stillOpen=()=>state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo);
    if(['stage-file','unstage-file','stage-all','unstage-all'].includes(action)){if(stillOpen())await loadWorkspace();}
    else{await refresh();if(stillOpen()){state.workspaceRepo=state.repos.find((item)=>item.path===repo.path)||repo;await loadWorkspace();}}
    return result;
  }catch(error){setNotice(error.message);setOutput(error.message,{expand:true,status:'error'});showActionFeedback(error.message,{error:true,context,retry:action==='fetch'?()=>{if(state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo))runWorkspaceAction('fetch',payload,`Retry fetch for ${repo.name}?`);else showActionFeedback('Reopen the original repository before retrying.',{error:true,context});}:null});try{if(state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo))await loadWorkspace();}catch{}if(typeof options.onError==='function')options.onError(error);return null;}
  finally{setBusy(false);hideLoading();}
}

function gitCommandPreview(action,payload={}){const q=(value)=>`"${String(value||'').replaceAll('"','\\"')}"`;const pullFlag=`--${payload.strategy==='rebase'?'rebase':payload.strategy==='merge'?'no-rebase':'ff-only'}`;const map={fetch:'git fetch --prune',pull:`git pull ${pullFlag}`,'pull-ref':`git pull ${pullFlag} ${q(payload.remote)} ${q(payload.branch)}`,push:'git push',commit:`git commit ${payload.amend?'--amend ':''}-m ${q(payload.message)}`,'branch-switch':`git switch ${q(payload.branch)}`,merge:`git merge ${payload.mode==='no-ff'?'--no-ff ':payload.mode==='squash'?'--squash ':payload.mode==='no-commit'?'--no-commit ':''}${q(payload.branch)}`,'rebase-start':`git rebase ${q(payload.branch)}`,'cherry-pick':`git cherry-pick ${String(payload.commit||'').slice(0,12)}`,'cherry-pick-many':`git cherry-pick ${(payload.commits||[]).map(item=>String(item).slice(0,8)).join(' ')}`,'revert-commit':`git revert --no-edit ${String(payload.commit||'').slice(0,12)}`,'reset-commit':`git reset --${payload.mode||'mixed'} ${String(payload.commit||'').slice(0,12)}`,'stage-all':'git add -A','unstage-all':'git reset','worktree-prune':'git worktree prune --verbose'};return map[action]||'';}

let workingDiffVersion=0;
async function loadWorkingDiff(file,staged,pane,button) {
  const version=++workingDiffVersion;
  document.querySelectorAll('.change-file-main.active').forEach((item)=>item.classList.remove('active'));button.classList.add('active');pane.replaceChildren(el('div','diff-loading','Loading working diff…'));
  try{const repo=state.workspaceRepo;const data=await api(`/api/repo/working-diff?path=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(file.path)}&staged=${staged}`);if(version!==workingDiffVersion||!pane.isConnected||!button.classList.contains('active')||button.closest('.change-file')?.hidden)return;renderWorkingPatch(pane,data.result.diff||'No textual diff.',staged,file);}
  catch(error){if(version===workingDiffVersion&&pane.isConnected)pane.replaceChildren(workspaceEmpty('Diff unavailable',error.message));}
}

function splitPatchHunks(diff){const lines=diff.split(/\r?\n/);const first=lines.findIndex((line)=>line.startsWith('@@'));if(first<0)return {header:lines,hunks:[]};const header=lines.slice(0,first);const hunks=[];let current=[];for(const line of lines.slice(first)){if(line.startsWith('@@')&&current.length){hunks.push(current);current=[];}current.push(line);}if(current.length)hunks.push(current);return {header,hunks};}
// One row of a working-tree patch: real old/new line numbers from the @@ header, and
// raw git header lines (diff --git, index, ---, +++) marked so CSS can hide them.
// Hidden rows stay in the DOM because line staging maps rows to patch indexes.
function workingDiffRow(line,inHunk,oldNo,newNo){
  if(line.startsWith('@@')){const match=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);return {kind:'diff-hunk',inHunk:true,oldNo:match?+match[1]:oldNo,newNo:match?+match[2]:newNo,old:'',new:''};}
  if(!inHunk)return {kind:/^(diff --git |index |--- |\+\+\+ )/.test(line)?'diff-meta':'diff-file',inHunk,oldNo,newNo,old:'',new:''};
  if(line.startsWith('+'))return {kind:'diff-add',inHunk,oldNo,newNo:newNo+1,old:'',new:String(newNo)};
  if(line.startsWith('-'))return {kind:'diff-remove',inHunk,oldNo:oldNo+1,newNo,old:String(oldNo),new:''};
  if(line.startsWith('\\'))return {kind:'diff-eof',inHunk,oldNo,newNo,old:'',new:''};
  return {kind:'',inHunk,oldNo:oldNo+1,newNo:newNo+1,old:String(oldNo),new:String(newNo)};
}
function renderWorkingPatch(pane,diff,staged,file){const parsed=splitPatchHunks(diff);const wrapper=el('div','patch-view');if(parsed.hunks.length){const toolbar=el('div','patch-toolbar');toolbar.append(el('strong','',file.path),el('small','',`${parsed.hunks.length} hunk(s) · Select individual hunks to act on`));wrapper.append(toolbar);}const renderLines=(lines,numbered=true)=>{const pre=el('div',numbered?'diff-code numbered':'diff-code');let oldNo=0,newNo=0,inHunk=false;lines.slice(0,6000).forEach((line)=>{const row=workingDiffRow(line,inHunk,oldNo,newNo);inHunk=row.inHunk;oldNo=row.oldNo;newNo=row.newNo;const node=el('div',row.kind,line||' ');if(numbered){node.dataset.old=row.old;node.dataset.new=row.new;}pre.append(node);});return pre;};if(!parsed.hunks.length){wrapper.append(renderLines(parsed.header,false));pane.replaceChildren(wrapper);return;}parsed.hunks.forEach((hunk,index)=>{const box=el('section','patch-hunk');const controls=el('div','patch-hunk-actions');controls.append(el('span','',`Hunk ${index+1}`));const mode=staged?'unstage':'stage';const action=el('button','',staged?'Unstage hunk':'Stage hunk');action.addEventListener('click',()=>runWorkspaceAction('apply-patch',{mode,patch:[...parsed.header,...hunk,''].join('\n')},`${staged?'Unstage':'Stage'} hunk ${index+1} of ${file.path}?`));controls.append(action);if(!staged&&file.status!=='??'){const discard=el('button','danger','Discard hunk');discard.addEventListener('click',()=>runWorkspaceAction('apply-patch',{mode:'discard',patch:[...parsed.header,...hunk,''].join('\n')},`Discard changes in hunk ${index+1} of ${file.path}?\nThis cannot be undone`));controls.append(discard);}box.append(controls,renderLines([...parsed.header,...hunk]));wrapper.append(box);});pane.replaceChildren(wrapper);}

function buildChangeGroup(title,files,staged,diffPane,selected,onSelectionChange) {
  const group=el('section','change-group');const head=el('div','change-group-head');const label=el('div','change-group-label');label.append(el('strong','',title),el('span','',`${files.length} file${files.length===1?'':'s'}`));const all=el('button','change-group-action',staged?'Unstage all':'Stage all');all.type='button';setDisabledReason(all,!files.length,staged?'No staged files to unstage.':'No unstaged files to stage.');all.addEventListener('click',()=>runWorkspaceAction(staged?'unstage-all':'stage-all'));head.append(label,all);group.append(head);
  if(!files.length){group.append(el('p','scan-location-empty',staged?'No staged files':'No unstaged files'));return group;}
  files.forEach((file)=>{const key=`${staged?'s':'u'}:${file.path}`;const row=el('div','change-file');const check=document.createElement('input');check.type='checkbox';check.className='change-select';check.checked=selected.has(key);check.setAttribute('aria-label',`Select ${file.path}`);check.addEventListener('change',()=>{if(check.checked)selected.add(key);else selected.delete(key);row.classList.toggle('selected',check.checked);onSelectionChange();});row.classList.toggle('selected',check.checked);const main=el('button','change-file-main');main.type='button';main.title=file.path;const code=el('i',`file-status file-status-${(staged?file.indexStatus:file.worktreeStatus||'?').toLowerCase()}`,staged?file.indexStatus:file.worktreeStatus||'?');const name=el('span','change-file-path',file.path);main.append(code,name);main.addEventListener('click',()=>loadWorkingDiff(file,staged,diffPane,main));const tools=el('div','change-file-tools');const action=el('button','change-file-action',staged?'−':'＋');action.type='button';action.title=staged?'Unstage file':'Stage file';action.setAttribute('aria-label',action.title);action.addEventListener('click',()=>runWorkspaceAction(staged?'unstage-file':'stage-file',{file:file.path}));tools.append(action);row.append(check,main,tools);row.addEventListener('contextmenu',(event)=>showContextMenu(event,workingFileContextItems(file,staged,diffPane,main)));group.append(row);});return group;
}

function renderChangesView(content,data) {
  const allStaged=data.files.filter((file)=>file.staged);const allUnstaged=data.files.filter((file)=>file.unstaged);const draftKey=repoKey(state.workspaceRepo);const shell=el('section','changes-workspace');
  const commandbar=el('header','changes-commandbar');const summary=el('div','changes-summary');const protectedCount=Number(data.protectedUntracked?.count||0);summary.append(el('h3','','File Status'),el('p','',data.files.length?`${allStaged.length} staged · ${allUnstaged.length} unstaged`:'Working tree clean'));if(protectedCount){const protectedNote=el('small','changes-protected-note',`🛡 ${protectedCount} IDE-generated item${protectedCount===1?'':'s'} protected`);protectedNote.title=`Git Deck will not show or stage: ${(data.protectedUntracked.paths||[]).join(', ')}`;summary.append(protectedNote);}
  const sort=document.createElement('select');sort.setAttribute('aria-label','Sort changed files');sort.append(new Option('Modified files · status','status'),new Option('File name · A–Z','name'));const search=el('input','changes-search','');search.type='search';search.placeholder='Search changed files…';search.setAttribute('aria-label','Search changed files');const discardAll=el('button','danger ghost-danger','Discard tracked…');discardAll.type='button';setDisabledReason(discardAll,!data.files.some(file=>file.status!=='??'),'No tracked changes to discard. Untracked files are not deleted.');discardAll.addEventListener('click',()=>{const answer=prompt('This cannot be undone. All tracked and staged changes will be discarded.\nType DISCARD to confirm');if(answer==='DISCARD')runWorkspaceAction('discard-tracked',{},'Confirm discarding all tracked changes?');});commandbar.append(summary,sort,search,discardAll);shell.append(commandbar);

  const selected=new Set();const bulk=el('div','change-bulk hidden');const bulkCount=el('strong','','0 selected');const stageSelected=el('button','','Stage selected');const unstageSelected=el('button','','Unstage selected');const discardSelected=el('button','danger','Discard selected');bulk.append(bulkCount,stageSelected,unstageSelected,discardSelected);shell.append(bulk);const selectedPaths=(prefix)=>[...selected].filter(key=>key.startsWith(prefix+':')).map(key=>key.slice(2));const updateBulk=()=>{bulk.classList.toggle('hidden',!selected.size);bulkCount.textContent=`${selected.size} selected`;setDisabledReason(stageSelected,!selectedPaths('u').length,'Select unstaged files first.');setDisabledReason(unstageSelected,!selectedPaths('s').length,'Select staged files first.');setDisabledReason(discardSelected,!selectedPaths('u').some(path=>allUnstaged.some(file=>file.path===path&&file.status!=='??')),'Select tracked unstaged changes. Untracked files are not deleted.');};stageSelected.addEventListener('click',()=>runWorkspaceAction('files-bulk',{mode:'stage',files:selectedPaths('u')},`Stage ${selectedPaths('u').length} selected files?`));unstageSelected.addEventListener('click',()=>runWorkspaceAction('files-bulk',{mode:'unstage',files:selectedPaths('s')},`Unstage ${selectedPaths('s').length} selected files?`));discardSelected.addEventListener('click',()=>{const files=selectedPaths('u').filter(path=>{const item=allUnstaged.find(file=>file.path===path);return item&&item.status!=='??';});if(files.length)runWorkspaceAction('files-bulk',{mode:'discard',files},`Discard tracked changes in ${files.length} files?\nThis cannot be undone`);});

  const layout=el('div','changes-layout');const groups=el('div','change-groups');const diff=el('div','working-diff');diff.append(workspaceEmpty('Select a changed file','Select a file on the left to view its diff. Right-click for more actions.'));layout.append(groups,diff);shell.append(layout);
  const renderGroups=()=>{const term=search.value.trim().toLowerCase();const order=(files)=>files.filter(file=>!term||file.path.toLowerCase().includes(term)).sort((a,b)=>sort.value==='name'?a.path.localeCompare(b.path):(a.status.localeCompare(b.status)||a.path.localeCompare(b.path)));groups.replaceChildren(buildChangeGroup('Staged files',order(allStaged),true,diff,selected,updateBulk),buildChangeGroup('Unstaged files',order(allUnstaged),false,diff,selected,updateBulk));const first=groups.querySelector('.change-file-main');if(first&&!diff.querySelector('.patch-view'))first.click();};search.addEventListener('input',renderGroups);sort.addEventListener('change',renderGroups);renderGroups();

  const form=el('form','commit-composer');const identity=el('div','commit-identity');const identityName=data.settings?.userName||'Git user';const initials=identityName.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'G';identity.append(el('span','commit-avatar',initials),el('div','commit-author'));identity.lastChild.append(el('strong','',identityName),el('small','',data.settings?.userEmail||'Set identity in Settings'));
  const editor=el('div','commit-editor');const message=document.createElement('textarea');message.placeholder='Commit message';message.value=state.meta.commitDrafts[draftKey]||'';message.rows=2;message.maxLength=500;message.setAttribute('aria-label','Commit message');const hint=el('small','commit-shortcut','Ctrl + Enter to commit');editor.append(message,hint);
  const options=el('div','commit-options');const amend=document.createElement('input');amend.type='checkbox';const amendLabel=el('label','commit-option');amendLabel.append(amend,el('span','','Amend latest commit'));const push=document.createElement('input');push.type='checkbox';const pushLabel=el('label','commit-option');pushLabel.append(push,el('span','','Open Push after commit'));options.append(amendLabel,pushLabel);
  const commit=el('button','primary commit-submit',`Commit ${allStaged.length} staged`);commit.type='submit';
  const commitActions=el('div','commit-action-block'),commitReason=el('small','action-disabled-reason');commitReason.id='commit-disabled-reason';commitReason.setAttribute('role','status');commit.setAttribute('aria-describedby',commitReason.id);
  const commitTarget=el('small','action-target',`${state.workspaceRepo.name} · ${data.branch||'Detached HEAD'} · Local only`);commitTarget.title=state.workspaceRepo.path;commitActions.append(commitTarget,commit,commitReason);form.append(identity,editor,options,commitActions);shell.append(form);content.append(shell);
  const updateCommit=()=>{const reason=data.operation?.conflicts?.length?'Resolve conflicts in Conflict Center first.':!allStaged.length&&!amend.checked?'Stage files above to commit.':!message.value.trim()?'Enter a commit message.':'';setDisabledReason(commit,Boolean(reason),reason);commitReason.textContent=reason;commit.textContent=amend.checked?'Amend latest commit':`Commit ${allStaged.length} staged`;};
  const saveDraft=()=>{state.meta.commitDrafts[draftKey]=message.value;saveMeta();updateCommit();};message.addEventListener('input',saveDraft);amend.addEventListener('change',()=>{if(amend.checked&&!message.value){message.value=data.headMessage||'';saveDraft();}updateCommit();});updateCommit();message.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();if(!commit.disabled)form.requestSubmit();}});
  form.addEventListener('submit',async(event)=>{event.preventDefault();if(!allStaged.length&&!amend.checked)return;const value=message.value.trim();if(!value){message.focus();return;}const scope=allStaged.length?`${allStaged.length} staged files`:'message only (no files staged)';const result=await runWorkspaceAction('commit',{message:value,amend:amend.checked},`${amend.checked?'Also amend the latest commit':'Commit'} ${scope} locally?\nThis will not push`);if(result){delete state.meta.commitDrafts[draftKey];saveMeta();if(push.checked)showPushDialog();}});
}

function renderBranchesView(content,data) {
  const remoteBranches=data.remoteBranches||[];
  const heading=workspaceHeading('Branches',`${data.branches.length} local · ${remoteBranches.length} remote — Search to narrow the list`);
  const form=el('form','workspace-form');const prefix=document.createElement('select');[['','Custom'],['feature/','Feature'],['release/','Release'],['hotfix/','Hotfix']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;prefix.append(option);});prefix.setAttribute('aria-label','Branch type');const input=el('input','','');input.placeholder='New branch name';input.setAttribute('aria-label','New branch name');const create=el('button','primary','Create & switch');create.type='submit';form.append(prefix,input,create);heading.box.append(form);content.append(heading.box);
  form.addEventListener('submit',(event)=>{event.preventDefault();const raw=input.value.trim();const branch=raw?(raw.startsWith(prefix.value)?raw:`${prefix.value}${raw}`):'';if(branch)runWorkspaceAction('branch-create',{branch},`Create branch “${branch}” and switch to it now?`);});
  const search=el('input','history-search','');search.type='search';search.placeholder='Search local or remote branch…';content.append(search);
  const summary=el('p','branch-result-summary');content.append(summary);const list=workspaceList();content.append(list);
  const draw=()=>{list.replaceChildren();const term=search.value.trim().toLowerCase();const local=data.branches.filter((branch)=>!term||branch.name.toLowerCase().includes(term));const remote=remoteBranches.filter((branch)=>!term||branch.name.toLowerCase().includes(term));const combined=[...local.map((item)=>({kind:'local',...item})),...remote.map((item)=>({kind:'remote',...item}))];const shown=combined.slice(0,100);summary.textContent=`Showing ${shown.length} of ${combined.length} matching branches${combined.length>100?' — Type to narrow the results':''}`;
    if(!shown.length){list.append(workspaceEmpty('No matching branches','Try searching for part of a branch name'));return;}
    shown.forEach((branch)=>{const wrap=el('section','branch-card');const row=el('div','workspace-row');const label=el('div');const isLocal=branch.kind==='local';label.append(el('strong',branch.current?'current-branch':'',`${branch.current?'● ':''}${branch.name}`),el('small','',isLocal?(branch.upstream?`Local · tracks ${branch.upstream}`:'Local branch'):`Remote branch · ${branch.hash||''}`));const actions=el('div','workspace-row-actions');
      if(isLocal){const change=el('button','','Switch');change.disabled=branch.current;change.addEventListener('click',()=>runWorkspaceAction('branch-switch',{branch:branch.name},`Switch from ${data.branch} to branch ${branch.name}?`));const manage=el('button','','Manage');manage.addEventListener('click',()=>wrap.classList.toggle('expanded'));actions.append(change,manage);}
      else{const track=el('button','','Track & switch');track.addEventListener('click',()=>runWorkspaceAction('branch-track',{branch:branch.name},`Create a local branch to track ${branch.name} and switch to it?`));const parts=branch.name.split('/');const remote=parts.shift();const remoteName=parts.join('/');const del=el('button','danger','Delete remote');del.addEventListener('click',()=>runWorkspaceAction('branch-delete-remote',{remote,branch:remoteName},`Delete ${branch.name} from remote?\nThis branch will no longer be available to collaborators`));actions.append(track,del);}
      row.append(label,actions);row.addEventListener('contextmenu',(event)=>showContextMenu(event,branchContextItems(data,branch,isLocal?'local':'remote')));wrap.append(row);
      if(isLocal){const panel=el('div','branch-manage');const mergeMode=document.createElement('select');[['default','Merge'],['no-ff','Merge --no-ff'],['squash','Squash'],['no-commit','No commit']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;mergeMode.append(option);});const merge=el('button','','Run merge');setDisabledReason(merge,branch.current,'This is already the working branch. Select a different branch to merge.');merge.addEventListener('click',()=>runWorkspaceAction('merge',{branch:branch.name,mode:mergeMode.value},`Merge ${branch.name} into ${data.branch} using ${mergeMode.value}?`));const rebase=el('button','','Rebase onto');setDisabledReason(rebase,branch.current,'Choose a different base branch.');rebase.addEventListener('click',()=>runWorkspaceAction('rebase-start',{branch:branch.name},`Rebase ${data.branch} on ${branch.name}?\nCommits on the current branch will be rewritten`));const renameInput=el('input','','');renameInput.value=branch.name;renameInput.setAttribute('aria-label',`New name for ${branch.name}`);const rename=el('button','','Rename');rename.addEventListener('click',()=>runWorkspaceAction('branch-rename',{branch:branch.name,newName:renameInput.value.trim()},`Rename ${branch.name} to ${renameInput.value.trim()}?`));const upstream=document.createElement('select');upstream.append(el('option','','Choose upstream…'));remoteBranches.forEach((item)=>{const option=el('option','',item.name);option.value=item.name;option.selected=item.name===branch.upstream;upstream.append(option);});const setUp=el('button','','Set upstream');setUp.disabled=!remoteBranches.length;setUp.addEventListener('click',()=>runWorkspaceAction('branch-set-upstream',{branch:branch.name,upstream:upstream.value},`Set ${branch.name} to track ${upstream.value}?`));const unset=el('button','','Unset upstream');unset.disabled=!branch.upstream;unset.addEventListener('click',()=>runWorkspaceAction('branch-unset-upstream',{branch:branch.name},`Remove upstream for ${branch.name}?`));const del=el('button','danger','Delete local');setDisabledReason(del,branch.current,'Check out a different branch before deleting this one.');del.addEventListener('click',()=>runWorkspaceAction('branch-delete',{branch:branch.name,force:false},`Delete local branch ${branch.name}?\nGit will refuse if the branch is not fully merged`));const force=el('button','danger','Force delete');setDisabledReason(force,branch.current,'Check out a different branch before deleting this one.');force.addEventListener('click',()=>{const answer=prompt(`Type the branch name to force delete\n${branch.name}`);if(answer===branch.name)runWorkspaceAction('branch-delete',{branch:branch.name,force:true},`Confirm force delete ${branch.name}?`);});panel.append(mergeMode,merge,rebase,renameInput,rename,upstream,setUp,unset,del,force);wrap.append(panel);}list.append(wrap);});};search.addEventListener('input',draw);draw();
}

function buildCommitGraph(history) {
  const lanes=[];const laneColors=[];let nextColor=0;
  const rows=history.map((commit)=>{
    // The top boundary must exactly match the previous row's bottom boundary.
    const before=[...lanes],beforeColors=[...laneColors];
    let lane=lanes.indexOf(commit.fullHash);
    if(lane<0){lane=lanes.length;lanes.push(commit.fullHash);laneColors.push(nextColor++%6);}
    const nodeColor=laneColors[lane],parents=[...new Set(commit.parents||[])];
    const first=parents[0];
    if(first&&!lanes.includes(first)){lanes[lane]=first;}
    else{lanes.splice(lane,1);laneColors.splice(lane,1);}
    for(const parent of parents.slice(1)){
      if(!lanes.includes(parent)){lanes.push(parent);laneColors.push(nextColor++%6);}
    }
    const after=[...lanes],afterColors=[...laneColors];
    const width=Math.max(1,lane+1,before.length,after.length);
    const head=`${commit.decorations||''}`.split(',').some(ref=>ref.trim()==='HEAD'||ref.trim().startsWith('HEAD ->'));
    return {lane,width,merge:parents.length>1,before,after,beforeColors,afterColors,nodeColor,commit:commit.fullHash,parents,head};
  });
  const graphWidth=Math.max(56,...rows.map(row=>18+(row.width-1)*13));
  return rows.map(row=>({...row,graphWidth}));
}

function renderGraphCell(meta,index) {
  const graph=el('span','commit-graph');const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');const x=lane=>9+lane*13;const palette=['#16875b','#e06c45','#6b66c8','#d3a517','#3d85c6','#bd507d'];const color=value=>palette[(Number(value)||0)%palette.length];const path=(fromX,fromY,toX,toY,stroke,emphasis=false)=>{const node=document.createElementNS(ns,'path');const bend=Math.abs(toX-fromX)>1?`C ${fromX} ${(fromY+toY)/2}, ${toX} ${(fromY+toY)/2}, ${toX} ${toY}`:`L ${toX} ${toY}`;node.setAttribute('d',`M ${fromX} ${fromY} ${bend}`);node.setAttribute('stroke',stroke);node.setAttribute('class',emphasis?'graph-edge graph-edge-active':'graph-edge');svg.append(node);};svg.setAttribute('viewBox',`0 0 ${meta.graphWidth} 28`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  document.querySelector('.commit-list')?.style.setProperty('--commit-graph-width',`${meta.graphWidth}px`);
  if(document.querySelector('.history-search')?.value?.trim()){
    graph.setAttribute('class','commit-graph graph-filtered');
    graph.title='Search results omit rows; connecting lines are hidden to avoid implying false ancestry.';
  }
  meta.before.forEach((ref,fromLane)=>{if(ref===meta.commit){path(x(fromLane),0,x(meta.lane),14,color(meta.nodeColor),true);return;}const toLane=meta.after.indexOf(ref);if(toLane>=0)path(x(fromLane),0,x(toLane),28,color(meta.beforeColors[fromLane]));});
  meta.parents.forEach((parent,parentIndex)=>{const toLane=meta.after.indexOf(parent);if(toLane>=0)path(x(meta.lane),14,x(toLane),28,color(meta.afterColors[toLane]),parentIndex===0);});
  const marker=document.createElementNS(ns,meta.merge?'polygon':'circle');if(meta.merge)marker.setAttribute('points',`${x(meta.lane)},8 ${x(meta.lane)+6},14 ${x(meta.lane)},20 ${x(meta.lane)-6},14`);else{marker.setAttribute('cx',String(x(meta.lane)));marker.setAttribute('cy','14');marker.setAttribute('r',meta.head?'5.5':'4');}marker.setAttribute('fill',color(meta.nodeColor));marker.setAttribute('class',meta.head?'graph-node graph-head':'graph-node');svg.append(marker);if(meta.head){const ring=document.createElementNS(ns,'circle');ring.setAttribute('cx',String(x(meta.lane)));ring.setAttribute('cy','14');ring.setAttribute('r','8');ring.setAttribute('stroke',color(meta.nodeColor));ring.setAttribute('class','graph-head-ring');svg.append(ring);}graph.append(svg);return graph;
}

function diffLineKind(line){return line.startsWith('+++')||line.startsWith('---')?'diff-file':line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-remove':line.startsWith('@@')?'diff-hunk':'';}
function renderUnifiedDiff(lines){const code=el('div','diff-code');lines.forEach((line)=>code.append(el('div',diffLineKind(line),line||' ')));return code;}
function renderSplitDiff(lines){const code=el('div','diff-split-code');let removed=[];let added=[];const flush=()=>{const size=Math.max(removed.length,added.length);for(let index=0;index<size;index+=1){const row=el('div','diff-split-row');row.append(el('span',removed[index]!==undefined?'diff-remove':'',removed[index]??' '),el('span',added[index]!==undefined?'diff-add':'',added[index]??' '));code.append(row);}removed=[];added=[];};for(const line of lines){if(line.startsWith('-')&&!line.startsWith('---'))removed.push(line);else if(line.startsWith('+')&&!line.startsWith('+++'))added.push(line);else{flush();const row=el('div','diff-split-row diff-split-context');row.append(el('span',diffLineKind(line),line||' '),el('span',diffLineKind(line),line||' '));code.append(row);}}flush();return code;}
function createDiffViewer(diff,title='Diff'){const preferences=state.meta.diffPreferences;const lines=(diff||'No textual diff.').split(/\r?\n/).slice(0,6000);const viewer=el('section','diff-viewer');const toolbar=el('div','diff-viewer-toolbar');const label=el('strong','',title);label.title=title;const mode=document.createElement('select');mode.setAttribute('aria-label','Diff layout');mode.append(new Option('Unified','unified'),new Option('Side by side','split'));mode.value=preferences.mode;const search=document.createElement('input');search.type='search';search.placeholder='Find in diff';search.setAttribute('aria-label','Find in diff');const wrap=el('button',preferences.wrap?'active':'','Wrap');wrap.type='button';const smaller=el('button','','A−');smaller.type='button';smaller.title='Smaller diff text';const larger=el('button','','A+');larger.type='button';larger.title='Larger diff text';const copy=el('button','','Copy');copy.type='button';const full=el('button','','⛶');full.type='button';full.title='Full screen diff (Esc to close)';toolbar.append(label,mode,search,wrap,smaller,larger,copy,full);const body=el('div','diff-viewer-body');viewer.append(toolbar,body);
  const draw=()=>{const term=search.value.trim().toLowerCase();const visible=term?lines.filter((line)=>line.toLowerCase().includes(term)):lines;body.replaceChildren(preferences.mode==='split'?renderSplitDiff(visible):renderUnifiedDiff(visible));body.classList.toggle('wrap-lines',preferences.wrap);body.style.setProperty('--diff-font-size',`${preferences.fontSize}px`);};
  mode.addEventListener('change',()=>{preferences.mode=mode.value;saveMeta();draw();});search.addEventListener('input',draw);wrap.addEventListener('click',()=>{preferences.wrap=!preferences.wrap;wrap.classList.toggle('active',preferences.wrap);saveMeta();draw();});smaller.addEventListener('click',()=>{preferences.fontSize=Math.max(8,preferences.fontSize-1);saveMeta();draw();});larger.addEventListener('click',()=>{preferences.fontSize=Math.min(14,preferences.fontSize+1);saveMeta();draw();});copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(diff);setNotice('Diff copied.');}catch{setNotice('Copy failed.');}});full.addEventListener('click',()=>viewer.classList.toggle('diff-fullscreen'));viewer.addEventListener('keydown',(event)=>{if(event.key==='Escape')viewer.classList.remove('diff-fullscreen');});draw();return viewer;}

const historyReadTokens=new WeakMap();
function commitViewMemory(path,hash){
  const key='git-deck-commit-view:'+String(path).toLowerCase();let values={};
  try{const parsed=JSON.parse(localStorage.getItem(key)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))values=parsed;}catch{}
  const value=values[hash]&&typeof values[hash]==='object'?values[hash]:{};
  return {value,save(update){try{const latest=JSON.parse(localStorage.getItem(key)||'{}');if(latest&&typeof latest==='object'&&!Array.isArray(latest))values=latest;}catch{}Object.assign(value,values[hash]||{},update);delete values[hash];values[hash]=value;values=Object.fromEntries(Object.entries(values).slice(-20));try{localStorage.setItem(key,JSON.stringify(values));}catch{}}};
}
function beginHistoryRead(pane){
  const token={},path=state.workspaceRepo?.path;historyReadTokens.set(pane,token);
  return ()=>historyReadTokens.get(pane)===token&&pane.isConnected&&state.workspaceRepo?.path===path;
}
async function loadCommitDiff(commit,file,diffPane) {
  const current=beginHistoryRead(diffPane);
  const focus=Boolean(diffPane.diffFocus);diffPane.diffFocus=false;
  diffPane.replaceChildren(el('div','diff-loading','Loading diff…'));
  try{
    const repo=state.workspaceRepo;const data=await api(`/api/repo/commit-diff?path=${encodeURIComponent(repo.path)}&commit=${encodeURIComponent(commit.fullHash)}&file=${encodeURIComponent(file.path)}`);
    if(current()){
      diffPane.replaceChildren(createDiffViewer(data.result.diff||'No textual diff.',file.path,{status:file.status?.charAt(0),binary:file.binary,truncated:data.result.truncated,focus,filePosition:diffPane.diffFilePosition,navigate:diffPane.diffNavigate,content:()=>api('/api/repo/commit-content?'+new URLSearchParams({path:repo.path,commit:commit.fullHash,file:file.path}))}));
      const memory=commitViewMemory(repo.path,commit.fullHash),body=diffPane.querySelector?.('.diff-viewer-body');
      if(body){if(memory.value.file===file.path){body.scrollTop=Math.max(0,Number(memory.value.top)||0);body.scrollLeft=Math.max(0,Number(memory.value.left)||0);}body.addEventListener('scroll',()=>{if(current())memory.save({file:file.path,top:body.scrollTop,left:body.scrollLeft});},{passive:true});}
    }
  }catch(error){if(current()){const box=workspaceEmpty('Diff unavailable',error.message);const retry=el('button','','Retry loading diff');retry.type='button';retry.onclick=()=>{if(current())loadCommitDiff(commit,file,diffPane);};box.append(retry);diffPane.replaceChildren(box);}}
}

async function loadFileHistory(file,diffPane){const current=beginHistoryRead(diffPane);diffPane.replaceChildren(el('div','diff-loading','Loading file history…'));try{const repo=state.workspaceRepo;const data=await api(`/api/repo/file-history?path=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(file.path)}`);if(!current())return;const list=el('div','file-history-list');if(!data.history.length)list.append(workspaceEmpty('No file history',''));data.history.forEach((item)=>{const row=el('div','file-history-row');row.append(el('code','',item.hash),el('strong','',item.subject),el('small','',`${item.author} · ${item.date}`));list.append(row);});diffPane.replaceChildren(list);}catch(error){if(current())diffPane.replaceChildren(workspaceEmpty('File history unavailable',error.message));}}
async function loadFileBlame(file,diffPane){const current=beginHistoryRead(diffPane);diffPane.replaceChildren(el('div','diff-loading','Loading blame…'));try{const repo=state.workspaceRepo;const data=await api(`/api/repo/blame?path=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(file.path)}`);if(!current())return;const pre=el('pre','blame-output',data.result.text||'No blame data');diffPane.replaceChildren(pre);}catch(error){if(current())diffPane.replaceChildren(workspaceEmpty('Blame unavailable',error.message));}}

async function loadCommitDetail(commit,detailPane,selectedRow) {
  const current=beginHistoryRead(detailPane);
  detailPane.replaceChildren(el('div','diff-loading','Loading commit details…'));
  document.querySelectorAll('.commit-row.selected').forEach((row)=>row.classList.remove('selected'));selectedRow.classList.add('selected');
  try{
    const repo=state.workspaceRepo;const data=await api(`/api/repo/commit?path=${encodeURIComponent(repo.path)}&commit=${encodeURIComponent(commit.fullHash)}`);if(!current())return;const item=data.commit;
    const meta=el('section','commit-detail-meta');const title=el('div');title.append(el('h3','',item.subject),el('p','',`${item.hash} · ${item.author} · ${item.date}`));const actions=el('div','commit-detail-actions');const copy=el('button','','Copy hash');copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(item.fullHash);setNotice(`Copied ${item.hash}`);});const tag=el('button','','Add tag');tag.title=`Create tag at ${item.hash}`;tag.addEventListener('click',()=>openTagCreator(item.fullHash));const cherry=el('button','','Cherry-pick');cherry.addEventListener('click',()=>runWorkspaceAction('cherry-pick',{commit:item.fullHash},`Apply commit ${item.hash} onto branch ${state.workspace.branch}?\nSafety Center will open if conflicts occur`));const revert=el('button','','Revert');revert.addEventListener('click',()=>runWorkspaceAction('revert-commit',{commit:item.fullHash},`Create a new commit to revert ${item.hash}?\nExisting history will not be deleted`));const reset=document.createElement('select');[['','Reset…'],['soft','Soft'],['mixed','Mixed'],['hard','Hard']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;reset.append(option);});reset.addEventListener('change',()=>{const mode=reset.value;reset.value='';if(!mode)return;const warning=mode==='hard'?'\nUncommitted changes will be permanently discarded':'';runWorkspaceAction('reset-commit',{commit:item.fullHash,mode},`Reset branch ${state.workspace.branch} to ${item.hash} using ${mode}?${warning}`);});const menu=el('details','commit-action-menu');const summary=el('summary','','Actions…');const target=el('small','',`Target: ${item.hash}`);menu.append(summary,target,cherry,revert,reset);actions.append(copy,tag,menu);meta.append(title,actions);
    if(item.body&&item.body!==item.subject){const message=el('details','commit-message-fold');message.append(el('summary','','Commit message'),el('pre','commit-message',item.body));meta.append(message)};
    const split=el('div','commit-detail-split');const files=el('div','commit-files');const resize=el('div','commit-detail-resizer');resize.tabIndex=0;resize.setAttribute('role','separator');resize.setAttribute('aria-label','Resize changed files and diff panes');resize.setAttribute('aria-orientation','vertical');resize.title='Drag horizontally to resize. Double-click to reset.';const diff=el('div','commit-diff');split.append(files,resize,diff);files.append(meta);detailPane.replaceChildren(split);initializeCommitDetailResizer(split,resize);
    if(!item.files.length){files.append(workspaceEmpty('No changed files','This commit has no file diff'));diff.append(workspaceEmpty('No diff',''));return;}
    const fileHeader=el('div','commit-files-header');const fileHeading=el('div','commit-files-title');fileHeading.append(el('strong','','Changed files'),el('small','',`${item.files.length} files`));const fileSearch=el('input','commit-files-search','');fileSearch.type='search';fileSearch.placeholder='Search changed files…';fileSearch.setAttribute('aria-label','Search changed files');fileHeader.append(fileHeading,fileSearch);const fileList=el('div','commit-file-list');files.append(fileHeader,fileList);
    const fileMemory=commitViewMemory(repo.path,item.fullHash);
    const statusLabels={A:'Added',M:'Modified',D:'Deleted',R:'Renamed',C:'Copied',T:'Type changed',U:'Unmerged'};let selectedPath=item.files.some(f=>f.path===fileMemory.value.file)?fileMemory.value.file:item.files[0].path;
    fileSearch.value=typeof fileMemory.value.search==='string'?fileMemory.value.search:'';
    if(fileSearch.value&&!item.files.some(f=>f.path.toLowerCase().includes(fileSearch.value.toLowerCase())))fileSearch.value='';
    fileSearch.addEventListener('input',()=>fileMemory.save({search:fileSearch.value}));
    const showFile=(file,button)=>{diff.diffFilePosition=`File ${item.files.findIndex(entry=>entry.path===file.path)+1} of ${item.files.length}`;selectedPath=file.path;const same=fileMemory.value.file===file.path;fileMemory.save({file:file.path,...(!same?{top:0,left:0}:{})});fileList.querySelectorAll('.commit-file-main').forEach((node)=>node.classList.toggle('active',node===button));fileList.querySelectorAll('.commit-file-row').forEach((node)=>node.classList.toggle('selected',node.contains(button)));loadCommitDiff(item,file,diff);};
    const drawFiles=()=>{const term=fileSearch.value.trim().toLowerCase();const visible=item.files.filter((file)=>!term||file.path.toLowerCase().includes(term));fileList.replaceChildren();fileHeading.querySelector('small').textContent=term?`${visible.length} of ${item.files.length}`:`${item.files.length} files`;if(!visible.length){fileList.append(workspaceEmpty('No matching files','Search by file or folder name'));return;}if(!visible.some((file)=>file.path===selectedPath))selectedPath=visible[0].path;let selectedButton=null;visible.forEach((file)=>{const normalized=file.path.replaceAll('\\','/');const parts=normalized.split('/');const name=parts.pop()||normalized;const directory=parts.join('/')||'Repository root';const status=(file.status||'M').trim().charAt(0).toUpperCase();const row=el('div','commit-file-row');row.dataset.status=status;const button=el('button','commit-file-main');button.title=file.path;button.dataset.path=file.path;const badge=el('span',`commit-file-status status-${status.toLowerCase()}`,statusLabels[status]||status);badge.title=statusLabels[status]||file.status;const text=el('span','commit-file-text');text.append(el('strong','',name),el('small','',directory),el('small','file-line-counts',file.binary?'Binary':Number.isFinite(file.added)&&Number.isFinite(file.removed)?`+${file.added} / −${file.removed}`:'Line counts unavailable'));button.append(badge,text);button.addEventListener('click',()=>showFile(file,button));const tools=el('span','commit-file-tools');const history=el('button','','History');history.title=`History of ${file.path}`;history.setAttribute('aria-label',`History of ${file.path}`);history.addEventListener('click',()=>loadFileHistory(file,diff));const blame=el('button','','Blame');blame.title=`Blame ${file.path}`;blame.setAttribute('aria-label',`Blame ${file.path}`);blame.addEventListener('click',()=>loadFileBlame(file,diff));tools.append(refMenuButton(()=>[{label:'File history',run:()=>loadFileHistory(file,diff)},{label:'Blame current working revision',run:()=>loadFileBlame(file,diff)}],'File actions for '+file.path));attachCommitFileMenu(row,button,file,repo,diff,tools);row.append(button,tools);fileList.append(row);if(file.path===selectedPath)selectedButton=button;});if(selectedButton)showFile(visible.find((file)=>file.path===selectedPath),selectedButton);};
    diff.diffNavigate=(delta,focus)=>{const term=fileSearch.value.trim().toLowerCase(),visible=item.files.filter(f=>!term||f.path.toLowerCase().includes(term));if(!visible.length)return;const index=visible.findIndex(f=>f.path===selectedPath),next=visible[(index+delta+visible.length)%visible.length];const button=[...fileList.querySelectorAll('.commit-file-main')].find(b=>b.dataset.path===next.path);if(button){diff.diffFocus=focus;showFile(next,button);button.scrollIntoView({block:'nearest'});}};fileSearch.addEventListener('input',drawFiles);drawFiles();
  }catch(error){if(current())detailPane.replaceChildren(workspaceEmpty('Commit details unavailable',error.message));}
}

function appendCommitRefs(container,decorations){
  const refs=decorations.split(',').map(s=>s.trim()).filter(Boolean);
  refs.sort((a,b)=>{const rank=s=>s==='HEAD'||s.startsWith('HEAD ->')?0:s.startsWith('tag:')?1:2;return rank(a)-rank(b);});
  for(const ref of refs.slice(0,2)){const badge=el('i','',ref.startsWith('HEAD')?'● You are here · '+ref.replace(/^HEAD -> /,''):ref);badge.title=ref;container.append(badge);}
  if(refs.length>2){const more=el('span','commit-refs-more',`+${refs.length-2}`);more.title=refs.join('\n');more.tabIndex=0;more.setAttribute('role','button');more.setAttribute('aria-label','Show all branch and tag names');const open=event=>{event.stopPropagation();const box=more.getBoundingClientRect();showContextMenu({preventDefault(){},stopPropagation(){},clientX:box.left,clientY:box.bottom},refs.map(ref=>({label:ref,run:()=>{setNotice(ref);}})));};more.addEventListener('click',open);more.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(event);}});container.append(more);}
}
function createCommitListHeader(list){
  const header=el('div','commit-list-header');
  const columns=[['graph','Graph',false],['subject','Commit',true],['author','Author',true],['date','Date',true],['hash','Hash',false]];
  columns.forEach(([name,label,resizable])=>{const cell=el('span',`commit-header-${name}`,label);cell.dataset.commitColumn=name;if(resizable){const handle=el('i','commit-column-resizer');handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',`Resize ${label} column`);handle.dataset.resizeColumn=name;handle.title=`Drag horizontally to resize column ${label} · Double-click to reset`;cell.append(handle);}header.append(cell);});
  list.append(header);initializeCommitColumnResizers(list,header);
}

function initializeCommitColumnResizers(list,header){
  const defaults={subject:420,author:145,date:92};const limits={subject:[220,1000],author:[90,360],date:[70,220]};let sizes={...defaults};
  try{const saved=JSON.parse(localStorage.getItem('git-deck-commit-columns-v1')||'{}');Object.keys(defaults).forEach((key)=>{if(Number(saved[key]))sizes[key]=Number(saved[key]);});}catch{}
  const set=(name,width,save=false)=>{const [minimum,maximum]=limits[name];sizes[name]=Math.round(Math.min(Math.max(width,minimum),maximum));list.style.setProperty(`--commit-${name}-width`,`${sizes[name]}px`);const handle=header.querySelector(`[data-resize-column="${name}"]`);handle.setAttribute('aria-valuemin',String(minimum));handle.setAttribute('aria-valuemax',String(maximum));handle.setAttribute('aria-valuenow',String(sizes[name]));handle.setAttribute('aria-valuetext',`${sizes[name]} pixels`);if(save){try{localStorage.setItem('git-deck-commit-columns-v1',JSON.stringify(sizes));}catch{}}};Object.keys(defaults).forEach((name)=>set(name,sizes[name]));
  header.querySelectorAll('.commit-column-resizer').forEach((handle)=>{const name=handle.dataset.resizeColumn;let startX=0;let startWidth=sizes[name];handle.addEventListener('pointerdown',(event)=>{event.preventDefault();event.stopPropagation();startX=event.clientX;startWidth=header.querySelector(`[data-commit-column="${name}"]`).getBoundingClientRect().width;handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-pane');});handle.addEventListener('pointermove',(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;set(name,startWidth+(event.clientX-startX));});const finish=(event)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);handle.classList.remove('dragging');document.body.classList.remove('resizing-pane');set(name,sizes[name],true);};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('dblclick',(event)=>{event.stopPropagation();set(name,defaults[name],true);});handle.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();const current=header.querySelector(`[data-commit-column="${name}"]`).getBoundingClientRect().width;set(name,event.key==='Home'?defaults[name]:current+(event.key==='ArrowLeft'?-20:20),true);});});
}

function renderHistoryView(content,data) {
  const position=historyMemory();const viewKey=repoKey(state.workspaceRepo);const saved=state.meta.historyViews[viewKey]||{};const layoutMode=state.meta.historyLayouts[viewKey]||'stacked';const density=state.meta.historyDensity[viewKey]||'compact';const visibleColumns={author:state.meta.historyColumns[viewKey]?.author!==false,date:state.meta.historyColumns[viewKey]?.date!==false,hash:state.meta.historyColumns[viewKey]?.hash!==false};let history=data.history;let loading=false;let multiSelect=false;const selectedCommits=new Set();
  const heading=workspaceHeading('Commit graph',`${history.length} commits · All branches · including remote branches`);const controls=el('div','history-controls');const scope=document.createElement('select');scope.setAttribute('aria-label','Commit history scope');scope.append(new Option('All branches','all'),new Option(`Current branch · ${data.branch}`,'current'));const localGroup=document.createElement('optgroup');localGroup.label='Local branches';data.branches.forEach((branch)=>localGroup.append(new Option(branch.name,`ref:${branch.name}`)));scope.append(localGroup);const remoteGroup=document.createElement('optgroup');remoteGroup.label='Remote branches';data.remoteBranches.forEach((branch)=>remoteGroup.append(new Option(branch.name,`ref:${branch.name}`)));scope.append(remoteGroup);const tagGroup=document.createElement('optgroup');tagGroup.label='Tags';(data.tags||[]).forEach(tag=>tagGroup.append(new Option(tag,'ref:refs/tags/'+tag)));scope.append(tagGroup);scope.value=[...scope.options].some((option)=>option.value===saved.scope)?saved.scope:'all';
  const remoteLabel=el('label','history-remote-toggle');const remote=document.createElement('input');remote.type='checkbox';remote.checked=saved.showRemote!==false;remoteLabel.append(remote,document.createTextNode('Remote branches'));const order=document.createElement('select');order.setAttribute('aria-label','Commit history order');order.append(new Option('Topology order','topo'),new Option('Date order','date'));order.value=saved.orderVersion===2&&saved.order==='topo'?'topo':'date';order.title='Date order keeps recent branch activity together; Topology may require many parallel lanes.';const search=el('input','history-search','');search.type='search';search.placeholder='Search or jump to hash…';const view=document.createElement('select');view.setAttribute('aria-label','History layout');view.append(new Option('Graph above · Diff below','stacked'),new Option('Graph left · Diff right','side'),new Option('Graph only','graph'));view.value=layoutMode;const options=el('details','history-options');const optionsSummary=el('summary','','View ▾');const optionsBody=el('div','history-options-body');const denseLabel=el('label','');const dense=document.createElement('input');dense.type='checkbox';dense.checked=density==='compact';denseLabel.append(dense,document.createTextNode(' Compact rows'));const multiLabel=el('label','');const multi=document.createElement('input');multi.type='checkbox';multiLabel.append(multi,document.createTextNode(' Select multiple commits'));optionsBody.append(denseLabel,multiLabel);[['author','Author'],['date','Date'],['hash','Hash']].forEach(([key,label])=>{const item=el('label','');const check=document.createElement('input');check.type='checkbox';check.checked=visibleColumns[key];check.dataset.historyColumn=key;item.append(check,document.createTextNode(` ${label}`));optionsBody.append(item);});options.append(optionsSummary,optionsBody);controls.append(scope,remoteLabel,order,view,options,search);heading.box.append(controls);content.append(heading.box);
  const bulk=el('div','commit-bulk hidden');const bulkCount=el('strong','','0 commits selected');const cherryMany=el('button','primary','Cherry-pick selected');const clearMany=el('button','','Clear');bulk.append(bulkCount,cherryMany,clearMany);content.append(bulk);const updateMulti=()=>{bulk.classList.toggle('hidden',!multiSelect);bulkCount.textContent=`${selectedCommits.size} commits selected`;cherryMany.disabled=!selectedCommits.size;};cherryMany.addEventListener('click',()=>{const commits=history.filter(item=>selectedCommits.has(item.fullHash)).reverse().map(item=>item.fullHash);runWorkspaceAction('cherry-pick-many',{commits},`Cherry-pick ${commits.length} commits from oldest to newest?`);});clearMany.addEventListener('click',()=>{selectedCommits.clear();draw();});multi.addEventListener('change',()=>{multiSelect=multi.checked;if(!multiSelect)selectedCommits.clear();updateMulti();draw();});const layout=el('div',`history-layout layout-${layoutMode}`);const list=el('div',`commit-list ${density==='compact'?'dense':''}`);const rowResize=el('div','history-resizer');rowResize.tabIndex=0;rowResize.setAttribute('role','separator');rowResize.setAttribute('aria-label','Resize commit graph and commit details');rowResize.setAttribute('aria-orientation','horizontal');rowResize.title='Drag vertically to resize the commit graph · Double-click to reset';const detail=el('div','commit-detail');detail.append(workspaceEmpty('Select a commit','Select a commit above to view files and diffs'));layout.append(list,rowResize,detail);content.append(layout);initializeHistorySplitResizer(layout,rowResize,viewKey);
  const applyColumns=()=>{Object.entries(visibleColumns).forEach(([key,value])=>list.classList.toggle(`hide-${key}`,!value));};
  const draw=(preserve=false)=>{const previous=list.querySelector('.commit-row.selected')?.dataset.commit||position.value.commit||'';list.replaceChildren();createCommitListHeader(list);applyColumns();if(data.files.length){const wip=el('button','commit-row commit-wip');wip.title='Open File Status to review uncommitted work';const graph=el('span','commit-graph wip-node','●');const description=el('span','commit-description');description.append(el('strong','',`Working changes · ${data.files.length} file${data.files.length===1?'':'s'}`),el('span','commit-refs',''));description.lastChild.append(el('i','',data.branch||'detached'));wip.append(graph,description,el('small','commit-author','Local only'),el('time','', 'Now'),el('code','commit-hash','WIP'));wip.addEventListener('click',()=>selectWorkspaceTab('changes'));list.append(wip);}const graphMeta=buildCommitGraph(history);const term=searchMode.value==='loaded'?search.value.trim().toLowerCase():'';const items=history.map((item,index)=>({item,index})).filter(({item})=>!term||`${item.hash} ${item.author} ${item.subject} ${item.date} ${item.decorations||''}`.toLowerCase().includes(term));if(!items.length){list.append(workspaceEmpty('No matching commits','Try a different branch or search'));return;}items.forEach(({item,index})=>{const row=el('button',`commit-row ${selectedCommits.has(item.fullHash)?'multi-selected':''}`);row.dataset.commit=item.fullHash;row.title=multiSelect?'Click to select multiple commits':'Click to inspect · Right-click for actions';const description=el('span','commit-description');const subject=el('strong','',item.subject);subject.title=item.subject;description.append(subject);if(item.decorations){const refs=el('span','commit-refs');appendCommitRefs(refs,item.decorations);description.append(refs);}const author=el('small','commit-author',item.author);author.title=item.author;const date=el('time','',item.date);date.title=item.date;row.append(renderGraphCell(graphMeta[index],index),description,author,date,el('code','commit-hash',item.hash));row.addEventListener('click',()=>{if(multiSelect){if(selectedCommits.has(item.fullHash))selectedCommits.delete(item.fullHash);else selectedCommits.add(item.fullHash);row.classList.toggle('multi-selected',selectedCommits.has(item.fullHash));updateMulti();}else {position.save({commit:item.fullHash});loadCommitDetail(item,detail,row);}});row.addEventListener('contextmenu',(event)=>showContextMenu(event,commitContextItems(item)));list.append(row);});if(!multiSelect){const retained=[...list.querySelectorAll('.commit-row[data-commit]')].find(row=>row.dataset.commit===previous);if(retained){retained.classList.add('selected');if(preserve!==true)retained.click();}else if(preserve!==true){const firstRow=list.querySelector('.commit-row:not(.commit-wip)');if(firstRow)firstRow.click();}}list.append(paging);updateMulti();};
  let historyRequest=0,nextSkip=0,hasMore=false;
  const historyRepo=state.workspaceRepo.path;
  const paging=el('div','history-paging');const more=el('button','','Load next 250');more.type='button';more.disabled=true;
  const allSearch=search;search.maxLength=200;search.placeholder='Search commits or paste hash · Enter';search.setAttribute('aria-label','Search commits or hash');
  const searchMode=document.createElement('select');searchMode.setAttribute('aria-label','Search range');searchMode.append(new Option('Loaded commits','loaded'),new Option('Full history · messages','full'));
  const searchBox=el('div','history-unified-search');search.replaceWith(searchBox);searchBox.append(searchMode,search);
  const findAll=el('button','','Search history');findAll.type='button';const clearAll=el('button','','Clear search');clearAll.type='button';const jump=el('button','','Open hash…');jump.type='button';
  const pageStatus=el('span');pageStatus.setAttribute('role','status');paging.append(more,pageStatus);list.append(paging);
  search.value=position.value.search||'';searchMode.value=position.value.mode==='full'?'full':'loaded';let fullQuery=searchMode.value==='full'?search.value.trim():'';let positionTimer;list.addEventListener('scroll',()=>{if(loading)return;clearTimeout(positionTimer);const top=list.scrollTop,left=list.scrollLeft;positionTimer=setTimeout(()=>position.save({top,left}),100);});search.addEventListener('input',()=>position.save({search:search.value}));searchMode.addEventListener('change',()=>position.save({mode:searchMode.value}));
  const load=async(append=false)=>{
    append=append===true;if(append&&(loading||!hasMore))return;
    const version=++historyRequest,selection=scope.value,includeRemote=remote.checked,sortOrder=order.value,query=fullQuery;
    const signature=JSON.stringify([selection,includeRemote,sortOrder,query]);if(position.value.signature!==signature)position.save({signature,commit:'',top:0,left:0,loaded:250});
    const offset=append?nextSkip:0,mode=selection.startsWith('ref:')?'ref':selection,ref=selection.startsWith('ref:')?selection.slice(4):'';
    const current=()=>version===historyRequest&&list.isConnected&&state.workspaceRepo?.path===historyRepo;
    loading=true;more.disabled=true;pageStatus.textContent='Loading history…';
    jump.disabled=true;
    if(!append){hasMore=false;nextSkip=0;history=[];selectedCommits.clear();updateMulti();}
    if(!append){historyReadTokens.set(detail,{});detail.replaceChildren(workspaceEmpty('Loading history',''));}
    if(!append)list.replaceChildren(el('div','diff-loading','Loading commits from the selected branch…'));
    try{
      const params=new URLSearchParams({path:historyRepo,scope:mode,ref,includeRemote:String(includeRemote),order:sortOrder,skip:String(offset),q:query});
      const response=await api('/api/repo/history?'+params);if(!current())return;
      if(!append){const target=Math.min(2000,position.value.loaded||250);while(response.hasMore&&Number.isInteger(response.nextSkip)&&response.nextSkip<target){params.set('skip',String(response.nextSkip));const next=await api('/api/repo/history?'+params);if(!current())return;if(!next.history?.length||next.nextSkip<=response.nextSkip)break;response.history.push(...next.history);response.nextSkip=next.nextSkip;response.hasMore=next.hasMore;}}
      const seen=new Set(append?history.map(item=>item.fullHash):[]);
      const incoming=(response.history||[]).filter(item=>{if(seen.has(item.fullHash))return false;seen.add(item.fullHash);return true;});
      history=append?history.concat(incoming):incoming;nextSkip=response.nextSkip??(offset+response.history.length);hasMore=response.hasMore===true;position.save({loaded:history.length});
      const treeScopeChanged=state.meta.historyViews[viewKey]?.scope!==selection;
      state.meta.historyViews[viewKey]={scope:selection,showRemote:includeRemote,order:sortOrder,orderVersion:2};saveMeta();if(treeScopeChanged)renderWorkbenchTree(data);const contextBar=content.querySelector('.history-context');if(contextBar)contextBar.replaceWith(renderHistoryContext(data));
      const scopeText=selection==='all'?'All branches':selection==='current'?`Current · ${data.branch}`:ref;
      heading.text.querySelector('p').textContent=`${history.length} loaded · ${scopeText} · ${sortOrder}${query?' · message search: '+query:''}`;
      const scroll=append?list.scrollTop:position.value.top||0,left=append?list.scrollLeft:position.value.left||0;draw(append);list.scrollTop=scroll;list.scrollLeft=left;
      // Filtered history omits intervening commits, so it must not imply ancestry.
      list.classList.toggle('history-message-search',Boolean(query));
      const pagingSupported=typeof response.hasMore==='boolean'&&Number.isInteger(response.nextSkip);
      findAll.disabled=!pagingSupported;searchMode.options[1].disabled=!pagingSupported;clearAll.disabled=!pagingSupported;
      pageStatus.textContent=!pagingSupported?'Outdated server. Restart Git Deck and its server to load more commits or search full history.':`Local · Checked ${new Date().toLocaleTimeString('en-US')} · ${history.length} loaded · ${hasMore?'More available':'End of matching history'}`;
      heading.text.querySelector('p').textContent+=pagingSupported?` · Local checked ${new Date().toLocaleTimeString('en-US')}`:' · ⚠ Server update required (restart)';
    }catch(error){if(!current())return;pageStatus.textContent='Load failed — retry';if(!append)list.replaceChildren(workspaceEmpty('History unavailable',error.message));setNotice(error.message);}
    finally{if(current()){loading=false;more.disabled=!hasMore;jump.disabled=false;}}
  };
  more.onclick=()=>load(true);findAll.onclick=()=>{fullQuery=search.value.trim();load();};clearAll.onclick=()=>{search.value='';position.save({search:''});fullQuery='';load();};
  searchMode.onchange=()=>{if(searchMode.value==='loaded'&&fullQuery){fullQuery='';load();}else if(searchMode.value==='full'&&search.value.trim())findAll.click();else draw();};
  allSearch.onkeydown=event=>{if(event.key!=='Enter')return;event.preventDefault();const value=search.value.trim();if(/^[a-f0-9]{4,40}$/i.test(value)){if(loading)return;document.querySelectorAll('.commit-row.selected').forEach(row=>row.classList.remove('selected'));loadCommitDetail({fullHash:value},detail,el('span'));}else if(searchMode.value==='full'&&!findAll.disabled)findAll.click();else draw();};
  jump.onclick=()=>{const hash=prompt('Commit hash (4–40 hexadecimal characters). Searches the whole local repository.');if(!hash)return;if(!/^[a-f0-9]{4,40}$/i.test(hash.trim())){setNotice('Invalid commit hash');return;}const marker=el('span');loadCommitDetail({fullHash:hash.trim()},detail,marker);};
  scope.addEventListener('change',()=>{remote.disabled=scope.value!=='all';load();});remote.addEventListener('change',load);order.addEventListener('change',load);search.addEventListener('input',draw);view.addEventListener('change',()=>{state.meta.historyLayouts[viewKey]=view.value;saveMeta();layout.className=`history-layout layout-${view.value}`;});dense.addEventListener('change',()=>{state.meta.historyDensity[viewKey]=dense.checked?'compact':'comfortable';saveMeta();list.classList.toggle('dense',dense.checked);});optionsBody.addEventListener('change',(event)=>{const key=event.target.dataset.historyColumn;if(!key)return;visibleColumns[key]=event.target.checked;state.meta.historyColumns[viewKey]={...visibleColumns};saveMeta();applyColumns();});remote.disabled=scope.value!=='all';load();
}

function renderStashesView(content,data) {
  const heading=workspaceHeading('Stashes','Stash changes, including untracked files');const form=el('form','workspace-form');const input=el('input','','');input.placeholder='Stash message (optional)';const save=el('button','primary','Stash changes');save.type='submit';form.append(input,save);heading.box.append(form);content.append(heading.box);form.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('stash-save',{message:input.value.trim()},'Move current changes into a stash?');});
  if(!data.stashes.length){content.append(workspaceEmpty('No stashes','No stashes yet'));return;}const layout=el('div','stash-layout');const list=workspaceList();const preview=el('div','stash-preview');preview.append(workspaceEmpty('Select a stash','Review the diff before applying or dropping'));data.stashes.forEach((stash)=>{const row=el('div','workspace-row');const label=el('button','stash-label');label.append(el('strong','',stash.ref),el('small','',stash.message));label.addEventListener('click',async()=>{preview.replaceChildren(el('div','diff-loading','Loading stash diff…'));try{const repo=state.workspaceRepo;const response=await api(`/api/repo/stash-diff?path=${encodeURIComponent(repo.path)}&stash=${encodeURIComponent(stash.ref)}`);const pre=el('div','diff-code');(response.result.diff||'No diff').split(/\r?\n/).forEach((line)=>pre.append(el('div',line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-remove':line.startsWith('@@')?'diff-hunk':'',line||' ')));preview.replaceChildren(pre);}catch(error){preview.replaceChildren(workspaceEmpty('Diff unavailable',error.message));}});const actions=el('div','workspace-row-actions');const apply=el('button','','Apply');apply.addEventListener('click',()=>runWorkspaceAction('stash-apply',{stash:stash.ref},`Apply ${stash.ref} and keep the stash?`));const pop=el('button','','Pop');pop.addEventListener('click',()=>runWorkspaceAction('stash-pop',{stash:stash.ref},`Apply ${stash.ref} and remove it from the stash list?`));const drop=el('button','danger','Drop');drop.addEventListener('click',()=>runWorkspaceAction('stash-drop',{stash:stash.ref},`Delete ${stash.ref} permanently?`));actions.append(apply,pop,drop);row.append(label,actions);list.append(row);});layout.append(list,preview);content.append(layout);
}

function renderTagsView(content,data) {
  const remotes=(data.remotes||[]).map((remote)=>remote.name);const defaultRemote=remotes.includes('origin')?'origin':(remotes[0]||'');const tagDetails=data.tagDetails||data.tags.map((name)=>({name,hash:'',date:'',message:'',annotated:false}));
  const heading=workspaceHeading('Tags','Create, push and delete tags in one place');const showCreate=el('button','tag-page-add','＋ Add tag');showCreate.type='button';heading.box.append(showCreate);content.append(heading.box);
  const layout=el('div','tag-manager');showCreate.addEventListener('click',()=>showTagDialog());
  const manageCard=el('section','tag-manage-card');const manageHead=el('div','tag-manage-head');const manageTitle=el('div');manageTitle.append(el('h4','','Existing tags'),el('small','',`${tagDetails.length} tags · local repository`));const remoteTools=el('div','tag-remote-tools');const remoteSelect=document.createElement('select');remoteSelect.setAttribute('aria-label','Tag remote');remotes.forEach((remote)=>{const option=el('option','',remote);option.value=remote;option.selected=remote===defaultRemote;remoteSelect.append(option);});const pushAll=el('button','','Push all tags');pushAll.type='button';pushAll.disabled=!defaultRemote||!tagDetails.length;pushAll.addEventListener('click',()=>runWorkspaceAction('tag-push-all',{remote:remoteSelect.value},`Push all local tags to ${remoteSelect.value}?`));remoteTools.append(remoteSelect,pushAll);manageHead.append(manageTitle,remoteTools);manageCard.append(manageHead);
  const search=document.createElement('input');search.type='search';search.className='tag-search';search.placeholder='Search tag, commit or message…';search.setAttribute('aria-label','Search tags');manageCard.append(search);const list=el('div','tag-list');manageCard.append(list);layout.append(manageCard);content.append(layout);
  const draw=()=>{list.replaceChildren();const term=search.value.trim().toLowerCase();const items=tagDetails.filter((tag)=>!term||`${tag.name} ${tag.hash} ${tag.date} ${tag.message}`.toLowerCase().includes(term));if(!items.length){list.append(workspaceEmpty('No matching tags',tagDetails.length?'Try a different search':'This repository has no tags'));return;}items.forEach((tag)=>{const row=el('div','tag-row');row.title=`${tag.name} · Right-click for actions`;const info=el('div','tag-info');const title=el('div','tag-title');title.append(el('strong','',tag.name),el('i',tag.annotated?'annotated':'lightweight',tag.annotated?'Annotated':'Lightweight'));info.append(title,el('small','',`${tag.hash||'-'}${tag.date?` · ${tag.date}`:''}`));if(tag.message)info.append(el('p','',tag.message));const actions=el('div','tag-actions');const push=el('button','','Push');push.type='button';push.disabled=!defaultRemote;push.addEventListener('click',()=>runWorkspaceAction('tag-push',{tag:tag.name,remote:remoteSelect.value},`Push tag “${tag.name}” to ${remoteSelect.value}?`));const removeLocal=el('button','danger','Delete local');removeLocal.type='button';removeLocal.addEventListener('click',()=>runWorkspaceAction('tag-delete',{tag:tag.name,deleteLocal:true,deleteRemote:false,remote:''},`Delete local tag “${tag.name}”?\nThe remote tag will not be deleted`));const removeRemote=el('button','danger','Delete remote');removeRemote.type='button';removeRemote.disabled=!defaultRemote;removeRemote.addEventListener('click',()=>runWorkspaceAction('tag-delete',{tag:tag.name,deleteLocal:false,deleteRemote:true,remote:remoteSelect.value},`Delete remote tag “${tag.name}” from ${remoteSelect.value}?\nThe local tag will be kept`));actions.append(push,removeLocal,removeRemote);row.append(info,actions);row.addEventListener('contextmenu',(event)=>showContextMenu(event,tagContextItems(data,tag)));list.append(row);});};search.addEventListener('input',draw);draw();
}

function renderRemotesView(content,data) {
  const remotes=data.remotes||[];const heading=workspaceHeading('Remote Manager','Add, edit or remove remotes without changing the remote repository');content.append(heading.box);
  const add=el('form','remote-form');const name=el('input','','');name.placeholder='Name (origin)';name.setAttribute('aria-label','New remote name');const url=el('input','','');url.placeholder='https://… or git@host:group/repo.git';url.setAttribute('aria-label','New remote URL');const submit=el('button','primary','Add remote');submit.type='submit';add.append(name,url,submit);add.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('remote-add',{remote:name.value.trim(),url:url.value.trim()},`Add remote ${name.value.trim()}?`);});content.append(add);
  if(!remotes.length){content.append(workspaceEmpty('No remotes','Add a remote above to fetch, push and create merge requests'));return;}
  const list=workspaceList();remotes.forEach((remote)=>{const card=el('section','remote-card');const row=el('div','workspace-row remote-row');const label=el('div');label.append(el('strong','',remote.name),el('small','',`Fetch: ${remote.fetchUrl||'-'}`),el('small','',`Push: ${remote.pushUrl||'-'}`));const actions=el('div','workspace-row-actions');const edit=el('button','','Edit');edit.addEventListener('click',()=>card.classList.toggle('expanded'));const remove=el('button','danger','Remove');remove.addEventListener('click',()=>runWorkspaceAction('remote-delete',{remote:remote.name},`Remove remote ${remote.name} from config?\nThe repository on the server will not be deleted`));actions.append(edit,remove);row.append(label,actions);card.append(row);const form=el('form','remote-edit');const fetchUrl=el('input','','');fetchUrl.value=remote.fetchUrl||'';fetchUrl.setAttribute('aria-label',`Fetch URL for ${remote.name}`);const pushUrl=el('input','','');pushUrl.value=remote.pushUrl||'';pushUrl.setAttribute('aria-label',`Push URL for ${remote.name}`);const save=el('button','primary','Save URLs');save.type='submit';form.append(fetchUrl,pushUrl,save);form.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('remote-update',{remote:remote.name,fetchUrl:fetchUrl.value.trim(),pushUrl:pushUrl.value.trim()},`Update URL for ${remote.name}?`);});card.append(form);list.append(card);});content.append(list);
}

async function renderRecoveryView(content){const heading=workspaceHeading('Recovery Center','Use the reflog to find previous branch tips and create recovery branches without moving HEAD');const search=document.createElement('input');search.type='search';search.className='recovery-search';search.placeholder='Search action, hash, selector or date…';heading.box.append(search);content.append(heading.box);const notice=el('div','recovery-note');notice.append(el('strong','','Safe recovery first'),el('span','','Creating a branch does not change working files or the current branch. Hard reset is available in commit details and requires separate confirmation.'));content.append(notice);const list=el('div','recovery-list');list.append(el('div','diff-loading','Reading Git reflog…'));content.append(list);try{const response=await api(`/api/repo/reflog?path=${encodeURIComponent(state.workspaceRepo.path)}`);const entries=response.reflog||[];const draw=()=>{list.replaceChildren();const term=search.value.trim().toLowerCase();const filtered=entries.filter((item)=>!term||`${item.hash} ${item.selector} ${item.date} ${item.message}`.toLowerCase().includes(term));if(!filtered.length){list.append(workspaceEmpty('No matching recovery points','Try a different search'));return;}filtered.forEach((item)=>{const row=el('section','recovery-row');const info=el('button','recovery-info');info.type='button';info.title='Open this commit in History';info.append(el('code','',item.hash),el('strong','',item.message||'reflog entry'),el('small','',`${item.selector} · ${item.date}`));info.addEventListener('click',()=>{state.meta.historyViews[repoKey(state.workspaceRepo)]={scope:'all',showRemote:true,order:'topo'};saveMeta();selectWorkspaceTab('history');});const actions=el('div','workspace-row-actions');const copy=el('button','','Copy hash');copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(item.fullHash);setNotice(`Copied ${item.hash}`);});const branch=el('button','primary','Create recovery branch');branch.addEventListener('click',()=>{const name=prompt(`Create a new branch at ${item.hash}`,'recovery/'+item.hash);if(name)runWorkspaceAction('branch-create-at',{branch:name.trim(),commit:item.fullHash},`Create branch ${name.trim()} at ${item.hash}?\nThe current branch and working files will not change`);});actions.append(copy,branch);row.append(info,actions);row.addEventListener('contextmenu',(event)=>showContextMenu(event,commitContextItems(item)));list.append(row);});};search.addEventListener('input',draw);draw();}catch(error){list.replaceChildren(workspaceEmpty('Reflog unavailable',error.message));}}

async function renderRecoveryViewV2(content){
  const heading=workspaceHeading('Recovery & Undo','Recover from a recent operation or find a commit in the reflog');content.append(heading.box);
  const note=el('div','recovery-note');note.append(el('strong','','Safe by default'),el('span','','A recovery branch does not move HEAD. Restore now requires no subsequent operations or working changes.'));content.append(note);
  const journalBox=el('section','journal-box');journalBox.append(el('h4','','Recent Git Deck actions'));const journalList=el('div','journal-list');journalList.append(el('div','diff-loading','Reading operation journal…'));journalBox.append(journalList);content.append(journalBox);
  try{const response=await api(`/api/repo/journal?path=${encodeURIComponent(state.workspaceRepo.path)}`);journalList.replaceChildren();if(!response.journal.length)journalList.append(el('p','scan-location-empty','No HEAD-changing operations recorded by Git Deck'));response.journal.forEach(item=>{const row=el('section','journal-row');const info=el('div');info.append(el('strong','',item.action),el('small','',`${item.createdAt} · ${item.beforeBranch||'detached'} · ${(item.beforeHead||'').slice(0,8)} → ${(item.afterHead||'').slice(0,8)}`),el('span','',item.summary||''));const actions=el('div','workspace-row-actions');const branch=el('button','primary','Recovery branch');branch.addEventListener('click',()=>{const name=prompt('Branch name for recovering the pre-operation state',`recovery/${item.action}-${(item.beforeHead||'head').slice(0,7)}`);if(name)runWorkspaceAction('journal-recovery-branch',{id:item.id,branch:name.trim()},`Create ${name.trim()} at the state before ${item.action}?\nThe current HEAD will not change`);});const restore=el('button','danger','Restore now');restore.addEventListener('click',()=>{const answer=prompt(`Restore HEAD to before ${item.action}\nRequires no subsequent work and a clean working tree\nType RESTORE`);if(answer==='RESTORE')runWorkspaceAction('journal-restore-head',{id:item.id},`Restore state before ${item.action}?`);});actions.append(branch,restore);row.append(info,actions);journalList.append(row);});}catch(error){journalList.replaceChildren(workspaceEmpty('Journal unavailable',error.message));}
  const reflogHead=el('div','workspace-heading compact-heading');const reflogText=el('div');reflogText.append(el('h3','','Git Reflog'),el('p','','Find previous branch tips, even after a reset or rebase'));const search=el('input','recovery-search','');search.type='search';search.placeholder='Search action, hash or date…';reflogHead.append(reflogText,search);content.append(reflogHead);const list=el('div','recovery-list');list.append(el('div','diff-loading','Reading Git reflog…'));content.append(list);
  try{const response=await api(`/api/repo/reflog?path=${encodeURIComponent(state.workspaceRepo.path)}`);const entries=response.reflog||[];const draw=()=>{list.replaceChildren();const term=search.value.trim().toLowerCase();entries.filter(item=>!term||`${item.hash} ${item.selector} ${item.date} ${item.message}`.toLowerCase().includes(term)).forEach(item=>{const row=el('section','recovery-row');const info=el('div','recovery-info');info.append(el('code','',item.hash),el('strong','',item.message||'reflog entry'),el('small','',`${item.selector} · ${item.date}`));const actions=el('div','workspace-row-actions');const copy=el('button','','Copy');copy.addEventListener('click',()=>navigator.clipboard.writeText(item.fullHash));const branch=el('button','primary','Create branch');branch.addEventListener('click',()=>{const name=prompt(`Create branch at ${item.hash}`,`recovery/${item.hash}`);if(name)runWorkspaceAction('branch-create-at',{branch:name.trim(),commit:item.fullHash},`Create ${name.trim()} without moving HEAD?`);});actions.append(copy,branch);row.append(info,actions);list.append(row);});if(!list.children.length)list.append(workspaceEmpty('No matching recovery points','Try a different search'));};search.addEventListener('input',draw);draw();}catch(error){list.replaceChildren(workspaceEmpty('Reflog unavailable',error.message));}
}

function addRefOptions(select,data,{local=true,remote=true,tags=false,exclude=''}={}){const seen=new Set();if(local){const group=document.createElement('optgroup');group.label='Local branches';(data.branches||[]).forEach((item)=>{if(item.name!==exclude&&!seen.has(item.name)){group.append(new Option(item.name,item.name));seen.add(item.name);}});select.append(group);}if(remote){const group=document.createElement('optgroup');group.label='Remote branches';(data.remoteBranches||[]).forEach((item)=>{if(item.name!==exclude&&!seen.has(item.name)){group.append(new Option(item.name,item.name));seen.add(item.name);}});select.append(group);}if(tags){const group=document.createElement('optgroup');group.label='Tags';(data.tags||[]).forEach(name=>{if(name!==exclude&&!seen.has(name)){group.append(new Option(name,name));seen.add(name);}});select.append(group);}return select;}
function preferredTarget(data,source){const refs=[...(data.branches||[]).map(item=>item.name),...(data.remoteBranches||[]).map(item=>item.name)];return ['develop','development','main','master','origin/develop','origin/development','origin/main','origin/master'].find(item=>item!==source&&refs.includes(item))||refs.find(item=>item!==source)||'';}
function compactCommitRow(item,onClick){const row=el('button','review-commit-row');row.type='button';row.append(el('code','',item.hash),el('strong','',item.subject),el('small','',`${item.author} · ${item.date}`));row.title=item.subject;if(onClick)row.addEventListener('click',()=>onClick(item,row));return row;}

async function renderCompareView(content,data){
  const heading=workspaceHeading('Compare & MR readiness','Compare a branch or tag with the current state');const controls=el('form','compare-controls');const source=document.createElement('select');source.setAttribute('aria-label','Compare source ref');addRefOptions(source,data,{remote:true,tags:true});source.value=data.branch;const arrow=el('span','compare-arrow','→');const target=document.createElement('select');target.setAttribute('aria-label','Compare target ref');addRefOptions(target,data,{remote:true,tags:true});target.value=preferredTarget(data,data.branch);if(state.pendingCompare){source.value=state.pendingCompare.source;target.value=state.pendingCompare.target;state.pendingCompare=null;}const swap=el('button','','⇄ Swap');swap.type='button';const inspect=el('button','primary','Compare');inspect.type='submit';const mr=el('button','compare-mr','＋ Create MR');mr.type='button';controls.append(source,arrow,target,swap,inspect,mr);heading.box.append(controls);content.append(heading.box);const panel=el('div','compare-dashboard');panel.append(el('div','diff-loading','Comparing refs…'));content.append(panel);
  const load=async()=>{if(!source.value||!target.value)return;panel.replaceChildren(el('div','diff-loading','Analyzing commits, files and conflicts…'));try{const response=await api(`/api/repo/compare?path=${encodeURIComponent(state.workspaceRepo.path)}&source=${encodeURIComponent(source.value)}&target=${encodeURIComponent(target.value)}&remote=origin`);const result=response.compare;const summary=el('section','compare-summary');summary.append(el('div','compare-stat',`↑ ${result.ahead}\ncommits ahead`),el('div','compare-stat',`↓ ${result.behind}\ncommits behind`),el('div','compare-stat',`${result.files.length}\nchanged files`),el('div',`compare-stat ${result.conflicts?'bad':'good'}`,result.conflicts?'⚠\nconflicts':'✓\nmerge preview'));const checks=el('section','readiness-list');result.checks.forEach((item)=>{const row=el('div',`readiness-row ${item.level}`);row.append(el('b','',item.level==='ok'?'✓':item.level==='block'?'!':'•'),el('span','',item.label),el('small','',item.detail));checks.append(row);});const lower=el('div','compare-lower');const commits=el('section','compare-card');commits.append(el('h4','',`Commits (${result.commits.length})`));const commitList=el('div','review-list');result.commits.forEach(item=>commitList.append(compactCommitRow(item)));if(!result.commits.length)commitList.append(workspaceEmpty('No commits','Source has no additional commits beyond the target'));commits.append(commitList);const files=el('section','compare-card');files.append(el('h4','',`Changed files (${result.files.length})`));const fileList=el('div','compare-file-list');const diff=el('div','compare-diff');diff.append(workspaceEmpty('Select a file','Select a file to view its branch diff'));result.files.forEach((item)=>{const button=el('button','compare-file-row',`${item.status}  ${item.path}`);button.type='button';button.title=item.path;button.addEventListener('click',async()=>{fileList.querySelectorAll('button').forEach(node=>node.classList.toggle('active',node===button));diff.replaceChildren(el('div','diff-loading','Loading branch diff…'));try{const response=await api(`/api/repo/compare-diff?path=${encodeURIComponent(state.workspaceRepo.path)}&source=${encodeURIComponent(source.value)}&target=${encodeURIComponent(target.value)}&file=${encodeURIComponent(item.path)}`);diff.replaceChildren(createDiffViewer(response.result.diff,item.path));}catch(error){diff.replaceChildren(workspaceEmpty('Diff unavailable',error.message));}});fileList.append(button);});if(!result.files.length)fileList.append(workspaceEmpty('No changed files',''));files.append(fileList);lower.append(commits,files,diff);panel.replaceChildren(summary,checks,lower);}catch(error){panel.replaceChildren(workspaceEmpty('Compare unavailable',error.message));}};
  const syncMr=()=>{mr.disabled=(data.tags||[]).includes(source.value);mr.title=mr.disabled?'A merge request requires a branch as its source':'Create Merge Request';};controls.addEventListener('submit',(event)=>{event.preventDefault();load();});source.addEventListener('change',syncMr);swap.addEventListener('click',()=>{const value=source.value;const next=target.value.replace(/^origin\//,'');if([...source.options].some(option=>option.value===next)){source.value=next;target.value=[...target.options].some(option=>option.value===value)?value:target.value;syncMr();load();}});mr.addEventListener('click',()=>{showMrDialog(state.workspaceRepo,source.value,'origin');$('mr-target').value=target.value.replace(/^origin\//,'');loadMrReadiness();});syncMr();load();
}

async function renderHistorySearchView(content){const heading=workspaceHeading('Search code history','Find commits that added or removed text using Git pickaxe');const form=el('form','history-content-form');const mode=document.createElement('select');mode.append(new Option('Exact text (-S)','literal'),new Option('Regex diff (-G)','regex'));const input=el('input','','');input.type='search';input.placeholder='Method, config key or code text…';input.setAttribute('aria-label','Search code history');const submit=el('button','primary','Search history');submit.type='submit';form.append(mode,input,submit);heading.box.append(form);content.append(heading.box);const layout=el('div','history-search-layout');const list=el('section','history-search-results');const detail=el('section','commit-detail');detail.append(workspaceEmpty('Search first','Find which commit changed this code'));layout.append(list,detail);content.append(layout);form.addEventListener('submit',async(event)=>{event.preventDefault();if(!input.value.trim()){input.focus();return;}list.replaceChildren(el('div','diff-loading','Searching all branches…'));detail.replaceChildren(workspaceEmpty('Select a result',''));try{const response=await api(`/api/repo/history-search?path=${encodeURIComponent(state.workspaceRepo.path)}&q=${encodeURIComponent(input.value.trim())}&mode=${mode.value}`);list.replaceChildren();response.history.forEach(item=>list.append(compactCommitRow(item,(commit,row)=>loadCommitDetail(commit,detail,row))));if(!response.history.length)list.append(workspaceEmpty('No matching commits','Try switching between exact text and regex'));}catch(error){list.replaceChildren(workspaceEmpty('Search unavailable',error.message));}});}

async function renderConflictView(content,data){const operation=data.operation||{};const heading=workspaceHeading('Conflict Center',operation.active?`${operation.type} · ${operation.conflicts.length} conflicted file(s)`:'No merge, rebase, cherry-pick or revert in progress');content.append(heading.box);if(!operation.active||!operation.conflicts?.length){content.append(workspaceEmpty(operation.active?'All conflicts staged':'No active conflicts',operation.active?'Click Continue above to finish the operation':'When conflicts occur, this view automatically shows Base / Ours / Theirs'));return;}const note=el('div','conflict-note');note.append(el('b','','Review the context before choosing'),el('span','',operation.type==='rebase'?'During a rebase, Ours is the destination branch and Theirs is the commit being replayed':'Ours is the current branch and Theirs is the branch being merged'));content.append(note);const layout=el('div','conflict-layout');const files=el('aside','conflict-file-list');const viewer=el('section','conflict-viewer');viewer.append(workspaceEmpty('Select conflicted file',''));layout.append(files,viewer);content.append(layout);const load=async(file,button)=>{files.querySelectorAll('button').forEach(node=>node.classList.toggle('active',node===button));viewer.replaceChildren(el('div','diff-loading','Reading Base / Ours / Theirs…'));try{const response=await api(`/api/repo/conflict?path=${encodeURIComponent(state.workspaceRepo.path)}&file=${encodeURIComponent(file)}`);const item=response.conflict;const panes=el('div','conflict-panes');[['BASE',item.base],['OURS',item.ours],['THEIRS',item.theirs]].forEach(([name,value])=>{const pane=el('label','conflict-pane');pane.append(el('b','',name));const area=document.createElement('textarea');area.readOnly=true;area.value=value||'';pane.append(area);panes.append(pane);});const resultLabel=el('label','conflict-result');resultLabel.append(el('b','','RESOLVED RESULT'));const markerWarning=el('span','conflict-marker-warning','');resultLabel.append(markerWarning);const result=document.createElement('textarea');result.value=item.ours||'';resultLabel.append(result);const actions=el('div','conflict-actions');const save=el('button','primary','Save result & Stage');const update=()=>{const markers=/^(<{7}|={7}|>{7})/m.test(result.value);save.disabled=markers;markerWarning.textContent=markers?'Conflict markers remain — remove them before staging':'';};const use=(label,value)=>{const button=el('button','',label);button.type='button';button.addEventListener('click',()=>{result.value=value;update();});return button;};actions.append(use('Use Ours',item.ours||''),use('Use Theirs',item.theirs||''),use('Use Both',(item.ours||'')+'\n'+(item.theirs||'')));result.addEventListener('input',update);save.addEventListener('click',()=>runWorkspaceAction('conflict-resolve',{file,mode:'manual',content:result.value},`Save the result and stage ${file}?`));actions.append(save);update();viewer.replaceChildren(panes,resultLabel,actions);}catch(error){viewer.replaceChildren(workspaceEmpty('Conflict unavailable',error.message));}};operation.conflicts.forEach((file,index)=>{const button=el('button',index===0?'active':'',file);button.type='button';button.title=file;button.addEventListener('click',()=>load(file,button));files.append(button);if(index===0)setTimeout(()=>load(file,button),0);});}

function renderRepositoryHealthView(content,data){const operation=data.operation||{},sync=data.sync||{},settings=data.settings||{};const heading=workspaceHeading('Repository Health','Check for risks before pulling, merging, rebasing or pushing');const refresh=el('button','','Run health check');refresh.addEventListener('click',()=>loadWorkspace(true));heading.box.append(refresh);content.append(heading.box);const grid=el('section','health-dashboard');const add=(level,title,detail,actionLabel='',action=null)=>{const card=el('article',`health-card ${level}`);card.append(el('b','',level==='good'?'✓':level==='bad'?'!':'•'));const text=el('div');text.append(el('strong','',title),el('small','',detail));card.append(text);if(actionLabel&&action){const button=el('button','',actionLabel);button.addEventListener('click',action);card.append(button);}grid.append(card);};add(data.branch?'good':'bad',data.branch?'Branch attached':'Detached HEAD',data.branch?`Current branch: ${data.branch}`:'Create or switch to a branch before committing new work','Branches',()=>selectWorkspaceTab('branches'));add(operation.active?'bad':'good',operation.active?`${operation.type} in progress`:'No unfinished Git operation',operation.active?`${operation.conflicts?.length||0} conflicts · Complete the operation or abort`:'No merge, rebase, cherry-pick or revert in progress',operation.active?'Resolve':'',operation.active?()=>selectWorkspaceTab('conflicts'):null);add((data.remotes||[]).length?'good':'warn',(data.remotes||[]).length?'Remote configured':'No remote configured',(data.remotes||[]).length?`${data.remotes.length} remote(s): ${data.remotes.map((item)=>item.name).join(', ')}`:'Add a remote before fetching, pushing or creating a merge request','Remotes',()=>selectWorkspaceTab('remotes'));add(sync.upstream?'good':'warn',sync.upstream?'Upstream connected':'No upstream branch',sync.upstream?`${sync.upstream} · ↑${sync.ahead||0} ↓${sync.behind||0}`:'Push with tracking or set an upstream in Branches','Branches',()=>selectWorkspaceTab('branches'));add(data.files.length?'warn':'good',data.files.length?`${data.files.length} working changes`:'Working tree clean',data.files.length?'Review the diff, stage, commit or stash before changing history':'Working tree is clean','File Status',()=>selectWorkspaceTab('changes'));add(Number(sync.behind)>0?'warn':'good',Number(sync.behind)>0?`${sync.behind} commits behind`:'Remote sync is current',Number(sync.behind)>0?'Fetch and review incoming commits before pulling':`Ahead ${sync.ahead||0} · Behind ${sync.behind||0}`,'Compare',()=>selectWorkspaceTab('compare'));add(settings.userName&&settings.userEmail?'good':'warn',settings.userName&&settings.userEmail?'Commit identity ready':'Commit identity incomplete',settings.userName&&settings.userEmail?`${settings.userName} · ${settings.userEmail}`:'Set user.name and user.email before committing','Settings',()=>selectWorkspaceTab('settings'));const badSubmodules=(settings.submodules||[]).filter((item)=>item.state==='-'||item.state==='+');add(badSubmodules.length?'warn':'good',badSubmodules.length?`${badSubmodules.length} submodule issues`:'Submodules ready',(settings.submodules||[]).length?`${settings.submodules.length} configured submodule(s)`:'Repository has no submodules','Tools',()=>selectWorkspaceTab('tools'));content.append(grid);}

async function renderGitLabInboxView(content){const heading=workspaceHeading('GitLab Inbox','Merge requests and pipelines for the current repository');const refresh=el('button','','Refresh GitLab');heading.box.append(refresh);content.append(heading.box);const body=el('div','gitlab-inbox');content.append(body);const load=async()=>{body.replaceChildren(el('div','diff-loading','Loading GitLab Inbox…'));try{const response=await api(`/api/gitlab/inbox?path=${encodeURIComponent(state.workspaceRepo.path)}`);const inbox=response.inbox;const columns=el('div','gitlab-inbox-columns');const mrs=el('section','gitlab-inbox-card');mrs.append(el('h4','',`Open merge requests (${inbox.mergeRequests.length})`));const mrList=el('div','inbox-list');inbox.mergeRequests.forEach(item=>{const card=el('article','inbox-item');const title=el('div','inbox-title');title.append(el('b','',`!${item.iid} ${item.title}`),el('small','',`${item.source_branch} → ${item.target_branch} · ${item.author?.name||item.author?.username||''}`));const badges=el('div','inbox-badges');badges.append(el('i',`state-${item.detailed_merge_status||item.merge_status||'open'}`,item.detailed_merge_status||item.merge_status||'open'));if(item.draft)badges.append(el('i','state-draft','Draft'));const actions=el('div','inbox-actions');const action=(label,run,className='')=>{const button=el('button',className,label);button.addEventListener('click',run);return button;};actions.append(action('Open',()=>runWorkspaceAction('open-url',{url:item.web_url})),action('Approve',()=>runWorkspaceAction('gitlab-mr-approve',{project:inbox.project,iid:item.iid},`Approve MR !${item.iid}?`)),action('Comment',()=>{const comment=prompt(`Comment on MR !${item.iid}`);if(comment)runWorkspaceAction('gitlab-mr-comment',{project:inbox.project,iid:item.iid,comment},`Send comment to MR !${item.iid}?`);}),action('Merge',()=>runWorkspaceAction('gitlab-mr-merge',{project:inbox.project,iid:item.iid},`Merge MR !${item.iid} on GitLab?`),'primary'),action('Close',()=>runWorkspaceAction('gitlab-mr-close',{project:inbox.project,iid:item.iid},`Close MR !${item.iid}?`),'danger'));card.append(title,badges,actions);mrList.append(card);});if(!inbox.mergeRequests.length)mrList.append(workspaceEmpty('No open merge requests',''));mrs.append(mrList);const pipes=el('section','gitlab-inbox-card');pipes.append(el('h4','',`Recent pipelines (${inbox.pipelines.length})`));const pipeList=el('div','inbox-list');inbox.pipelines.forEach(item=>{const card=el('article','pipeline-item');card.append(el('i',`pipeline-${item.status}`,item.status),el('b','',`${item.ref||'-'} · #${item.id}`),el('small','',item.updated_at||item.created_at||''));const retry=el('button','','Retry');retry.addEventListener('click',()=>runWorkspaceAction('gitlab-pipeline-retry',{project:inbox.project,pipeline:item.id},`Retry pipeline #${item.id}?`));card.append(retry);pipeList.append(card);});pipes.append(pipeList);columns.append(mrs,pipes);body.replaceChildren(columns);}catch(error){body.replaceChildren(workspaceEmpty('GitLab Inbox unavailable',error.message));}};refresh.addEventListener('click',load);load();}

async function renderRebaseView(content,data){const heading=workspaceHeading('Interactive Rebase','Reorder, squash, fixup or drop commits. Safety Center helps resolve conflicts.');const controls=el('form','rebase-controls');const base=document.createElement('select');base.setAttribute('aria-label','Interactive rebase base');addRefOptions(base,data,{exclude:data.branch});base.value=preferredTarget(data,data.branch);const loadButton=el('button','','Load commits');loadButton.type='submit';controls.append(base,loadButton);heading.box.append(controls);content.append(heading.box);const body=el('div','rebase-planner');body.append(workspaceEmpty('Choose a base branch','Shows up to 50 commits after the base'));content.append(body);controls.addEventListener('submit',async(event)=>{event.preventDefault();body.replaceChildren(el('div','diff-loading','Preparing rebase plan…'));try{const response=await api(`/api/repo/rebase-plan?path=${encodeURIComponent(state.workspaceRepo.path)}&base=${encodeURIComponent(base.value)}`);const plan=response.plan;const list=el('div','rebase-step-list');plan.commits.forEach((item)=>{const row=el('div','rebase-step');row.dataset.hash=item.fullHash;const action=document.createElement('select');[['pick','Pick'],['squash','Squash'],['fixup','Fixup'],['drop','Drop']].forEach(([value,label])=>action.append(new Option(label,value)));const info=el('span','rebase-step-info');info.append(el('code','',item.hash),el('strong','',item.subject));const up=el('button','','↑');up.type='button';up.title='Move commit up';up.addEventListener('click',()=>row.previousElementSibling&&list.insertBefore(row,row.previousElementSibling));const down=el('button','','↓');down.type='button';down.title='Move commit down';down.addEventListener('click',()=>row.nextElementSibling&&list.insertBefore(row.nextElementSibling,row));row.append(action,info,up,down);list.append(row);});const footer=el('div','rebase-footer');footer.append(el('p','',`${plan.commits.length} commits · Commit history will be rewritten and may require force push with lease`));const run=el('button','primary','Run interactive rebase');run.disabled=!plan.commits.length;run.addEventListener('click',()=>{const answer=prompt('Interactive rebase will rewrite commit history\nType REBASE to confirm');if(answer!=='REBASE')return;const steps=[...list.querySelectorAll('.rebase-step')].map(row=>({hash:row.dataset.hash,action:row.querySelector('select').value}));runWorkspaceAction('rebase-interactive',{base:plan.base,steps},`Start interactive rebase ${steps.length} commits on ${plan.base}?`);});footer.append(run);body.replaceChildren(list,footer);}catch(error){body.replaceChildren(workspaceEmpty('Rebase plan unavailable',error.message));}});}

async function renderWorktreesView(content,data){const heading=workspaceHeading('Worktree Manager','Work on multiple branches without stashing or switching working copies');const prune=el('button','','Prune stale');prune.addEventListener('click',()=>runWorkspaceAction('worktree-prune',{},'Prune only worktree records whose paths no longer exist?'));heading.box.append(prune);content.append(heading.box);const form=el('form','worktree-form');const destination=el('input','','');destination.placeholder='C:\\work\\project-feature';destination.setAttribute('aria-label','Worktree destination');const branch=el('input','','');branch.placeholder='feature/name';branch.setAttribute('aria-label','Worktree branch');const create=document.createElement('input');create.type='checkbox';create.checked=true;const createLabel=el('label','worktree-choice');createLabel.append(create,el('span','','Create new branch'));const start=document.createElement('select');addRefOptions(start,data);start.value='';start.insertBefore(new Option('Start from HEAD','HEAD'),start.firstChild);start.value='HEAD';const add=el('button','primary','Create worktree');add.type='submit';form.append(destination,branch,createLabel,start,add);content.append(form);const parent=state.workspaceRepo.path.replace(/[\\/][^\\/]+$/,'');const updateDestination=()=>{if(branch.value.trim())destination.value=`${parent}\\${state.workspaceRepo.name}-${branch.value.trim().replace(/[\\/]+/g,'-')}`;};branch.addEventListener('input',()=>{if(create.checked)updateDestination();});create.addEventListener('change',()=>{start.disabled=!create.checked;});form.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('worktree-add',{destination:destination.value.trim(),branch:branch.value.trim(),create:create.checked,start:start.value},`Create worktree at ${destination.value.trim()}?`);});const list=el('div','worktree-list');list.append(el('div','diff-loading','Loading worktrees…'));content.append(list);try{const response=await api(`/api/repo/worktrees?path=${encodeURIComponent(state.workspaceRepo.path)}`);list.replaceChildren();response.worktrees.forEach(item=>{const row=el('section',`worktree-row ${item.isMain?'main':''}`);const info=el('div');info.append(el('strong','',item.branch||`detached@${(item.head||'').slice(0,7)}`),el('small','',item.path));const actions=el('div','workspace-row-actions');const open=el('button','','Explorer');open.addEventListener('click',()=>run('open-folder',{...state.workspaceRepo,path:item.path}));actions.append(open);if(!item.isMain){const remove=el('button','danger','Remove');remove.addEventListener('click',()=>{const answer=prompt(`Delete this working directory if it has no pending changes\n${item.path}\nType REMOVE to confirm`);if(answer==='REMOVE')runWorkspaceAction('worktree-remove',{destination:item.path},`Remove worktree ${item.path}?`);});actions.append(remove);}row.append(info,actions);list.append(row);});}catch(error){list.replaceChildren(workspaceEmpty('Worktrees unavailable',error.message));}}

function renderPatchesView(content,data){const heading=workspaceHeading('Patch Center','Export a commit as .patch or apply a patch after --check validation');content.append(heading.box);const layout=el('div','patch-center');const exportCard=el('section','patch-card');exportCard.append(el('h4','','Export patch'),el('p','','Export a single commit as a patch to C:\\my-git-tools\\exports'));const commit=el('input','','');commit.value=data.history?.[0]?.fullHash||'';commit.placeholder='Commit hash';const exportButton=el('button','primary','Export commit');exportButton.addEventListener('click',()=>runWorkspaceAction('patch-export',{commit:commit.value.trim()},`Export commit ${commit.value.trim().slice(0,8)} as a patch?`));exportCard.append(commit,exportButton);const applyCard=el('section','patch-card');applyCard.append(el('h4','','Apply patch'),el('p','','Select a file. Git apply --check always runs before applying it.'));const selected=el('code','patch-selected',state.selectedPatch||'No patch selected');const choose=el('button','','Choose patch…');const stage=document.createElement('input');stage.type='checkbox';const stageLabel=el('label','worktree-choice');stageLabel.append(stage,el('span','','Apply and stage'));const apply=el('button','primary','Apply patch');apply.disabled=!state.selectedPatch;choose.addEventListener('click',async()=>{try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'patch-choose',path:state.workspaceRepo.path})});state.selectedPatch=result.path||'';selected.textContent=state.selectedPatch||'No patch selected';apply.disabled=!result.valid;setOutput(result.output||result.message,{expand:!result.valid});setNotice(result.message);}catch(error){setNotice(error.message);setOutput(error.message,{expand:true,status:'error'});}});apply.addEventListener('click',()=>runWorkspaceAction('patch-apply-file',{patchPath:state.selectedPatch,stage:stage.checked},`Apply ${state.selectedPatch}${stage.checked?' and stage':''}?`));applyCard.append(selected,choose,stageLabel,apply);layout.append(exportCard,applyCard);content.append(layout);}

async function renderToolsView(content,data){const heading=workspaceHeading('Advanced Git Tools','Advanced Git tools in one place, with confirmation before changes');content.append(heading.box);const layout=el('div','git-tools-grid');layout.append(el('div','diff-loading','Checking repository capabilities…'));content.append(layout);const makeCard=(title,description,className='')=>{const card=el('section',`git-tool-card ${className}`);card.append(el('h4','',title),el('p','',description));return card;};try{const response=await api(`/api/repo/tools?path=${encodeURIComponent(state.workspaceRepo.path)}`);const tools=response.tools||{};layout.replaceChildren();
  const maintenance=makeCard('Repository maintenance','Inspect object size, prune stale remote refs and optimize the object database','tool-maintenance');const objectInfo=el('pre','tool-output',tools.objects||'Statistics unavailable');const maintenanceActions=el('div','tool-actions');const remote=document.createElement('select');(data.remotes||[]).forEach(item=>remote.append(new Option(item.name,item.name)));remote.disabled=!remote.options.length;remote.setAttribute('aria-label','Remote to prune');const preview=el('button','','Preview prune');preview.disabled=!remote.options.length;preview.addEventListener('click',()=>runWorkspaceAction('remote-prune-preview',{remote:remote.value}));const prune=el('button','','Prune stale refs');prune.disabled=!remote.options.length;prune.addEventListener('click',()=>runWorkspaceAction('remote-prune',{remote:remote.value},`Prune remote-tracking refs no longer on ${remote.value}?\nLocal branches will not be deleted`));const optimize=el('button','primary','Optimize repository');optimize.addEventListener('click',()=>runWorkspaceAction('maintenance-gc',{},'Run git gc to compact stored objects?\nWorking files and commit history will not change'));maintenanceActions.append(remote,preview,prune,optimize);maintenance.append(objectInfo,maintenanceActions);layout.append(maintenance);
  const lfs=makeCard('Git LFS patterns',tools.lfsAvailable?'Track new file patterns with LFS. This modifies .gitattributes.':'Git LFS is not installed','tool-lfs');const lfsForm=el('form','tool-form');const pattern=el('input','','');pattern.placeholder='Pattern, e.g. *.psd or assets/**';pattern.setAttribute('aria-label','Git LFS pattern');const track=el('button','primary','Track pattern');track.type='submit';track.disabled=!tools.lfsAvailable;lfsForm.append(pattern,track);lfsForm.addEventListener('submit',(event)=>{event.preventDefault();if(pattern.value.trim())runWorkspaceAction('lfs-track',{pattern:pattern.value.trim()},`Track with Git LFS: “${pattern.value.trim()}”?`);});const patternList=el('div','tool-patterns');(tools.lfsPatterns||[]).forEach(value=>{const row=el('div','tool-pattern');row.append(el('code','',value));const remove=el('button','','Untrack');remove.addEventListener('click',()=>runWorkspaceAction('lfs-untrack',{pattern:value},`Stop tracking “${value}” with Git LFS?\nFiles in existing history will not be rewritten`));row.append(remove);patternList.append(row);});if(!(tools.lfsPatterns||[]).length)patternList.append(el('small','','No tracked LFS patterns'));const lfsActions=el('div','tool-actions');const pull=el('button','','Pull LFS objects');pull.disabled=!tools.lfsAvailable;pull.addEventListener('click',()=>runWorkspaceAction('lfs-pull',{},'Download LFS objects for this repository?'));const lfsPrune=el('button','','Prune old LFS objects');lfsPrune.disabled=!tools.lfsAvailable;lfsPrune.addEventListener('click',()=>runWorkspaceAction('lfs-prune',{},'Prune old LFS objects that Git LFS considers safe to remove?'));lfsActions.append(pull,lfsPrune);lfs.append(lfsForm,patternList,lfsActions);layout.append(lfs);
  const subs=makeCard('Submodules','Add a dependency repository or initialize/update existing submodules','tool-submodules');const subForm=el('form','tool-form tool-form-wide');const subUrl=el('input','','');subUrl.placeholder='HTTPS or SSH repository URL';subUrl.setAttribute('aria-label','Submodule repository URL');const subPath=el('input','','');subPath.placeholder='libs/module-name';subPath.setAttribute('aria-label','Submodule path');const subAdd=el('button','primary','Add submodule');subAdd.type='submit';subForm.append(subUrl,subPath,subAdd);subForm.addEventListener('submit',(event)=>{event.preventDefault();if(subUrl.value.trim()&&subPath.value.trim())runWorkspaceAction('submodule-add',{url:subUrl.value.trim(),target:subPath.value.trim()},`Add submodule at ${subPath.value.trim()}?\nThis downloads the repository and modifies .gitmodules`);});const subList=el('div','tool-submodule-list');(data.settings?.submodules||[]).forEach(item=>{const row=el('div','tool-submodule');row.append(el('code','',item.state||' '),el('strong','',item.path),el('small','',item.hash||''));subList.append(row);});if(!(data.settings?.submodules||[]).length)subList.append(el('small','','No submodules'));const update=el('button','','Initialize / Update all');update.disabled=!(data.settings?.submodules||[]).length;update.addEventListener('click',()=>runWorkspaceAction('submodule-update',{},'Initialize and update all submodules?'));subs.append(subForm,subList,update);layout.append(subs);
  const bisect=makeCard('Git Bisect','Find the commit that introduced a problem using binary search','tool-bisect');if(tools.bisectActive){bisect.append(el('div','tool-state active','Bisect session active'));const bisectActions=el('div','tool-actions');const good=el('button','','Mark current Good');good.addEventListener('click',()=>runWorkspaceAction('bisect-good',{},'Tests pass at the current commit. Mark good?'));const bad=el('button','danger','Mark current Bad');bad.addEventListener('click',()=>runWorkspaceAction('bisect-bad',{},'The problem occurs at the current commit. Mark bad?'));const reset=el('button','','End Bisect');reset.addEventListener('click',()=>runWorkspaceAction('bisect-reset',{},'End bisect and return to the original branch?'));bisectActions.append(good,bad,reset);bisect.append(bisectActions,el('pre','tool-output',tools.bisectLog||''));}else{const bisectForm=el('form','tool-form');const goodRef=document.createElement('select');goodRef.setAttribute('aria-label','Known good revision');addRefOptions(goodRef,data);goodRef.value=preferredTarget(data,data.branch);const badRef=el('input','','HEAD');badRef.value='HEAD';badRef.setAttribute('aria-label','Known bad revision');const start=el('button','primary','Start Bisect');start.type='submit';bisectForm.append(goodRef,badRef,start);bisectForm.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('bisect-start',{good:goodRef.value,bad:badRef.value.trim()},`Start bisect?\nGood: ${goodRef.value}\nBad: ${badRef.value.trim()}\nWorking tree must be clean`);});bisect.append(bisectForm);}layout.append(bisect);
  const exports=makeCard('Export repository','Export a source snapshot as ZIP or back up all refs and objects as a Git bundle','tool-export');const exportForm=el('div','tool-form');const exportRef=el('input','','');exportRef.value='HEAD';exportRef.placeholder='Branch, tag or commit';exportRef.setAttribute('aria-label','Revision to archive');const archive=el('button','','Export ZIP');archive.addEventListener('click',()=>runWorkspaceAction('archive-export',{ref:exportRef.value.trim()||'HEAD'},`Export ${exportRef.value.trim()||'HEAD'} as ZIP in C:\\my-git-tools\\exports?`));const bundle=el('button','primary','Export full bundle');bundle.addEventListener('click',()=>runWorkspaceAction('bundle-export',{},'Export all local/remote refs and Git objects as a .bundle?\nThe file may be large'));exportForm.append(exportRef,archive,bundle);exports.append(exportForm);layout.append(exports);
  const note=makeCard('Feature coverage','Ready: Clone, Create, Add, Scan, Commit, Push dialog, Branch/Merge/Rebase, Stash, Tags, Remotes, Worktrees, Patches, Reflog recovery, GitLab MR, LFS, Submodules, Bisect and Export','tool-coverage');note.append(el('small','','Automatic commit signing is disabled to avoid waiting for a passphrase. Use Terminal or your Git credential agent when needed.'));layout.append(note);
 }catch(error){layout.replaceChildren(workspaceEmpty('Advanced tools unavailable',error.message));}}

function renderSettingsView(content,data){const settings=data.settings||{};const heading=workspaceHeading('Repository Settings','Settings apply only to this repository, not global Git configuration');content.append(heading.box);const layout=el('div','settings-layout');const identity=el('section','settings-card');identity.append(el('h4','','Commit identity'),el('p','','Use this name and email only for the current repository'));const identityForm=el('form','settings-form');const name=el('input','','');name.value=settings.userName||'';name.placeholder='Full name';const email=el('input','','');email.type='email';email.value=settings.userEmail||'';email.placeholder='Email';const saveIdentity=el('button','primary','Save identity');saveIdentity.type='submit';identityForm.append(name,email,saveIdentity);identityForm.addEventListener('submit',(event)=>{event.preventDefault();runWorkspaceAction('settings-save-identity',{name:name.value.trim(),email:email.value.trim()},`Save Git identity only for ${state.workspaceRepo.name}?`);});identity.append(identityForm);layout.append(identity);
  const ignore=el('section','settings-card settings-ignore');ignore.append(el('h4','','.gitignore'),el('p','','Edits the repository file. Saving creates a working change.'));const textarea=document.createElement('textarea');textarea.value=settings.gitignore||'';textarea.spellcheck=false;textarea.setAttribute('aria-label','.gitignore content');const saveIgnore=el('button','primary','Save .gitignore');saveIgnore.addEventListener('click',()=>runWorkspaceAction('settings-save-gitignore',{content:textarea.value},'Save .gitignore?'));ignore.append(textarea,saveIgnore);layout.append(ignore);
  const subs=el('section','settings-card settings-submodules');const submodules=settings.submodules||[];const subHead=el('div','settings-card-head');subHead.append(el('div','',`Submodules (${submodules.length})`));const update=el('button','','Initialize / Update');update.disabled=!submodules.length;update.addEventListener('click',()=>runWorkspaceAction('submodule-update',{},'Initialize and update all submodules?\nThis may download data from the remote'));subHead.append(update);subs.append(subHead);if(!submodules.length)subs.append(el('p','','This repository has no submodules'));submodules.forEach((item)=>{const row=el('div','submodule-row');row.append(el('code','',item.state||' '),el('strong','',item.path),el('small','',`${item.hash||''} ${item.description||''}`));subs.append(row);});layout.append(subs);
  const lfs=el('section','settings-card settings-lfs');const lfsHead=el('div','settings-card-head');lfsHead.append(el('div','',`Git LFS · ${settings.lfsAvailable?`${settings.lfsFiles||0} tracked files`:'not installed'}`));const lfsActions=el('div','workspace-row-actions');const pull=el('button','','Pull LFS');pull.disabled=!settings.lfsAvailable;pull.addEventListener('click',()=>runWorkspaceAction('lfs-pull',{},'Download Git LFS objects for this repository?'));const prune=el('button','','Prune');prune.disabled=!settings.lfsAvailable;prune.addEventListener('click',()=>runWorkspaceAction('lfs-prune',{},'Prune unused old Git LFS objects?'));lfsActions.append(pull,prune);lfsHead.append(lfsActions);lfs.append(lfsHead,el('p','',settings.lfsAvailable?(settings.lfsVersion||'Git LFS ready'):'Install Git LFS to use this command'));layout.append(lfs);
  const app=el('section','settings-card settings-app');app.append(el('h4','','Git Deck appearance & automation'),el('p','','Theme and accent changes apply immediately and are saved automatically. Automatic fetch is off until enabled.'));const appForm=el('div','settings-form settings-app-form');const theme=document.createElement('select');[['system','System theme'],['light','Light'],['dark','Dark'],['midnight','Midnight']].forEach(([value,text])=>theme.append(new Option(text,value)));theme.value=state.meta.theme;theme.setAttribute('aria-label','Color theme');const accent=document.createElement('input');accent.type='color';accent.value=state.meta.accentColor;accent.setAttribute('aria-label','Custom accent color');theme.addEventListener('change',()=>setTheme(theme.value));accent.addEventListener('input',()=>setAccentColor(accent.value));const scale=document.createElement('select');[90,100,110,120].forEach(value=>scale.append(new Option(`UI scale ${value}%`,value)));scale.value=String(state.meta.uiScale);const preset=document.createElement('select');[['compact','Compact'],['comfortable','Comfortable'],['review','Review focus']].forEach(([value,text])=>preset.append(new Option(text,value)));preset.value=state.meta.layoutPreset;const auto=document.createElement('select');[[0,'Automatic Fetch: Off'],[15,'Every 15 minutes'],[30,'Every 30 minutes'],[60,'Every 60 minutes']].forEach(([value,text])=>auto.append(new Option(text,value)));auto.value=String(state.meta.autoFetchMinutes);const notify=document.createElement('input');notify.type='checkbox';notify.checked=state.meta.notifyComplete;const notifyLabel=el('label','settings-check');notifyLabel.append(notify,el('span','','Notify when background Git jobs finish'));const saveApp=el('button','primary','Apply preferences');saveApp.addEventListener('click',async()=>{state.meta.theme=theme.value;state.meta.accentColor=accent.value;state.meta.uiScale=Number(scale.value);state.meta.layoutPreset=preset.value;state.meta.autoFetchMinutes=Number(auto.value);state.meta.notifyComplete=notify.checked;if(notify.checked&&'Notification'in window&&Notification.permission==='default')await Notification.requestPermission();saveMeta();applyAppearance();setNotice('Git Deck preferences saved.');renderWorkspace();});const install=el('button','','Add Explorer menu');install.addEventListener('click',()=>runWorkspaceAction('shell-register',{},'Add “Open in Git Deck” to the Windows context menu for this user?'));const uninstall=el('button','','Remove Explorer menu');uninstall.addEventListener('click',()=>runWorkspaceAction('shell-unregister',{},'Remove “Open in Git Deck” from Windows Explorer?'));appForm.append(theme,accent,scale,preset,auto,notifyLabel,saveApp,install,uninstall);app.append(appForm);layout.prepend(app);content.append(layout);}

let preserveBranchTree=false;
function renderWorkspace() {
  if(state.workspace&&!preserveBranchTree)renderWorkbenchTree(state.workspace);
  const data=state.workspace;const content=$('workspace-content');content.replaceChildren();if(!data)return;if(state.workspaceTab==='history')content.append(renderHistoryContext(data));
  if(workspaceNeedsExtras()&&data.settings?.extrasLoaded===false){content.append(workspaceEmpty('Loading additional data…','Git LFS and submodules are checked only when this view opens'));loadWorkspace();return;}
  renderSafetyCenter(content,data);
  if(state.workspaceTab==='compare')renderCompareView(content,data);
  else if(state.workspaceTab==='gitlab-inbox')renderGitLabInboxView(content,data);
  else if(state.workspaceTab==='search-history')renderHistorySearchView(content,data);
  else if(state.workspaceTab==='rebase')renderRebaseView(content,data);
  else if(state.workspaceTab==='conflicts')renderConflictView(content,data);
  else if(state.workspaceTab==='health')renderRepositoryHealthView(content,data);
  else if(state.workspaceTab==='worktrees')renderWorktreesView(content,data);
  else if(state.workspaceTab==='patches')renderPatchesView(content,data);
  else if(state.workspaceTab==='tools')renderToolsView(content,data);
  else if(state.workspaceTab==='branches')renderBranchesView(content,data);
  else if(state.workspaceTab==='history')renderHistoryView(content,data);
  else if(state.workspaceTab==='stashes')renderStashesView(content,data);
  else if(state.workspaceTab==='tags')renderTagsView(content,data);
  else if(state.workspaceTab==='remotes')renderRemotesView(content,data);
  else if(state.workspaceTab==='recovery')renderRecoveryViewV2(content,data);
  else if(state.workspaceTab==='settings')renderSettingsView(content,data);
  else renderChangesView(content,data);
}

let mrReadinessTimer=null;
async function loadMrReadiness(){const box=$('mr-readiness');const submit=$('mr-form').querySelector('button[type="submit"],button.primary');const source=$('mr-source-branch').value.trim();const requested=$('mr-target').value.trim();if(!state.mrRepo||!source||!requested){box.replaceChildren(el('p','mr-ready-warn','Select source and target branches first'));submit.disabled=true;return;}const local=(state.workspace?.branches||[]).some(item=>item.name===requested);const remote=(state.workspace?.remoteBranches||[]).find(item=>item.name===requested||item.name.endsWith('/'+requested));const target=local?requested:(remote?.name||requested);box.replaceChildren(el('span','loading-spinner'),el('p','','Checking commits, conflicts and working tree…'));submit.disabled=true;try{const response=await api(`/api/repo/compare?path=${encodeURIComponent(state.mrRepo.path)}&source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}&remote=${encodeURIComponent(state.mrRemote)}`);const result=response.compare;const head=el('div','mr-readiness-head');head.append(el('b','',`${result.ahead} commits · ${result.files.length} files`),el('small','',`${source} → ${requested}`));const list=el('div','mr-readiness-list');if(!state.lastFetchAt){const row=el('div','readiness-row warn');row.append(el('b','','•'),el('span','','Fetch status'),el('small','','Not fetched in this session'));list.append(row);}result.checks.forEach(item=>{const row=el('div',`readiness-row ${item.level}`);row.append(el('b','',item.level==='ok'?'✓':item.level==='block'?'!':'•'),el('span','',item.label),el('small','',item.detail));list.append(row);});box.replaceChildren(head,list);const blocked=result.checks.some(item=>item.level==='block');submit.disabled=blocked;submit.textContent=blocked?'Resolve blockers first':'Push & Create MR';}catch(error){box.replaceChildren(el('p','mr-ready-error',error.message));submit.disabled=false;submit.textContent='Push & Create MR';}}

function showMrDialog(repo,sourceBranch='',remote='origin') {
  const source=sourceBranch||state.workspace?.branch||repo.branch;state.mrRepo=repo;state.mrSource=source;state.mrRemote=remote||'origin';$('mr-form').reset();$('mr-message').textContent='';$('mr-source-branch').value=source;$('mr-source').textContent=`${repo.name} · ${state.mrRemote}/${source} → GitLab merge request`;
  const refs=[...(state.workspace?.branches||[]).map((item)=>item.name),...(state.workspace?.remoteBranches||[]).map((item)=>item.name.replace(/^[^/]+\//,''))];const targets=[...new Set(refs)].filter((item)=>item&&item!==source);const preferred=['develop','development','main','master'].find((item)=>targets.includes(item))||targets[0]||'';$('mr-target').value=preferred;const options=$('mr-target-options');options.replaceChildren();targets.forEach((item)=>{const option=document.createElement('option');option.value=item;options.append(option);});
  const head=state.workspace?.history?.find((item)=>`${item.decorations||''}`.split(',').some((ref)=>ref.trim().replace(/^HEAD -> /,'').replace(/^[^/]+\//,'')===source));$('mr-title').value=head?.subject||(source===repo.branch?(repo.lastCommit||'').replace(/^[a-f0-9]+\s+\d{4}-\d{2}-\d{2}\s+/i,''):'');$('mr-backdrop').classList.remove('hidden');loadMrReadiness();$('mr-target').focus();
}

function hideMrDialog(){ $('mr-backdrop').classList.add('hidden'); state.mrRepo=null;state.mrSource='';state.mrRemote='origin'; }

function safeRemoteLabel(value=''){try{const url=new URL(value);url.username='';url.password='';return url.toString();}catch{return value.replace(/:\/\/[^/@]+@/,'://');}}
function cleanGitError(value=''){return String(value||'Git command failed.').split(/\r?\n/).map(line=>line.replace(/^git\.exe\s*:\s*/i,'').trim()).filter(line=>line&&!/^At [A-Z]:\\/i.test(line)&&!/^\+\s/.test(line)&&!/^CategoryInfo\s*:/i.test(line)&&!/^FullyQualifiedErrorId\s*:/i.test(line)).join('\n').trim();}
function classifyPushError(value=''){const technical=cleanGitError(value);if(/non-fast-forward|fetch first|updates were rejected because the remote contains work/i.test(technical))return {title:'Push stopped — remote has newer commits',detail:'Git prevented overwriting remote work. Fetch the latest data and compare before choosing pull, rebase or merge for your project workflow.',technical,canFetch:true};if(/invalid branch name|invalid refspec|not a valid ref/i.test(technical))return {title:'Push stopped — remote branch name is invalid',detail:'Enter a valid remote branch name, such as main or feature/my-work, without spaces.',technical,canFetch:false};if(/authentication failed|could not read username|permission denied|access denied|403/i.test(technical))return {title:'Push stopped — authentication or permission failed',detail:'Check your Git account, credentials and write access to this branch, then retry.',technical,canFetch:false};if(/protected branch|pre-receive hook declined|hook declined/i.test(technical))return {title:'Push stopped — branch policy rejected it',detail:'This remote branch is protected. You may need to push a feature branch and open a merge request instead.',technical,canFetch:false};return {title:'Push did not complete',detail:'No files or commits were deleted. Review Technical details and resolve the cause before retrying.',technical,canFetch:true};}
function hidePushError(){$('push-error-card').classList.add('hidden');$('push-error-title').textContent='';$('push-error-detail').textContent='';$('push-error-technical').textContent='';}
function showPushError(error){const info=classifyPushError(error?.message||error);$('push-error-title').textContent=info.title;$('push-error-detail').textContent=info.detail;$('push-error-technical').textContent=info.technical;$('push-fetch-compare').classList.toggle('hidden',!info.canFetch);$('push-error-card').classList.remove('hidden');$('push-message').textContent='Push failed. Git Deck stopped without rewriting remote history.';}
function selectedPushBranches(){return [...$('push-branch-list').querySelectorAll('.push-branch-row')].filter(row=>row.querySelector('.push-check').checked).map(row=>({local:row.dataset.local,remote:row.querySelector('.push-target').value.trim(),track:row.querySelector('.push-track').checked}));}
function updatePushDialog(){const remote=$('push-remote').value;const remoteInfo=(state.workspace?.remotes||[]).find(item=>item.name===remote);$('push-remote-url').textContent=safeRemoteLabel(remoteInfo?.pushUrl||remoteInfo?.fetchUrl||'No URL configured');const rows=[...$('push-branch-list').querySelectorAll('.push-branch-row')];const selected=rows.filter(row=>row.querySelector('.push-check').checked);rows.forEach(row=>{const active=row.querySelector('.push-check').checked;row.classList.toggle('selected',active);row.querySelector('.push-target').disabled=!active;row.querySelector('.push-track').disabled=!active;});$('push-select-all').checked=Boolean(rows.length)&&selected.length===rows.length;$('push-select-all').indeterminate=selected.length>0&&selected.length<rows.length;const tags=$('push-tags').checked;const force=$('push-force').checked;const commands=selected.map(row=>{const local=row.dataset.local;const target=row.querySelector('.push-target').value.trim()||local;const track=row.querySelector('.push-track').checked?'--set-upstream ':'';return `git push ${force?'--force-with-lease ':''}${track}${remote} ${local}:refs/heads/${target}`;});if(tags)commands.push(`git push ${force?'--force-with-lease ':''}${remote} --tags`);$('push-command').textContent=commands.join('\n')||'Select a branch or Push all tags.';$('push-submit').disabled=!commands.length||selected.some(row=>!row.querySelector('.push-target').value.trim());const pushReason=!commands.length?'Select a branch or enable Push all tags.':selected.some(row=>!row.querySelector('.push-target').value.trim())?'Enter a remote branch name for every selected branch.':'';$('push-submit').title=pushReason;$('push-action-target').textContent=actionContext(state.workspaceRepo,state.workspace,{remote,branches:selectedPushBranches()})+(pushReason?'\n'+pushReason:'');$('push-submit').textContent=selected.length?`Push ${selected.length} branch${selected.length===1?'':'es'}${tags?' + tags':''}`:tags?'Push tags':'Push selected';}
function renderPushBranches(remote){const list=$('push-branch-list');list.replaceChildren();const data=state.workspace||{};const remotes=(data.remoteBranches||[]).map(item=>item.name);(data.branches||[]).forEach(branch=>{const row=el('label','push-branch-row');row.dataset.local=branch.name;const select=document.createElement('input');select.type='checkbox';select.className='push-check';select.checked=branch.current;select.setAttribute('aria-label',`Push ${branch.name}`);const local=el('span','push-local');local.append(el('strong','',branch.name));if(branch.current)local.append(el('i','','CURRENT'));if(branch.current&&data.sync?.ahead)local.append(el('b','push-ahead',`↑ ${data.sync.ahead}`));const upstream=(branch.upstream||'').startsWith(remote+'/')?branch.upstream.slice(remote.length+1):'';const target=document.createElement('input');target.className='push-target';target.value=upstream||branch.name;target.setAttribute('aria-label',`Remote branch for ${branch.name}`);target.setAttribute('list','push-remote-branch-options');const track=document.createElement('input');track.type='checkbox';track.className='push-track';track.checked=Boolean(branch.upstream)||branch.current;track.setAttribute('aria-label',`Track remote for ${branch.name}`);row.append(select,local,target,track);select.addEventListener('change',updatePushDialog);target.addEventListener('input',updatePushDialog);track.addEventListener('change',updatePushDialog);list.append(row);});const options=$('push-remote-branch-options')||document.createElement('datalist');options.id='push-remote-branch-options';options.replaceChildren();remotes.filter(name=>name.startsWith(remote+'/')).forEach(name=>options.append(new Option(name.slice(remote.length+1))));if(!options.isConnected)$('push-form').append(options);updatePushDialog();}
function showPushDialog(){const data=state.workspace;if(!state.workspaceRepo||!data)return;if(!(data.remotes||[]).length){setNotice('Add a remote before pushing.');selectWorkspaceTab('remotes');return;}$('push-form').reset();hidePushError();$('push-title').textContent=`Push · ${state.workspaceRepo.name}`;$('push-repository').textContent=`Select only the branches you want to push · Current: ${data.branch||'detached HEAD'}`;$('push-message').textContent='';const remote=$('push-remote');remote.replaceChildren();(data.remotes||[]).forEach(item=>remote.append(new Option(item.name,item.name)));const upstreamRemote=(data.sync?.upstream||'').split('/')[0];remote.value=(data.remotes||[]).some(item=>item.name===upstreamRemote)?upstreamRemote:((data.remotes||[]).some(item=>item.name==='origin')?'origin':data.remotes[0].name);renderPushBranches(remote.value);$('push-backdrop').classList.remove('hidden');requestAnimationFrame(()=>$('push-branch-list').querySelector('.push-check:checked')?.focus());}
function hidePushDialog(){if(state.busy)return;$('push-backdrop').classList.add('hidden');}
function updateTagDialog(){
  const specific=$('tag-target-specific').checked;const lightweight=$('tag-lightweight').checked;const push=$('tag-push').checked;const tag=$('tag-name').value.trim()||'<tag>';const target=specific?($('tag-commit').value.trim()||'<commit>'):'';const message=$('tag-message').value.trim()||'<description>';
  $('tag-commit').disabled=!specific;$('tag-message').disabled=lightweight;$('tag-remote').disabled=!push;$('tag-submit').disabled=!$('tag-name').value.trim()||(specific&&!$('tag-commit').value.trim());
  const args=['git tag'];if($('tag-move').checked)args.push('-f');if(!lightweight)args.push('-a');args.push(`"${tag.replaceAll('"','\\"')}"`);if(target)args.push(target);if(!lightweight)args.push(`-m "${message.replaceAll('"','\\"')}"`);if(push&&$('tag-remote').value)args.push(`\ngit push ${$('tag-remote').value}${$('tag-move').checked?' --force-with-lease':''} "refs/tags/${tag.replaceAll('"','\\"')}"`);$('tag-command').textContent=args.join(' ');
}
function showBranchCreator(){
  const repo=state.workspaceRepo,data=state.workspace;
  if(!repo||!data||state.busy)return;
  const branch=data.branch;
  const ui=releaseDialog('Create new branch');
  const form=el('form'),label=el('label','','New branch name'),name=el('input');
  name.type='text';name.required=true;name.placeholder='feature/my-change';name.setAttribute('aria-label','New branch name');name.className='workflow-input';label.append(name);
  const status=el('p');status.setAttribute('role','status');
  const create=el('button','primary','Create & switch');create.type='submit';
  form.append(el('p','',`Repository: ${repo.name}\n${repo.path}`),el('p','',`Start from: HEAD · ${branch||'Detached HEAD'}`),label,el('p','','Creates a local branch and switches to it. Pending changes must be committed or stashed first. Nothing is pushed.'),status,create);ui.body.append(form);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(state.busy||create.disabled)return;
    if(state.workspaceRepo?.path!==repo.path||state.workspace?.branch!==branch){status.textContent='Repository or working branch changed. Close and reopen this dialog.';return;}
    const value=name.value.trim();if(!value){name.focus();return;}
    if((state.workspace.branches||[]).some(item=>item.name===value)){status.textContent='A local branch with this name already exists.';name.focus();return;}
    create.disabled=true;status.textContent='Creating branch…';
    try{const result=await runWorkspaceAction('branch-create',{branch:value},`Create ${value} from HEAD (${branch||'Detached HEAD'}) and switch to it?`);if(result)ui.dialog.close();else status.textContent='Branch was not created. Check Output for details or try again.';}
    catch(error){status.textContent=error.message;}finally{create.disabled=false;}
  });
  name.focus();
}
$('toolbar-create-branch').addEventListener('click',showBranchCreator);
$('toolbar-create-tag').addEventListener('click',()=>{if(!state.busy)showTagDialog();});
function showTagDialog(commit=''){
  const data=state.workspace;if(!state.workspaceRepo||!data)return;$('tag-form').reset();state.tagCreateOpen=true;state.tagTargetCommit=commit||'';$('tag-dialog-title').textContent=`Add Tag · ${state.workspaceRepo.name}`;$('tag-repository').textContent=commit?`Create at ${(commit||'').slice(0,12)} · ${data.branch||'detached HEAD'}`:`Create at HEAD · ${data.branch||'detached HEAD'}`;$('tag-message-status').textContent='';
  const options=$('tag-commit-options');options.replaceChildren();(data.history||[]).forEach(item=>{const option=document.createElement('option');option.value=item.fullHash;option.label=`${item.hash} · ${item.subject}`;options.append(option);});const remote=$('tag-remote');remote.replaceChildren();(data.remotes||[]).forEach(item=>remote.append(new Option(item.name,item.name)));const defaultRemote=(data.remotes||[]).some(item=>item.name==='origin')?'origin':data.remotes?.[0]?.name||'';remote.value=defaultRemote;$('tag-push').disabled=!defaultRemote;
  if(commit){$('tag-target-specific').checked=true;$('tag-commit').value=commit;}else{$('tag-target-head').checked=true;$('tag-commit').value='';}$('tag-advanced').open=false;updateTagDialog();$('tag-backdrop').classList.remove('hidden');requestAnimationFrame(()=>$('tag-name').focus());
}
function hideTagDialog(){if(state.busy)return;$('tag-backdrop').classList.add('hidden');state.tagCreateOpen=false;state.tagTargetCommit='';}
function showAboutDialog(view='about'){
  const titles={about:'About Git Deck','getting-started':'Getting Started',shortcuts:'Keyboard Shortcuts'};document.querySelectorAll('.help-menu').forEach(menu=>menu.removeAttribute('open'));$('about-title').textContent=titles[view]||titles.about;document.querySelectorAll('[data-about-view]').forEach(section=>section.classList.toggle('hidden',section.dataset.aboutView!==view));$('about-backdrop').classList.remove('hidden');requestAnimationFrame(()=>$('about-close').focus());
}
function hideAboutDialog(){$('about-backdrop').classList.add('hidden');}

$('repo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if(state.busy)return;
  const mode=state.mode;const body = { action: mode, path: $('repo-path').value.trim(), url: $('repo-url').value.trim(),name:$('create-name').value.trim(),defaultBranch:$('create-branch').value.trim(),readme:$('create-readme').checked,gitignoreTemplate:$('create-gitignore').value };
  const submit=event.submitter; if(submit)submit.disabled=true;
  setBusy(true);
  $('form-message').textContent = 'Working…'; showLoading(mode==='scan'?'Scanning for Git repositories…':mode==='clone'?'Cloning repository…':mode==='create'?'Creating local repository…':'Adding repository…',body.path);
  try { let result=await api('/api/action', { method: 'POST', body: JSON.stringify(body) });if(result.async)hideDialog();result=await resolveActionResult(result);hideDialog();setNotice(result.message);setOutput(result.output||result.message);await refresh();if(mode==='create'&&result.path){const repo=state.repos.find(item=>item.path.toLowerCase()===result.path.toLowerCase());if(repo)openWorkspace(repo,'changes',true);} }
  catch (error) { $('form-message').textContent = error.message; }
  finally { if(submit)submit.disabled=false;setBusy(false);hideLoading(); }
});

$('mr-form').addEventListener('submit',async(event)=>{
  event.preventDefault(); const repo=state.mrRepo; if(!repo||state.busy)return;
  if(!confirm(`Push ${state.mrSource} and create this merge request?`))return;
  const submit=event.submitter;if(submit)submit.disabled=true;setBusy(true);
  $('mr-message').textContent='Pushing branch and creating merge request…';showLoading('Pushing and creating merge request…',`${repo.name}: ${state.mrSource}`);
  try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'create-mr',path:repo.path,source:state.mrSource,remote:state.mrRemote,target:$('mr-target').value.trim(),title:$('mr-title').value.trim(),description:$('mr-description').value,assignee:$('mr-assignee').value.trim(),reviewer:$('mr-reviewer').value.trim(),labels:$('mr-labels').value.trim(),milestone:$('mr-milestone').value.trim(),template:$('mr-template').value.trim(),draft:$('mr-draft').checked,squash:$('mr-squash').checked,removeSource:$('mr-remove-source').checked})});hideMrDialog();setNotice(result.message);setOutput(result.output||result.message,{collapse:true});await refresh();}
  catch(error){$('mr-message').textContent=error.message;}
  finally{if(submit)submit.disabled=false;setBusy(false);hideLoading();}
});

$('search').addEventListener('input',()=>{$('repo-search').value=$('search').value;state.repoPage=1;render();});
$('repo-search').addEventListener('input',()=>{$('search').value=$('repo-search').value;state.repoPage=1;render();});
$('search-clear').addEventListener('click',()=>{$('search').value='';$('repo-search').value='';state.repoPage=1;render();$('search').focus();});
$('repo-search-clear').addEventListener('click',()=>{$('search').value='';$('repo-search').value='';state.repoPage=1;render();$('repo-search').focus();});
$('repo-density').addEventListener('click',toggleRepositoryDensity);
document.addEventListener('click',(event)=>{const choice=event.target.closest('button[data-theme-choice]');if(!choice)return;setTheme(choice.dataset.themeChoice);choice.closest('details')?.removeAttribute('open');});
document.addEventListener('input',(event)=>{if(event.target.matches('.theme-custom-color'))setAccentColor(event.target.value);});
document.addEventListener('mousedown',(event)=>{document.querySelectorAll('.theme-picker[open]').forEach(picker=>{if(!picker.contains(event.target))picker.removeAttribute('open');});});
$('quick-filters').addEventListener('click',(event)=>{const button=event.target.closest('button[data-filter]');if(button)setRepoFilter(button.dataset.filter);});
$('repo-group').addEventListener('change',()=>{state.repoGroup=$('repo-group').value;state.repoPage=1;$('bulk-fetch').disabled=!state.scanLocations.includes(state.repoGroup);render();});
$('bulk-fetch').addEventListener('click',()=>{if(state.scanLocations.includes(state.repoGroup))runScanLocation('bulk-fetch',state.repoGroup);});
document.querySelector('.repo-overview').addEventListener('click',(event)=>{const button=event.target.closest('button[data-overview-filter]');if(button)setRepoFilter(button.dataset.overviewFilter);});
 document.addEventListener('keydown', (event) => { if ((event.ctrlKey && event.key.toLowerCase() === 'k')||(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='p')) { event.preventDefault(); showCommandPalette();return; } if(event.ctrlKey&&!event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();showRepoSwitcher();return;}if(event.ctrlKey&&event.key==='1'&&state.workspace){event.preventDefault();selectWorkspaceTab('changes');return;}if(event.ctrlKey&&event.key==='2'&&state.workspace){event.preventDefault();selectWorkspaceTab('history');return;} if (event.key === 'Escape') { hideContextMenu();hideCommandPalette();document.querySelectorAll('.diff-fullscreen').forEach((item)=>item.classList.remove('diff-fullscreen'));hideRepoSwitcher();hideDialog(); hideMrDialog();hidePushDialog();hideTagDialog();hideAboutDialog();hideRepositoryDetails();hideOperationsCenter();document.querySelectorAll('.help-menu').forEach(menu=>menu.removeAttribute('open')); $('gitlab-backdrop').classList.add('hidden'); } });
$('command-search').addEventListener('input',()=>{state.commandIndex=0;renderCommandPalette();});
$('command-search').addEventListener('keydown',(event)=>{const items=$('command-list').querySelectorAll('button');if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!items.length)return;state.commandIndex=(state.commandIndex+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items.forEach((item,index)=>item.classList.toggle('active',index===state.commandIndex));items[state.commandIndex]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();items[state.commandIndex]?.click();}});
$('command-palette').addEventListener('mousedown',(event)=>{if(event.target===$('command-palette'))hideCommandPalette();});
document.addEventListener('mousedown',(event)=>{if(!event.target.closest('#context-menu'))hideContextMenu();});
$('repo-switcher-search').addEventListener('input',()=>{repoSwitcherIndex=0;repoSwitcherPage=0;renderRepoSwitcher();});
$('repo-switcher-search').addEventListener('keydown',(event)=>{const items=$('repo-switcher-list').querySelectorAll('.repo-switcher-item');if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!items.length)return;repoSwitcherIndex=(repoSwitcherIndex+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;renderRepoSwitcher();$('repo-switcher-list').querySelector('.repo-switcher-item.active')?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();items[repoSwitcherIndex]?.click();}});
document.addEventListener('mousedown',(event)=>{if(!$('repo-switcher').classList.contains('hidden')&&!event.target.closest('#repo-switcher')&&!event.target.closest('.repo-tab-search'))hideRepoSwitcher();});
document.querySelectorAll('.operations-open').forEach((button)=>button.addEventListener('click',()=>showOperationsCenter('fleet')));
$('operations-close').addEventListener('click',hideOperationsCenter);
$('operations-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('operations-backdrop'))hideOperationsCenter();});
document.querySelector('.operations-tabs').addEventListener('click',(event)=>{const button=event.target.closest('[data-operations-view]');if(button)switchOperationsView(button.dataset.operationsView);});
$('fleet-search').addEventListener('input',renderFleetDashboard);$('fleet-filter').addEventListener('change',renderFleetDashboard);
$('fleet-refresh').addEventListener('click',async()=>{await refreshRepositoryStatuses(true);renderFleetDashboard();loadJobs();});$('jobs-refresh').addEventListener('click',loadJobs);
$('operations-fetch-scope').addEventListener('change',()=>{const previous=state.meta.autoFetchScope;state.meta.autoFetchScope=$('operations-fetch-scope').value;updateSmartFetchSummary();state.meta.autoFetchScope=previous;});
$('automation-save').addEventListener('click',()=>{state.meta.autoFetchMinutes=Number($('operations-fetch-interval').value);state.meta.autoFetchScope=$('operations-fetch-scope').value;saveMeta();scheduleAutoFetch();updateSmartFetchSummary();setNotice(`Smart Fetch saved: ${state.meta.autoFetchMinutes?`every ${state.meta.autoFetchMinutes} minutes`:'Off'} · ${state.meta.autoFetchScope}`);});
$('smart-fetch-now').addEventListener('click',async()=>{state.meta.autoFetchScope=$('operations-fetch-scope').value;saveMeta();updateSmartFetchSummary();await runSmartFetch(true);loadJobs();renderFleetDashboard();});
$('integration-install').addEventListener('click',()=>{if(confirm('Add “Open in Git Deck” to the Windows context menu for this user?'))runIntegrationAction('shell-register');});
$('integration-remove').addEventListener('click',()=>{if(confirm('Remove “Open in Git Deck” from Windows Explorer?'))runIntegrationAction('shell-unregister');});
$('refresh').addEventListener('click',()=>refresh(true));
$('clone').addEventListener('click', () => showDialog('clone'));
$('create').addEventListener('click', () => showDialog('create'));
$('add').addEventListener('click', () => showDialog('add'));
$('scan').addEventListener('click', () => showDialog('scan'));
$('browse').addEventListener('click', async () => { try { const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'choose-folder'})}); if(result.path)$('repo-path').value=result.path; } catch(error) { $('form-message').textContent=error.message; } });
$('clone-root').addEventListener('change',()=>{if(state.mode==='clone')updateCloneDestination();else if(state.mode==='create')updateCreateDestination();});
$('repo-url').addEventListener('input',updateCloneDestination);
$('create-name').addEventListener('input',updateCreateDestination);
$('cancel').addEventListener('click', hideDialog);
$('backdrop').addEventListener('mousedown', (event) => { if (event.target === $('backdrop')) hideDialog(); });
$('gitlab').addEventListener('click',showGitLab);
$('gitlab-close').addEventListener('click',()=>$('gitlab-backdrop').classList.add('hidden'));
$('gitlab-host').addEventListener('change',updateGitLabStatus);
$('gitlab-load').addEventListener('click',loadGitLabProjects);
$('gitlab-search').addEventListener('input',()=>{state.projectPage=1;renderProjects();});
$('gitlab-search-clear').addEventListener('click',()=>{$('gitlab-search').value='';state.projectPage=1;renderProjects();$('gitlab-search').focus();});
$('gitlab-login').addEventListener('click',async()=>{const host=$('gitlab-host').value;if(!host)return;try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'gitlab-login',host})});$('gitlab-status').textContent=result.message;}catch(error){$('gitlab-status').textContent=error.message;}});
$('gitlab-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('gitlab-backdrop'))$('gitlab-backdrop').classList.add('hidden');});
$('mr-cancel').addEventListener('click',hideMrDialog);
$('mr-close-top').addEventListener('click',hideMrDialog);
$('mr-target').addEventListener('input',()=>{clearTimeout(mrReadinessTimer);mrReadinessTimer=setTimeout(loadMrReadiness,320);});
$('mr-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('mr-backdrop'))hideMrDialog();});
$('push-close').addEventListener('click',hidePushDialog);
$('push-cancel').addEventListener('click',hidePushDialog);
$('push-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('push-backdrop'))hidePushDialog();});
$('push-remote').addEventListener('change',()=>renderPushBranches($('push-remote').value));
$('push-select-all').addEventListener('change',()=>{$('push-branch-list').querySelectorAll('.push-check').forEach(item=>item.checked=$('push-select-all').checked);updatePushDialog();});
$('push-tags').addEventListener('change',updatePushDialog);
$('push-force').addEventListener('change',updatePushDialog);
$('push-error-dismiss').addEventListener('click',hidePushError);
$('push-fetch-compare').addEventListener('click',async()=>{hidePushError();$('push-message').textContent='Fetching updates before comparing…';const result=await runWorkspaceAction('fetch');if(result){$('push-message').textContent='Fetch complete. Opening Compare';hidePushDialog();selectWorkspaceTab('compare');}else showPushError('Fetch failed. Check Output and retry');});
$('push-form').addEventListener('submit',async(event)=>{event.preventDefault();if(state.busy)return;const branches=selectedPushBranches();const pushTags=$('push-tags').checked;const forceWithLease=$('push-force').checked;if(!branches.length&&!pushTags){$('push-message').textContent='Select at least one branch or Push all tags';return;}hidePushError();$('push-message').textContent='Sending data to remote…';const warning=forceWithLease?'Use force with lease for the selected items?\nThe command stops if the remote has new commits not yet known locally':'';const result=await runWorkspaceAction('push-selection',{remote:$('push-remote').value,branches,pushTags,forceWithLease},warning,{onError:showPushError});if(result){$('push-message').textContent=result.message;$('push-backdrop').classList.add('hidden');}});
$('tag-close').addEventListener('click',hideTagDialog);
$('tag-cancel').addEventListener('click',hideTagDialog);
$('tag-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('tag-backdrop'))hideTagDialog();});
['tag-name','tag-commit','tag-message'].forEach(id=>$(id).addEventListener('input',updateTagDialog));
['tag-target-head','tag-target-specific','tag-push','tag-lightweight','tag-move'].forEach(id=>$(id).addEventListener('change',()=>{updateTagDialog();if(id==='tag-target-specific'&&$(id).checked)$('tag-commit').focus();}));
$('tag-remote').addEventListener('change',updateTagDialog);
$('tag-form').addEventListener('submit',async(event)=>{event.preventDefault();if(state.busy)return;const tag=$('tag-name').value.trim();const specific=$('tag-target-specific').checked;const target=specific?$('tag-commit').value.trim():'';if(!tag){$('tag-name').focus();return;}if(specific&&!target){$('tag-commit').focus();return;}const lightweight=$('tag-lightweight').checked;const move=$('tag-move').checked;const push=$('tag-push').checked;const remote=push?$('tag-remote').value:'';$('tag-message-status').textContent='Creating tag…';const warning=move?'\n\nThis moves the existing tag and may force push if Push is selected':'';const result=await runWorkspaceAction('tag-create',{tag,commit:target,message:$('tag-message').value.trim(),lightweight,move,push,remote},`Create${lightweight?' lightweight':' annotated'} tag “${tag}” at ${target||'HEAD'}${push?` and push to ${remote}`:' without pushing'}?${warning}`);if(result){$('tag-backdrop').classList.add('hidden');state.tagCreateOpen=false;state.tagTargetCommit='';}else $('tag-message-status').textContent='Could not create tag. See Output for details.';});
document.querySelectorAll('.help-menu-panel').forEach(panel=>panel.addEventListener('click',(event)=>{const button=event.target.closest('button[data-help-view]');if(button)showAboutDialog(button.dataset.helpView);}));
$('about-close').addEventListener('click',hideAboutDialog);
$('about-ok').addEventListener('click',hideAboutDialog);
$('about-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('about-backdrop'))hideAboutDialog();});
$('repo-detail-close').addEventListener('click',hideRepositoryDetails);
$('repo-detail-backdrop').addEventListener('mousedown',(event)=>{if(event.target===$('repo-detail-backdrop'))hideRepositoryDetails();});
$('repo-detail-copy-path').addEventListener('click',()=>{if(repoDetailRepo)copyRepositoryValue(repoDetailRepo.path,'folder path');});
$('repo-detail-open-folder').addEventListener('click',()=>{const repo=repoDetailRepo;if(!repo)return;hideRepositoryDetails();run('open-folder',repo);});
$('repo-detail-open-remote').addEventListener('click',()=>{const repo=repoDetailRepo;if(!repo)return;hideRepositoryDetails();run('open-remote',repo);});
$('repo-detail-open-workspace').addEventListener('click',()=>{const repo=repoDetailRepo;if(!repo||!repo.valid)return;hideRepositoryDetails();openWorkspace(repo,state.workspaceTab||'history',true);});
document.addEventListener('mousedown',(event)=>{document.querySelectorAll('.help-menu[open]').forEach(menu=>{if(!event.target.closest('.help-menu'))menu.removeAttribute('open');});});
$('workspace-tabs').addEventListener('click',(event)=>{const button=event.target.closest('button[data-workspace-tab]');if(button)selectWorkspaceTab(button.dataset.workspaceTab);});
document.querySelector('.tree-view-switcher').addEventListener('click',(event)=>{const button=event.target.closest('button[data-tree-view]');if(button)selectWorkspaceTab(button.dataset.treeView);});
$('status-fetch').addEventListener('click',()=>{if(state.workspace?.remotes?.length)runWorkspaceAction('fetch');});
$('status-commands').addEventListener('click',()=>showCommandPalette());
$('tree-search').addEventListener('input',()=>{if(state.workspace)renderWorkbenchTree(state.workspace);});
$('library-pin').addEventListener('click',()=>setLibraryPinned(!state.meta.libraryPinned));
$('library-collapse').addEventListener('click',()=>{setLibraryPinned(false);document.body.classList.add('library-collapsed');});
$('focus-workbench').addEventListener('click',()=>setFocusWorkbench(!document.body.classList.contains('focus-workbench')));
$('view-back').addEventListener('click',()=>moveViewHistory(-1));
$('view-forward').addEventListener('click',()=>moveViewHistory(1));
document.addEventListener('mousedown',(event)=>{if(window.innerWidth>1350||!document.body.classList.contains('workbench-mode')||document.body.classList.contains('library-collapsed'))return;if(event.target.closest?.('.repos')||event.target.closest?.('#library-open'))return;document.body.classList.add('library-collapsed');});
document.querySelector('.workspace-header-actions').addEventListener('click',(event)=>{const raw=event.target.closest('button');if(raw?.id==='library-open'){if(!document.body.classList.contains('library-collapsed')&&state.meta.libraryPinned)setLibraryPinned(false);document.body.classList.toggle('library-collapsed');return;}if(raw?.dataset.workbenchNav){selectWorkspaceTab(raw.dataset.workbenchNav);return;}const button=event.target.closest('button[data-workspace-quick]');const repo=state.workspaceRepo;if(!button||!repo)return;button.closest('details')?.removeAttribute('open');const action=button.dataset.workspaceQuick;if(action==='favorite'){const key=repoKey(repo);if(isFavorite(repo))delete state.meta.favorites[key];else state.meta.favorites[key]=true;saveMeta();button.textContent=isFavorite(repo)?'★':'☆';button.classList.toggle('active',isFavorite(repo));render();}else if(action==='create-mr')showMrDialog(repo);else run(action,repo);});
document.querySelector('.sync-actions').addEventListener('click',(event)=>{const nav=event.target.closest('button[data-workbench-nav]');if(nav){nav.closest('details')?.removeAttribute('open');if(nav.dataset.workbenchNav==='tag-create')openTagCreator();else selectWorkspaceTab(nav.dataset.workbenchNav);return;}const button=event.target.closest('button[data-git-action]');if(!button)return;const action=button.dataset.gitAction;if(action==='fetch')runWorkspaceAction('fetch');else if(action==='pull')runWorkspaceAction('pull',{strategy:state.meta.pullStrategy},syncConfirmation('pull'));else if(action==='push')showPushDialog();});
$('pull-strategy').value=state.meta.pullStrategy;$('pull-strategy').addEventListener('change',()=>{state.meta.pullStrategy=$('pull-strategy').value;saveMeta();setNotice(`Pull strategy: ${state.meta.pullStrategy}`);});
$('output-clear').addEventListener('click',()=>setOutput('Output cleared.'));
$('job-cancel').addEventListener('click',cancelActiveJob);
$('output-cancel').addEventListener('click',cancelActiveJob);
$('output-toggle').addEventListener('click',()=>{$('console').classList.toggle('collapsed');$('output-toggle').textContent=$('console').classList.contains('collapsed')?'⌃':'⌄';$('output-toggle').setAttribute('aria-label',$('console').classList.contains('collapsed')?'Expand output':'Collapse output');});
$('output-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('output').textContent);setNotice('Output copied to clipboard.');}catch{setNotice('Copy failed. Select the output text and press Ctrl+C.');}});
$('workspace-statusbar').addEventListener('click',(event)=>{const nav=event.target.closest('[data-status-nav]');if(nav)selectWorkspaceTab(nav.dataset.statusNav);else if(event.target.closest('#status-activity')){if($('console').classList.contains('collapsed')){$('output').textContent=state.activity.length?state.activity.map((item)=>`${item.time}  ${item.text}`).join('\n'):'No activity in this session.';$('output-summary').textContent=`Recent activity · ${state.activity.length}`;$('console').classList.remove('collapsed');$('output-toggle').textContent='⌄';}else{$('console').classList.add('collapsed');$('output-toggle').textContent='⌃';}}});

initializePaneResizer();
initializeTreeResizer();
applyAppearance();
updateRepositoryDensity(false);
window.addEventListener('resize',()=>{updateLibraryPinButton();if(!document.body.classList.contains('workbench-mode'))return;if(state.meta.libraryPinned&&canPinLibrary())document.body.classList.remove('library-collapsed');else if(!canPinLibrary())document.body.classList.add('library-collapsed');});
updateLibraryPinButton();
closeWorkspace();
void (async()=>{try{await refresh();if(state.launchPath){const requested=state.launchPath;history.replaceState({},'',location.pathname);try{let repo=state.repos.find(item=>item.path.toLowerCase()===requested.toLowerCase());if(!repo){await api('/api/action',{method:'POST',body:JSON.stringify({action:'add',path:requested})});await loadRepositoryCache(false);repo=state.repos.find(item=>item.path.toLowerCase()===requested.toLowerCase());}if(repo)await openWorkspace(repo,state.meta.lastWorkspaceTab||'history',true);}catch(error){setNotice(error.message);setOutput(error.message,{expand:true,status:'error'});}finally{state.launchPath='';}}else{const savedView=await loadPersistentView();const restored=(savedView.openRepos||[]).map((key)=>state.repos.find((repo)=>repoKey(repo)===String(key).toLowerCase())).filter(Boolean);state.meta.openRepos=[...new Set(restored.map(repoKey))];const lastKey=savedView.path||state.meta.lastRepo;const last=state.repos.find(item=>repoKey(item)===lastKey);if(last&&!state.meta.openRepos.includes(repoKey(last)))state.meta.openRepos.push(repoKey(last));saveMeta();renderRepoTabs();if(last)await openWorkspace(last,savedView.path?savedView.tab:(state.meta.lastWorkspaceTab||'history'),true);else if(lastKey){state.meta.lastRepo='';clearLastView();saveMeta();}else if(state.selected)await openWorkspace(state.selected,state.meta.lastWorkspaceTab||'history',true);}}finally{state.initializing=false;window.GitDeckStartup?.finish();}})();
