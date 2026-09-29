'use strict';
// GitHub tab: pull requests, workflow runs and "create pull request" through
// the user's own GitHub CLI (gh) login, alongside the existing GitLab inbox.
(function(){
  if(typeof renderWorkspace!=='function')return;
  const isGitHub=(data)=>/github\.com[:/]/i.test(data?.remote||'');
  function ensureTab(){
    const tabs=document.getElementById('workspace-tabs');if(!tabs)return null;
    let button=tabs.querySelector('[data-workspace-tab="github"]');
    if(!button){button=el('button','','GitHub');button.type='button';button.dataset.workspaceTab='github';(tabs.querySelector('[data-workspace-tab="gitlab-inbox"]')||tabs.lastElementChild).after(button);}
    return button;
  }
  const baseRender=renderWorkspace;
  renderWorkspace=function(...args){
    const tab=ensureTab();const data=state.workspace;
    if(tab){tab.hidden=Boolean(data)&&!isGitHub(data)&&state.workspaceTab!=='github';tab.classList.toggle('active',state.workspaceTab==='github');}
    if(state.workspaceTab!=='github')return baseRender(...args);
    if(data)renderWorkbenchTree(data);
    const content=$('workspace-content');content.replaceChildren();if(!data)return;
    renderSafetyCenter(content,data);renderGitHubView(content,data);
  };
  function badge(text,kind=''){return el('span',`github-badge ${kind}`.trim(),text);}
  function openUrl(url){if(url)api('/api/action',{method:'POST',body:JSON.stringify({action:'open-url',url})}).catch(error=>setNotice(error.message));}
  function renderGitHubView(content,data){
    const heading=workspaceHeading('GitHub','Pull requests and Actions runs for this repository via GitHub CLI (gh)');
    const refresh=el('button','github-refresh','Refresh GitHub');refresh.type='button';heading.box.append(refresh);content.append(heading.box);
    const body=el('div','github-inbox');content.append(body);
    if(!isGitHub(data)){body.append(workspaceEmpty('origin is not on GitHub','This tab works with repositories whose origin is on github.com'));return;}
    const load=async()=>{
      body.replaceChildren(el('p','github-loading','Loading from GitHub…'));
      const repo=state.workspaceRepo;
      try{
        const inbox=(await api(`/api/github/inbox?path=${encodeURIComponent(repo.path)}`)).inbox;
        if(state.workspaceTab!=='github'||state.workspaceRepo!==repo)return;
        body.replaceChildren();
        if(!inbox.installed){body.append(workspaceEmpty('GitHub CLI is not installed','Install it from https://cli.github.com (or place gh.exe in bin/), then click Refresh'));const link=el('button','primary','Open cli.github.com');link.type='button';link.addEventListener('click',()=>openUrl('https://cli.github.com'));body.append(link);return;}
        if(!inbox.authenticated){body.append(workspaceEmpty('GitHub is not connected','Click Connect, finish gh auth login in the terminal, then click Refresh'));const login=el('button','primary','Connect GitHub');login.type='button';login.addEventListener('click',()=>api('/api/action',{method:'POST',body:JSON.stringify({action:'github-login'})}).then(result=>setNotice(result.message)).catch(error=>setNotice(error.message)));body.append(login);return;}
        body.append(renderCreatePr(data,inbox),renderPullRequests(inbox),renderRuns(inbox));
      }catch(error){body.replaceChildren(workspaceEmpty('Could not load GitHub',error.message));}
    };
    refresh.addEventListener('click',load);load();
  }
  function renderCreatePr(data,inbox){
    const section=el('details','github-section github-create');const summary=el('summary','','＋ Create pull request');section.append(summary);
    const form=el('form','workspace-form github-pr-form');
    const branches=[...new Set([...(data.branches||[]).map(item=>item.name),...(data.remoteBranches||[]).map(item=>item.name.replace(/^[^/]+\//,''))])].filter(name=>name&&name!=='HEAD'&&name!==data.branch);
    const base=document.createElement('select');base.setAttribute('aria-label','Base branch');branches.forEach(name=>base.append(new Option(name,name)));base.value=['main','master','develop'].find(name=>branches.includes(name))||branches[0]||'';
    const title=el('input','');title.placeholder='Pull request title';title.required=true;title.maxLength=256;title.value=data.history?.[0]?.subject||'';title.setAttribute('aria-label','Pull request title');
    const description=document.createElement('textarea');description.rows=4;description.placeholder='Description (Markdown)';description.setAttribute('aria-label','Pull request description');
    const draftLabel=el('label','commit-option');const draft=document.createElement('input');draft.type='checkbox';draftLabel.append(draft,el('span','','Draft'));
    const submit=el('button','primary',`Push & open PR from ${data.branch||'current branch'}`);submit.type='submit';submit.disabled=!data.branch||!branches.length;
    const baseLabel=el('label','github-field');baseLabel.append(el('span','','Base'),base);
    form.append(title,baseLabel,description,draftLabel,submit);section.append(form);
    form.addEventListener('submit',async(event)=>{event.preventDefault();const result=await runWorkspaceAction('github-pr-create',{title:title.value.trim(),description:description.value,base:base.value,head:data.branch,draft:draft.checked},`Push ${data.branch} and create a pull request → ${base.value} on ${inbox.repo}?`);if(result?.url)openUrl(result.url);});
    return section;
  }
  function renderPullRequests(inbox){
    const section=el('section','github-section');section.append(el('h4','',`Open pull requests · ${inbox.pullRequests.length}`));
    if(!inbox.pullRequests.length){section.append(el('p','scan-location-empty','No open pull requests'));return section;}
    const list=workspaceList();
    inbox.pullRequests.forEach(pr=>{
      const row=el('div','workspace-row github-row');const info=el('div','github-row-info');
      const title=el('strong','',`#${pr.number} ${pr.title}`);const meta=el('small','',`${pr.author?.login||'unknown'} · ${pr.headRefName} → ${pr.baseRefName} · ${new Date(pr.updatedAt).toLocaleString()}`);
      const badges=el('span','github-badges');if(pr.isDraft)badges.append(badge('Draft'));if(pr.reviewDecision)badges.append(badge(pr.reviewDecision.replaceAll('_',' ').toLowerCase(),pr.reviewDecision==='APPROVED'?'ok':pr.reviewDecision==='CHANGES_REQUESTED'?'bad':''));
      info.append(title,meta,badges);
      const actions=el('div','workspace-row-actions');const open=el('button','','Open');open.type='button';open.addEventListener('click',()=>openUrl(pr.url));const checkout=el('button','','Checkout');checkout.type='button';checkout.addEventListener('click',()=>runWorkspaceAction('github-pr-checkout',{number:pr.number},`Check out pull request #${pr.number} (${pr.headRefName}) locally?`));actions.append(open,checkout);
      row.append(info,actions);list.append(row);
    });
    section.append(list);return section;
  }
  function renderRuns(inbox){
    const section=el('section','github-section');section.append(el('h4','',`Actions runs · ${inbox.runs.length}`));
    if(!inbox.runs.length){section.append(el('p','scan-location-empty','No workflow runs yet'));return section;}
    const list=workspaceList();
    inbox.runs.forEach(item=>{
      const row=el('div','workspace-row github-row');const info=el('div','github-row-info');
      const state=item.status==='completed'?(item.conclusion||'completed'):item.status;const kind=item.conclusion==='success'?'ok':['failure','cancelled','timed_out','startup_failure'].includes(item.conclusion)?'bad':'';
      info.append(el('strong','',item.displayTitle||item.workflowName),el('small','',`${item.workflowName} · ${item.headBranch} · ${item.event} · ${new Date(item.createdAt).toLocaleString()}`),badge(state,kind));
      const actions=el('div','workspace-row-actions');const open=el('button','','Open');open.type='button';open.addEventListener('click',()=>openUrl(item.url));actions.append(open);
      if(kind==='bad'){const rerun=el('button','','Re-run failed');rerun.type='button';rerun.addEventListener('click',()=>runWorkspaceAction('github-run-rerun',{run:item.databaseId},`Re-run failed jobs of “${item.displayTitle}”?`));actions.append(rerun);}
      row.append(info,actions);list.append(row);
    });
    section.append(list);return section;
  }
})();
