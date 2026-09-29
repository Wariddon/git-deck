'use strict';
// Clean look, structural part (styles are in web/clean.css). Only acts while
// html.ui-clean is set; switching looks re-renders so Classic stays untouched.
// - File Status: sort and list/tree selects move into one "View" menu.
// - Commit box: the Ctrl+Enter hint moves into the message placeholder.
(function(){
  if(typeof renderChangesView!=='function')return;
  const isClean=()=>document.documentElement.classList.contains('ui-clean');
  function groupViewOptions(content){
    const bar=content.querySelector('.changes-commandbar');if(!bar||bar.querySelector('.changes-view-options'))return;
    const selects=[...bar.querySelectorAll(':scope > select')];if(selects.length<3)return;
    const [sort,view]=selects;
    const menu=el('details','changes-view-options');const summary=el('summary','',t('View'));summary.title=t('Sort order and list or folder view');
    const panel=el('div','changes-view-panel');menu.append(summary,panel);
    sort.before(menu);
    for(const [label,select] of [[t('Sort'),sort],[t('Layout'),view]]){const row=el('label','');row.append(el('span','',label),select);panel.append(row);}
  }
  function moveShortcutHint(content){
    const message=content.querySelector('.commit-composer textarea');if(!message||!content.querySelector('.commit-shortcut'))return;
    const base=message.getAttribute('placeholder')||t('Commit message');
    if(!base.includes('Ctrl'))message.setAttribute('placeholder',t('{message} · Ctrl+Enter to commit',{message:base}));
  }
  const baseChanges=renderChangesView;
  renderChangesView=function(content,data){
    const result=baseChanges(content,data);
    if(isClean()){try{groupViewOptions(content);moveShortcutHint(content);}catch(error){console.warn('Clean layout unavailable',error);}}
    return result;
  };
  // History: keep branch scope and search in the bar; order, layout and remote
  // toggle join the existing "View ▾" menu.
  function groupHistoryControls(root){
    for(const controls of root.querySelectorAll('.history-controls:not([data-clean])')){
      const body=controls.querySelector('.history-options-body');if(!body)continue;
      controls.dataset.clean='1';
      const selects=[...controls.querySelectorAll(':scope > select')];
      const remote=controls.querySelector(':scope > .history-remote-toggle');
      const block=el('div','clean-history-options');
      if(selects[1]){const row=el('label','');row.append(el('span','',t('Order')),selects[1]);block.append(row);}
      if(selects[2]){const row=el('label','');row.append(el('span','',t('Layout')),selects[2]);block.append(row);}
      if(remote)block.append(remote);
      body.prepend(block);
    }
  }
  // Diff viewers: rarely used tools move into a "⋯" menu.
  const diffExtras=['Previous match','Next match','A−','A+','Copy','Focus diff','File info'];
  function groupDiffTools(root){
    for(const toolbar of root.querySelectorAll('.diff-viewer-toolbar:not([data-clean])')){
      const buttons=[...toolbar.querySelectorAll(':scope > button')].filter(button=>diffExtras.includes(button.textContent.trim()));
      toolbar.dataset.clean='1';if(!buttons.length)continue;
      const menu=el('details','clean-diff-more');const summary=el('summary','','⋯');summary.title=t('More diff tools');summary.setAttribute('aria-label',t('More diff tools'));
      const panel=el('div','clean-diff-more-panel');panel.append(...buttons);menu.append(summary,panel);toolbar.append(menu);
    }
  }
  let pending=false;
  const tidy=()=>{pending=false;if(!isClean())return;const root=document.getElementById('workspace-content');if(!root)return;try{groupHistoryControls(root);groupDiffTools(root);}catch(error){console.warn('Clean layout unavailable',error);}};
  const content=document.getElementById('workspace-content');
  // setTimeout, not requestAnimationFrame: rAF is paused while the window is hidden.
  if(content)new MutationObserver(()=>{if(!pending&&isClean()){pending=true;setTimeout(tidy,0);}}).observe(content,{childList:true,subtree:true});
  // One listener for every render: close open Clean menus on outside clicks.
  document.addEventListener('click',(event)=>{document.querySelectorAll('.changes-view-options[open],.clean-diff-more[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  document.addEventListener('gitdeck:appearance',()=>{if(state.workspace)renderWorkspace();});
})();
