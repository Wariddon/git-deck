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
  // A newer Git Deck on GitHub (only when the Git Deck folder is a git clone): offer to pull it.
  const laterKey='gitdeck.selfUpdateLater';
  function offer(update){
    if(shown)return;shown='available';
    document.getElementById('update-banner')?.remove();
    const bar=el('div','update-banner');bar.id='update-banner';bar.setAttribute('role','status');
    const text=t('A new version of Git Deck is available ({count} update(s)).',{count:update.behind})+(update.latest?' '+t('Latest: {subject}',{subject:update.latest}):'');
    bar.append(el('span','update-banner-icon','⬇'),el('span','',update.dirty?text+' '+t('Files in the Git Deck folder were changed on this computer, so update it with git pull yourself.'):text));
    if(!update.dirty){
      const go=el('button','primary',t('Update now'));go.type='button';
      go.onclick=async()=>{
        if(!confirm(t('Download the new Git Deck version now (git pull in the Git Deck folder)? Your repositories are not touched.')))return;
        go.disabled=true;
        try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'self-update'})});shown='';banner('server');}
        catch(error){go.disabled=false;if(typeof showActionFeedback==='function')showActionFeedback(error.message,{error:true});}
      };
      bar.append(go);
    }
    const later=el('button','',t('Later'));later.type='button';
    later.onclick=()=>{bar.remove();shown='';try{localStorage.setItem(laterKey,String(Date.now()+24*3600*1000));}catch{}};
    bar.append(later);document.body.append(bar);
  }
  async function checkSelf(){
    let until=0;try{until=Number(localStorage.getItem(laterKey))||0;}catch{}
    if(Date.now()<until)return;
    try{const update=(await api('/api/self-update')).update;if(update?.git&&update.behind>0)offer(update);}catch{}
  }
  if(typeof document!=='undefined'){
    setTimeout(check,1500);setInterval(check,60000);
    window.addEventListener('focus',check);
    setTimeout(checkSelf,8000);setInterval(checkSelf,6*3600*1000);
  }
  window.GitDeckUpdateCheck={decide,check,checkSelf};
})();
