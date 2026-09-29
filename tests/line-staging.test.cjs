const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {buildLinePatch,selectableLineIndexes}=require('../web/line-staging.js');

function splitPatchHunks(diff){const lines=diff.split(/\r?\n/);const first=lines.findIndex((line)=>line.startsWith('@@'));const header=lines.slice(0,first);const hunks=[];let current=[];for(const line of lines.slice(first)){if(line.startsWith('@@')&&current.length){hunks.push(current);current=[];}current.push(line);}if(current.length)hunks.push(current);return {header,hunks};}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'git-deck-lines-'));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
const apply=(patch,...flags)=>{const file=path.join(root,'..',path.basename(root)+'.patch');fs.writeFileSync(file,patch);try{git('apply','--recount','--whitespace=nowarn',...flags,file);}finally{fs.rmSync(file,{force:true});}};
try{
  git('init','-q','-b','main');git('config','user.email','t@example.invalid');git('config','user.name','T');git('config','commit.gpgsign','false');git('config','core.autocrlf','false');
  fs.writeFileSync(path.join(root,'f.txt'),'one\ntwo\nthree\nfour\n');git('add','.');git('commit','-qm','base');
  fs.writeFileSync(path.join(root,'f.txt'),'one\nTWO\nthree\nextra\nfour\n');
  // Stage only the "+extra" line: "-two" stays as context and "+TWO" is dropped.
  let parsed=splitPatchHunks(git('diff','--no-color','f.txt'));
  let hunk=parsed.hunks[0];
  const extra=hunk.findIndex(line=>line==='+extra');
  assert.ok(selectableLineIndexes(hunk).includes(extra));
  apply(buildLinePatch(parsed.header,hunk,new Set([extra]),false),'--cached');
  assert.equal(git('show',':f.txt'),'one\ntwo\nthree\nextra\nfour\n');
  assert.equal(fs.readFileSync(path.join(root,'f.txt'),'utf8'),'one\nTWO\nthree\nextra\nfour\n','working tree untouched');
  // Stage the "-two" removal without its replacement.
  parsed=splitPatchHunks(git('diff','--no-color','f.txt'));hunk=parsed.hunks[0];
  apply(buildLinePatch(parsed.header,hunk,new Set([hunk.indexOf('-two')]),false),'--cached');
  assert.equal(git('show',':f.txt'),'one\nthree\nextra\nfour\n');
  // Unstage just the "+extra" line (reverse against the index).
  parsed=splitPatchHunks(git('diff','--cached','--no-color','f.txt'));hunk=parsed.hunks[0];
  apply(buildLinePatch(parsed.header,hunk,new Set([hunk.indexOf('+extra')]),true),'--cached','--reverse');
  assert.equal(git('show',':f.txt'),'one\nthree\nfour\n');
  // Discard only "+TWO" from the working tree.
  parsed=splitPatchHunks(git('diff','--no-color','f.txt'));hunk=parsed.hunks[0];
  apply(buildLinePatch(parsed.header,hunk,new Set([hunk.indexOf('+TWO')]),true),'--reverse');
  assert.equal(fs.readFileSync(path.join(root,'f.txt'),'utf8'),'one\nthree\nextra\nfour\n');
  // Nothing selected produces no patch.
  assert.equal(buildLinePatch(parsed.header,hunk,new Set(),false),null);
  console.log('PASS: line staging patches apply with git for stage, unstage and discard');
}finally{fs.rmSync(root,{recursive:true,force:true});}
