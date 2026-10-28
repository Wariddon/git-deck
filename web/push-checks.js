'use strict';
// Pre-push checks in the Push dialog: secrets, large files and protected
// branches. Blocking findings need an explicit confirmation before pushing.
(function(){
  if(typeof updatePushDialog!=='function')return;
  let timer=null,version=0,blockers=[],riskChecks=[],nextRiskChecks=[];
  const box=()=>{let node=document.getElementById('push-checks');if(node)return node;node=el('section','push-checks');node.id='push-checks';node.setAttribute('aria-live','polite');document.querySelector('#push-form .push-preview')?.before(node);return node;};
  const selected=()=>[...document.querySelectorAll('#push-branch-list .push-branch-row')].filter(row=>row.querySelector('.push-check')?.checked).map(row=>({local:row.dataset.local,target:row.querySelector('.push-target').value.trim()||row.dataset.local})).filter(item=>item.target).slice(0,5);
  async function runChecks(){
    const current=++version;const node=box();const repo=state.workspaceRepo;const remote=document.getElementById('push-remote')?.value;const force=Boolean(document.getElementById('push-force')?.checked);const items=selected();
    // The checklist of the previous run stays in force until the new one is shown (no gap to push through).
    blockers=[];nextRiskChecks=[];
    if(!repo||!remote||!items.length){riskChecks=[];node.replaceChildren();node.hidden=true;return;}
    node.hidden=false;node.replaceChildren(el('span','push-checks-title',t('Pre-push checks')),el('p','push-checks-loading',t('Checking for secrets, large files and protected branches…')));
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
      if(error){group.append(checkRow({level:'warn',label:t('Checks unavailable'),detail:error}));}
      else{
        result.checks.forEach(check=>group.append(checkRow(check)));
        if(result.findings.length){const details=el('details','push-findings');details.append(el('summary','',t('{count} finding(s)',{count:result.findings.length})));result.findings.slice(0,20).forEach(finding=>details.append(el('code','',`${finding.commit} ${finding.file}: ${finding.preview}`)));group.append(details);}
      }
      list.append(group);
    });
    const risk=rows.map(item=>item.result?.risk).filter(Boolean).sort((a,b)=>b.score-a.score)[0];
    node.replaceChildren(el('span','push-checks-title',t(blockers.length?'Pre-push checks · blocked':'Pre-push checks')),...(risk?[riskCard(risk)]:[]),list);
    // Pre-flight: what the outgoing commits change in pom.xml, configuration and Dockerfile, in words.
    const outgoing=[...new Set(rows.flatMap(row=>row.result?.commits||[]))].slice(0,5);
    if(outgoing.length&&window.GitDeckSemanticDiff?.explain){
      const meaning=el('details','push-meaning');meaning.append(el('summary','',t('What these {count} commit(s) change (pom.xml, configuration, Dockerfile)',{count:outgoing.length})));
      meaning.addEventListener('toggle',()=>{if(!meaning.open||meaning.dataset.loaded)return;meaning.dataset.loaded='1';for(const hash of outgoing){const part=el('section','semantic-box');meaning.append(part);void window.GitDeckSemanticDiff.explain(repo.path,hash,part,el('button'));}});
      node.append(meaning);
    }
    riskChecks=nextRiskChecks;
  }
  // Blast radius of the push: why it is risky, and for high risk a checklist to tick before pushing.
  const riskLabels={'prod-config':t('Production configuration'),config:t('Application configuration'),migration:t('Database migration'),build:t('Dependencies or build'),deploy:t('Deployment or CI'),security:t('Security code'),size:t('Large change'),files:t('Many files'),deleted:t('Deleted files'),consumers:t('Used by other services')};
  const riskChecks_={'I compared the production values with the ConfigMap (Dashboard > Effective config).':t('I compared the production values with the ConfigMap (Dashboard > Effective config).'),'I checked which environments get this value (Dashboard > Effective config).':t('I checked which environments get this value (Dashboard > Effective config).'),'The migration is backward compatible or has a rollback script.':t('The migration is backward compatible or has a rollback script.'),'I ran the tests after the dependency or build change.':t('I ran the tests after the dependency or build change.'),'Someone else reviewed the deployment or pipeline change.':t('Someone else reviewed the deployment or pipeline change.'),'The security change was reviewed by a second person.':t('The security change was reviewed by a second person.'),'This change was reviewed in a merge request.':t('This change was reviewed in a merge request.'),'I told the teams of the services that use this one.':t('I told the teams of the services that use this one.')};
  function riskCard(risk){
    const card=el('div',`push-risk push-risk-${risk.level}`);
    const head=el('div','push-risk-head');head.append(el('strong','',{high:t('High risk'),medium:t('Medium risk'),low:t('Low risk')}[risk.level]||risk.level),el('span','push-risk-score',`${risk.score}/100`),el('small','fleet-muted',t('{files} files · {lines} changed lines',{files:risk.files,lines:risk.lines})));
    card.append(head);
    for(const reason of risk.reasons||[]){const line=el('div','push-risk-reason');line.append(el('b','',`+${reason.weight}`),el('span','',riskLabels[reason.id]||reason.label),el('small','fleet-muted',reason.detail||''));card.append(line);}
    if(risk.level==='high'&&(risk.checklist||[]).length){
      card.append(el('p','push-risk-note',t('Tick each point before pushing:')));
      for(const item of risk.checklist){const label=el('label','settings-check push-risk-check');const box=el('input');box.type='checkbox';label.append(box,el('span','',riskChecks_[item]||item));card.append(label);nextRiskChecks.push(box);}
    }
    return card;
  }
  function checkRow(check){const row=el('div',`readiness-row ${check.level}`);row.append(el('b','',check.level==='ok'?'✓':check.level==='block'?'!':'•'),el('span','',check.label),el('small','',check.detail));return row;}
  const base=updatePushDialog;
  updatePushDialog=function(...args){const result=base(...args);clearTimeout(timer);timer=setTimeout(runChecks,350);return result;};
  document.getElementById('push-form')?.addEventListener('submit',(event)=>{
    if(riskChecks.some(box=>!box.checked)){event.preventDefault();event.stopImmediatePropagation();alert(t('High-risk push: tick the checklist in the Push dialog first.'));riskChecks.find(box=>!box.checked)?.focus();return;}
    if(!blockers.length)return;
    if(!confirm(t('Pre-push checks found blocking issues:\n\n{issues}\n\nPush anyway?',{issues:blockers.join('\n')}))){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  window.GitDeckPushChecks={pendingRiskChecks:()=>riskChecks.filter(box=>!box.checked).length};
})();
