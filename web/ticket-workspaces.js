'use strict';
// Ticket workspaces (server side: lib/GitDeck.Agents.ps1). For a ticket, one Git worktree per chosen
// repository on feature/<KEY>, next to the repository; then a coding agent (Claude Code, Codex,
// Gemini CLI, Aider) started in a terminal there, with a first prompt you can edit. The list shows every
// ticket worktree with its changes and commits to push, so several tickets or agents can run side by side.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const ticketKey=(value)=>String(value||'').trim().toUpperCase();
  const validKey=(value)=>/^[A-Z][A-Z0-9]{1,9}-\d{1,12}$/.test(value);
  function defaultPrompt(key,repos,title=''){
    return [`Ticket ${key}${title?': '+title:''}.`,
      `You are in a Git worktree on branch feature/${key}${repos.length>1?' (the same ticket also has worktrees in: '+repos.join(', ')+')':''}.`,
      'Read the relevant code first and explain the plan in a few lines.',
      'Make the change, run the existing tests, and commit with a message that starts with '+key+'.',
      'Do not push.'].join('\n');
  }
  // Worktrees grouped by ticket key (worktrees without one are grouped under "").
  function groupWorkspaces(items){
    const groups=new Map();
    for(const item of items||[]){const key=item.key||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
    return [...groups.entries()].sort((a,b)=>(a[0]?0:1)-(b[0]?0:1)||a[0].localeCompare(b[0])).map(([key,list])=>({key,items:list.sort((a,b)=>a.mainName.localeCompare(b.mainName))}));
  }
  const helpers={ticketKey,validKey,defaultPrompt,groupWorkspaces};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,table,row,mapLimit,runQuiet,query}=F;
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};
  const action=(name,path,body={})=>api('/api/action',{method:'POST',body:JSON.stringify({action:name,path,...body})});
  let agents=[];
  const loadAgents=async()=>{try{agents=(await api('/api/agents')).agents||[];}catch{agents=[];}return agents;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const key=input(t('Ticket key, for example PAY-1234'));
    const branchGuess=String(state.workspace?.branch||'').match(/[A-Z][A-Z0-9]{1,9}-\d+/);if(branchGuess)key.value=branchGuess[0];
    const filter=input(t('Filter repositories'));const withBranch=button(t('Select repositories that already have the ticket branch'));const create=button(t('Create worktrees'),'primary');
    bar.append(folder,key,filter,withBranch,create);
    const picker=el('div','cockpit-picker ticket-workspace-picker');const count=el('small','fleet-muted','');
    const agentBox=el('details','fleet-mr-create ticket-agent');agentBox.append(el('summary','',t('Agent and first prompt')));
    const agentSelect=document.createElement('select');agentSelect.className='workflow-input';agentSelect.setAttribute('aria-label',t('Coding agent'));
    const prompt=el('textarea','workflow-input ticket-agent-prompt');prompt.rows=6;prompt.setAttribute('aria-label',t('First prompt for the agent'));
    const agentNote=el('small','fleet-muted','');agentBox.append(agentSelect,prompt,agentNote);
    // Connect any coding agent to Git Deck (MCP, read-only): Claude Code started here gets it already.
    const mcpBox=el('details','fleet-mr-create ticket-mcp');mcpBox.append(el('summary','',t('Connect agents to Git Deck (MCP)')));
    mcpBox.addEventListener('toggle',async()=>{
      if(!mcpBox.open||mcpBox.dataset.loaded)return;mcpBox.dataset.loaded='1';
      let setup=null;try{setup=(await api('/api/mcp')).mcp;}catch(error){mcpBox.append(el('p','fleet-muted',error.message));return;}
      mcpBox.append(el('p','fleet-muted',t('Agents can then ask Git Deck for pending work, a file across a family, config sources, tickets and push risk. Read-only: they cannot commit or push through it. Claude Code started from this page is already connected.')));
      for(const [label,text] of [['Claude Code',setup.claude],['Codex (~/.codex/config.toml)',setup.codex],['Gemini CLI',setup.gemini]]){
        const row=el('div','ticket-mcp-row');const code=el('pre','ticket-mcp-code',text);const copy=el('button','',t('Copy'));copy.type='button';
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent=t('Copied');}catch{}};
        row.append(el('strong','',label),copy,code);mcpBox.append(row);
      }
    });
    agentBox.after(mcpBox);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('For a ticket: a Git worktree per repository on feature/<ticket>, next to the repository, so your own folders stay as they are. Start a coding agent in each, or open them in Git Deck, VS Code or a terminal. Nothing is pushed.')),picker,count,agentBox,status,out);
    const boxes=[];
    const fillPicker=()=>{
      picker.replaceChildren();boxes.length=0;
      for(const repo of reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path))){
        const label=el('label','cockpit-pick');const box=el('input');box.type='checkbox';box.value=repo.path;box.onchange=sync;label.append(box,el('span','',repo.name));label.title=repo.path;picker.append(label);boxes.push(box);
      }
      sync();
    };
    const chosen=()=>boxes.filter(box=>box.checked).map(box=>reposIn('all').find(repo=>repo.path===box.value)).filter(Boolean);
    function sync(){count.textContent=t('{count} selected',{count:chosen().length});const k=ticketKey(key.value);if(validKey(k)&&!prompt.dataset.edited)prompt.value=defaultPrompt(k,chosen().map(repo=>repo.name));}
    prompt.addEventListener('input',()=>{prompt.dataset.edited='1';});
    key.addEventListener('input',()=>{delete prompt.dataset.edited;sync();});
    filter.addEventListener('input',()=>{const words=filter.value.trim().toLowerCase();for(const box of boxes){const label=box.closest('label');label.hidden=Boolean(words)&&!box.checked&&!label.textContent.toLowerCase().includes(words);}});
    folder.addEventListener('change',fillPicker);fillPicker();
    loadAgents().then(list=>{
      agentSelect.replaceChildren(...list.map(agent=>new Option(agent.name,agent.id)));
      agentNote.textContent=list.length?t('Agents found on this computer: {names}',{names:list.map(agent=>agent.name).join(', ')}):t('No coding agent CLI was found. Install one, for example: npm install -g @anthropic-ai/claude-code, then reopen Git Deck. Terminal and VS Code still work.');
      agentSelect.hidden=!list.length;
    });
    withBranch.onclick=async()=>{
      const k=ticketKey(key.value);if(!validKey(k)){status.textContent=t('Use a ticket key such as PAY-123.');key.focus();return;}
      withBranch.disabled=true;status.textContent=t('Looking in {count} repositories…',{count:boxes.length});
      await mapLimit(boxes,6,async box=>{try{const found=(await api('/api/repo/find-branch?'+query({path:box.value,name:'feature/'+k}))).branch;if(found.local||found.remote)box.checked=true;}catch{}});
      withBranch.disabled=false;sync();status.textContent=t('{count} selected',{count:chosen().length});
    };
    create.onclick=async()=>{
      const k=ticketKey(key.value);if(!validKey(k)){status.textContent=t('Use a ticket key such as PAY-123.');key.focus();return;}
      const repos=chosen();if(!repos.length){status.textContent=t('Choose at least one repository.');return;}
      if(!confirm(t('Create worktrees for {key} in {count} repositories (branch feature/{key})? Your current folders are not changed.',{key:k,count:repos.length})))return;
      create.disabled=true;let ok=0;const errors=[];
      await mapLimit(repos,2,async repo=>{try{await runQuiet('ticket-workspace-create',repo,{key:k});ok++;}catch(error){errors.push(`${repo.name}: ${error.message.split('\n')[0]}`);}});
      create.disabled=false;
      if(typeof loadRepositoryCache==='function')try{await loadRepositoryCache(false);}catch{}
      feedback(errors.length?errors.join('\n'):t('{count} worktrees ready for {key}',{count:ok,key:k}),errors.length>0);
      await list();
    };
    async function list(){
      out.replaceChildren(el('small','multi-repo-status',t('Reading worktrees…')));
      let items=[];try{items=(await api('/api/ticket-workspaces')).workspaces||[];}catch(error){out.replaceChildren(el('div','repo-alert tone-bad',error.message));return;}
      out.replaceChildren();
      if(!items.length){out.append(el('div','multi-repo-empty',t('No ticket worktrees yet. Choose repositories above and create them.')));return;}
      for(const group of groupWorkspaces(items)){
        const section=el('section','fleet-ticket-card');const head=el('div','fleet-ticket-head');head.append(el('strong','',group.key||t('Other worktrees')));
        if(group.key&&agents.length){const all=button(t('Start agent in all {count}',{count:group.items.length}));all.onclick=()=>startAgents(group.items,group.key);head.append(all);}
        section.append(head);
        const grid=table([t('Repository'),t('Branch'),t('Changes'),t('To push'),'']);
        for(const item of group.items){
          const actions=el('div','fleet-actions');
          const open=button(t('Open'));open.onclick=()=>{const repo=(state.repos||[]).find(entry=>entry.path.toLowerCase()===item.path.toLowerCase())||{path:item.path,name:item.path.split(/[\\/]/).pop()};document.getElementById('operations-close')?.click();openWorkspace(repo,'changes',true);};
          const agent=button(t('Agent'),'primary');agent.hidden=!agents.length;agent.onclick=()=>startAgents([item],item.key);
          const terminal=button(t('Terminal'));terminal.onclick=()=>action('open-terminal',item.path).then(answer=>feedback(answer.message)).catch(error=>feedback(error.message,true));
          const code=button('VS Code');code.onclick=()=>action('open-editor',item.path,{editor:'code'}).then(answer=>feedback(answer.message)).catch(error=>feedback(error.message,true));
          const remove=button(t('Remove'),'danger');remove.disabled=!item.main;
          remove.onclick=async()=>{
            if(item.changes&&!confirm(t('{name} has {count} uncommitted change(s). Git refuses to remove it until they are committed or discarded. Try anyway?',{name:item.mainName,count:item.changes})))return;
            if(!item.changes&&!confirm(t('Remove the worktree {path}? The branch {branch} and its commits stay in {name}.',{path:item.path,branch:item.branch,name:item.mainName})))return;
            try{await action('worktree-remove',item.main,{destination:item.path});feedback(t('Worktree removed'));await list();}catch(error){feedback(error.message,true);}
          };
          actions.append(open,agent,terminal,code,remove);
          grid.append(row([el('span','',item.mainName||item.path),el('code','',item.branch||'—'),item.changes?el('b','fleet-count',String(item.changes)):el('span','fleet-muted','0'),item.ahead?el('b','fleet-count','↑'+item.ahead):el('span','fleet-muted','0'),actions]));
        }
        section.append(grid);out.append(section);
      }
    }
    async function startAgents(items,k){
      const agent=agentSelect.value||agents[0]?.id;if(!agent)return;
      const text=prompt.dataset.edited?prompt.value:defaultPrompt(k||ticketKey(key.value),items.map(item=>item.mainName));
      for(const item of items){try{const answer=await action('agent-start',item.path,{agent,prompt:text});feedback(answer.message);}catch(error){feedback(error.message,true);}}
    }
    const refresh=button(t('Refresh list'));refresh.onclick=list;bar.append(refresh);
    list();
  }

  addPanel('ticket-workspaces',t('Ticket workspaces'),build);
  const nav=document.querySelector('.operations-tabs');const after=nav?.querySelector('[data-operations-view="ticket"]');const tab=nav?.querySelector('[data-operations-view="ticket-workspaces"]');if(after&&tab)after.after(tab);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="ticket-workspaces"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='ticket-workspaces';item.append(el('strong','',t('Ticket workspaces')),el('small','',t('A worktree per repository for a ticket, with a coding agent')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('ticket-workspaces');};
    const anchor=more.querySelector('[data-multi-repo="ticket"]');if(anchor)anchor.after(item);else more.append(item);
  }
  window.GitDeckTicketWorkspaces=helpers;
})();
