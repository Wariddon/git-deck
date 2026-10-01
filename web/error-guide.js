// Friendly error cards: every failed action says, in plain words, what happened, what to do next,
// and offers buttons that go there (Open Conflicts, Stash and try again, Pull with merge, ...).
// Git's own message stays under Details. Unknown errors still get a next step.
(function(){
  if(typeof showActionFeedback!=='function'||typeof runWorkspaceAction!=='function')return;

  // The action that is running, so a card can offer "try again" with the same input.
  const running=[];
  const baseRun=runWorkspaceAction;
  runWorkspaceAction=async function(action,payload={},confirmation='',options={}){
    running.push({action,payload,repo:state.workspaceRepo?.path});
    try{return await baseRun(action,payload,confirmation,options);}finally{running.pop();}
  };
  const lastAction=()=>running[running.length-1]||null;

  const tab=name=>({label:({changes:()=>t('Open File Status'),conflicts:()=>t('Open Conflicts'),remotes:()=>t('Open Remotes'),branches:()=>t('Open Branches'),settings:()=>t('Open Settings'),history:()=>t('Open History'),stashes:()=>t('Open Stashes'),health:()=>t('Check repository health'),compare:()=>t('Open Compare')}[name])(),run:()=>selectWorkspaceTab(name)});
  const retry=ctx=>ctx.last?{label:t('Try again'),run:()=>runWorkspaceAction(ctx.last.action,ctx.last.payload,'')}:null;
  const stashRetry=ctx=>({label:ctx.last?t('Stash my changes and try again'):t('Stash my changes'),run:async()=>{
    const saved=await runWorkspaceAction('stash-save',{message:t('Saved by Git Deck before {action}',{action:ctx.last?.action||t('an action')})},'');
    if(!saved)return;
    if(ctx.last&&await runWorkspaceAction(ctx.last.action,ctx.last.payload,''))showActionFeedback(t('Done. Your changes are kept in Stashes; apply them when you are ready.'));
  }});
  const pullWith=strategy=>({label:strategy==='merge'?t('Pull with merge'):t('Pull with rebase'),run:()=>runWorkspaceAction('pull',{strategy},'')});
  const copy=(label,text)=>({label,run:async()=>{try{await navigator.clipboard.writeText(text);showActionFeedback(t('Copied. Paste it into a terminal and press Enter.'));}catch{setOutput?.(text,{expand:true});}}});
  const repoPath=()=>state.workspaceRepo?.path||'';

  const guides=[
    {id:'lock',test:/index\.lock|another git (process|program) seems to be running|unable to create .*\.lock/i,
      title:()=>t('Another program is using this repository'),why:()=>t('Git found a lock file, so another Git program (or a crashed one) is still working here.'),
      next:()=>t('Close other Git programs or terminals for this repository, wait a moment, then try again.'),actions:ctx=>[retry(ctx)]},
    {id:'dubious',test:/dubious ownership|safe\.directory/i,
      title:()=>t('Windows says this folder belongs to another user'),why:()=>t('Git refuses to work in folders owned by a different Windows account.'),
      next:()=>t('If you trust this folder, copy the command, run it once in a terminal, then try again.'),actions:ctx=>[copy(t('Copy fix command'),`git config --global --add safe.directory "${repoPath().replace(/\\/g,'/')}"`),retry(ctx)]},
    {id:'identity',test:/please tell me who you are|empty ident|unable to auto-detect email|author identity unknown/i,
      title:()=>t('Git does not know your name and email yet'),why:()=>t('Every commit records who made it, and no name or email is set.'),
      next:()=>t('Enter your name and email in Settings, then commit again.'),actions:()=>[tab('settings')]},
    {id:'unfinished',test:/not concluded your merge|MERGE_HEAD exists|already a rebase-(merge|apply) directory|rebase (is )?in progress|cherry-pick is already in progress|revert is already in progress|you are in the middle of|finish or abort the (merge|rebase)/i,
      title:()=>t('A merge or rebase is still unfinished'),why:()=>t('Git is paused in the middle of an earlier merge, rebase or cherry-pick.'),
      next:()=>t('Open Conflicts to finish it (Continue) or cancel it (Abort), then try again.'),actions:()=>[tab('conflicts')]},
    {id:'conflicts',test:/\bCONFLICT\b|merge conflict|paused for conflicts|fix conflicts|unmerged (paths|files)|needs merge|conflicted|conflict with yours|resolve conflicts/i,
      title:()=>t('Some files conflict'),why:()=>t('Both sides changed the same lines, so Git needs you to choose what to keep.'),
      next:()=>t('Open each conflicted file, pick mine, theirs or both, then commit to finish.'),actions:()=>[tab(state.workspace?.operation?.active?'conflicts':'changes')]},
    {id:'untracked',test:/untracked working tree files? would be (overwritten|removed)|would overwrite \d+ untracked file/i,
      title:()=>t('A new file is in the way'),why:()=>t('An incoming file has the same name as a file you have not added to Git yet.'),
      next:()=>t('Stash your changes (untracked files included) and try again, or rename or delete that file in File Status.'),actions:ctx=>[stashRetry(ctx),tab('changes')]},
    {id:'local-changes',test:/local changes to the following files would be overwritten|commit your changes or stash them|commit or stash|please commit or stash|you have unstaged changes|cannot (pull|rebase|merge) with (unstaged|uncommitted)|has uncommitted changes/i,
      title:()=>t('Your uncommitted changes are in the way'),why:()=>t('This action would overwrite files you changed but have not committed.'),
      next:()=>t('Commit your changes, or stash them and try again.'),actions:ctx=>[stashRetry(ctx),tab('changes')]},
    {id:'diverged',test:/not possible to fast-forward|diverging branches can't be fast-forwarded|divergent branches|need to specify how to reconcile|have diverged/i,
      title:()=>t('Your branch and the remote both have new commits'),why:()=>t('A fast-forward pull only works when you have no commits of your own, and here both sides moved on.'),
      next:()=>t('Pull with merge to combine them (safe, like Sourcetree), or with rebase to replay your commits on top.'),actions:()=>[pullWith('merge'),pullWith('rebase')]},
    {id:'push-behind',test:/\[rejected\].*(fetch first|non-fast-forward)|updates were rejected because the (remote contains work|tip of your current branch is behind)/i,
      title:()=>t('The remote has newer commits'),why:()=>t('Someone pushed to this branch after your last pull, so Git will not overwrite it.'),
      next:()=>t('Merge their commits into yours, then push again.'),actions:ctx=>{
        const pm=window.GitDeckPushMerge;const last=ctx.last;const source=pm&&last&&['push','push-selection'].includes(last.action)?pm.pullSource(last.action,last.payload,ctx.message):null;
        return [source?{label:t('Merge and push'),run:()=>pm.mergeThenPush(last.action,last.payload,source)}:pullWith('merge'),tab('compare')];
      }},
    {id:'protected',test:/protected branch|pre-receive hook declined|hook declined|GH006|not allowed to (push|force)/i,
      title:()=>t('The remote does not allow pushing to this branch'),why:()=>t('This branch is protected, so changes must arrive through a pull or merge request.'),
      next:()=>t('Create a new branch from your work, push that branch, then open a pull or merge request.'),actions:()=>[tab('branches')]},
    {id:'long-path',test:/filename too long|path too long/i,
      title:()=>t('A file path is too long for Windows'),why:()=>t('Windows limits paths to 260 characters unless long paths are turned on for Git.'),
      next:()=>t('Copy the command, run it once in a terminal, then try again.'),actions:ctx=>[copy(t('Copy fix command'),'git config --global core.longpaths true'),retry(ctx)]},
    {id:'file-busy',test:/unable to unlink|unable to create file|being used by another process|resource busy/i,
      title:()=>t('A file is open in another program'),why:()=>t('Windows would not let Git change a file because another program has it open.'),
      next:()=>t('Close the editor, IDE or other program using that file, then try again.'),actions:ctx=>[retry(ctx)]},
    {id:'auth',test:/authentication failed|could not read (username|password)|permission denied|access denied|\b40[13]\b|terminal prompts disabled|invalid credentials|logon failed/i,
      title:()=>t('Sign-in to the remote failed'),why:()=>t('The remote did not accept your account, or your account cannot write to this repository.'),
      next:()=>t('Sign in again through Git Credential Manager (or check your SSH key), make sure you have access, then try again.'),actions:ctx=>[retry(ctx),tab('remotes')]},
    {id:'not-found',test:/repository not found|does not appear to be a git repository|no such remote|not a valid remote|\b404\b/i,
      title:()=>t('The remote repository was not found'),why:()=>t('The remote address is wrong, the repository moved, or you do not have access to it.'),
      next:()=>t('Check the remote URL in Remotes.'),actions:()=>[tab('remotes')]},
    {id:'network',test:/could not resolve host|failed to connect|connection (timed out|refused|reset)|operation timed out|network is unreachable|remote end hung up|early eof|unable to access|\bssl\b|schannel|proxy/i,
      title:()=>t('Could not reach the remote'),why:()=>t('The internet connection, VPN or proxy blocked the connection to the server.'),
      next:()=>t('Check your connection or VPN, then try again.'),actions:ctx=>[retry(ctx)]},
    {id:'too-large',test:/file size limit|exceeds .*limit|HTTP 413|large files detected|GH001|pack exceeds/i,
      title:()=>t('Something you are pushing is too large'),why:()=>t('The server rejects files or pushes over its size limit.'),
      next:()=>t('Remove the large file from your commits (or use Git LFS), then push again.'),actions:()=>[tab('history')]},
    {id:'no-upstream',test:/has no upstream branch|no tracking information|no upstream configured|does not track/i,
      title:()=>t('This branch is not on the remote yet'),why:()=>t('The branch only exists on your computer, so there is nothing to pull from or push to yet.'),
      next:()=>t('Publish the branch to create it on the remote.'),actions:()=>[{label:t('Publish branch'),run:()=>runWorkspaceAction('push',{},'')}]},
    {id:'missing-ref',test:/couldn't find remote ref|remote ref does not exist|unknown revision|bad revision|not found\. fetch first|was not found locally or on/i,
      title:()=>t('That branch or commit does not exist'),why:()=>t('It may have been deleted or renamed, or your list is out of date.'),
      next:()=>t('Fetch to refresh the list, then choose again.'),actions:()=>[{label:t('Fetch'),run:()=>runWorkspaceAction('fetch',{},'')},tab('branches')]},
    {id:'nothing',test:/nothing to commit|no changes added to commit|nothing added to commit|no changes to stash|no local changes to save|no (staged|visible) changes/i,
      title:()=>t('There is nothing to save'),why:()=>t('No changes are staged, or there are no changes at all.'),
      next:()=>t('Stage the files you want in File Status first.'),actions:()=>[tab('changes')]},
    {id:'exists',test:/already exists/i,
      title:()=>t('That name is already used'),why:()=>t('A branch, tag or file with this name already exists.'),
      next:()=>t('Pick a different name.'),actions:()=>[tab('branches')]},
    {id:'not-merged',test:/not fully merged/i,
      title:()=>t('This branch has commits that are not merged anywhere'),why:()=>t('Deleting it would lose those commits.'),
      next:()=>t('Merge it first, or compare to check that nothing is needed.'),actions:()=>[tab('compare')]},
    {id:'detached',test:/not currently on a branch|detached head/i,
      title:()=>t('You are not on a branch'),why:()=>t('You checked out a single commit (detached HEAD), so new work has no branch to go to.'),
      next:()=>t('Create a branch here or switch to an existing one.'),actions:()=>[tab('branches')]},
    {id:'unrelated',test:/unrelated histories/i,
      title:()=>t('These branches have no history in common'),why:()=>t('They were started separately, so Git will not merge them automatically.'),
      next:()=>t('Check that you picked the right branch or remote.'),actions:()=>[tab('compare')]},
    {id:'empty-repo',test:/does not have any commits yet|bad default revision 'HEAD'|ambiguous argument 'HEAD'/i,
      title:()=>t('This repository has no commits yet'),why:()=>t('Most actions need at least one commit.'),
      next:()=>t('Stage your files and make the first commit.'),actions:()=>[tab('changes')]},
    {id:'missing-path',test:/pathspec .* did not match|did not match any file|no such file or directory/i,
      title:()=>t('That file or branch is no longer there'),why:()=>t('It was probably moved, renamed or deleted since the list was loaded.'),
      next:()=>t('Refresh the list and choose again.'),actions:()=>[{label:t('Refresh'),run:()=>loadWorkspace()}]},
  ];
  const fallback={id:'unknown',title:()=>t('That did not work'),why:null,next:()=>t('Nothing was lost. Open Details to see the exact message from Git, then try again or check the repository health.'),actions:ctx=>[retry(ctx),tab('health')]};

  function guideFor(message){return guides.find(guide=>guide.test.test(String(message||'')))||null;}

  // File names Git mentions, so the card can say which files are involved without opening Details.
  function affectedFiles(message){
    const text=String(message||'');const found=[];
    const patterns=[/(?:Merge conflict in|CONFLICT \([^)]*\):[^\n]*? in) ([^\n]+?)\s*$/gm,/^(?:\t|\s*•\s)\s*([^\n]+?)\s*$/gm,
      /unable to (?:unlink(?: old)?|create file) '?([^':\n]+)'?/g,/pathspec '([^']+)'/g,/\bFile (\S+) is [\d.]+ ?MB/g,/^(\S+) has uncommitted changes/gm];
    for(const pattern of patterns)for(const match of text.matchAll(pattern)){const file=match[1].trim();if(file&&!found.includes(file))found.push(file);}
    return found;
  }

  function decorate(card,message){
    const guide=guideFor(message)||fallback;const ctx={message:String(message||''),last:lastAction()};
    card.dataset.guide=guide.id;
    const title=card.querySelector('strong');if(title)title.textContent=guide.title();
    const first=card.querySelector(':scope > p');
    if(first&&guide.why)first.textContent=guide.why();
    const showNext=guide!==fallback||/^(fatal|error|hint|remote|warning):|\[rejected\]/im.test(ctx.message);
    const next=el('p','feedback-next');next.append(el('b','',t('What to do: ')),document.createTextNode(guide.next()));
    if(showNext)(first||title)?.after(next);
    let files=affectedFiles(ctx.message);
    if(!files.length&&['conflicts','unfinished'].includes(guide.id))files=[...(state.workspace?.operation?.conflicts||[])];
    if(files.length){
      const list=el('p','feedback-files');
      list.append(el('b','',t('Files: ')),document.createTextNode(files.slice(0,3).join(', ')+(files.length>3?' '+t('and {count} more',{count:files.length-3}):'')));
      list.title=files.join('\n');(first||title)?.after(list);
    }
    // Keep the card short: the repository/folder block moves under Details, its first line stays.
    const where=card.querySelector(':scope > .feedback-context');const details=card.querySelector(':scope > details');
    if(where&&details&&where.textContent.includes('\n')){const full=el('pre','feedback-context-full',where.textContent);details.querySelector('summary')?.after(full);where.textContent=where.textContent.split('\n')[0];}
    const actions=card.querySelector('.feedback-actions');if(!actions)return;
    const buttons=(guide.actions(ctx)||[]).filter(Boolean);
    // The app's own Retry is replaced when the guide offers one.
    if(buttons.some(item=>item.label===t('Try again')))[...actions.querySelectorAll('button')].find(b=>b.textContent==='Retry')?.remove();
    buttons.slice().reverse().forEach((item,index)=>{
      const button=el('button',index===buttons.length-1?'primary':'',item.label);button.type='button';
      button.onclick=()=>{card.remove();item.run();};actions.prepend(button);
    });
  }

  const baseFeedback=showActionFeedback;
  showActionFeedback=function(message,options={}){
    const result=baseFeedback(message,options);
    if(options.error){const card=document.getElementById('action-error-feedback');if(card&&!card.dataset.guide)try{decorate(card,message);}catch(error){console.warn('Error guide unavailable',error);}}
    return result;
  };

  // The Push dialog's own error box uses the same words.
  if(typeof classifyPushError==='function'){
    const baseClassify=classifyPushError;
    classifyPushError=function(value=''){const info=baseClassify(value);const guide=guideFor(info.technical);if(guide){info.title=guide.title();info.detail=[guide.why?.(),guide.next()].filter(Boolean).join(' ');}return info;};
  }

  window.GitDeckErrorGuide={guides,guideFor,fallback,affectedFiles};
})();
