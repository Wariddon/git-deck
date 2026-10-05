'use strict';
// One-click Undo, extra keyboard shortcuts and command palette entries.

// ---- Undo last action -------------------------------------------------------
let undoState={available:false};let undoVersion=0;
function undoButton(){
  let button=document.getElementById('undo-last');
  if(button)return button;
  const push=document.querySelector('.sync-actions [data-git-action="push"]');if(!push)return null;
  button=el('button','undo-last hidden');button.id='undo-last';button.type='button';button.append(el('strong','',t('↶ Undo')),el('small','',''));
  button.addEventListener('click',undoLastAction);push.after(button);return button;
}
function describeUndo(info){const what=info.action==='commit'?t('commit “{subject}”',{subject:info.subject||''}):`${info.action}${info.subject?` (${info.subject})`:''}`;const head=String(info.beforeHead||'').slice(0,8);return info.mode==='soft'?t('Undo {what}? Changes go back to staged.',{what}):info.beforeBranch?t('Undo {what}? HEAD returns to {head} on {branch}.',{what,head,branch:info.beforeBranch}):t('Undo {what}? HEAD returns to {head}.',{what,head});}
async function refreshUndoState(){
  const repo=state.workspaceRepo;const version=++undoVersion;const button=undoButton();if(!button)return;
  if(!repo){button.classList.add('hidden');undoState={available:false};return;}
  try{const result=await api(`/api/repo/undo-preview?path=${encodeURIComponent(repo.path)}`);if(version!==undoVersion)return;undoState=result.undo||{available:false};}
  catch{if(version!==undoVersion)return;undoState={available:false};}
  button.classList.toggle('hidden',!undoState.available);
  // The Modern action bar has its own Undo button; it listens for this.
  document.dispatchEvent(new CustomEvent('gitdeck:undo',{detail:{...undoState,title:undoState.available?describeUndo(undoState):''}}));
  if(undoState.available){button.title=describeUndo(undoState);button.querySelector('small').textContent=undoState.action==='commit'?t('Last commit'):t('Last {action}',{action:undoState.action});}
}
async function undoLastAction(){if(!undoState.available||state.busy)return;await runWorkspaceAction('undo-last',{id:undoState.id},describeUndo(undoState));void refreshUndoState();}
if(typeof paintWorkspace==='function'){const baseUndoPaint=paintWorkspace;paintWorkspace=function(...args){const result=baseUndoPaint(...args);void refreshUndoState();return result;};}

// ---- Keyboard shortcuts -----------------------------------------------------
const extraShortcuts=[[t('Next / previous item'),'J / K'],[t('Stage / unstage selected file'),'S / U'],[t('Focus commit message'),'C'],[t('Search in current view'),'/'],[t('Refresh workspace'),'R'],[t('Fetch'),'F'],[t('Push branches…'),'Shift P'],[t('Undo last action'),'Ctrl Z'],[t('Show shortcuts'),'?']];
function isTypingTarget(target){return Boolean(target&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)));}
function dialogOpen(){return [...document.querySelectorAll('.backdrop')].some(node=>!node.classList.contains('hidden'))||!document.getElementById('command-palette')?.classList.contains('hidden');}
function moveSelection(delta){
  const content=document.getElementById('workspace-content');if(!content)return;
  if(state.workspaceTab==='changes'){
    const items=[...content.querySelectorAll('.change-file-main')];if(!items.length)return;
    const index=items.findIndex(item=>item.classList.contains('active'));const next=items[Math.max(0,Math.min(items.length-1,index<0?0:index+delta))];next.click();next.focus();next.scrollIntoView({block:'nearest'});return;
  }
  const rows=[...content.querySelectorAll('.commit-row')].filter(row=>!row.classList.contains('commit-wip'));if(!rows.length)return;
  const index=rows.findIndex(row=>row.classList.contains('selected'));const next=rows[Math.max(0,Math.min(rows.length-1,index<0?0:index+delta))];next.click();next.scrollIntoView({block:'nearest'});
}
function stageActive(stage){
  const active=document.querySelector('#workspace-content .change-file-main.active');if(!active)return;
  const group=active.closest('.change-group');const groups=[...document.querySelectorAll('#workspace-content .change-group')];const isStaged=groups.indexOf(group)===0;
  if(stage===isStaged)return;active.closest('.change-file')?.querySelector('.change-file-action')?.click();
}
document.addEventListener('keydown',(event)=>{
  if(event.defaultPrevented||event.altKey||event.metaKey||isTypingTarget(event.target)||dialogOpen())return;
  if(event.ctrlKey){if(event.key.toLowerCase()==='z'&&!event.shiftKey&&state.workspace&&undoState.available){event.preventDefault();undoLastAction();}return;}
  if(event.key==='?'){event.preventDefault();showAboutDialog('shortcuts');return;}
  if(!state.workspace)return;
  const key=event.key;
  if(key==='j'){event.preventDefault();moveSelection(1);}
  else if(key==='k'){event.preventDefault();moveSelection(-1);}
  else if(key==='s'&&state.workspaceTab==='changes'){event.preventDefault();stageActive(true);}
  else if(key==='u'&&state.workspaceTab==='changes'){event.preventDefault();stageActive(false);}
  else if(key==='c'){event.preventDefault();if(state.workspaceTab!=='changes')selectWorkspaceTab('changes');requestAnimationFrame(()=>document.querySelector('.commit-composer textarea')?.focus());}
  else if(key==='/'){const search=document.querySelector('#workspace-content input[type="search"]');if(search){event.preventDefault();search.focus();search.select();}}
  else if(key==='r'){event.preventDefault();void loadWorkspace();}
  else if(key==='f'){event.preventDefault();runWorkspaceAction('fetch');}
  else if(key==='P'){event.preventDefault();showPushDialog();}
});
(function addShortcutHelp(){const list=document.querySelector('[data-about-view="shortcuts"] .shortcut-list');if(!list)return;extraShortcuts.forEach(([label,keys])=>{const row=el('span','',label+' ');row.append(el('kbd','',keys));list.append(row);});})();

// ---- Command palette --------------------------------------------------------
if(typeof commandPaletteEntries==='function'){
  const basePalette=commandPaletteEntries;
  commandPaletteEntries=function(){
    const extra=[
      {label:t('Undo last action'),group:'Safety',shortcut:'Ctrl+Z',run:()=>undoState.available?undoLastAction():setNotice(t('Nothing to undo right after the last recorded action.'))},
      {label:t('GitHub pull requests & runs'),group:'GitHub',shortcut:'',run:()=>selectWorkspaceTab('github')},
      {label:t('Keyboard shortcuts'),group:'Help',shortcut:'?',run:()=>showAboutDialog('shortcuts')}
    ].map(item=>({...item,search:`${item.label} ${item.group}`}));
    const entries=basePalette();const firstRepo=entries.findIndex(item=>item.group==='Switch repository');
    if(firstRepo<0)return entries.concat(extra);
    return [...entries.slice(0,firstRepo),...extra,...entries.slice(firstRepo)];
  };
}
