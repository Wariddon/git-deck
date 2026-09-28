const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {diffRows,diffPairs,changedFragment}=require('../web/diff-ui.js');
const rows=diffRows('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -7,3 +7,3 @@\n same\n-old value\n+new value\n last\n@@ -30 +30 @@\n-a\n+b');
assert.equal(rows[4].left,7);assert.equal(rows[4].right,7);assert.equal(rows[5].left,8);assert.equal(rows[6].right,8);assert.equal(rows[9].hunk,2);
const pairs=diffPairs(rows);assert(pairs.some(([a,b])=>a?.line==='-old value'&&b?.line==='+new value'));assert.deepEqual(changedFragment('old value','new value'),{start:0,end:3});
assert.equal(diffPairs(diffRows('@@ -0,0 +1,2 @@\n+a\n+b')).length,3);
assert.equal(diffRows('@@ -1 +1 @@\n---text\n+++text')[1].kind,'remove');
assert.equal(diffRows('@@ -1 +1 @@\n---text\n+++text')[2].kind,'add');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/diff-ui.js'),'utf8');
function node(tag,cls,text){return {tag,cls,text,children:[],append(...items){this.children.push(...items)}}}
const ctx=vm.createContext({el:node,document:{createTextNode:text=>node('text','',text)}});
vm.runInContext(source.slice(source.indexOf('function safeMarkdownPreview('),source.indexOf('function enhancedDiffViewer(')),ctx);
const preview=ctx.safeMarkdownPreview('# Safe\n<script>alert(1)</script>\n![x](https://private.invalid/a)\n[link](javascript:alert(1))\n```html\n<img src=x onerror=alert(1)>\n```');
const all=n=>[n,...n.children.flatMap(all)];assert(!all(preview).some(n=>['script','img','iframe','a'].includes(n.tag)));assert(all(preview).some(n=>n.text?.includes('<script>')));
assert(!source.includes('innerHTML'));assert(source.includes('data-hunk'));assert(!source.includes('lines.filter'));
console.log('PASS: line numbers, change pairing, intraline ranges, added files and inert Markdown preview');
