'use strict';
// AI helpers in the UI (server side: lib/GitDeck.Ai.ps1). AI only explains or
// proposes: anything that changes the repository still goes through the normal
// Git Deck action with its confirmation. Consent is asked once per repository
// and provider per session; the repository AI policy lives in Settings.
(function(){
  if(typeof runWorkspaceAction!=='function'||typeof api!=='function')return;
  const repo=()=>state.workspaceRepo;
  const accepted=new Set();

  async function aiStatus(){const current=repo();return (await api('/api/ai/status'+(current?`?path=${encodeURIComponent(current.path)}`:''))).ai;}
  async function ensureAi(what){
    let status;try{status=await aiStatus();}catch(error){showActionFeedback(error.message,{error:true,context:t('AI')});return false;}
    if(!status.ready){showActionFeedback(status.hint||t('AI is not available.'),{error:true,context:t('AI')});return false;}
    const key=status.provider+'|'+(repo()?.path||'');
    if(!accepted.has(key)){
      const where=status.provider==='ollama'?t('Ollama ({model}) on this computer',{model:status.model}):`Anthropic (${status.model})`;
      if(!confirm(t('Send {what} to {where}?\n\nGit Deck checks for secrets first and never runs Git commands from AI answers. You will not be asked again for this repository in this session.',{what,where})))return false;
      accepted.add(key);
    }
    return true;
  }
  async function aiAction(action,payload,what){
    if(!await ensureAi(what))return null;
    return api('/api/action',{method:'POST',body:JSON.stringify({action,path:repo()?.path||'',...payload})});
  }
  async function busy(button,run){
    const label=button.textContent;button.disabled=true;button.textContent=t('Thinking…');button.setAttribute('aria-busy','true');
    try{return await run();}catch(error){showActionFeedback(error.message,{error:true,context:t('AI')});return null;}
    finally{button.disabled=false;button.textContent=label;button.removeAttribute('aria-busy');}
  }
  function aiButton(label,title,run){const button=el('button','ai-button',label);button.type='button';button.title=title;button.addEventListener('click',()=>busy(button,run));return button;}
  function answerBox(text,note=''){
    const box=el('div','ai-answer');box.setAttribute('role','status');box.append(el('p','',text));
    box.append(el('small','ai-answer-note',[t('AI generated · check before acting'),note].filter(Boolean).join(' · ')));return box;
  }
  // Place a card right under the view heading (or first when a view has none).
  function underHeading(content,card){const head=content.querySelector(':scope > .workspace-section-head');if(head)head.after(card);else content.prepend(card);}
  function replaceAnswer(anchor,box,position='after'){anchor.parentElement?.querySelector(':scope > .ai-answer')?.remove();anchor[position](box);}

  // ---- 1. Explain a failed action (error feedback card) ---------------------------------
  if(typeof showActionFeedback==='function'){
    const baseFeedback=showActionFeedback;
    showActionFeedback=function(message,options={}){
      const result=baseFeedback(message,options);
      if(options.error&&repo()&&options.context!==t('AI')){
        const card=document.getElementById('action-error-feedback');const actions=card?.querySelector('.feedback-actions');
        if(actions&&!actions.querySelector('.ai-button')){
          const failed=String(options.context||'').split('·').pop().trim();
          actions.prepend(aiButton(t('✨ Explain'),t('Explain this error and what to do next'),async()=>{
            const answer=await aiAction('ai-explain-error',{failedAction:failed,error:String(message)},t('this error message and the repository status (no code)'));
            if(answer){card.querySelector('.ai-answer')?.remove();actions.before(answerBox(answer.explanation,answer.note));}
          }));
        }
      }
      return result;
    };
  }

  // ---- Views rendered into #workspace-content: add buttons as they appear ------------------
  function enhance(root){
    // 2. GitHub "Create pull request" form.
    for(const form of root.querySelectorAll('.github-pr-form:not([data-ai])')){
      form.dataset.ai='1';
      const title=form.querySelector('input');const description=form.querySelector('textarea');const base=form.querySelector('select');
      form.prepend(aiButton(t('✨ Draft title & description'),t('Draft from the commits and diff against the base branch'),async()=>{
        const answer=await aiAction('ai-pr-description',{base:base.value,head:state.workspace?.branch||''},t('the commits and diff of this branch'));
        if(answer){title.value=answer.title;description.value=answer.body;if(answer.note)setNotice(answer.note);}
      }));
    }
    // 3. Commit detail in History.
    for(const actions of root.querySelectorAll('.commit-detail-actions:not([data-ai])')){
      actions.dataset.ai='1';
      const hash=(actions.parentElement?.querySelector('p')?.textContent||'').split('·')[0].trim();
      if(!/^[0-9a-f]{4,40}$/i.test(hash))continue;
      actions.append(aiButton(t('✨ Explain'),t('Explain what this commit changes'),async()=>{
        const answer=await aiAction('ai-explain-commit',{commit:hash},t('this commit and its diff'));
        if(answer)replaceAnswer(actions.closest('.commit-detail-meta')||actions,answerBox(answer.explanation,answer.note),'append');
      }));
    }
    // 4. Conflict Center: fill the result box; the user still saves with the existing button.
    for(const actions of root.querySelectorAll('.conflict-actions:not([data-ai])')){
      actions.dataset.ai='1';
      actions.prepend(aiButton(t('✨ Propose merge'),t('Let AI combine Ours and Theirs into the result box for you to review'),async()=>{
        const file=root.querySelector('.conflict-file-list button.active')?.title;const result=root.querySelector('.conflict-result textarea');
        if(!file||!result)return;
        const answer=await aiAction('ai-conflict-proposal',{file},t('the Base, Ours and Theirs versions of {file}',{file}));
        if(!answer)return;
        result.value=answer.merged;result.dispatchEvent(new Event('input',{bubbles:true}));
        replaceAnswer(actions,answerBox(answer.explanation+'\n'+t('Review the result, then Save result & Stage.')),'before');
      }));
    }
    // 6. Commit box: plan focused commits from the staged hunks.
    for(const bar of root.querySelectorAll('.commit-assist:not([data-ai])')){
      bar.dataset.ai='1';
      const split=aiButton(t('✨ Split'),t('Suggest how to split the staged changes into focused commits'),showSplitPlan);
      split.disabled=!(state.workspace?.files||[]).some(file=>file.staged);bar.querySelector('.commit-ai')?.after(split);
    }
  }
  const content=document.getElementById('workspace-content');
  if(content){let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;enhance(content);},0);}).observe(content,{childList:true,subtree:true});}

  async function showSplitPlan(){
    const plan=await aiAction('ai-split-plan',{},t('the staged diff'));if(!plan)return;
    const ui=releaseDialog(t('Split into focused commits'));
    ui.body.append(el('p','',t('Stage one group, commit it, then plan again for the rest. Working files are never changed.')));
    plan.groups.forEach((group,index)=>{
      const card=el('section','ai-split-group');card.append(el('strong','',`${index+1}. ${group.message}`),el('small','',group.hunks.join(', ')));
      const use=el('button','primary',t('Stage only this group'));use.type='button';
      use.addEventListener('click',async()=>{
        ui.dialog.close();
        const result=await runWorkspaceAction('keep-staged-hunks',{hunks:group.hunks,fingerprint:plan.fingerprint},t('Keep only these {count} hunk(s) staged? The other staged hunks move back to unstaged; working files are not changed.',{count:group.hunks.length}));
        if(result){const message=document.querySelector('.commit-composer textarea');if(message){message.value=group.message;message.dispatchEvent(new Event('input',{bubbles:true}));message.focus();}}
      });
      card.append(use);ui.body.append(card);
    });
    if(plan.note)ui.body.append(el('small','ai-answer-note',plan.note));
  }

  // ---- 5. Push dialog: optional AI review of the outgoing commits ------------------------------
  const pushActions=document.querySelector('#push-form .modal-actions');
  if(pushActions){
    const box=el('section','ai-push-review');box.id='ai-push-review';box.hidden=true;document.querySelector('#push-form .push-preview')?.before(box);
    pushActions.prepend(aiButton(t('✨ AI review'),t('Ask AI to review the commits you are about to push (advice only, never blocks)'),async()=>{
      const row=[...document.querySelectorAll('#push-branch-list .push-branch-row')].find(item=>item.querySelector('.push-check')?.checked);
      const remote=document.getElementById('push-remote')?.value;if(!row||!remote){setNotice(t('Select a branch to push first.'));return;}
      const local=row.dataset.local;const target=row.querySelector('.push-target')?.value.trim()||local;
      const review=await aiAction('ai-push-review',{remote,local,target},t('the commits you are about to push'));if(!review)return;
      box.hidden=false;box.replaceChildren(el('strong','',t('AI review')),el('p','',review.summary));
      for(const finding of review.findings){const item=el('div',`readiness-row ${finding.severity==='warn'?'warn':'ok'}`);item.append(el('b','',finding.severity==='warn'?'!':'•'),el('span','',finding.file),el('small','',finding.message));box.append(item);}
      box.append(el('small','ai-answer-note',[t('AI generated · check before acting'),review.note].filter(Boolean).join(' · ')));
    }));
  }

  // ---- 2. GitLab merge request dialog ------------------------------------------------------------------
  const mrDescription=document.getElementById('mr-description');
  if(mrDescription){
    mrDescription.closest('label')?.before(aiButton(t('✨ Draft title & description'),t('Draft from the commits and diff against the target branch'),async()=>{
      const base=document.getElementById('mr-target')?.value.trim();const head=document.getElementById('mr-source-branch')?.value.trim()||state.workspace?.branch||'';
      if(!base){setNotice(t('Choose a target branch first.'));return;}
      const answer=await aiAction('ai-pr-description',{base,head},t('the commits and diff of this branch'));
      if(answer){document.getElementById('mr-title').value=answer.title;mrDescription.value=answer.body;if(answer.note)setNotice(answer.note);}
    }));
  }

  // ---- 7. Command palette: ask AI to pick a command -------------------------------------------------------
  if(typeof commandPaletteEntries==='function'){
    const basePalette=commandPaletteEntries;
    commandPaletteEntries=function(){
      const entries=basePalette();const term=(document.getElementById('command-search')?.value||'').trim();
      if(term.length<4)return entries;
      return [...entries,{label:t('✨ Ask AI: "{text}"',{text:term.slice(0,60)}),group:t('AI'),shortcut:'',search:term,run:()=>askPalette(term,entries)}];
    };
  }
  async function askPalette(text,entries){
    if(typeof hideCommandPalette==='function')hideCommandPalette();
    const commands=entries.map((entry,index)=>({id:String(index),label:`${entry.label} (${entry.group})`}));
    let answer=null;try{answer=await aiAction('ai-command',{request:text,commands},t('your request and the list of Git Deck commands (no code)'));}catch(error){showActionFeedback(error.message,{error:true,context:t('AI')});return;}
    if(!answer)return;
    const entry=answer.commandId!==''?entries[Number(answer.commandId)]:null;
    if(!entry){showActionFeedback(answer.explanation||t('No matching command.'),{context:t('AI')});return;}
    if(confirm(t('AI suggests: {label}\n\n{explanation}\n\nOpen it?',{label:entry.label,explanation:answer.explanation})))entry.run();
  }

  // ---- 8. Recovery: ask where work went -------------------------------------------------------------------
  // app.js renders the Recovery tab with renderRecoveryViewV2 (older builds: renderRecoveryView).
  const recoveryName=typeof renderRecoveryViewV2==='function'?'renderRecoveryViewV2':typeof renderRecoveryView==='function'?'renderRecoveryView':'';
  if(recoveryName){
    const baseRecovery=globalThis[recoveryName];
    globalThis[recoveryName]=function(content,data){
      const result=baseRecovery(content,data);
      const card=el('section','ai-card');card.append(el('strong','',t('✨ Ask about history')),el('small','',t('For example: "where is my work from yesterday afternoon?"')));
      const form=el('form','ai-ask');const input=el('input','');input.placeholder=t('Ask a question about the reflog');input.maxLength=500;const ask=el('button','primary',t('Ask'));ask.type='submit';form.append(input,ask);card.append(form);
      form.addEventListener('submit',(event)=>{event.preventDefault();if(!input.value.trim())return;busy(ask,async()=>{
        const answer=await aiAction('ai-reflog',{question:input.value.trim()},t('your question and the reflog (commit messages, no code)'));if(!answer)return;
        card.querySelector('.ai-answer')?.remove();const box=answerBox(answer.answer);
        for(const candidate of answer.candidates){const row=el('div','ai-candidate');row.append(el('code','',candidate.hash),el('span','',candidate.reason));const branch=el('button','',t('Create recovery branch'));branch.type='button';
          branch.addEventListener('click',()=>{const name=prompt(t('Name for the recovery branch'),`recovery/${candidate.hash}`);if(name&&name.trim())runWorkspaceAction('branch-create-at',{branch:name.trim(),commit:candidate.fullHash},t('Create branch {branch} at {hash}?\nThe current branch and working files will not change',{branch:name.trim(),hash:candidate.hash}));});
          row.append(branch);box.append(row);}
        card.append(box);
      });});
      underHeading(content,card);return result;
    };
  }

  // ---- 9. Tags: release notes between two points -------------------------------------------------------------
  if(typeof renderTagsView==='function'){
    const baseTags=renderTagsView;
    renderTagsView=function(content,data){
      const result=baseTags(content,data);
      const tags=data.tags||[];const card=el('section','ai-card');card.append(el('strong','',t('✨ Release notes')));
      const from=document.createElement('select');from.setAttribute('aria-label',t('From tag'));from.append(new Option(t('Beginning of history'),''),...tags.map(tag=>new Option(tag,tag)));from.value=tags[0]||'';
      const to=el('input','');to.value='HEAD';to.setAttribute('aria-label',t('To tag or commit'));
      const draft=aiButton(t('Draft notes'),t('Summarise the commits in this range as release notes'),async()=>{
        const answer=await aiAction('ai-release-notes',{from:from.value,to:to.value.trim()||'HEAD'},t('the commit messages in this range (no code)'));if(!answer)return;
        const ui=releaseDialog(t('Release notes · {range}',{range:answer.range}));const text=document.createElement('textarea');text.className='ai-notes';text.value=answer.notes;text.rows=16;ui.body.append(text);
        if(answer.note)ui.body.append(el('small','ai-answer-note',answer.note));
        const copy=el('button','primary',t('Copy'));copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(text.value);setNotice(t('Release notes copied'));}catch{text.select();}});ui.actions.prepend(copy);
      });
      const row=el('div','ai-ask');row.append(from,el('span','','→'),to,draft);card.append(row);underHeading(content,card);return result;
    };
  }

  // ---- Settings: AI policy for this repository ------------------------------------------------------------------
  if(typeof renderSettingsView==='function'){
    const baseSettings=renderSettingsView;
    renderSettingsView=function(content,data){
      const result=baseSettings(content,data);
      const card=el('section','ai-card ai-policy');card.append(el('strong','',t('AI for this repository')),el('small','',t('Stored in this repository\'s local Git config only. Work repositories can stay local-only or off.')));
      const select=document.createElement('select');select.setAttribute('aria-label',t('AI for this repository'));
      select.append(new Option(t('Allowed (configured provider)'),'on'),new Option(t('Local model only (Ollama)'),'local'),new Option(t('Off'),'off'));
      const status=el('small','ai-policy-status',t('Checking…'));card.append(select,status);content.append(card);
      aiStatus().then(info=>{select.value=info.policy||'on';status.textContent=info.ready?t('Ready: {provider} ({model})',{provider:info.provider,model:info.model}):(info.hint||t('AI is not available.'));}).catch(error=>{status.textContent=error.message;});
      select.addEventListener('change',()=>runWorkspaceAction('ai-policy-set',{policy:select.value}));
      return result;
    };
  }
})();
