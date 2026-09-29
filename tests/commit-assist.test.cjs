const assert=require('node:assert/strict');
const {issueKeyFromBranch,applyCommitType,insertIssueKey,commitMessageWarnings}=require('../web/commit-assist.js');

assert.equal(issueKeyFromBranch('feature/ABC-123-login'),'ABC-123');
assert.equal(issueKeyFromBranch('bugfix/PROJ-7'),'PROJ-7');
assert.equal(issueKeyFromBranch('fix/42-crash'),'#42');
assert.equal(issueKeyFromBranch('issue-17'),'#17');
assert.equal(issueKeyFromBranch('main'),'');
assert.equal(issueKeyFromBranch('release/2026'),'','years are not issue numbers without a separator');

assert.equal(applyCommitType('add login','feat'),'feat: add login');
assert.equal(applyCommitType('feat(ui): add login','fix'),'fix: add login');
assert.equal(applyCommitType('fix: add login',''),'add login');

assert.equal(insertIssueKey('feat: add login','ABC-1'),'feat: ABC-1 add login');
assert.equal(insertIssueKey('add login','#4'),'#4 add login');
assert.equal(insertIssueKey('ABC-1 add login','ABC-1'),'ABC-1 add login');

assert.deepEqual(commitMessageWarnings('feat: short'),[]);
assert.equal(commitMessageWarnings('x'.repeat(73)).length,1);
assert.equal(commitMessageWarnings('subject\nbody right away').length,1);
assert.equal(commitMessageWarnings('Ends with period.').length,1);
console.log('PASS: commit helpers parse issue keys, types and message warnings');
