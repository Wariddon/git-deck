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
    // Raw git header rows (diff --git, index, ---, +++) carry nothing the file title
    // and notes do not already show; rename/mode lines stay visible.
    for(const row of root.querySelectorAll('.diff-lines .diff-meta:not([data-clean-checked])')){
      row.dataset.cleanChecked='1';
      if(/^(diff --git |index |--- |\+\+\+ )/.test(row.querySelector('.diff-line-text')?.textContent||''))row.classList.add('clean-raw-header');
    }
    // Change/file navigation: compact arrows; the full label stays as tooltip and accessible name.
    const arrows={'Previous change':'↑','Next change':'↓','Previous file':'‹','Next file':'›'};
    for(const nav of root.querySelectorAll('.diff-navigation:not([data-clean])')){
      nav.dataset.clean='1';
      for(const button of nav.querySelectorAll(':scope > button')){const label=button.textContent.trim();if(!arrows[label])continue;button.title=label;button.setAttribute('aria-label',label);button.textContent=arrows[label];button.classList.add('clean-arrow');}
    }
  }
  let pending=false;
  const tidy=()=>{pending=false;if(!isClean())return;const root=document.getElementById('workspace-content');if(!root)return;try{groupHistoryControls(root);groupDiffTools(root);}catch(error){console.warn('Clean layout unavailable',error);}};

  // ---- Static chrome (toolbar, repository list): moved while Clean is on and
  // put back exactly where it was for Classic.
  const moved=[];
  const move=(node,target)=>{if(!node||!target||node.parentElement===target)return;moved.push({node,parent:node.parentElement,next:node.nextSibling});target.append(node);};
  const restore=()=>{while(moved.length){const {node,parent,next}=moved.pop();parent.insertBefore(node,next&&next.parentElement===parent?next:null);}document.querySelectorAll('.clean-made').forEach(node=>node.remove());};
  function menu(className,label,title){const details=el('details',`${className} clean-made`);const summary=el('summary','',label);summary.title=title;const panel=el('div','clean-menu-panel');details.append(summary,panel);return {details,panel};}
  function applyChrome(){
    // Toolbar: Branch and Tag join the top of More under "Create".
    const more=document.querySelector('.sync-more > div');
    if(more&&!more.querySelector('.clean-create-group')){
      const heading=el('p','sync-more-group clean-create-group clean-made',t('CREATE'));more.prepend(heading);
      const anchor=heading.nextSibling;
      for(const id of ['toolbar-create-branch','toolbar-create-tag']){const button=document.getElementById(id);if(!button)continue;moved.push({node:button,parent:button.parentElement,next:button.nextSibling});more.insertBefore(button,anchor);}
    }
    // Repository list: Create / Add / Scan collapse into one "Add" menu next to Clone.
    const buttons=document.querySelector('.panel-buttons');
    if(buttons&&!buttons.querySelector('.clean-add-menu')){
      const soft=[...buttons.querySelectorAll(':scope > button')].filter(button=>/^(＋ Create|＋ Add|⌕ Scan)$/.test(button.textContent.trim()));
      if(soft.length){const {details,panel}=menu('clean-add-menu',t('＋ Add ▾'),t('Create, add or scan for repositories'));soft[0].before(details);soft.forEach(button=>move(button,panel));}
    }
    syncFilterCounts();
  }
  // Summary tiles are hidden in Clean; their counts appear on the matching filter chips.
  const countSource={all:'stat-total',favorite:'stat-favorite',dirty:'stat-changed',sync:'stat-sync',missing:'stat-missing'};
  function syncFilterCounts(){
    for(const chip of document.querySelectorAll('#quick-filters button[data-filter]')){
      const source=document.getElementById(countSource[chip.dataset.filter]||'');
      if(source&&isClean())chip.dataset.count=source.textContent.trim();else delete chip.dataset.count;
    }
  }
  const overview=document.querySelector('.repo-overview');
  if(overview)new MutationObserver(syncFilterCounts).observe(overview,{childList:true,subtree:true,characterData:true});
  document.addEventListener('click',(event)=>{
    // Branch/Tag inside More: close the menu like the other More items do.
    if(event.target.closest('.sync-more #toolbar-create-branch, .sync-more #toolbar-create-tag'))event.target.closest('details')?.removeAttribute('open');
    if(event.target.closest('.clean-add-menu .clean-menu-panel button'))event.target.closest('details')?.removeAttribute('open');
  });
  const applyLook=()=>{if(isClean())applyChrome();else{restore();syncFilterCounts();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLook);else applyLook();
  document.addEventListener('gitdeck:appearance',applyLook);
  const content=document.getElementById('workspace-content');
  // setTimeout, not requestAnimationFrame: rAF is paused while the window is hidden.
  if(content)new MutationObserver(()=>{if(!pending&&isClean()){pending=true;setTimeout(tidy,0);}}).observe(content,{childList:true,subtree:true});
  // One listener for every render: close open Clean menus on outside clicks.
  document.addEventListener('click',(event)=>{document.querySelectorAll('.changes-view-options[open],.clean-diff-more[open],.clean-add-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  document.addEventListener('gitdeck:appearance',()=>{if(state.workspace)renderWorkspace();});
})();
