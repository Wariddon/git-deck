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
function pushSignature(){return JSON.stringify({path:state.workspaceRepo?.path,remote:$('push-remote').value,branches:selectedPushBranches(),tags:$('push-tags').checked,force:$('push-force').checked});}
$('push-form').addEventListener('submit',async event=>{
  const signature=pushSignature();
  if(approvedPush===signature){approvedPush=null;return;}
  event.preventDefault();event.stopImmediatePropagation();if(preflightBusy||state.busy)return;
  preflightBusy=true;
  const repo=state.workspaceRepo;const remote=$('push-remote').value;const branches=selectedPushBranches();
  const ui=releaseDialog('ตรวจสอบก่อน Push');ui.body.textContent='กำลังอ่าน commits จาก local tracking refs…';
  try{
    const results=[];for(const branch of branches){results.push(await api('/api/repo/push-preview?'+new URLSearchParams({path:repo.path,remote,local:branch.local,target:branch.remote})));}
    ui.body.replaceChildren(el('p','','ข้อมูลนี้อ้างอิง local tracking refs ไม่ใช่การตรวจ remote ล่าสุด ควร Fetch remote ที่เลือกก่อน Push โดยเฉพาะเมื่อมีคนอื่นแก้ branch'));
    for(const result of results){ui.body.append(el('h3','',`${result.local} → ${result.remote}/${result.target}`),el('p','',result.knownTarget?`ส่ง ${result.ahead} commits · ตามหลัง ${result.behind} commits`:'ไม่พบ target ใน local tracking refs — ยังยืนยันไม่ได้ว่าเป็น branch ใหม่'),el('small','',`FETCH_HEAD ล่าสุด: ${result.lastFetchAt||'ไม่ทราบ'} (อาจเป็นของ remote อื่น)`));const pre=el('pre','',(result.commits||[]).join('\n'));pre.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto';ui.body.append(pre);}
    if($('push-tags').checked)ui.body.append(el('p','','รวมการ Push tags ทั้งหมด — รายการ commits ด้านบนไม่ใช่ preview ของ tags'));
    if($('push-force').checked)ui.body.append(el('p','','คำเตือน: Force with lease อาจเขียนประวัติใหม่'));
    const confirm=el('button','primary','ยืนยัน Push');confirm.disabled=(!branches.length&&!$('push-tags').checked)||(!$('push-force').checked&&results.some(r=>r.behind>0));
    confirm.onclick=()=>{if(signature!==pushSignature()){ui.body.append(el('p','','ตัวเลือกเปลี่ยนแล้ว กรุณาปิดและตรวจใหม่'));return;}approvedPush=signature;ui.dialog.close();$('push-form').requestSubmit();};ui.actions.append(confirm);
  }catch(error){ui.body.textContent='ตรวจไม่สำเร็จ — ไม่ส่ง Push: '+error.message;}
  finally{preflightBusy=false;}
},true);
const readinessTimer=setInterval(()=>{if(state.initializing)return;clearInterval(readinessTimer);if(localStorage.getItem('git-deck-onboarding-v1')!=='done')showReadiness();},500);
