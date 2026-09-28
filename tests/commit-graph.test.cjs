const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const make=(fullHash,parents=[])=>({fullHash,parents});
const element=()=>({attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v},append(n){this.children.push(n)}});
const context={el:element,document:{createElementNS:element,querySelector:()=>null}};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function buildCommitGraph('),source.indexOf('function diffLineKind(')),context);
const plain=x=>JSON.parse(JSON.stringify(x));
function verify(history){
 const rows=context.buildCommitGraph(history);
 rows.forEach((row,i)=>{
  if(i){assert.deepEqual(plain(row.before),plain(rows[i-1].after));assert.deepEqual(plain(row.beforeColors),plain(rows[i-1].afterColors));}
  assert.equal(new Set(row.after).size,row.after.length);
  for(const parent of row.parents)assert(row.after.includes(parent));
  const graph=context.renderGraphCell(row,i),svg=graph.children[0];
  assert.equal(svg.children.filter(n=>n.attributes.d).length,row.before.length+row.parents.length);
  assert.equal(svg.attributes.viewBox,`0 0 ${row.graphWidth} 28`);
 });return rows;
}
verify([make('a',['b']),make('b',['c']),make('c')]);
verify([make('merge',['left','right']),make('left',['root']),make('right',['root']),make('root')]);
verify([make('merge',['left','right']),make('right',['root']),make('left',['root']),make('root')]);
verify([make('a',['root']),make('unrelated',['other']),make('root'),make('other')]);
const parents=Array.from({length:12},(_,i)=>'branch'+i);
const wide=verify([make('octopus',parents),...parents.map(p=>make(p,['root'])),make('root')]);
assert(wide[0].graphWidth>82);assert.equal(wide[0].after.length,12);
assert(wide.every(row=>row.graphWidth===wide[0].graphWidth));
const svg=context.renderGraphCell(wide[0],0).children[0];
assert(svg.children.some(n=>/152 28/.test(n.attributes.d||'')),'Lane 11 must not be clamped');
console.log('PASS: lane continuity, unrelated tips, shared parents, alternate orders, 12 lanes and SVG edges');
