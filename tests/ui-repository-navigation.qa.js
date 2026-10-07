// Owned synthetic package only; navigation and local filtering, no Git mutations.
async page => {
  if(!page.url().startsWith('http://127.0.0.1:12507/'))throw new Error('Owned fixture required');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1487,height:1058});
  await page.getByRole('button',{name:'All repos',exact:true}).click();
  const panel=page.locator('[data-operations-panel="fleet"]'),nav=page.locator('.operations-tabs');
  await panel.waitFor({state:'visible'});
  const inventory=nav.getByRole('button',{name:'All repositories',exact:true});
  if(!await inventory.isVisible()||!await inventory.evaluate(node=>node.parentElement.classList.contains('cockpit-primary')&&node.classList.contains('active')))throw new Error('Inventory is not a visible primary destination');
  if(await page.locator('#fleet-filter').inputValue()!=='all')throw new Error('Inventory did not default to all');
  if(await panel.locator('section.fleet-row').count()!==3)throw new Error('Missing synthetic repositories');
  const aligned=await panel.locator('#fleet-table').evaluate(table=>{
    const header=table.querySelector('.fleet-head').getBoundingClientRect(),row=table.querySelector('section.fleet-row').getBoundingClientRect();
    const name=table.querySelector('section.fleet-row strong').getBoundingClientRect();
    return {overlap:Math.max(0,Math.min(header.bottom,row.bottom)-Math.max(header.top,row.top)),nameVisible:name.top>=header.bottom-1};
  });
  if(aligned.overlap>1||!aligned.nameVisible)throw new Error('Header still overlaps first repository');
  await page.screenshot({path:'output/playwright/40-all-repositories-desktop.png'});
  const search=nav.getByRole('searchbox',{name:'Find dashboard tool'});
  for(const term of ['all repos','all repositories','repository health']){
    await search.fill(term);if(!await inventory.isVisible())throw new Error('Missing search alias: '+term);
    await search.press('Enter');await panel.waitFor({state:'visible'});
  }
  await search.fill('capsule');await page.getByRole('button',{name:'All repos',exact:true}).click();
  await inventory.waitFor({state:'visible'});
  if(await search.inputValue()!==''||await inventory.getAttribute('aria-current')!=='page')throw new Error('External navigation left current inventory hidden');
  await search.fill('no-such-tool');await nav.getByRole('status').waitFor({state:'visible'});
  await search.fill('');if(!await inventory.isVisible()||await nav.getByRole('status').isVisible())throw new Error('Search did not recover');
  await inventory.focus();await inventory.press('ArrowDown');
  if(!await nav.getByRole('button',{name:'My work',exact:true}).evaluate(node=>node===document.activeElement))throw new Error('Keyboard navigation failed');
  const map=await page.evaluate(()=>({tabs:[...document.querySelectorAll('.operations-tabs [data-operations-view]')].map(n=>n.dataset.operationsView),panels:[...document.querySelectorAll('[data-operations-panel]')].map(n=>n.dataset.operationsPanel)}));
  if(map.tabs.length!==22||new Set(map.tabs).size!==22||map.panels.some(id=>!map.tabs.includes(id)))throw new Error('Orphaned dashboard view');
  await page.locator('#fleet-search').fill('deployment-configuration');if(await panel.locator('section.fleet-row').count()!==1)throw new Error('Inventory name filter failed');await page.locator('#fleet-search').fill('');
  await page.evaluate(()=>{GitDeckAppearance.setTextSize(16);document.body.classList.add('theme-dark');});
  const cramped=await panel.locator('.fleet-head').evaluate(header=>[...header.children].slice(0,-1).some(cell=>{const range=document.createRange();range.selectNodeContents(cell);return range.getBoundingClientRect().right>cell.nextElementSibling.getBoundingClientRect().left-4;}));
  if(cramped)throw new Error('Table headers collide at 16px');
  await page.screenshot({path:'output/playwright/41-all-repositories-dark-large.png'});
  await page.setViewportSize({width:700,height:800});
  await page.getByRole('combobox',{name:'Dashboard view'}).selectOption('fleet');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Document overflow at narrow viewport');
  if(await panel.locator('#fleet-table').evaluate(node=>node.scrollWidth<=node.clientWidth))throw new Error('Wide columns have no local scroll');
  await page.screenshot({path:'output/playwright/42-all-repositories-narrow.png'});
  await page.setViewportSize({width:1487,height:1058});await page.evaluate(()=>{GitDeckAppearance.setTextSize(13);document.body.classList.remove('theme-dark');});
  if(errors.length)throw new Error('Browser exception: '+errors.join('; '));
  return {railDestination:'fleet',primaryInventory:true,searchAliases:true,noOrphanedViews:true,headerOverlap:aligned.overlap,keyboard:true,filter:true,narrowLocalScroll:true,consoleErrors:errors.length,fixtureOnly:true};
}
