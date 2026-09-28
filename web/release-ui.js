'use strict';
const releaseViews=GitDeckRelease.read(localStorage,'git-deck-view-details-v1',{});
let restoringReleaseView=false;
function rememberReleaseView(){
  if(!state.workspaceRepo||restoringReleaseView)return;
  const key=repoKey(state.workspaceRepo),old=releaseViews[key]||{};
  const list=document.querySelector('.commit-list');
  releaseViews[key]={...old,tab:state.workspaceTab,scroll:list?.scrollTop||0,left:list?.scrollLeft||0,commit:document.querySelector('.commit-row.selected')?.dataset.commit||old.commit||''};
  GitDeckRelease.write(localStorage,'git-deck-view-details-v1',releaseViews);
}
const originalOpenWorkspace=openWorkspace;
openWorkspace=async function(repo,tab='history',collapse=true,record=true){
  rememberReleaseView();
  const saved=releaseViews[repoKey(repo)];
  // Explicit navigation still wins; repository-tab switching restores its own view.
  if(collapse===null&&saved?.tab&&workspaceTabs.has(saved.tab))tab=saved.tab;
  await originalOpenWorkspace(repo,tab,collapse,record);
  if(!state.workspaceRepo||repoKey(repo)!==repoKey(state.workspaceRepo)||!saved)return;
  restoringReleaseView=true;
  try{
    const rows=[...document.querySelectorAll('.commit-row[data-commit]')];
    rows.find(row=>row.dataset.commit===saved.commit)?.click();
    const list=document.querySelector('.commit-list');if(list){list.scrollTop=saved.scroll||0;list.scrollLeft=saved.left||0;}
  }finally{restoringReleaseView=false;}
};
window.addEventListener('pagehide',rememberReleaseView);
let viewTimer;
document.addEventListener('scroll',event=>{if(event.target.matches?.('.commit-list')){clearTimeout(viewTimer);viewTimer=setTimeout(rememberReleaseView,180);}},true);
document.addEventListener('click',event=>{if(event.target.closest('.commit-row'))setTimeout(rememberReleaseView,0);});

function releaseDialog(title){
  const dialog=document.createElement('dialog');dialog.className='release-dialog';dialog.setAttribute('aria-label',title);
  const heading=el('h2','',title),body=el('div'),actions=el('div');actions.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:16px';
  const close=el('button','','Close');close.addEventListener('click',()=>dialog.close());actions.append(close);dialog.append(heading,body,actions);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return {dialog,body,actions};
}
async function showReadiness(){
  const ui=releaseDialog('ตรวจความพร้อม · Git Deck');ui.body.textContent='กำลังตรวจเครื่องนี้…';
  try{const info=await api('/api/readiness');ui.body.replaceChildren();
    const checks=[['Local service / port',info.serviceReady,'เชื่อมต่อพอร์ต '+info.port+' สำเร็จ'],['Git',info.gitAvailable,'ติดตั้ง Git for Windows และเปิดโปรแกรมใหม่'],['Global commit identity',info.globalIdentityReady,'ตั้ง git config --global user.name และ user.email หรือกำหนดแยกแต่ละ repo'],['GitLab CLI (optional)',info.gitlabCliAvailable,'วาง glab.exe ใน bin แล้วล็อกอินด้วยบัญชีของคุณ']];
    for(const [label,ok,hint] of checks){ui.body.append(el('p','',`${ok?'✓':'!'} ${label} — ${ok?'พร้อม':hint}`));}
    ui.body.append(el('p','','ข้อมูล repo และ cache เก็บบนเครื่องนี้เท่านั้น ไม่ส่ง telemetry ออกไป'));
    const done=el('button','primary','รับทราบ');done.onclick=()=>{try{localStorage.setItem('git-deck-onboarding-v1','done');}catch{}ui.dialog.close();};ui.actions.append(done);
  }catch(error){ui.body.textContent='ตรวจไม่ได้: '+error.message;}
}
async function showSafeReport(){
  const ui=releaseDialog('รายงานปัญหา · ไม่มีข้อมูล repository');
  try{const info=await api('/api/readiness');const text=GitDeckRelease.report(info);const preview=el('pre','',text);preview.style.whiteSpace='pre-wrap';ui.body.append(el('p','','รายงานนี้มีเฉพาะเวอร์ชันและสถานะความพร้อม ไม่รวม error ดิบ, token, URL, path หรือชื่อบัญชี ตรวจข้อความก่อนส่งเองได้เลย'),preview);
    const copy=el('button','','Copy report');copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent='Copied';}catch{copy.textContent='เลือกข้อความด้านบนเพื่อคัดลอก';}};ui.actions.append(copy);
  }catch{ui.body.textContent='Local service unavailable. ไม่มีข้อมูลส่วนตัวถูกแนบ';}
}
for(const panel of document.querySelectorAll('.help-menu-panel')){
  for(const [label,action] of [['ตรวจความพร้อม',showReadiness],['รายงานปัญหา (ปกปิดข้อมูล)',showSafeReport],['ล้าง workspace cache',()=>{workspaceSnapshots.clear();persistWorkspaceSnapshots();setNotice('ล้างข้อมูล workspace ที่จำไว้แล้ว');}]]){const button=el('button','',label);button.type='button';button.onclick=()=>{panel.closest('details')?.removeAttribute('open');action();};panel.append(button);}
}
let preflightBusy=false,approvedPush=null;
let pushReviewVersion=0;
function resetPushReview(){pushReviewVersion++;approvedPush=null;document.getElementById('push-review')?.remove();$('push-form').classList.remove('reviewing');}
function inlinePushReview(){
  document.getElementById('push-review')?.remove();
  const panel=el('section','push-review');panel.id='push-review';panel.tabIndex=-1;panel.setAttribute('aria-label','ตรวจสอบก่อน Push');
  const steps=el('p','push-review-steps','1 เลือก branch  →  2 ตรวจสอบ  →  3 ยืนยัน');
  const body=el('div','push-review-body'),actions=el('div','push-review-actions');
  const back=el('button','','กลับไปเลือก branch');back.type='button';back.onclick=()=>{resetPushReview();$('push-submit').focus();};actions.append(back);
  panel.append(steps,body,actions);$('push-message').before(panel);$('push-form').classList.add('reviewing');panel.focus();
  return {body,actions,close:resetPushReview};
}
['push-close','push-cancel'].forEach(id=>$(id)?.addEventListener('click',resetPushReview));
const originalShowPushDialog=showPushDialog;showPushDialog=function(){resetPushReview();return originalShowPushDialog();};
function pushSignature(){return JSON.stringify({path:state.workspaceRepo?.path,remote:$('push-remote').value,branches:selectedPushBranches(),tags:$('push-tags').checked,force:$('push-force').checked});}
$('push-form').addEventListener('submit',async event=>{
  const signature=pushSignature();
  if(approvedPush===signature){approvedPush=null;return;}
  event.preventDefault();event.stopImmediatePropagation();if(preflightBusy||state.busy)return;
  preflightBusy=true;
  const repo=state.workspaceRepo;const remote=$('push-remote').value;const branches=selectedPushBranches();
  const ui=inlinePushReview();const version=++pushReviewVersion;ui.body.textContent='กำลังอ่าน commits จาก local tracking refs…';
  try{
    const results=[];for(const branch of branches){results.push(await api('/api/repo/push-preview?'+new URLSearchParams({path:repo.path,remote,local:branch.local,target:branch.remote})));}
    if(version!==pushReviewVersion||signature!==pushSignature())return;
    ui.body.replaceChildren(el('p','push-review-warning','ข้อมูลจาก local tracking refs — ควร Fetch remote ที่เลือกก่อน Push หากข้อมูลอาจเก่า'));
    for(const result of results){ui.body.append(el('h3','',`${result.local} → ${result.remote}/${result.target}`),el('p','',result.knownTarget?`ส่ง ${result.ahead} commits · ตามหลัง ${result.behind} commits`:'ไม่พบ target ใน local tracking refs — ยังยืนยันไม่ได้ว่าเป็น branch ใหม่'),el('small','',`FETCH_HEAD ล่าสุด: ${result.lastFetchAt||'ไม่ทราบ'} (อาจเป็นของ remote อื่น)`));const pre=el('pre','',(result.commits||[]).join('\n'));pre.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto';ui.body.append(pre);}
    if($('push-tags').checked)ui.body.append(el('p','','รวมการ Push tags ทั้งหมด — รายการ commits ด้านบนไม่ใช่ preview ของ tags'));
    if($('push-force').checked)ui.body.append(el('p','','คำเตือน: Force with lease อาจเขียนประวัติใหม่'));
    const confirm=el('button','primary','ยืนยัน Push');confirm.type='button';confirm.disabled=(!branches.length&&!$('push-tags').checked)||(!$('push-force').checked&&results.some(r=>r.behind>0));
    if(confirm.disabled)ui.body.append(el('p','push-review-warning','ยัง Push ไม่ได้: ตรวจ branch ที่เลือกและ commits ที่ตามหลัง remote'));
    confirm.onclick=()=>{if(signature!==pushSignature()){ui.body.append(el('p','','ตัวเลือกเปลี่ยนแล้ว กรุณาย้อนกลับและตรวจใหม่'));return;}ui.close();approvedPush=signature;$('push-form').requestSubmit();};ui.actions.append(confirm);
  }catch(error){ui.body.textContent='ตรวจไม่สำเร็จ — ไม่ส่ง Push: '+error.message;}
  finally{preflightBusy=false;}
},true);
const readinessTimer=setInterval(()=>{if(state.initializing)return;clearInterval(readinessTimer);if(localStorage.getItem('git-deck-onboarding-v1')!=='done')showReadiness();},500);

// Compact workbench: preserve existing controls/listeners instead of duplicating actions.
document.body.classList.add('compact-workbench');
const toolbar=document.querySelector('.workspace-modal-head');
const secondary=document.createElement('details');secondary.className='workbench-secondary';
const secondaryLabel=el('summary','','View & tools');secondaryLabel.title='Repositories, theme, Help and application tools';secondary.append(secondaryLabel,document.querySelector('.workspace-header-actions'));
toolbar.append(document.querySelector('.sync-actions'),secondary);
document.addEventListener('mousedown',event=>{if(!secondary.contains(event.target))secondary.removeAttribute('open');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&secondary.open){secondary.removeAttribute('open');secondaryLabel.focus();}});
const branchLabel=el('span','toolbar-branch');toolbar.firstElementChild.append(branchLabel);
const footer=$('workspace-statusbar');footer.before($('console'));
$('status-activity').setAttribute('aria-label','Show operation status and output');
$('status-activity').setAttribute('aria-live','polite');
let operationLabel='Ready',operationStart=0;
const originalStatus=renderWorkspaceStatus;
renderWorkspaceStatus=function(){originalStatus();branchLabel.textContent=state.workspace?.branch||'No branch';branchLabel.title=branchLabel.textContent;$('status-job').textContent=operationLabel;$('status-activity').title=operationLabel;};
const originalLoading=showLoading,originalHideLoading=hideLoading;
showLoading=function(title,detail=''){operationStart=Date.now();operationLabel=title+(detail?' · '+detail:'');originalLoading(title,detail);renderWorkspaceStatus();};
hideLoading=function(){originalHideLoading();operationLabel=state.busy?'Working…':($('output-summary').textContent||'Ready');renderWorkspaceStatus();};
new MutationObserver(()=>{if(!document.body.hasAttribute('aria-busy')){operationLabel=$('output-summary').textContent||'Ready';renderWorkspaceStatus();}}).observe($('output-summary'),{childList:true,characterData:true,subtree:true});
new MutationObserver(()=>{const value=$('workspace-branch').textContent;if(/กำลัง|รอคิว|อ่าน status/.test(value)){operationLabel=value;renderWorkspaceStatus();}}).observe($('workspace-branch'),{childList:true});
setInterval(()=>{if(document.body.hasAttribute('aria-busy')&&operationStart){$('status-job').textContent=`${operationLabel} · ${((Date.now()-operationStart)/1000).toFixed(1)}s`;}},1000);

function enhanceChangeFiles(){
  for(const node of document.querySelectorAll('.change-file-path:not([data-labelled])')){
    const path=node.textContent;const parts=path.replaceAll('\\','/').split('/');const name=parts.pop();node.dataset.labelled='true';node.title=path;
    node.replaceChildren(el('strong','',name),el('small','',parts.join('/')||'Repository root'));
    const row=node.closest('.change-file');const status=row.querySelector('.file-status');
    const label={M:'Modified',A:'Added',D:'Deleted',R:'Renamed',U:'Conflict','?':'Untracked'}[status?.textContent.trim()]||'Changed';if(status){status.title=label;status.setAttribute('aria-label',label);}
    row.querySelector('.change-file-main')?.setAttribute('aria-label',`${label}: ${path}`);
  }
  const layout=document.querySelector('.changes-layout');if(!layout||layout.querySelector('.changes-column-resizer'))return;
  const key='git-deck-file-pane:'+repoKey(state.workspaceRepo);const handle=el('div','changes-column-resizer');handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label','Resize file list');handle.setAttribute('aria-orientation','vertical');
  let width=Number(localStorage.getItem(key))||300;
  const set=value=>{width=Math.round(Math.min(Math.max(200,value),Math.max(200,layout.clientWidth-260)));layout.style.setProperty('--files-width',width+'px');handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuemin','200');handle.setAttribute('aria-valuemax',String(Math.max(200,layout.clientWidth-260)));};
  const save=()=>{try{localStorage.setItem(key,String(width));}catch{}};
  layout.querySelector('.change-groups').after(handle);requestAnimationFrame(()=>set(width));
  handle.onpointerdown=e=>{e.preventDefault();handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))set(e.clientX-layout.getBoundingClientRect().left);};handle.onpointerup=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);save();}};
  handle.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();set(e.key==='Home'?300:width+(e.key==='ArrowLeft'?-20:20));save();}};handle.ondblclick=()=>{set(300);save();};
}
new MutationObserver(enhanceChangeFiles).observe($('workspace-content'),{childList:true,subtree:true});
const paneKey=()=>state.workspaceRepo?'git-deck-pane-layout:'+repoKey(state.workspaceRepo):'';
const restorePaneLayout=()=>{const saved=GitDeckRelease.read(localStorage,paneKey(),{});if(saved.tree)document.querySelector('.workbench-body').style.setProperty('--tree-width',saved.tree);if(saved.files)document.querySelector('.commit-detail-split')?.style.setProperty('--commit-files-width',saved.files);};
const originalDetailResizer=initializeCommitDetailResizer;initializeCommitDetailResizer=function(...args){originalDetailResizer(...args);restorePaneLayout();};
document.addEventListener('pointerup',event=>{if(!event.target.matches('#tree-resizer,.commit-detail-resizer'))return;const body=document.querySelector('.workbench-body');const split=document.querySelector('.commit-detail-split');GitDeckRelease.write(localStorage,paneKey(),{tree:body.style.getPropertyValue('--tree-width'),files:split?.style.getPropertyValue('--commit-files-width')});});
const compactOpenWorkspace=openWorkspace;openWorkspace=async function(...args){await compactOpenWorkspace(...args);restorePaneLayout();renderWorkspaceStatus();};
enhanceChangeFiles();renderWorkspaceStatus();
