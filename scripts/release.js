#!/usr/bin/env node
'use strict';

// npm run release            → the next version (1.0.0-beta.1 becomes
//                              1.0.0-beta.2; 1.3.4 becomes 1.3.5, and
//                              after x.y.9 comes x.(y+1).0)
// npm run release -- 1.0.0   → that version (a beta like 1.1.0-beta.1 too)
//
// Sets the version in package.json and package-lock.json, commits it, pushes
// main, then pushes the tag that starts GitHub's build. Stops with a plain
// sentence (and changes nothing) when something isn't right.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitLoud = (...args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });
const stop = (msg) => { console.error('\n✋ ' + msg + '\n'); process.exit(1); };
const say = (msg) => console.log('→ ' + msg);

// 1. on main, with nothing half-done
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') stop(`You're on "${branch}", not main. Type: git checkout main   then try again.`);
const changed = git('status', '--porcelain', '--untracked-files=no');
if (changed) stop('Some NEO files have changes that aren\'t committed yet:\n' + changed + '\nAsk Claude what to do with them before releasing.');

// 2. up to date with GitHub
say('Getting the latest from GitHub…');
try { git('pull', '--ff-only'); } catch { stop('Couldn\'t get the latest from GitHub cleanly. Ask Claude to take a look.'); }

// 3. the version
const pkgFile = path.join(root, 'package.json');
const lockFile = path.join(root, 'package-lock.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const current = pkg.version;
const asked = process.argv[2];
let next;
if (asked) {
  next = asked.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(next)) stop(`"${asked}" isn't a version number. Use three numbers, like 1.3.0, or a beta, like 1.3.0-beta.1.`);
} else if (!git('ls-remote', '--tags', 'origin', 'v' + current)) {
  // this version was set but never released (a release that stopped
  // halfway): finish it rather than skip a number
  next = current;
} else if (/-beta\.\d+$/.test(current)) {
  // a beta goes to the next beta; say the number to leave beta (npm run release -- 1.0.0)
  next = current.replace(/\d+$/, (n) => String(Number(n) + 1));
} else {
  // the last number stays a single digit: after x.y.9 comes x.(y+1).0
  const [a, b, c] = current.split('.').map(Number);
  next = c >= 9 ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
const tag = 'v' + next;
// newer, betas included: 1.0.0-beta.2 > 1.0.0-beta.1, and 1.0.0 > any 1.0.0 beta
const newer = (x, y) => {
  const sp = (v) => { const [core, pre] = v.split('-'); return { c: core.split('.').map(Number), b: pre ? Number(pre.split('.')[1]) : Infinity }; };
  const p = sp(x), q = sp(y);
  for (let i = 0; i < 3; i++) if (p.c[i] !== q.c[i]) return p.c[i] > q.c[i];
  return p.b > q.b;
};
// the version may already be set (a release that stopped halfway): carry on from there
const alreadySet = current === next;
if (!alreadySet && !newer(next, current)) stop(`${next} isn't newer than ${current}. NEO's updater would never offer it.`);
if (git('ls-remote', '--tags', 'origin', tag)) stop(`${tag} already exists on GitHub. To release again, run:  npm run release   (it picks the next number).`);

// 4. what's in it, since the last release
let notes = '';
try {
  const last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  notes = git('log', '--no-merges', '--format=• %s', `${last}..HEAD`)
    .split('\n').filter((l) => l && !/^• \d+\.\d+\.\d+(-beta\.\d+)?$/.test(l)).join('\n');
} catch { /* first release, or a shallow copy */ }

// 5. set it, commit, push
if (!alreadySet) {
  say(`Setting the version to ${next}…`);
  pkg.version = next;
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.version = next;
    if (lock.packages && lock.packages['']) lock.packages[''].version = next;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  }
  git('add', 'package.json', 'package-lock.json');
  git('commit', '-m', next);
}
say('Sending it to GitHub…');
gitLoud('push', 'origin', 'main');
say(`Starting the ${next} build…`);
git('tag', tag);
gitLoud('push', 'origin', tag);

console.log(`
✅ ${next} is building. In about 15 minutes:
   1. Open https://github.com/mayhemrw/neo-scribe/releases
   2. Open the ${tag} draft, check the Windows file is NEO-Scribe-Setup-${next}.exe
   3. Press Publish. Everyone's NEO Scribe on Windows updates itself from there
      (an unsigned Mac build can't update itself: Mac testers download it again).
${notes ? `\nWhat's in it (a start for the release notes):\n${notes}\n` : ''}`);
