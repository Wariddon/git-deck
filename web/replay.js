'use strict';
// History replay: a repository's history played back as an animation. Commits appear oldest first,
// branches fork into their own lanes and merge back, tags and branch names appear at their commits,
// and the date runs along the top. Pause, change speed or drag through time. Read-only, from the
// same history the History view uses (/api/repo/history).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Commits newest first (git log order) -> lane per commit, like a history graph.
  function assignLanes(commits){
    const lanes=[];const out=new Map();
    for(const commit of commits||[]){
      let lane=lanes.indexOf(commit.fullHash);
      if(lane<0){lane=lanes.indexOf(null);if(lane<0){lane=lanes.length;lanes.push(null);}}
      for(let i=0;i<lanes.length;i++)if(i!==lane&&lanes[i]===commit.fullHash)lanes[i]=null;
      out.set(commit.fullHash,lane);
      const [first,...rest]=commit.parents||[];
      lanes[lane]=first||null;
      for(const parent of rest){if(!lanes.includes(parent)){const free=lanes.indexOf(null);if(free<0)lanes.push(parent);else lanes[free]=parent;}}
      while(lanes.length&&lanes[lanes.length-1]===null)lanes.pop();
    }
    return out;
  }
  // Short labels from git decorations: branches and tags, without HEAD and remotes' HEAD.
  function labels(decorations){
    return String(decorations||'').split(',').map(item=>item.trim().replace(/^HEAD -> /,'').replace(/^tag: /,'🏷 ')).filter(item=>item&&item!=='HEAD'&&!/\/HEAD$/.test(item)).slice(0,3);
  }
  const helpers={assignLanes,labels};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');
    const repoSelect=document.createElement('select');repoSelect.className='workflow-input';repoSelect.setAttribute('aria-label',t('Repository'));
    const count=document.createElement('select');count.className='workflow-input';count.setAttribute('aria-label',t('Commits'));for(const n of [100,250,500])count.append(new Option(t('Last {count} commits',{count:n}),String(n)));count.value='250';
    const load=button(t('Load'),'primary');const play=button('▶');play.title=t('Play or pause');play.setAttribute('aria-label',t('Play or pause'));
    const speed=document.createElement('select');speed.className='workflow-input';speed.setAttribute('aria-label',t('Speed'));for(const [label,v] of [['1×',1],['3×',3],['10×',10]])speed.append(new Option(label,String(v)));speed.value='3';
    const scrub=el('input','replay-scrub');scrub.type='range';scrub.min='0';scrub.max='0';scrub.value='0';scrub.setAttribute('aria-label',t('Position in time'));
    bar.append(repoSelect,count,load,play,speed);
    const now=el('div','replay-now');const stage=el('div','replay-stage');
    panel.append(bar,el('p','multi-repo-explain',t('The repository\'s history as an animation: commits appear oldest first, branches fork into lanes and merge back, branch names and tags show where they point. Use it to understand a repository you are new to, or what happened last week.')),scrub,now,stage);
    const fill=()=>{const keep=repoSelect.value||state.workspaceRepo?.path||'';repoSelect.replaceChildren(...(state.repos||[]).filter(repo=>repo.valid!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(repo=>new Option(repo.name,repo.path)));if(keep)repoSelect.value=keep;};
    fill();panel.addEventListener('focusin',()=>{if(repoSelect.options.length!==(state.repos||[]).length)fill();});
    let commits=[],shown=0,timer=null,nodes=[],links=[];
    const stop=()=>{clearInterval(timer);timer=null;play.textContent='▶';};
    function showUpTo(n){
      shown=Math.max(0,Math.min(commits.length,n));scrub.value=String(shown);
      nodes.forEach((node,i)=>node.classList.toggle('on',i<shown));links.forEach(link=>link.el.classList.toggle('on',link.child<shown&&link.parent<shown));
      const c=commits[shown-1];now.replaceChildren();
      if(c){now.append(el('strong','',new Date(c.time*1000).toLocaleString()),el('span','',` · ${c.author} · ${c.subject}`));}
      const target=nodes[shown-1];if(target&&timer)target.scrollIntoView?.({block:'nearest',inline:'center'});
    }
    load.onclick=async()=>{
      stop();stage.replaceChildren(el('p','fleet-muted',t('Reading history…')));
      const loaded=[];let skip=0;
      try{while(loaded.length<Number(count.value)){const answer=await api('/api/repo/history?'+query({path:repoSelect.value,scope:'all',includeRemote:'true',order:'date',skip:String(skip)}));loaded.push(...(answer.history||[]));if(!answer.hasMore)break;skip=answer.nextSkip;}}
      catch(error){stage.replaceChildren(el('div','repo-alert tone-bad',error.message));return;}
      const newest=loaded.slice(0,Number(count.value));const lanes=assignLanes(newest);
      commits=[...newest].reverse();
      const index=new Map(commits.map((c,i)=>[c.fullHash,i]));
      const step=26,laneGap=22,width=commits.length*step+120,height=(Math.max(0,...lanes.values())+1)*laneGap+130;
      const root=svg('svg',{width,height,viewBox:`0 0 ${width} ${height}`,class:'replay-svg',role:'img','aria-label':t('History replay')});
      const pos=(i)=>({x:40+i*step,y:100+(lanes.get(commits[i].fullHash)||0)*laneGap});
      links=[];nodes=[];
      commits.forEach((c,i)=>{for(const parent of c.parents||[]){const p=index.get(parent);if(p===undefined)continue;const a=pos(p),b=pos(i);const path=svg('path',{d:a.y===b.y?`M${a.x} ${a.y}L${b.x} ${b.y}`:`M${a.x} ${a.y}C${a.x+step} ${a.y} ${b.x-step} ${b.y} ${b.x} ${b.y}`,class:`replay-link lane-${(lanes.get(c.fullHash)||0)%6}`});root.append(path);links.push({el:path,child:i,parent:p});}});
      commits.forEach((c,i)=>{
        const {x,y}=pos(i);const g=svg('g',{class:`replay-node lane-${(lanes.get(c.fullHash)||0)%6}`});
        g.append(svg('circle',{cx:x,cy:y,r:(c.parents||[]).length>1?6:4.5}));
        const tip=svg('title');tip.textContent=`${c.hash} · ${c.date} · ${c.author}\n${c.subject}`;g.append(tip);
        // Labels slant up and to the right so neighbouring branch names do not overlap.
        labels(c.decorations).forEach((label,k)=>{const lx=x+4+k*10,ly=y-8;const text=svg('text',{x:lx,y:ly,transform:`rotate(-35 ${lx} ${ly})`});text.textContent=label.length>34?label.slice(0,33)+'…':label;g.append(text);});
        root.append(g);nodes.push(g);
      });
      stage.replaceChildren(root);scrub.max=String(commits.length);showUpTo(0);
      if(commits.length){play.click();}
    };
    play.onclick=()=>{
      if(timer){stop();return;}
      if(!commits.length)return;if(shown>=commits.length)showUpTo(0);
      play.textContent='⏸';
      timer=setInterval(()=>{if(shown>=commits.length){stop();return;}showUpTo(shown+1);},Math.round(400/Number(speed.value)));
    };
    speed.onchange=()=>{if(timer){stop();play.click();}};
    scrub.oninput=()=>{stop();showUpTo(Number(scrub.value));};
  }
  addPanel('replay',t('History replay'),build);
})();
