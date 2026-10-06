'use strict';
// Git Deck updated while it is open: say so instead of silently showing the old screen.
// - Web files changed (git pull, a new build): "Git Deck was updated" with Reload now.
// - Server files changed: the page reload is not enough, so it says to close and reopen Git Deck.
// Checks /api/version once a minute and when the window comes back into focus.
(function(){
  if(typeof api!=='function'||typeof el!=='function')return;
  let first=null;let shown='';
  function decide(start,now){
    if(!start||!now)return '';
    if(now.serverStale)return 'server';
    if(String(now.web)!==String(start.web))return 'web';
    return '';
  }
  function banner(kind){
    if(kind===shown)return;shown=kind;
    document.getElementById('update-banner')?.remove();if(!kind)return;
    const bar=el('div','update-banner');bar.id='update-banner';bar.setAttribute('role','status');
    bar.append(el('span','update-banner-icon','🔄'),el('span','',kind==='server'
      ?t('Git Deck was updated. Close Git Deck and open it again to use the new version (reloading the page is not enough).')
      :t('Git Deck was updated. Reload to see the new version.')));
    if(kind==='web'){const reload=el('button','primary',t('Reload now'));reload.type='button';reload.onclick=()=>location.reload();bar.append(reload);}
    const later=el('button','',t('Later'));later.type='button';later.onclick=()=>bar.remove();bar.append(later);
    document.body.append(bar);
  }
  async function check(){
    try{const now=await api('/api/version');if(!first){first=now;if(now.serverStale)banner('server');return;}banner(decide(first,now));}catch{}
  }
  if(typeof document!=='undefined'){
    setTimeout(check,1500);setInterval(check,60000);
    window.addEventListener('focus',check);
  }
  window.GitDeckUpdateCheck={decide,check};
})();
