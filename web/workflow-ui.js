'use strict';
// Local workflow helpers. Reports contain numeric measurements, never repository data.
const workflowTimings=[];
function recordWorkflowTiming(kind,ms,gitMs){
  if(!['workspace','status','checkout','history','render'].includes(kind)||!Number.isFinite(ms))return;
  workflowTimings.push({kind,ms:Math.round(Math.max(0,ms)),...(Number.isFinite(gitMs)?{gitMs:Math.round(Math.max(0,gitMs))}:{})});
  if(workflowTimings.length>40)workflowTimings.shift();
}
const workflowBaseApi=api;
api=async function(path,options={}){
  const kind=path.startsWith('/api/repo/status-snapshot?')?'status':path.startsWith('/api/repo/checkout-review?')?'checkout':path.startsWith('/api/repo/workspace?')?'workspace':path.startsWith('/api/repo/history?')?'history':'';
  const start=performance.now();let result;
  try{result=await workflowBaseApi(path,options);return result;}
  finally{if(kind)recordWorkflowTiming(kind,performance.now()-start,result?.gitMs??result?.status?.gitMs);}
};
const workflowBaseRender=renderWorkspace;
renderWorkspace=function(...args){const start=performance.now();try{return workflowBaseRender(...args);}finally{recordWorkflowTiming('render',performance.now()-start);}};
function workflowButton(label,run){const button=el('button','',label);button.type='button';button.onclick=run;return button;}
function workflowCurrent(repo){return state.workspaceRepo?.path===repo.path;}
function workflowList(items){const list=el('ul','workflow-list');for(const item of items)list.append(el('li','',item));return list;}
function workflowReport(){return JSON.stringify({app:'Git Deck',measurements:workflowTimings.map(x=>({kind:x.kind,ms:x.ms,...(Number.isFinite(x.gitMs)?{gitMs:x.gitMs}:{})}))},null,2);}
function showWorkflowPerformance(){
  const ui=releaseDialog('ความเร็ว · Local measurements');
  ui.body.append(el('p','','Request = เวลาเดินทาง + รอ server + ประมวลผล; Git = งานอ่าน Git ของ status; ส่วนต่างเป็น overhead รวม ไม่ใช่เวลาคิวล้วน ๆ; Render วัดเฉพาะการสร้าง DOM แบบ synchronous'));
  const report=workflowReport();ui.body.append(el('pre','workflow-report',report));
  ui.actions.append(workflowButton('Copy safe report',async()=>{await navigator.clipboard.writeText(report);setNotice('Copied numeric report — no paths, URLs or commit data');}),workflowButton('Clear measurements',()=>{workflowTimings.length=0;ui.dialog.close();}));
}

let statusCheckRunning=false,lastStatusCheck=0,statusUnsupported=false;
function workflowFileStamp(files=[]){return JSON.stringify(files.map(f=>[f.path,f.status,Boolean(f.staged),Boolean(f.unstaged)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
const workflowHeads=new Map();
const workflowBasePaint=paintWorkspace;
paintWorkspace=function(data){const head=(data.history||[]).find(c=>/(^|,\s*)HEAD(?: ->|,|$)/.test(c.decorations||''));if(state.workspaceRepo&&head)workflowHeads.set(repoKey(state.workspaceRepo),head.fullHash);return workflowBasePaint(data);};
if(state.workspace&&state.workspaceRepo){const head=(state.workspace.history||[]).find(c=>/(^|,\s*)HEAD(?: ->|,|$)/.test(c.decorations||''));if(head)workflowHeads.set(repoKey(state.workspaceRepo),head.fullHash);}
function workflowStatusNotice(text,retry){
  document.getElementById('workflow-status-note')?.remove();const note=el('div','history-context');note.id='workflow-status-note';note.setAttribute('role','status');note.append(el('span','',text));if(retry)note.append(workflowButton('ตรวจใหม่',retry));$('workspace-content').prepend(note);
}
async function checkActiveWorkingFiles(manual=false){
  const repo=state.workspaceRepo;if(!repo||!state.workspace||state.busy||state.activeJob||statusCheckRunning||workspaceReadInFlight||document.hidden||document.querySelector('dialog[open]')||(!manual&&(statusUnsupported||Date.now()-lastStatusCheck<2000)))return;
  statusCheckRunning=true;lastStatusCheck=Date.now();const version=workspaceLoadVersion;
  try{
    const result=await api('/api/repo/status-snapshot?'+new URLSearchParams({path:repo.path}));
    if(!workflowCurrent(repo)||state.busy||version!==workspaceLoadVersion)return;
    statusUnsupported=false;
    const oldHead=workflowHeads.get(repoKey(repo));workflowHeads.set(repoKey(repo),result.head);
    if(result.branch!==state.workspace.branch||(oldHead!==undefined&&oldHead!==result.head)){
      workflowStatusNotice('Branch/HEAD เปลี่ยนจากโปรแกรมอื่น — History เดิมยังอยู่ กดตรวจใหม่เพื่อโหลดข้อมูลล่าสุด',()=>loadWorkspace());return;
    }
    const changed=workflowFileStamp(state.workspace.files)!==workflowFileStamp(result.files)||JSON.stringify(state.workspace.operation)!==JSON.stringify(result.operation);
    state.workspace.files=result.files;state.workspace.protectedUntracked=result.protectedUntracked;state.workspace.operation=result.operation;
    // Do not stamp a whole workspace snapshot fresh: only status was checked.
    renderWorkspaceStatus();
    if(changed){
      const editing=document.activeElement?.matches('input,textarea,select,[contenteditable=true]');
      if(state.workspaceTab==='changes'&&!editing)renderWorkspace();
      workflowStatusNotice(`ตรวจไฟล์ล่าสุด ${new Date().toLocaleTimeString()} · ${result.files.length} changed · ไม่โหลด History ใหม่`,()=>{if(state.workspaceTab==='changes')renderWorkspace();else selectWorkspaceTab('changes');});
    }
  }catch(error){
    if(workflowCurrent(repo)){statusUnsupported=/404|not found/i.test(error.message);workflowStatusNotice('ตรวจไฟล์ไม่สำเร็จ ข้อมูลเดิมยังอยู่ · หาก server รุ่นเก่าให้ปิดแล้วเปิด Git Deck ใหม่',()=>checkActiveWorkingFiles(true));}
  }finally{statusCheckRunning=false;}
}
window.addEventListener('focus',()=>checkActiveWorkingFiles());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkActiveWorkingFiles();});

let checkoutReviewBusy=false;
async function confirmCheckoutReview(repo,target){
  const ui=releaseDialog('ตรวจสอบก่อน Checkout');ui.body.textContent='กำลังตรวจ branch และงานค้างจาก Git…';
  return new Promise(resolve=>{
    let approved=false;ui.dialog.addEventListener('close',()=>resolve(approved),{once:true});
    (async()=>{try{
      const result=await api('/api/repo/checkout-review?'+new URLSearchParams({path:repo.path,target}));
      if(!ui.dialog.isConnected)return;
      if(!workflowCurrent(repo)){ui.body.textContent='Repository เปลี่ยนแล้ว กรุณาเปิดคำสั่งใหม่';return;}
      ui.body.replaceChildren(el('h3','',`${result.status.branch||'Detached HEAD'} → ${target}`),el('p','',`${result.currentOnly} commits เฉพาะต้นทาง · ${result.targetOnly} เฉพาะปลายทาง · ${result.changedFiles.length} files ต่างกัน`));
      ui.body.append(el('h4','','ไฟล์ต่างกันระหว่าง commits'),workflowList(result.changedFiles.slice(0,100)));
      if(result.changedFiles.length>100)ui.body.append(el('p','','แสดง 100 ไฟล์แรก'));
      if(result.blocked){
        ui.body.append(el('p','workflow-warning','ยัง Checkout ไม่ได้: มีไฟล์ค้างหรือ Git operation ที่ต้องจัดการก่อน'),workflowList(result.status.files.map(f=>f.status+' '+f.path)));
        ui.actions.append(workflowButton('กลับไปจัดการไฟล์',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('changes');}),workflowButton('เปิด Stashes / เก็บงานเอง',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('stashes');}));
      }else ui.actions.append(workflowButton('ยืนยัน Checkout',()=>{if(!workflowCurrent(repo)||state.busy)return;approved=true;ui.dialog.close();}));
      ui.body.append(el('small','','ไม่ Stash อัตโนมัติ · backend จะตรวจงานค้างอีกครั้งก่อนเปลี่ยน branch'));
    }catch(error){if(ui.dialog.isConnected)ui.body.textContent='ตรวจไม่ได้ จึงยังไม่ Checkout: '+error.message;}})();
  });
}
const workflowBaseAction=runWorkspaceAction;
runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
  if(['branch-switch','branch-track','checkout-commit'].includes(action)){
    const repo=state.workspaceRepo;if(!repo||state.busy||checkoutReviewBusy)return null;
    checkoutReviewBusy=true;try{if(!await confirmCheckoutReview(repo,payload.branch||payload.commit)||!workflowCurrent(repo))return null;}finally{checkoutReviewBusy=false;}
    return workflowBaseAction(action,payload,'',options);
  }
  return workflowBaseAction(action,payload,confirmation,options);
};

async function showSendReview(){
  const repo=state.workspaceRepo;if(!repo){setNotice('เลือก repository ก่อน');return;}
  const ui=releaseDialog('ก่อนส่งงาน · '+repo.name);ui.body.textContent='กำลังอ่านสถานะล่าสุดในเครื่อง…';
  try{
    const response=await api('/api/repo/workspace?'+new URLSearchParams({path:repo.path,extras:'false'}));const data=response.workspace;
    if(!ui.dialog.isConnected)return;if(!workflowCurrent(repo)){ui.body.textContent='Repository เปลี่ยนแล้ว กรุณาเปิดใหม่';return;}
    ui.body.replaceChildren(el('h3','',`Current: ${data.branch||'Detached HEAD'}`),el('p','',`${data.files.length} ไฟล์ค้าง · ${data.operation?.active?'มี '+data.operation.type+' ค้าง':'ไม่มี Git operation ค้าง'}`));
    ui.body.append(workflowList(data.files.map(f=>f.status+' '+f.path)));
    const remotes=el('select');remotes.setAttribute('aria-label','Review push remote');for(const r of data.remotes||[])remotes.append(new Option(r.name,r.name));
    const upstream=(data.sync?.upstream||'').split('/');if(upstream.length>1)remotes.value=upstream[0];if(!remotes.value&&remotes.options.length)remotes.selectedIndex=0;
    const target=el('input');target.setAttribute('aria-label','Review destination branch');target.value=upstream.length>1?upstream.slice(1).join('/'):data.branch;
    const preview=el('div');let reviewVersion=0;const inspect=async()=>{
      const version=++reviewVersion;preview.textContent='กำลังตรวจปลายทางจาก local refs…';
      try{const result=await api('/api/repo/push-preview?'+new URLSearchParams({path:repo.path,remote:remotes.value,local:data.branch,target:target.value.trim()}));if(!ui.dialog.isConnected||version!==reviewVersion)return;preview.replaceChildren(el('p','',`${data.branch} → ${result.remote}/${result.target} · ↑${result.ahead??'?'} ↓${result.behind??'?'} · ข้อมูล local refs ไม่ยืนยัน remote ล่าสุด`),workflowList(result.commits||[]));}
      catch(error){if(ui.dialog.isConnected&&version===reviewVersion)preview.textContent=error.message;}
    };
    remotes.className='workflow-input';target.className='workflow-input';
    const invalidate=()=>{reviewVersion++;preview.textContent='ปลายทางเปลี่ยนแล้ว — กดตรวจ commits อีกครั้ง';};remotes.onchange=invalidate;target.oninput=invalidate;
    ui.body.append(remotes,target,workflowButton('ตรวจ commits ที่จะส่ง',inspect),preview);
    if(remotes.options.length&&data.branch)void inspect();else preview.textContent='ยังไม่มี remote หรืออยู่ Detached HEAD — ตั้งค่าก่อน Push';
    const mr=el('div');mr.textContent='MR: ยังไม่ได้ตรวจออนไลน์';ui.body.append(mr);
    ui.actions.append(workflowButton('ตรวจสถานะ MR บน GitLab',async()=>{mr.textContent='กำลังอ่าน GitLab…';try{const result=await api('/api/gitlab/inbox?'+new URLSearchParams({path:repo.path}));if(ui.dialog.isConnected)mr.replaceChildren(el('p','','Open MR ของ branch นี้'),workflowList((result.inbox.mergeRequests||[]).filter(x=>x.source_branch===data.branch).map(x=>`!${x.iid} ${x.title} · ${x.detailed_merge_status||x.state||'open'}`)));}catch(error){mr.textContent='ตรวจ MR ไม่ได้: '+error.message;}}));
    ui.actions.append(workflowButton('เปิด Push เพื่อตรวจและยืนยัน',async()=>{if(!workflowCurrent(repo)||state.busy)return;await loadWorkspace();if(!workflowCurrent(repo))return;ui.dialog.close();showPushDialog();}),workflowButton('เปิด File Status',()=>{ui.dialog.close();if(workflowCurrent(repo))selectWorkspaceTab('changes');}));
    ui.body.append(el('small','','หน้าตรวจนี้ไม่ Push และไม่สร้าง MR อัตโนมัติ · หน้าต่าง Push จะให้เลือกปลายทางและยืนยันอีกครั้ง'));
  }catch(error){if(ui.dialog.isConnected)ui.body.textContent='ตรวจไม่ได้: '+error.message;}
}

function workflowBlockers(data,busy=false){
  const reasons=[];if(busy)reasons.push('มีคำสั่งกำลังทำงาน — รอให้จบก่อนเริ่มคำสั่งเขียนใหม่');
  if(!data)return [...reasons,'ยังไม่ได้โหลด repository — เลือก repo และลองโหลดใหม่'];
  if(!data.branch)reasons.push('Detached HEAD — สร้างหรือ Checkout branch ก่อน Push');
  if(!data.remotes?.length)reasons.push('ไม่มี remote — ไป Remotes เพื่อตั้งค่าปลายทาง Push');
  if(data.files?.length)reasons.push('มีไฟล์ค้าง — Commit หรือ Stash ก่อน Checkout / Merge (การ Push commits เดิมไม่จำเป็นต้องล้างไฟล์ค้าง)');
  if(data.operation?.active)reasons.push('มี '+data.operation.type+' ค้าง — ไป Conflict Center เพื่อแก้ Continue หรือ Abort');
  if(data.sync?.behind>0)reasons.push('Local tracking แสดงว่าตามหลัง — Fetch แล้ว Compare/Pull ก่อน Push; อย่า Force โดยไม่ตรวจ');
  return reasons;
}
async function showActionReasons(){
  const repo=state.workspaceRepo,ui=releaseDialog('ทำไมทำไม่ได้? · Push / Checkout / Merge');ui.body.textContent='กำลังตรวจ…';
  try{const data=repo?(await api('/api/repo/workspace?'+new URLSearchParams({path:repo.path,extras:'false'}))).workspace:null;if(!ui.dialog.isConnected)return;const reasons=workflowBlockers(data,state.busy);ui.body.replaceChildren(workflowList(reasons.length?reasons:['ไม่พบ blocker พื้นฐานในเครื่อง ปุ่มอาจต้องเลือก branch/ไฟล์ก่อน หรือถูกจำกัดด้วยสิทธิ์บน remote — ดูข้อความใน Output']));for(const [label,tab]of [['จัดการไฟล์','changes'],['ตั้งค่า remote','remotes'],['แก้ Conflict','conflicts'],['Compare','compare']])ui.actions.append(workflowButton(label,()=>{ui.dialog.close();if(repo&&workflowCurrent(repo))selectWorkspaceTab(tab);}));}
  catch(error){ui.body.textContent='ตรวจสถานะไม่ได้: '+error.message;}
}

function readWorksets(){const value=GitDeckRelease.read(localStorage,'git-deck-worksets-v1',[]);return Array.isArray(value)?value.filter(x=>typeof x.name==='string'&&Array.isArray(x.paths)).slice(0,30):[];}
function showWorksets(){
  const ui=releaseDialog('ชุด repository ตามงาน');const draw=()=>{ui.body.replaceChildren(el('p','','เปิดเป็นแท็บโดยคงแท็บเดิมไว้ ไม่ปิด draft และไม่ Checkout branch'));const sets=readWorksets();
    sets.forEach((set,index)=>{const row=el('div','workflow-workset');row.append(el('strong','',set.name),el('small','',set.paths.length+' repos'),workflowButton('เปิดชุดนี้',()=>{
      const repos=set.paths.map(path=>state.repos.find(r=>repoKey(r)===path));const valid=repos.filter(r=>r&&r.valid!==false);const missing=repos.length-valid.length;
      state.meta.openRepos=[...new Set([...state.meta.openRepos,...valid.map(repoKey)])];saveMeta();renderRepoTabs();if(valid.length)openWorkspace(valid[0],state.workspaceTab||'history',null);if(missing)setNotice(`${missing} repo ไม่พบหรือใช้งานไม่ได้ — ข้ามโดยไม่สร้างหรือ Clone ใหม่`);ui.dialog.close();
    }),workflowButton('ลบชุด',()=>{if(!confirm('ลบเฉพาะชุด '+set.name+'? ไฟล์ repo ไม่ถูกลบ'))return;sets.splice(index,1);GitDeckRelease.write(localStorage,'git-deck-worksets-v1',sets);draw();}));ui.body.append(row);});
  };draw();ui.actions.append(workflowButton('บันทึกแท็บที่เปิดเป็นชุด',()=>{const name=prompt('ชื่อชุดงาน (ไม่เกิน 60 ตัวอักษร)');if(!name?.trim())return;const sets=readWorksets();if(sets.length>=30){setNotice('เก็บได้สูงสุด 30 ชุด');return;}const paths=[...new Set(state.meta.openRepos)].slice(0,50);if(!paths.length){setNotice('เปิด repo อย่างน้อยหนึ่งแท็บก่อน');return;}sets.push({name:name.trim().slice(0,60),paths});GitDeckRelease.write(localStorage,'git-deck-worksets-v1',sets);draw();}));
}

function showTraining(){
  const ui=releaseDialog('สนามฝึก Git · แยกจากโปรเจกต์จริง');ui.body.append(el('p','','สร้าง repo ใหม่ใต้โฟลเดอร์ Git Deck/sandboxes ทุกครั้ง ไม่มี remote ไม่คัดลอกข้อมูลจากงานจริง และไม่ลบ repo เก่า'));
  ui.body.append(workflowList(['Commit: Stage notes.txt แล้วเขียนข้อความ Commit','Branch: เปิด Branches สร้าง branch ทดลอง แล้ว Checkout กลับ main','Merge: บน main เลือก Merge lesson/conflict เพื่อฝึก conflict','Conflict: เปิด Conflict Center เลือกแก้ไฟล์และ Continue หรือ Abort','Push / MR ไม่อยู่ในบทฝึก เพราะไม่มี remote']));
  const create=workflowButton('สร้างและเปิด repo ฝึก',async()=>{
    if(state.busy)return;create.disabled=true;setBusy(true);
    try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'training-create'})});const repo={path:result.path,name:result.name,valid:true,branch:'main',changes:1,remote:''};state.repos.push(repo);ui.dialog.close();await openWorkspace(repo,'changes',true);setNotice('สนามฝึกพร้อม — ไม่มี remote; อ่าน README เพื่อเริ่มฝึก');}
    catch(error){ui.body.append(el('p','workflow-warning','สร้างไม่สำเร็จ: '+error.message));}
    finally{setBusy(false);create.disabled=false;}
  });ui.actions.append(create);
}
const workflowCommands=[['ก่อนส่งงาน / Before sending',showSendReview],['ตรวจไฟล์ล่าสุด / Refresh files',()=>checkActiveWorkingFiles(true)],['ทำไมทำไม่ได้? / Action help',showActionReasons],['ชุด repo / Worksets',showWorksets],['วัดความเร็ว / Performance',showWorkflowPerformance],['สนามฝึก Git / Practice',showTraining]];
const workflowBaseCommands=commandPaletteEntries;
commandPaletteEntries=function(){return workflowBaseCommands().concat(workflowCommands.map(([label,run])=>({label,group:'Workflow',shortcut:'',search:label,run})));};
for(const panel of document.querySelectorAll('.help-menu-panel'))for(const [label,run]of workflowCommands){panel.append(workflowButton(label,()=>{panel.closest('details')?.removeAttribute('open');run();}));}
const workflowTools=el('div','workflow-toolbar');workflowTools.append(workflowButton('ก่อนส่งงาน',showSendReview),workflowButton('ทำไมทำไม่ได้?',showActionReasons),workflowButton('ชุด repo',showWorksets));document.querySelector('.workbench-layout-controls')?.append(workflowTools);
