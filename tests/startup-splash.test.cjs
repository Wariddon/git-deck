const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'web/startup.js'),'utf8');
function setup(){
  const elements={};for(const id of ['startup-splash','startup-status','startup-actions','startup-reload','startup-continue'])elements[id]={hidden:true,textContent:'',events:{},addEventListener(type,fn){this.events[type]=fn;},showModal(){this.open=true;},close(){this.open=false;this.closes=(this.closes||0)+1;}};
  let timeout,cleared=false,reloads=0;
  const context={window:{},document:{getElementById:id=>elements[id]},location:{reload(){reloads++;}},setTimeout(fn,ms){assert.equal(ms,12000);timeout=fn;return 1;},clearTimeout(){cleared=true;}};
  vm.runInNewContext(script,context);
  return {elements,api:context.window.GitDeckStartup,timeout:()=>timeout(),cleared:()=>cleared,reloads:()=>reloads};
}
const ready=setup();assert(ready.elements['startup-splash'].open);ready.api.update('Loading saved repositories…');assert.equal(ready.elements['startup-status'].textContent,'Loading saved repositories…');ready.api.finish();ready.api.finish();assert.equal(ready.elements['startup-splash'].closes,1);assert(ready.cleared());ready.api.update('Fetching…');assert.equal(ready.elements['startup-status'].textContent,'Loading saved repositories…');ready.timeout();assert(ready.elements['startup-actions'].hidden);
const slow=setup();slow.timeout();assert.equal(slow.elements['startup-actions'].hidden,false);slow.elements['startup-reload'].onclick();assert.equal(slow.reloads(),1);slow.elements['startup-continue'].onclick();assert.equal(slow.elements['startup-splash'].open,false);
const escape=setup();let prevented=false;escape.elements['startup-splash'].events.cancel({preventDefault(){prevented=true;}});assert(prevented);assert.equal(escape.elements['startup-splash'].open,false);
const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');assert.match(app,/finally\{state.initializing=false;window.GitDeckStartup\?\.finish\(\);\}/);assert(html.indexOf('id="startup-controller"')<html.indexOf('src="/app.js"'));assert.match(fs.readFileSync(path.join(root,'web/startup.css'),'utf8'),/prefers-reduced-motion:reduce/);
// Release packaging copies every flat web/*.js|css file and the server serves them via the generic static fallback.
const release=fs.readFileSync(path.join(root,'Build-Release.ps1'),'utf8'),server=fs.readFileSync(path.join(root,'git-dashboard-server.ps1'),'utf8');assert.match(server,/Write-GitDeckStatic \$context \$route/);
for(const file of ['startup.js','startup.css']){assert(html.includes('/'+file));assert(fs.existsSync(path.join(root,'web',file)));assert(release.includes("'"+path.extname(file)+"'"));}
console.log('PASS: startup logo, status, completion, slow-load recovery, Escape and no reopening');
// Splash is a brand card with the logo and the name (like Sourcetree); title and status stay for screen readers.
const splashCss=fs.readFileSync(path.join(root,'web/startup.css'),'utf8');
assert.match(html,/<div class="startup-card" aria-hidden="true"><img [^>]*><span class="startup-wordmark">Git Deck<\/span><\/div>/);
assert.match(splashCss,/\.startup-card \{[^}]*background:var\(--brand\)/);
// The whole window is brand green: no light page around the logo (user screenshot), and no white flash first.
assert.match(splashCss,/#startup-splash \{ --brand:#0b6e47;[^}]*background:var\(--brand\);/);
assert(!/box-shadow/.test(splashCss),'No card edge or shadow: only the logo and the name');
assert.match(html,/<html lang="en" style="background:#0b6e47">/);
assert.match(script,/document\.documentElement\.style\.background=''/,'The app gets its own background back after loading');
assert(!html.includes('startup-spinner'),'No spinner: the card alone, like Sourcetree');
// GitDeck.exe paints the same card natively until the app window appears.
const launcher=fs.readFileSync(path.join(root,'launcher/GitDeckLauncher.cs'),'utf8');
assert.match(launcher,/class SplashForm : Form/);assert.match(launcher,/Color\.FromArgb\(0x0B, 0x6E, 0x47\)/,'Same green as --brand');
assert.match(splashCss,/--brand:#0b6e47/);
assert.match(html,/<h1 id="startup-title" class="startup-sr">/);assert.match(html,/<p id="startup-status" class="startup-sr" role="status"/);
assert.match(splashCss,/\.startup-sr \{ position:absolute; width:1px; height:1px;/);
assert.match(script,/splash\.dataset\.theme=theme==='system'/,'splash uses the saved theme from the first frame');
console.log('PASS: splash card (logo + name) in the saved theme');
