// Isolated source-level reproductions, not browser or React integration tests.
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (pr, file) => execFileSync('git', ['-C', 'zedu-fe', 'show', `refs/review/${pr}:${file}`], {encoding:'utf8'});
const unread = source(1244, 'src/app/(client)/[org]/_components/ChannelMessage/index.tsx');
const effect = unread.match(/\/\/ Set unread divider position after messages load\s+useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[messages\]\);/)[1];
for (const count of [50, 51]) {
  let divider = null;
  vm.runInNewContext(effect, { messages: Array.from({length:50}, (_,i)=>({thread_id:String(i)})), unreadCountRef:{current:count}, setUnreadDividerId:v=>{divider=v;} });
  assert.equal(divider, null);
  console.log(`#1244: ${count} unread / 50 loaded -> no divider or scroll target (bug reproduced)`);
}
const landing = source(1241, 'src/app/(client)/[org]/page.tsx');
const redirect = landing.match(/useEffect\(\(\) => \{(\s+if \(!isLargeScreen[\s\S]*?)\n  \}, \[defaultChannel/)[1];
assert.match(landing, /\[windowWidth, setWindowWidth\] = useState\(0\)/);
const redirects = [];
vm.runInNewContext(redirect, {isLargeScreen:false, defaultChannel:{channels_id:'general'}, state:{orgSlug:'demo'}, router:{replace:url=>redirects.push(url)}});
assert.deepEqual(redirects, ['/demo/home/channels/general']);
console.log('#1241: initial render width=0 with cached channels triggers redirect before desktop width is committed');
const snapshot = path.join(__dirname,'open-prs','1242','test-snapshot');
for (const file of ['tests/issue352-profile-phone.test.cjs','src/app/(client)/[org]/_components/edit-profile-modal/index.tsx']) {
  const target = path.join(snapshot,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,source(1242,file));
}
process.stdout.write(execFileSync(process.execPath,['--test',path.join(snapshot,'tests/issue352-profile-phone.test.cjs')],{encoding:'utf8'}));
