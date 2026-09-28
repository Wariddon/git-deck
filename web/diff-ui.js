'use strict';
function diffRows(text){
  let old=0,next=0,hunk=0;
  return text.split(/\r?\n/).slice(0,6000).map((line,index)=>{
    const match=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    let kind='meta',left='',right='';
    if(match){old=+match[1];next=+match[2];hunk++;kind='hunk';}
    else if(line.startsWith('diff --git ')){hunk=0;}
    else if(hunk&&line.startsWith('+')){kind='add';right=next++;}
    else if(hunk&&line.startsWith('-')){kind='remove';left=old++;}
    else if(hunk&&line.startsWith(' ')){kind='context';left=old++;right=next++;}
    return {line,index,kind,left,right,hunk};
  });
}
function changedFragment(a,b){let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;let end=0;while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;return {start,end:a.length-end};}
function diffPairs(rows){
  const result=[];for(let i=0;i<rows.length;){
    if(rows[i].kind==='remove'||rows[i].kind==='add'){
      const removed=[],added=[];while(i<rows.length&&rows[i].kind==='remove')removed.push(rows[i++]);while(i<rows.length&&rows[i].kind==='add')added.push(rows[i++]);
      for(let n=0;n<Math.max(removed.length,added.length);n++){const a=removed[n],b=added[n];if(a&&b){a.fragment=changedFragment(a.line.slice(1),b.line.slice(1));b.fragment=changedFragment(b.line.slice(1),a.line.slice(1));}result.push([a,b]);}
    }else{result.push([rows[i],rows[i]]);i++;}
  }return result;
}
function safeMarkdownPreview(text){
  // Deliberately small Markdown subset: no HTML, URLs, images, embeds or executable content.
  const root=el('article','safe-markdown');let code=null;
  for(const line of text.split(/\r?\n/)){
    if(/^\s*```/.test(line)){if(code)code=null;else{code=el('pre');root.append(code);}continue;}
    if(code){code.append(document.createTextNode(line+'\n'));continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading)root.append(el('h'+heading[1].length,'',heading[2]));
    else if(/^\s*[-*+]\s/.test(line))root.append(el('p','md-list-item','• '+line.replace(/^\s*[-*+]\s+/,'')));
    else if(/^>\s?/.test(line))root.append(el('blockquote','',line.replace(/^>\s?/,'')));
    else if(line.trim())root.append(el('p','',line));
  }return root;
}
function enhancedDiffViewer(diff,title='Diff',options={}){
  const preferences=state.meta.diffPreferences;
  if(preferences.fontVersion!==3){if(!preferences.fontSize||preferences.fontSize===13||preferences.fontVersion===1)preferences.fontSize=12;preferences.fontVersion=3;saveMeta();}
  const raw=diff||'No textual diff.',rows=diffRows(raw),pairs=diffPairs(rows);
  const viewer=el('section','diff-viewer improved-diff'),toolbar=el('div','diff-viewer-toolbar'),body=el('div','diff-viewer-body');
  const label=el('strong','',title);label.title=title;
  const button=(name,run)=>{const b=el('button','',name);b.type='button';b.onclick=run;return b;};
  const mode=el('select');mode.setAttribute('aria-label','Diff layout');mode.append(new Option('Unified','unified'),new Option('Side by side','split'));mode.value=preferences.mode;
  const search=el('input');search.type='search';search.placeholder='Find in diff';search.setAttribute('aria-label','Find in diff');
  const status=el('span','diff-navigation-status');status.setAttribute('aria-live','polite');
  let hunkIndex=-1,matchIndex=-1,previewing=false,fold=true,blobCache=null,previewVersion=0,focusOrigin=null;
  const focusMode=()=>{const full=viewer.classList.toggle('diff-fullscreen');if(full)focusOrigin=document.activeElement;fullButton.textContent=full?'Exit focus':'Focus diff';fullButton.setAttribute('aria-pressed',String(full));if(!full)focusOrigin?.focus();};
  const fullButton=button('Focus diff',focusMode);
  const wrap=button('Wrap',()=>{preferences.wrap=!preferences.wrap;saveMeta();draw();});
  const font=delta=>{preferences.fontSize=Math.min(20,Math.max(10,preferences.fontSize+delta));saveMeta();body.style.setProperty('--diff-font-size',preferences.fontSize+'px');};
  const foldButton=button('Collapse context',()=>{fold=!fold;foldButton.setAttribute('aria-pressed',String(fold));draw();});foldButton.setAttribute('aria-pressed','true');
  const jump=(kind,delta)=>{
    const nodes=[...body.querySelectorAll(kind==='hunk'?'[data-hunk]':'.diff-match')];if(!nodes.length){status.textContent=kind==='hunk'?'No change hunks':'No matches';return;}
    let index=kind==='hunk'?hunkIndex:matchIndex;index=index<0?(delta<0?nodes.length-1:0):(index+delta+nodes.length)%nodes.length;if(kind==='hunk')hunkIndex=index;else matchIndex=index;
    const target=nodes[index];let parent=target.parentElement;while(parent&&parent!==body){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    body.querySelectorAll('.diff-jump-target').forEach(n=>n.classList.remove('diff-jump-target'));target.classList.add('diff-jump-target');
    body.scrollTop+=target.getBoundingClientRect().top-body.getBoundingClientRect().top-8;
    status.textContent=(kind==='hunk'?'Change ':'Match ')+(index+1)+'/'+nodes.length;
  };
  const controls=el('div','diff-navigation');controls.append(button('Previous change',()=>jump('hunk',-1)),button('Next change',()=>jump('hunk',1)),status,foldButton);
  if(options.navigate){controls.append(button('Previous file',()=>options.navigate(-1,viewer.classList.contains('diff-fullscreen'))),button('Next file',()=>options.navigate(1,viewer.classList.contains('diff-fullscreen'))));}
  toolbar.append(label,mode,search,button('Previous match',()=>jump('match',-1)),button('Next match',()=>jump('match',1)),wrap,button('A−',()=>font(-1)),button('A+',()=>font(1)),button('Copy',async()=>{try{await navigator.clipboard.writeText(raw);setNotice('Diff copied');}catch{setNotice('Copy failed');}}),fullButton);
  viewer.append(toolbar,controls,body);
  const lineNode=row=>{
    const node=el('div','diff-line diff-'+row.kind);node.dataset.row=String(row.index);if(row.kind==='hunk')node.dataset.hunk=String(row.hunk);
    node.append(el('span','diff-line-number',String(row.left)),el('span','diff-line-number',String(row.right)));
    const text=el('span','diff-line-text'),term=search.value.toLowerCase(),at=term?row.line.toLowerCase().indexOf(term):-1;
    if(at>=0){text.append(document.createTextNode(row.line.slice(0,at)),el('mark','diff-search-mark',row.line.slice(at,at+term.length)),document.createTextNode(row.line.slice(at+term.length)));node.classList.add('diff-match');}
    else if(row.fragment&&row.fragment.end>row.fragment.start){const {start,end}=row.fragment;text.append(document.createTextNode(row.line.slice(0,start+1)),el('mark','diff-word-change',row.line.slice(start+1,end+1)),document.createTextNode(row.line.slice(end+1)));}
    else text.textContent=row.line||' ';
    node.append(text);return node;
  };
  const draw=()=>{
    if(previewing)return;const top=body.scrollTop,left=body.scrollLeft;body.replaceChildren();hunkIndex=-1;matchIndex=-1;
    body.classList.toggle('wrap-lines',Boolean(preferences.wrap));wrap.setAttribute('aria-pressed',String(Boolean(preferences.wrap)));body.style.setProperty('--diff-font-size',preferences.fontSize+'px');
    if(options.status==='A'||/^new file mode /m.test(raw))body.append(el('div','diff-file-note','New file · ทุกบรรทัดเป็นข้อมูลเพิ่มใหม่'));
    if(options.binary||/^(Binary files .* differ|GIT binary patch)/m.test(raw)){body.append(el('div','diff-file-note','Binary file · ไม่มี text diff · ใช้ File info เพื่อดูขนาดและดาวน์โหลด'));return;}
    const code=el('div','diff-lines '+(preferences.mode==='split'?'diff-side-by-side':''));
    if(preferences.mode==='split'){
      code.style.setProperty('--diff-column-width',`max(400px,${Math.max(0,...rows.map(r=>r.line.length))+16}ch)`);
      const pairNode=([a,b])=>{const pair=el('div','diff-pair');pair.append(a?lineNode(a):el('div','diff-line'),b?lineNode(b):el('div','diff-line'));if(a?.kind==='hunk'){pair.querySelectorAll('[data-hunk]').forEach(n=>n.removeAttribute('data-hunk'));pair.dataset.hunk=String(a.hunk);}return pair;};
      for(let i=0;i<pairs.length;){if(pairs[i][0]?.kind==='context'&&fold&&!search.value){let end=i;while(end<pairs.length&&pairs[end][0]?.kind==='context')end++;if(end-i>8){code.append(pairNode(pairs[i]),pairNode(pairs[i+1]));const details=el('details','diff-context-fold');details.append(el('summary','',`${end-i-4} unchanged lines · expand`));for(let n=i+2;n<end-2;n++)details.append(pairNode(pairs[n]));code.append(details,pairNode(pairs[end-2]),pairNode(pairs[end-1]));i=end;continue;}}code.append(pairNode(pairs[i++]));}
    }
    else for(let i=0;i<rows.length;){
      if(rows[i].kind==='context'&&fold&&!search.value){let end=i;while(end<rows.length&&rows[end].kind==='context')end++;if(end-i>8){code.append(lineNode(rows[i]),lineNode(rows[i+1]));const details=el('details','diff-context-fold');details.append(el('summary','',`${end-i-4} unchanged lines · expand`));for(let n=i+2;n<end-2;n++)details.append(lineNode(rows[n]));code.append(details,lineNode(rows[end-2]),lineNode(rows[end-1]));i=end;continue;}}
      code.append(lineNode(rows[i++]));
    }
    body.append(code);if(raw.split(/\r?\n/).length>6000||options.truncated)body.append(el('p','diff-file-note','แสดง diff แบบจำกัดขนาด — ผลค้นหา/จุดเปลี่ยนครอบคลุมเฉพาะส่วนที่โหลด'));
    status.textContent=search.value?body.querySelectorAll('.diff-match').length+' matching lines':body.querySelectorAll('[data-hunk]').length+' changes';body.scrollTop=top;body.scrollLeft=left;
  };
  if(options.content){
    const markdown=/\.(md|markdown)$/i.test(title),contentButton=button(markdown?'Preview':'File info',async()=>{
      if(previewing){previewVersion++;previewing=false;contentButton.textContent=markdown?'Preview':'File info';mode.disabled=false;search.disabled=false;foldButton.disabled=false;draw();return;}
      previewing=true;const version=++previewVersion;contentButton.textContent='Back to diff';mode.disabled=true;search.disabled=true;foldButton.disabled=true;body.replaceChildren(el('p','diff-file-note','กำลังอ่านไฟล์จาก commit…'));
      try{const result=blobCache||await options.content();if(!viewer.isConnected||!previewing||version!==previewVersion)return;blobCache=result;
        body.replaceChildren(el('p','diff-file-note',`${result.size.toLocaleString()} bytes · revision ${result.revision.slice(0,8)}${options.status==='D'?' · ก่อนลบไฟล์':''}`));
        if(result.tooLarge){body.append(el('p','diff-file-note','ไฟล์เกิน 10 MB — ไม่โหลดเพื่อป้องกันหน้าจอค้าง'));return;}
        if(markdown&&!result.binary&&!result.textTooLarge){body.append(el('small','diff-file-note','Safe Markdown preview · HTML/ลิงก์/รูปภายนอกไม่ทำงาน'),safeMarkdownPreview(result.text));}
        else if(result.binary){body.append(el('p','diff-file-note',result.pdf?'PDF document · ดาวน์โหลดเพื่อเปิดด้วยโปรแกรมอ่าน PDF ของคุณ':'Binary file · ไม่มี text preview'));
          if(result.base64)body.append(button(result.pdf?'Download PDF from commit':'Download binary from commit',()=>{const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:result.pdf?'application/pdf':'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=result.pdf?title.split(/[\\/]/).pop():'commit-file.bin';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}));
        }else if(result.textTooLarge)body.append(el('p','diff-file-note','Text preview จำกัดไม่เกิน 1 MB'));
        else body.append(el('pre','safe-file-text',result.text));
      }catch(error){if(viewer.isConnected&&previewing&&version===previewVersion)body.replaceChildren(el('p','diff-file-note','อ่านไม่ได้: '+error.message+' · กด Back to diff แล้วลองใหม่'));}
    });toolbar.append(contentButton);
  }
  mode.onchange=()=>{preferences.mode=mode.value;saveMeta();draw();};search.oninput=draw;search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();jump('match',event.shiftKey?-1:1);}};
  viewer.addEventListener('keydown',event=>{if(event.key==='Escape'&&viewer.classList.contains('diff-fullscreen')){event.stopPropagation();focusMode();}});
  draw();if(options.focus){viewer.classList.add('diff-fullscreen');fullButton.textContent='Exit focus';fullButton.setAttribute('aria-pressed','true');requestAnimationFrame(()=>{if(viewer.isConnected)fullButton.focus();});}return viewer;
}
if(typeof module!=='undefined')module.exports={diffRows,diffPairs,changedFragment};
else createDiffViewer=enhancedDiffViewer;
