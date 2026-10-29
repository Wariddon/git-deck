'use strict';
// Today's cube: the day's open work as a scrambled cube face. Every Inbox item seen today (to commit,
// to push, to pull, conflicts, branches only here…) is a scrambled sticker; when it is done, or marked
// done in the Inbox, its sticker turns green. Solve them all and the face is green: a short celebration.
// A 3x3 face sits in the status bar; click it for the full face and what is left. It also keeps the
// Pending snapshot fresh: a repository Git Deck sees change is checked again on its own.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Today's record: keys seen today; a new day starts from what is open now.
  function track(record,openKeys,today){
    if(!record||record.day!==today)return {day:today,seen:[...new Set(openKeys)],celebrated:false};
    const seen=new Set(record.seen||[]);for(const key of openKeys)seen.add(key);
    return {...record,seen:[...seen]};
  }
  function progress(record,openKeys){
    const open=new Set(openKeys);const total=(record?.seen||[]).length;
    const solved=(record?.seen||[]).filter(key=>!open.has(key)).length;
    return {total,solved,done:total>0&&solved===total};
  }
  // Nine sticker colours: solved share in green, the rest scrambled (fixed order, so it does not flicker).
  const scramble=['#e5534b','#2f81f7','#d29922','#eef1f4','#f2cc60','#e5534b','#2f81f7','#d29922','#eef1f4'];
  function stickers(total,solved){
    const green=total?Math.round(9*solved/total):9;
    const order=[4,0,2,6,8,1,3,5,7];const out=scramble.slice();
    for(let i=0;i<green;i++)out[order[i]]='#3fb950';
    return out;
  }
  const helpers={track,progress,stickers};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof el!=='function'||typeof api!=='function')return;

  const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const dayOf=(date)=>{const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const openItems=()=>{
    const inbox=window.GitDeckInboxHelpers;const snap=readJson('gitdeck.pendingSnapshot',null);if(!inbox||!snap)return null;
    const items=(snap.items||[]).filter(item=>!/\.worktrees[\\/]/i.test(item.path)).flatMap(item=>inbox.itemsFor({path:item.path,name:String(item.path).split(/[\\/]/).pop()},item.pending,{}));
    return inbox.sortItems(inbox.visibleItems(items,readJson('gitdeck.inboxState',{})));
  };
  const mini=el('button','day-cube-mini');mini.type='button';
  const bar=document.getElementById('workspace-statusbar');(bar?.querySelector('.gd-status-live'))?.before(mini);if(!mini.isConnected)bar?.append(mini);
  let last={total:0,solved:0,done:false},items=[];
  function update(){
    const open=openItems();if(!open){mini.hidden=true;return;}
    items=open;const keys=open.map(item=>item.key);const today=dayOf(Date.now());
    const record=track(readJson('gitdeck.dayCube',null),keys,today);
    last=progress(record,keys);
    if(last.done&&!record.celebrated){record.celebrated=true;celebrate();}
    writeJson('gitdeck.dayCube',record);
    mini.hidden=false;mini.replaceChildren(...stickers(last.total,last.solved).map(color=>{const i=el('i');i.style.background=color;return i;}));
    const label=last.total?t('Today\'s cube: {solved} of {total} done',{solved:last.solved,total:last.total}):t('Today\'s cube: nothing open');
    mini.title=label;mini.setAttribute('aria-label',label);
  }
  function celebrate(){
    if(typeof showActionFeedback==='function')showActionFeedback(t('Today\'s cube is solved 🎉'));
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const burst=el('div','gd-confetti');burst.setAttribute('aria-hidden','true');
    for(let i=0;i<48;i++){const bit=el('i');bit.style.setProperty('--x',`${Math.round(Math.random()*100)}vw`);bit.style.setProperty('--d',`${(Math.random()*0.6).toFixed(2)}s`);bit.style.setProperty('--r',`${Math.round(Math.random()*720-360)}deg`);bit.className=`c${i%5}`;burst.append(bit);}
    document.body.append(burst);setTimeout(()=>burst.remove(),3200);
  }
  mini.onclick=()=>{
    if(typeof releaseDialog!=='function')return;
    update();const ui=releaseDialog(t('Today\'s cube'));
    const box=el('div','day-cube-dialog');const face=el('div','day-cube-face');
    for(const color of stickers(last.total,last.solved)){const i=el('i');i.style.background=color;face.append(i);}
    box.append(face,el('strong','',last.total?t('{solved} of {total} done today',{solved:last.solved,total:last.total}):t('Nothing open today. Nice.')));
    if(items.length){const list=el('ul');for(const item of items.slice(0,12))list.append(el('li','',`${item.repo.name} · ${item.title}`));if(items.length>12)list.append(el('li','fleet-muted',t('and {count} more',{count:items.length-12})));box.append(el('small','fleet-muted',t('Still scrambled:')),list);}
    else box.append(el('small','fleet-muted',t('Run a Pending check to scramble today\'s cube with your open work.')));
    ui.body.append(box);
  };
  // Keep the snapshot fresh: re-check a repository when Git Deck sees it change.
  window.addEventListener('gitdeck:repo-changed',async(event)=>{
    const path=String(event.detail?.path||'');const snap=readJson('gitdeck.pendingSnapshot',null);if(!path||!snap)return;
    const key=path.toLowerCase();if(!(snap.items||[]).some(item=>String(item.path).toLowerCase()===key))return;
    try{const pending=(await api('/api/repo/pending?path='+encodeURIComponent(path))).pending;const now=readJson('gitdeck.pendingSnapshot',snap);now.items=(now.items||[]).map(item=>String(item.path).toLowerCase()===key?{path:item.path,pending}:item);writeJson('gitdeck.pendingSnapshot',now);update();}catch{}
  });
  window.addEventListener('storage',(event)=>{if(event.key==='gitdeck.pendingSnapshot'||event.key==='gitdeck.inboxState')update();});
  setInterval(()=>{if(!document.hidden)update();},5000);update();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  window.GitDeckDayCube={...helpers,update};
})();
