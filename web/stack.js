'use strict';
// Stacked branches and merge requests (server side: lib/GitDeck.Stack.ps1). A big change split into
// branches that build on each other: base -> part 1 -> part 2 -> ... Each part gets its own small
// merge request into the part before it; when the base moves, Restack rebases every part at once.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Description of part i of n, linking the parts so reviewers know the order.
  function stackDescription(branches,index){
    const lines=[`Part ${index+1} of ${branches.length} of a stacked change.`,''];
    branches.forEach((branch,i)=>lines.push(`${i===index?'➡️':'-'} ${i+1}. \`${branch.name}\` → \`${branch.target}\`${branch.subject?' — '+branch.subject:''}`));
    lines.push('','Review and merge in order; later parts are rebased by Git Deck when earlier ones change.');
    return lines.join('\n');
  }
  const helpers={stackDescription};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof el!=='function'||typeof api!=='function'||typeof releaseDialog!=='function')return;
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};

  async function openStack(){
    const repo=state.workspaceRepo;if(!repo)return;
    const ui=releaseDialog(t('Branch stack'));ui.dialog.classList.add('stack-dialog');
    const draw=async()=>{
      ui.body.replaceChildren(el('p','fleet-muted',t('Reading the branches…')));
      let stack;
      try{stack=(await api('/api/repo/stack?'+new URLSearchParams({path:repo.path}))).stack;}catch(error){ui.body.replaceChildren(el('div','repo-alert tone-bad',error.message));return;}
      ui.body.replaceChildren();ui.actions.querySelectorAll('.stack-action').forEach(node=>node.remove());
      if(!stack.branches.length){ui.body.append(el('p','',stack.message||t('This branch has no stack.')));return;}
      let mrs=null;try{mrs=(await api('/api/repo/mrs?'+new URLSearchParams({path:repo.path}))).mergeRequests||[];}catch(error){ui.body.append(el('p','fleet-muted',t('Merge requests are not shown: {message}',{message:error.message.split('\n')[0]})));}
      ui.body.append(el('p','fleet-muted',t('Each branch starts from the one above it. Base: {base}',{base:stack.base})));
      if(stack.baseAhead)ui.body.append(el('div','repo-alert tone-warn',t('{base} has {count} new commit(s) that the stack does not have yet. Restack to build on them.',{base:stack.base,count:stack.baseAhead})));
      const list=el('ol','stack-list');
      for(const branch of stack.branches){
        const item=el('li','stack-item'+(branch.current?' is-current':''));
        const head=el('div','stack-head');head.append(el('code','',branch.name),el('span','fleet-muted','→ '+branch.target),el('b','fleet-count',t('{count} commit(s)',{count:branch.commits})));
        const state_=el('div','stack-state');
        state_.append(el('span',`fleet-state tone-${branch.upstream?(branch.ahead||branch.behind?'warn':'ok'):'muted'}`,branch.upstream?(branch.ahead?t('{count} to push',{count:branch.ahead}):branch.behind?t('{count} to pull',{count:branch.behind}):t('Pushed')):t('Not pushed yet')));
        const mr=(mrs||[]).find(entry=>entry.source===branch.name);
        if(mr){const link=el('a','',`!${mr.iid} ${mr.target!==branch.target?t('(targets {target})',{target:mr.target}):''}`);link.href=mr.url;link.target='_blank';link.rel='noopener';state_.append(link);}
        else if(mrs)state_.append(el('span','fleet-muted',t('No merge request')));
        item.append(head,el('small','fleet-muted',branch.subject||''),state_);list.append(item);
      }
      ui.body.append(list);
      const restack=button(t('Restack onto {base}',{base:stack.base}),'stack-action');
      restack.onclick=async()=>{if(!confirm(t('Rebase all {count} branches onto {base}? Commit or stash your changes first. Undo can put the current branch back.',{count:stack.branches.length,base:stack.base})))return;await runWorkspaceAction('stack-restack',{});await draw();};
      const push=button(t('Push stack'),'stack-action');
      push.onclick=async()=>{if(!confirm(t('Push {count} branches with --force-with-lease (safe force: refused if someone else pushed)?',{count:stack.branches.length})))return;await runWorkspaceAction('stack-push',{});await draw();};
      const missing=stack.branches.filter(branch=>!(mrs||[]).some(entry=>entry.source===branch.name));
      const create=button(t('Create {count} merge request(s)',{count:missing.length}),'primary stack-action');create.disabled=!mrs||!missing.length;
      create.onclick=async()=>{
        if(!confirm(t('Create {count} merge request(s), each into the branch before it? Branches are pushed first.',{count:missing.length})))return;
        create.disabled=true;const errors=[];
        for(const branch of missing){
          const index=stack.branches.indexOf(branch);
          try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'create-mr',path:repo.path,source:branch.name,target:branch.target,remote:'origin',title:`[${index+1}/${stack.branches.length}] ${branch.subject||branch.name}`,description:stackDescription(stack.branches,index),draft:index>0})});}
          catch(error){errors.push(`${branch.name}: ${error.message.split('\n')[0]}`);}
        }
        feedback(errors.length?errors.join('\n'):t('Merge requests created'),errors.length>0);await draw();
      };
      ui.actions.prepend(restack,push,create);
    };
    await draw();
  }

  window.GitDeckStack={...helpers,openStack};
  if(typeof commandPaletteEntries==='function'){
    const base=commandPaletteEntries;
    commandPaletteEntries=function(){const list=base();list.push({label:t('Branch stack and stacked merge requests'),group:'GitLab',shortcut:'',run:openStack,search:'Branch stack stacked merge requests restack GitLab'});return list;};
  }
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-branch-stack]')){
    const item=el('button','');item.type='button';item.dataset.branchStack='1';item.append(el('strong','',t('Branch stack')),el('small','',t('Stacked branches and merge requests, restack')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');openStack();};
    const anchor=more.querySelector('.fleet-more-group');if(anchor)anchor.before(item);else more.append(item);
  }
})();
