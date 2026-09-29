'use strict';
// Line-level staging: pick individual +/- lines inside a hunk and stage,
// unstage or discard only those. The server applies the patch with
// `git apply --recount`, so hunk header counts do not need to be exact.

// Builds a single-hunk patch that keeps only the selected changed lines.
// hunk[0] is the "@@" header; selected holds indexes into hunk.
// Forward (stage): unselected "+" lines are dropped, unselected "-" lines become context.
// Reverse (unstage/discard): unselected "+" lines become context, unselected "-" lines are dropped.
function buildLinePatch(header,hunk,selected,reverse){
  const out=[hunk[0]];let changed=false,dropped=false;
  // A trailing newline in the diff text is not a context line.
  let end=hunk.length;while(end>1&&hunk[end-1]==='')end--;
  for(let index=1;index<end;index++){
    const line=hunk[index];const kind=line[0];
    if(kind==='\\'){if(!dropped)out.push(line);continue;}
    dropped=false;
    if(kind==='+'||kind==='-'){
      if(selected.has(index)){out.push(line);changed=true;continue;}
      const keepAsContext=reverse?kind==='+':kind==='-';
      if(keepAsContext)out.push(' '+line.slice(1));else dropped=true;
      continue;
    }
    out.push(line);
  }
  if(!changed)return null;
  return [...header,...out,''].join('\n');
}

function selectableLineIndexes(hunk){const indexes=[];hunk.forEach((line,index)=>{if(index&&(line[0]==='+'||line[0]==='-'))indexes.push(index);});return indexes;}

if(typeof module!=='undefined')module.exports={buildLinePatch,selectableLineIndexes};

if(typeof window!=='undefined'&&typeof renderWorkingPatch==='function'){
  const lineStagingBaseRender=renderWorkingPatch;
  renderWorkingPatch=function(pane,diff,staged,file){
    lineStagingBaseRender(pane,diff,staged,file);
    try{enhanceLineStaging(pane,diff,staged,file);}catch(error){console.warn('Line staging unavailable',error);}
  };
}

function enhanceLineStaging(pane,diff,staged,file){
  const parsed=splitPatchHunks(diff);if(!parsed.hunks.length)return;
  const sections=[...pane.querySelectorAll('.patch-hunk')];
  sections.forEach((section,hunkIndex)=>{
    const hunk=parsed.hunks[hunkIndex];const rows=section.querySelector('.diff-code')?.children;if(!hunk||!rows)return;
    const selected=new Set();const offset=parsed.header.length;
    const controls=section.querySelector('.patch-hunk-actions');
    const makeButton=(label,className,mode,reverse,confirmText)=>{const button=el('button',`line-stage-button ${className}`.trim(),label);button.type='button';button.hidden=true;button.addEventListener('click',()=>{const patch=buildLinePatch(parsed.header,hunk,selected,reverse);if(!patch)return;runWorkspaceAction('apply-patch',{mode,patch},confirmText(selected.size));});return button;};
    const stageLines=staged
      ?makeButton('Unstage lines','', 'unstage',true,(count)=>`Unstage ${count} selected line(s) in ${file.path}?`)
      :makeButton('Stage lines','primary','stage',false,(count)=>`Stage ${count} selected line(s) in ${file.path}?`);
    const discardLines=!staged&&file.status!=='??'?makeButton('Discard lines','danger','discard',true,(count)=>`ทิ้งการแก้ ${count} บรรทัดที่เลือกใน ${file.path}?\nย้อนกลับไม่ได้`):null;
    const clear=el('button','line-stage-clear','Clear');clear.type='button';clear.hidden=true;
    const hint=el('small','line-stage-hint','คลิกบรรทัด +/− เพื่อเลือกเฉพาะบางบรรทัด');
    controls?.append(hint,stageLines,...(discardLines?[discardLines]:[]),clear);
    const update=()=>{const any=selected.size>0;[stageLines,discardLines,clear].forEach(button=>{if(button)button.hidden=!any;});hint.hidden=any;if(any)stageLines.textContent=`${staged?'Unstage':'Stage'} ${selected.size} line${selected.size===1?'':'s'}`;};
    clear.addEventListener('click',()=>{selected.clear();section.querySelectorAll('.line-selected').forEach(row=>row.classList.remove('line-selected'));update();});
    let anchor=null;
    selectableLineIndexes(hunk).forEach((index)=>{
      const row=rows[offset+index];if(!row)return;
      row.classList.add('line-selectable');row.tabIndex=0;row.setAttribute('role','checkbox');row.setAttribute('aria-checked','false');
      const toggle=(event)=>{
        const targets=event.shiftKey&&anchor!==null?selectableLineIndexes(hunk).filter(item=>item>=Math.min(anchor,index)&&item<=Math.max(anchor,index)):[index];
        const turnOn=!selected.has(index);
        targets.forEach(item=>{const target=rows[offset+item];if(!target)return;if(turnOn)selected.add(item);else selected.delete(item);target.classList.toggle('line-selected',turnOn);target.setAttribute('aria-checked',String(turnOn));});
        anchor=index;update();
      };
      row.addEventListener('click',toggle);
      row.addEventListener('keydown',(event)=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();toggle(event);}});
    });
    update();
  });
}
