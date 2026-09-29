'use strict';
// Pre-push checks in the Push dialog: secrets, large files and protected
// branches. Blocking findings need an explicit confirmation before pushing.
(function(){
  if(typeof updatePushDialog!=='function')return;
  let timer=null,version=0,blockers=[];
  const box=()=>{let node=document.getElementById('push-checks');if(node)return node;node=el('section','push-checks');node.id='push-checks';node.setAttribute('aria-live','polite');document.querySelector('#push-form .push-preview')?.before(node);return node;};
  const selected=()=>[...document.querySelectorAll('#push-branch-list .push-branch-row')].filter(row=>row.querySelector('.push-check')?.checked).map(row=>({local:row.dataset.local,target:row.querySelector('.push-target').value.trim()||row.dataset.local})).filter(item=>item.target).slice(0,5);
  async function runChecks(){
    const current=++version;const node=box();const repo=state.workspaceRepo;const remote=document.getElementById('push-remote')?.value;const force=Boolean(document.getElementById('push-force')?.checked);const items=selected();
    blockers=[];
    if(!repo||!remote||!items.length){node.replaceChildren();node.hidden=true;return;}
    node.hidden=false;node.replaceChildren(el('span','push-checks-title','Pre-push checks'),el('p','push-checks-loading','กำลังตรวจ secret, ไฟล์ใหญ่ และ protected branch…'));
    const rows=[];
    for(const item of items){
      try{
        const result=(await api(`/api/repo/push-checks?path=${encodeURIComponent(repo.path)}&remote=${encodeURIComponent(remote)}&local=${encodeURIComponent(item.local)}&target=${encodeURIComponent(item.target)}&force=${force}`)).pushChecks;
        if(current!==version)return;
        rows.push({item,result});
        result.checks.filter(check=>check.level==='block').forEach(check=>blockers.push(`${item.local}: ${check.label} — ${check.detail}`));
      }catch(error){if(current!==version)return;rows.push({item,error:error.message});}
    }
    const list=el('div','push-checks-list');
    rows.forEach(({item,result,error})=>{
      const group=el('div','push-checks-group');group.append(el('strong','',items.length>1?`${item.local} → ${item.target}`:''));
      if(error){group.append(checkRow({level:'warn',label:'Checks unavailable',detail:error}));}
      else{
        result.checks.forEach(check=>group.append(checkRow(check)));
        if(result.findings.length){const details=el('details','push-findings');details.append(el('summary','',`${result.findings.length} finding(s)`));result.findings.slice(0,20).forEach(finding=>details.append(el('code','',`${finding.commit} ${finding.file}: ${finding.preview}`)));group.append(details);}
      }
      list.append(group);
    });
    node.replaceChildren(el('span','push-checks-title',blockers.length?'Pre-push checks · blocked':'Pre-push checks'),list);
  }
  function checkRow(check){const row=el('div',`readiness-row ${check.level}`);row.append(el('b','',check.level==='ok'?'✓':check.level==='block'?'!':'•'),el('span','',check.label),el('small','',check.detail));return row;}
  const base=updatePushDialog;
  updatePushDialog=function(...args){const result=base(...args);clearTimeout(timer);timer=setTimeout(runChecks,350);return result;};
  document.getElementById('push-form')?.addEventListener('submit',(event)=>{
    if(!blockers.length)return;
    if(!confirm(`Pre-push checks found blocking issues:\n\n${blockers.join('\n')}\n\nPush anyway?`)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
})();
