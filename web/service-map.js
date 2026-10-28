'use strict';
// Service map: the API map (web/api-map.js) drawn as a live graph. Each service is a dot; an arrow
// goes from a caller to the service that provides the endpoint (HTTP) or from a producer to a
// consumer (Kafka). It stays live: a service pulses when Git Deck sees it change, and when a
// change removes an endpoint that others still call, the arrows from those callers turn red.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // [{repo, surface}] + buildMap/topics from GitDeckApiMap -> {nodes, edges}.
  function serviceGraph(results,mapHelpers){
    const map=mapHelpers.buildMap(results),topics=mapHelpers.topics(results);
    const edges=new Map();const used=new Set();
    const add=(from,to,kind,label)=>{if(!from||!to||from===to)return;const key=`${from.path}>${to.path}`;if(!edges.has(key))edges.set(key,{from:from.path,to:to.path,http:0,kafka:0,labels:[]});const edge=edges.get(key);edge[kind]++;if(edge.labels.length<8&&!edge.labels.includes(label))edge.labels.push(label);used.add(from.path);used.add(to.path);};
    for(const endpoint of map.endpoints)for(const caller of endpoint.callers)for(const provider of endpoint.providers)add(caller.repo,provider.repo,'http',`${endpoint.method} ${endpoint.path}`.trim());
    for(const topic of topics)for(const producer of topic.producers)for(const consumer of topic.consumers)add(producer.repo,consumer.repo,'kafka',topic.topic);
    const nodes=results.filter(item=>used.has(item.repo.path)).map(item=>{const path=item.repo.path;let into=0,out=0;for(const edge of edges.values()){if(edge.to===path)into++;if(edge.from===path)out++;}return {path,name:item.repo.name,into,out};}).sort((a,b)=>a.name.localeCompare(b.name));
    return {nodes,edges:[...edges.values()]};
  }
  // Endpoints a new scan no longer provides that some other service calls.
  function brokenEndpoints(repoPath,before,after,results,mapHelpers){
    const key=(item)=>`${item.method} ${mapHelpers.normalizePath(item.path)}`;
    const now=new Set((after?.provides||[]).map(key));
    const gone=(before?.provides||[]).filter(item=>!now.has(key(item)));
    if(!gone.length)return [];
    const callers=[];
    for(const item of gone)for(const {repo,surface} of results)if(repo.path!==repoPath)for(const call of surface?.calls||[])if(mapHelpers.callMatches(call.path,item.path))callers.push({endpoint:`${item.method} ${item.path}`.trim(),caller:repo.path,callerName:repo.name});
    return callers;
  }
  // Nodes on a circle, ordered by name so families sit together.
  function layout(nodes,size){
    const r=size/2-60,c=size/2;
    return nodes.map((node,i)=>{const a=(2*Math.PI*i)/Math.max(1,nodes.length)-Math.PI/2;return {...node,x:Math.round(c+r*Math.cos(a)),y:Math.round(c+r*Math.sin(a))};});
  }
  const helpers={serviceGraph,brokenEndpoints,layout};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,mapLimit,query}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const scan=button(t('Draw the map'),'primary');bar.append(folder,scan);
    const status=el('small','multi-repo-status');const alerts=el('div','smap-alerts');
    const stage=el('div','smap-stage');const side=el('aside','smap-side');const layoutBox=el('div','smap-layout');layoutBox.append(stage,side);
    panel.append(bar,el('p','multi-repo-explain',t('Who calls whom, from the API map: an arrow goes from the caller to the service that provides the endpoint, or from a Kafka producer to its consumer. A service pulses when it changes; arrows turn red when a change removes an endpoint someone still calls. Click a service to see its links.')),status,alerts,layoutBox);
    let results=[],graph={nodes:[],edges:[]},selected='',broken=[];const dots=new Map();
    const MApi=window.GitDeckApiMap;
    function draw(){
      stage.replaceChildren();dots.clear();
      if(!graph.nodes.length){stage.append(el('div','multi-repo-empty',t('No calls between these repositories were found.')));return;}
      const size=Math.max(520,Math.min(1000,graph.nodes.length*46));
      const placed=layout(graph.nodes,size);const pos=new Map(placed.map(node=>[node.path,node]));
      const root=svg('svg',{viewBox:`0 0 ${size} ${size}`,class:'smap-svg',role:'img','aria-label':t('Service map')});
      const defs=svg('defs');const marker=svg('marker',{id:'smap-arrow',viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'});marker.append(svg('path',{d:'M0 0L10 5L0 10z',class:'smap-arrowhead'}));defs.append(marker);root.append(defs);
      const brokenPairs=new Set(broken.map(item=>`${item.caller}>${item.provider}`));
      for(const edge of graph.edges){
        const a=pos.get(edge.from),b=pos.get(edge.to);if(!a||!b)continue;
        const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,pad=14;
        const line=svg('line',{x1:a.x+dx/len*pad,y1:a.y+dy/len*pad,x2:b.x-dx/len*pad,y2:b.y-dy/len*pad,'marker-end':'url(#smap-arrow)'});
        const cls=['smap-edge',edge.kafka&&!edge.http?'smap-kafka':'smap-http'];
        if(selected&&(edge.from===selected||edge.to===selected))cls.push('smap-on');else if(selected)cls.push('smap-dim');
        if(brokenPairs.has(`${edge.from}>${edge.to}`))cls.push('smap-broken');
        line.setAttribute('class',cls.join(' '));const tip=svg('title');tip.textContent=edge.labels.join('\n');line.append(tip);root.append(line);
      }
      for(const node of placed){
        const g=svg('g',{class:'smap-node'+(selected===node.path?' smap-selected':'')+(selected&&selected!==node.path&&!graph.edges.some(e=>(e.from===selected&&e.to===node.path)||(e.to===selected&&e.from===node.path))?' smap-dim':''),tabindex:'0',role:'button','aria-label':node.name});
        const r=6+Math.min(10,node.into*1.5);
        g.append(svg('circle',{cx:node.x,cy:node.y,r}));
        const font=Math.max(11,Math.round(size/62));const label=svg('text',{x:node.x,y:node.y+r+font+2,'text-anchor':'middle','font-size':font});label.textContent=node.name;g.append(label);
        g.addEventListener('click',()=>{selected=selected===node.path?'':node.path;draw();drawSide();});
        g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();g.dispatchEvent(new Event('click'));}});
        dots.set(node.path.toLowerCase(),g);root.append(g);
      }
      stage.append(root);
    }
    function drawSide(){
      side.replaceChildren();const node=graph.nodes.find(item=>item.path===selected);
      if(!node){side.append(el('p','fleet-muted',t('{services} services · {links} links. Click a service.',{services:graph.nodes.length,links:graph.edges.length})));return;}
      const name=(path)=>graph.nodes.find(item=>item.path===path)?.name||path;
      side.append(el('h4','',node.name));
      const list=(title,edges,other)=>{if(!edges.length)return;side.append(el('strong','',title));const ul=el('ul','smap-links');for(const edge of edges){const li=el('li');li.append(el('b','',name(edge[other])),el('small','fleet-muted',' '+edge.labels.slice(0,3).join(' · ')+(edge.labels.length>3?' …':'')));ul.append(li);}side.append(ul);};
      list(t('Calls'),graph.edges.filter(edge=>edge.from===node.path),'to');
      list(t('Called by'),graph.edges.filter(edge=>edge.to===node.path),'from');
    }
    scan.onclick=async()=>{
      if(!MApi){status.textContent=t('The API map is not available.');return;}
      const repos=reposIn(folder.value).filter(repo=>repo.valid!==false&&!/\.worktrees[\\/]/i.test(repo.path)).slice(0,120);
      scan.disabled=true;let done=0;broken=[];alerts.replaceChildren();
      results=await mapLimit(repos,4,async repo=>{let surface=null;try{surface=(await api('/api/repo/api-surface?'+query({path:repo.path}))).surface;}catch{}status.textContent=t('Reading {done} of {count}…',{done:++done,count:repos.length});return {repo,surface};});
      scan.disabled=false;graph=serviceGraph(results,MApi);
      status.textContent=t('{services} services · {links} links · live',{services:graph.nodes.length,links:graph.edges.length});
      draw();drawSide();
    };
    // Live: pulse on change, rescan that repository and flag endpoints others still call.
    window.addEventListener('gitdeck:repo-changed',async(event)=>{
      const path=String(event.detail?.path||'');if(!path||!results.length||!panel.isConnected)return;
      const dot=dots.get(path.toLowerCase());if(dot){dot.classList.remove('smap-pulse');void dot.getBBox?.();dot.classList.add('smap-pulse');setTimeout(()=>dot.classList.remove('smap-pulse'),4000);}
      const index=results.findIndex(item=>item.repo.path.toLowerCase()===path.toLowerCase());if(index<0)return;
      let fresh=null;try{fresh=(await api('/api/repo/api-surface?'+query({path:results[index].repo.path}))).surface;}catch{return;}
      const gone=brokenEndpoints(results[index].repo.path,results[index].surface,fresh,results,MApi);
      results[index]={...results[index],surface:fresh};
      for(const item of gone)broken.push({...item,provider:results[index].repo.path});
      if(gone.length){
        const card=el('div','repo-alert tone-bad');card.append(el('strong','',t('{repo} no longer provides an endpoint others call',{repo:results[index].repo.name})));
        const ul=el('ul');for(const item of gone.slice(0,10))ul.append(el('li','',`${item.endpoint} ← ${item.callerName}`));card.append(ul);alerts.prepend(card);
      }
      graph=serviceGraph(results,MApi);
      // A removed endpoint drops its arrow from the rebuilt map; keep it, in red, so the break shows.
      for(const item of broken)if(!graph.edges.some(edge=>edge.from===item.caller&&edge.to===item.provider)&&graph.nodes.some(node=>node.path===item.caller)&&graph.nodes.some(node=>node.path===item.provider))graph.edges.push({from:item.caller,to:item.provider,http:1,kafka:0,labels:[t('{endpoint} (removed)',{endpoint:item.endpoint})]});
      draw();drawSide();
    });
  }
  addPanel('service-map',t('Service map'),build);
})();
