'use strict';
// Commit message helpers: Conventional Commit type, issue key from the branch
// name, subject length guide and an optional AI suggestion.
const commitTypes=['feat','fix','docs','style','refactor','perf','test','build','ci','chore','revert'];
const conventionalPrefix=/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?:\s*/;

function issueKeyFromBranch(branch=''){
  const jira=String(branch).match(/(?:^|[/_-])([A-Z][A-Z0-9]{1,9}-\d{1,7})(?=$|[/_-])/);if(jira)return jira[1];
  // Numbers need an explicit prefix (issue-17) or a following slug (42-crash); release/2026 is not an issue.
  const number=String(branch).match(/(?:^|\/)(?:issue|gh)-(\d{1,7})(?=$|[-_])|(?:^|\/)#?(\d{1,7})[-_]/i);if(number)return `#${number[1]||number[2]}`;
  return '';
}
function applyCommitType(message,type){const rest=message.replace(conventionalPrefix,'');return type?`${type}: ${rest}`:rest;}
function insertIssueKey(message,key){if(!key||message.includes(key))return message;const match=message.match(conventionalPrefix);if(match)return `${match[0]}${key} ${message.slice(match[0].length)}`;return `${key} ${message}`;}
function commitMessageWarnings(message){
  // Node tests load this file without web/i18n.js.
  const t=typeof globalThis.t==='function'?globalThis.t:(text,vars={})=>text.replace(/\{(\w+)\}/g,(match,key)=>key in vars?vars[key]:match);
  const lines=String(message).split(/\r?\n/);const warnings=[];if(lines[0].length>72)warnings.push(t('Subject is {length} characters; keep it at 72 or fewer.',{length:lines[0].length}));if(lines.length>1&&lines[1].trim())warnings.push(t('Leave the second line blank between subject and body.'));if(/\.\s*$/.test(lines[0]))warnings.push(t('Subjects usually do not end with a period.'));return warnings;
}

if(typeof module!=='undefined')module.exports={issueKeyFromBranch,applyCommitType,insertIssueKey,commitMessageWarnings};

if(typeof window!=='undefined'&&typeof renderChangesView==='function'){
  let aiConsent=false;
  const baseChanges=renderChangesView;
  renderChangesView=function(content,data){
    baseChanges(content,data);
    try{enhanceCommitComposer(content,data);}catch(error){console.warn('Commit helpers unavailable',error);}
  };
  function enhanceCommitComposer(content,data){
    const form=content.querySelector('.commit-composer');const message=form?.querySelector('textarea');if(!message)return;
    const bar=el('div','commit-assist');
    const type=document.createElement('select');type.setAttribute('aria-label',t('Conventional commit type'));type.append(new Option(t('Type…'),''),...commitTypes.map(item=>new Option(item,item)));
    const current=message.value.match(conventionalPrefix);if(current)type.value=current[1];
    const changed=()=>message.dispatchEvent(new Event('input',{bubbles:true}));
    type.addEventListener('change',()=>{message.value=applyCommitType(message.value,type.value);changed();message.focus();});
    bar.append(type);
    const key=issueKeyFromBranch(data.branch||'');
    if(key){const issue=el('button','',`+ ${key}`);issue.type='button';issue.title=t('Insert {key} from branch {branch}',{key,branch:data.branch});issue.addEventListener('click',()=>{message.value=insertIssueKey(message.value,key);changed();message.focus();});bar.append(issue);}
    const ai=el('button','commit-ai',t('✨ Suggest'));ai.type='button';ai.title=t('Draft a commit message from the staged diff');ai.disabled=!data.files.some(file=>file.staged);
    ai.addEventListener('click',()=>suggestCommitMessage(message,type,ai,changed));
    bar.append(ai);
    const meter=el('small','commit-meter');
    const warn=el('small','commit-warnings');
    const update=()=>{const subject=message.value.split(/\r?\n/)[0];meter.textContent=`${subject.length}/72`;meter.classList.toggle('over',subject.length>72);const warnings=commitMessageWarnings(message.value);warn.textContent=warnings.join(' ');warn.hidden=!warnings.length||!message.value.trim();};
    message.addEventListener('input',update);update();
    bar.append(meter);
    const editor=form.querySelector('.commit-editor')||message.parentElement;editor.prepend(bar);editor.append(warn);
  }
  async function suggestCommitMessage(message,type,button,changed){
    let status;try{status=(await api('/api/ai/status')).ai;}catch(error){setNotice(error.message);return;}
    if(!status.ready){setNotice(status.hint||t('AI provider is not configured.'));setOutput(status.hint||t('AI provider is not configured.'),{expand:true});return;}
    if(!aiConsent){const where=status.provider==='ollama'?t('Ollama ({model}) on this computer',{model:status.model}):`Anthropic (${status.model})`;if(!confirm(t('Send the staged diff to {where} to draft a commit message?\n\nGit Deck will not send it if it finds anything that looks like a secret or token.',{where})))return;aiConsent=true;}
    const label=button.textContent;button.disabled=true;button.textContent=t('Drafting…');
    try{
      const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'ai-commit-message',path:state.workspaceRepo.path,style:(type.value||conventionalPrefix.test(message.value))?'conventional':'plain'})});
      if(message.isConnected){message.value=result.message;changed();message.focus();const match=result.message.match(conventionalPrefix);type.value=match?match[1]:'';}
      setNotice(result.note||t('Draft ready — review it before committing.'));
    }catch(error){setNotice(error.message);setOutput(error.message,{expand:true,status:'error'});}
    finally{button.disabled=false;button.textContent=label;}
  }
}
