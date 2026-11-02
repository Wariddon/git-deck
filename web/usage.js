'use strict';
// What you actually use: counts on this computer only, nothing is sent anywhere. Workspace views, Dashboard
// views, action-bar buttons and Ctrl+K commands. Ctrl+K › "What do I actually use?" shows the counts and the
// Dashboard views never opened, so that what nobody uses can be hidden or removed later on real numbers.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const empty=(now)=>({since:now,counts:{}});
  function count(data,key,now){
    const base=data&&data.counts?data:empty(now);const item=base.counts[key]||{n:0,last:now};
    return {...base,counts:{...base.counts,[key]:{n:item.n+1,last:now}}};
  }
  // Most used first; ties by the latest use.
  const ranked=(data)=>Object.entries(data?.counts||{}).map(([key,item])=>({key,...item})).sort((a,b)=>b.n-a.n||String(b.last).localeCompare(String(a.last)));
  // Of the known names, those never counted.
  const unused=(data,keys)=>keys.filter(key=>!data?.counts?.[key]);
  const helpers={count,ranked,unused};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const storageKey='gitdeck.usage';
  const read=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch{return null;}};
  // Written at most every few seconds: counting must cost nothing.
  let data=read();let timer=null;
  const flush=()=>{timer=null;try{localStorage.setItem(storageKey,JSON.stringify(data));}catch{}};
  const hit=(key)=>{data=count(data,key,new Date().toISOString());if(!timer)timer=setTimeout(flush,3000);};
  window.addEventListener('pagehide',()=>{if(timer){clearTimeout(timer);flush();}});

  if(typeof selectWorkspaceTab==='function'){const base=selectWorkspaceTab;selectWorkspaceTab=function(tab,...rest){hit(`view:${tab}`);return base.call(this,tab,...rest);};}
  if(typeof switchOperationsView==='function'){const base=switchOperationsView;switchOperationsView=function(view,...rest){hit(`dashboard:${view}`);return base.call(this,view,...rest);};}
  document.addEventListener('click',(event)=>{
    const act=event.target.closest?.('.modern-actions button[data-act]');if(act)hit(`action:${act.dataset.act}`);
  },true);

  const dashboardViews=()=>[...document.querySelectorAll('.operations-tabs [data-operations-view]')].map(button=>({key:`dashboard:${button.dataset.operationsView}`,label:button.textContent.trim()}));
  function report(){
    if(typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('What you actually use'));const list=ranked(data);const views=dashboardViews();const labels=new Map(views.map(view=>[view.key,view.label]));
    const since=data?.since?new Date(data.since).toLocaleDateString():new Date().toLocaleDateString();
    ui.body.append(el('p','fleet-muted',t('Counted since {date}, on this computer only.',{date:since})));
    if(!list.length)ui.body.append(el('p','',t('Nothing counted yet. Use Git Deck for a while and look again.')));
    else{
      const table=el('table','multi-repo-table');const head=el('tr');for(const label of [t('What'),t('Times'),t('Last used')])head.append(el('th','',label));table.append(head);
      for(const item of list.slice(0,40)){const row=el('tr');row.append(el('td','',labels.get(item.key)||item.key.replace(/^[a-z]+:/,'')),el('td','',String(item.n)),el('td','',new Date(item.last).toLocaleDateString()));table.append(row);}
      ui.body.append(table);
    }
    const never=unused(data,views.map(view=>view.key));
    if(never.length)ui.body.append(el('h4','',t('Dashboard views never opened: {count} of {total}',{count:never.length,total:views.length})),el('p','fleet-muted',never.map(key=>labels.get(key)).join(' · ')));
  }
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;
    // This script loads last, so it sees every command, whichever way it is started (click or Enter).
    commandPaletteEntries=function(...args){
      const label=t('What do I actually use?'),group=t('Tools');
      return [...base.apply(this,args),{label,group,shortcut:'',run:report,search:`${label} ${group} usage statistics`}].map(entry=>({...entry,run:(...rest)=>{hit(`command:${entry.fallback?t('Ask AI'):entry.label}`);return entry.run(...rest);}}));
    };
  }
  window.GitDeckUsage={...helpers,report};
})();
