'use strict';
// Word-level highlight inside changed diff lines, like Sourcetree: when a removed line is followed
// by an added one, the words that actually changed get a stronger background. Works on every diff
// view (unified, side by side, working-tree hunks) by pairing rows after they are rendered; the row
// text itself is unchanged, so line staging and copy keep working.
(function(){
  const tokenPattern=/\s+|[A-Za-z0-9_\u0E00-\u0E7F]+|[^\sA-Za-z0-9_\u0E00-\u0E7F]/g;
  const tokenize=(text)=>String(text).match(tokenPattern)||[];
  const MAX_TOKENS=300;

  // Character ranges [start,end) that differ between two lines, from a token LCS.
  // Returns null when the lines are too different for a word highlight to help.
  function changedRanges(before,after){
    const a=tokenize(before),b=tokenize(after);
    if(!a.length||!b.length||a.length>MAX_TOKENS||b.length>MAX_TOKENS)return null;
    const rows=a.length+1,cols=b.length+1;const table=new Uint16Array(rows*cols);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*cols+j]=a[i]===b[j]?table[(i+1)*cols+j+1]+1:Math.max(table[(i+1)*cols+j],table[i*cols+j+1]);
    const keepA=new Array(a.length).fill(false),keepB=new Array(b.length).fill(false);
    for(let i=0,j=0;i<a.length&&j<b.length;){if(a[i]===b[j]){keepA[i]=keepB[j]=true;i++;j++;}else if(table[(i+1)*cols+j]>=table[i*cols+j+1])i++;else j++;}
    const same=a.reduce((n,token,i)=>n+(keepA[i]&&token.trim()?token.length:0),0);
    const shorter=Math.min(before.replace(/\s/g,'').length,after.replace(/\s/g,'').length);
    if(!shorter||same/shorter<0.3)return null;
    const ranges=(tokens,keep)=>{const out=[];let offset=0;tokens.forEach((token,i)=>{if(!keep[i]){const last=out[out.length-1];if(last&&last[1]===offset)last[1]+=token.length;else out.push([offset,offset+token.length]);}offset+=token.length;});
      // Whitespace-only edges are noise; trim them.
      const text=tokens.join('');return out.map(([s,e])=>{while(s<e&&/\s/.test(text[s]))s++;while(e>s&&/\s/.test(text[e-1]))e--;return [s,e];}).filter(([s,e])=>e>s);};
    return {before:ranges(a,keepA),after:ranges(b,keepB)};
  }

  // Wrap ranges of a row's text (after the +/- marker) in <mark class="diff-word">.
  function mark(node,ranges){
    if(!ranges?.length||node.childNodes.length!==1||node.firstChild.nodeType!==3)return;
    const text=node.textContent;const prefix=/^[+-]/.test(text)?1:0;const fragment=document.createDocumentFragment();let at=0;
    for(const [s,e] of ranges){const start=s+prefix,end=e+prefix;if(start>at)fragment.append(text.slice(at,start));const word=document.createElement('mark');word.className='diff-word';word.textContent=text.slice(start,end);fragment.append(word);at=end;}
    if(at<text.length)fragment.append(text.slice(at));node.replaceChildren(fragment);
  }
  const body=(node)=>node.textContent.replace(/^[+-]/,'');
  function pair(removed,added){
    const count=Math.min(removed.length,added.length);
    for(let i=0;i<count;i++){const ranges=changedRanges(body(removed[i]),body(added[i]));if(ranges){mark(removed[i],ranges.before);mark(added[i],ranges.after);}}
  }
  function highlight(container){
    if(container.dataset.wordDiff)return;container.dataset.wordDiff='1';
    if(container.classList.contains('diff-split-code')){
      container.querySelectorAll(':scope > .diff-split-row').forEach(row=>{const left=row.querySelector(':scope > .diff-remove'),right=row.querySelector(':scope > .diff-add');if(left&&right)pair([left],[right]);});
      return;
    }
    let removed=[],added=[];
    const flush=()=>{pair(removed,added);removed=[];added=[];};
    for(const row of container.children){
      if(row.classList.contains('diff-remove')){if(added.length)flush();removed.push(row);}
      else if(row.classList.contains('diff-add')&&removed.length)added.push(row);
      else flush();
    }
    flush();
  }
  function scan(root=document){root.querySelectorAll?.('.diff-code:not([data-word-diff]),.diff-split-code:not([data-word-diff])').forEach(container=>{try{highlight(container);}catch{}});}

  if(typeof document!=='undefined'&&typeof MutationObserver==='function'&&document.body){
    let queued=false;
    new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;scan();},30);}).observe(document.body,{childList:true,subtree:true});
    scan();
  }
  window.GitDeckWordDiff={tokenize,changedRanges,highlight};
})();
