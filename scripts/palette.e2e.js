// End-to-end tests for the command palette, on a throwaway library with
// NEO's real menu: ⌘K (Ctrl+K) opens it near the top, every menu command
// is there with its place and shortcut, typing finds by the starts of
// words, Enter clicks that very menu item, the last used come first, Esc
// puts the caret back, Copy acts on the page, a script's own commands are
// there when a script is open, the menu's language is the palette's, ⌘K
// again closes it, and the shortcuts sheet lists it.
// Run with `npm run test:palette`.

'use strict';

const { app, BrowserWindow, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js)
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-palette-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-palette-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', hintShown: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const C = (mac, other) => (process.platform === 'darwin' ? mac : other);
async function until(cond, ms = 6000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting: ' + cond);
    await tick(40);
  }
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (!modifiers.length || modifiers.every((m) => m === 'shift')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(60);
}
async function type(text) {
  for (const ch of text) await key(ch);
  await tick(80);
}
const isOpen = () => js(`!!document.getElementById('command-palette')`);
// ⌘K as pressed (the menu's accelerator); where a test display has no menu
// bar to take it, the menu item's own message
const byKey = { yes: 0, no: 0 };
async function openPalette() {
  await key('k', [MOD]);
  await tick(200);
  if (!(await isOpen())) { byKey.no++; await js(`togglePalette()`); } else byKey.yes++;
  await until(isOpen);
  await tick(60);
}
const rows = () => js(`[...document.querySelectorAll('#command-palette .pal-item')].map((el) => ({
  name: el.querySelector('.pal-name').firstChild.textContent,
  path: (el.querySelector('.pal-path') || {}).textContent || '',
  key: (el.querySelector('.pal-key') || {}).textContent || '',
  off: el.classList.contains('off'),
  check: el.querySelector('.pal-check').textContent,
  sel: el.getAttribute('aria-selected') === 'true'
}))`);
const toastText = () => js(`$('#hint').textContent`);
async function importAndOpen(file, text) {
  const fp = path.join(tmp, file);
  fs.writeFileSync(fp, text);
  await js(`(async () => {
    document.getElementById('firstrun').hidden = true;
    const results = await window.neo.importFiles([${JSON.stringify(fp)}]);
    await addImportedBooks(results, library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    await openBook(ids[ids.length - 1]);
  })()`);
  await tick(800);
}
// the caret in the page's first line, at a letter
async function caretAt(offset, nth = 0) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const p = body.querySelectorAll('p')[${nth}];
    const r = document.createRange();
    r.setStart(p.firstChild, ${offset});
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('on the shelf: ⌘K opens it near the top, the box ready to type in', async () => {
  assert.equal(await isOpen(), false, 'nothing until it\'s called');
  await openPalette();
  const box = await js(`(() => { const r = document.querySelector('#command-palette .modal').getBoundingClientRect(); return { top: r.top, h: innerHeight, w: r.width }; })()`);
  assert.ok(box.top < box.h * 0.25, 'near the top');
  assert.ok(box.w <= 600, 'narrow');
  assert.equal(await js(`document.activeElement.className`), 'pal-input');
  assert.equal(await js(`document.activeElement.getAttribute('role')`), 'combobox');
});

test('every menu command, with its place and shortcut, and ticks as the menu has them', async () => {
  const all = await rows();
  assert.ok(all.length > 40, `${all.length} commands`);
  const find = (name) => all.find((r) => r.name === name);
  assert.deepEqual(find('Take Snapshot'), { name: 'Take Snapshot', path: 'File', key: C('⌘S', 'Ctrl+S'), off: false, check: '', sel: false });
  assert.equal(find('Goals…').key, C('⌘,', 'Ctrl+,'));
  assert.equal(find('Find & Replace').path, 'Edit');
  assert.equal(find('Paperback for KDP…').path, 'File › Export');
  assert.ok(!all.some((r) => r.name === 'Command Palette…'), 'not itself');
  assert.equal(find('Night').path, 'View › Page');
  assert.equal(find('Night').check, '✓', 'a radio item shows when it\'s chosen');
  assert.equal(find('Paper').check, '');
  assert.equal(find('Undo').key, C('⌘Z', 'Ctrl+Z'), 'a role item\'s own shortcut');
  assert.equal(find('Flush Paragraph').key, C('⇧Enter', 'Shift+Enter'), 'a shortcut written into the label');
  assert.ok(!all.some((r) => r.name === 'Fountain (.fountain)'), 'a script\'s exports only with a script open');
  // the whole name typed comes first: Paper (the page), then Paperback for KDP…
  await type('paper');
  assert.deepEqual((await rows()).slice(0, 2).map((r) => [r.name, r.path]), [['Paper', 'View › Page'], ['Paperback for KDP…', 'File › Export']]);
  await type('zzz');
  assert.equal(await js(`!document.querySelector('#command-palette .pal-empty').hidden`), true, 'says nothing matches');
  await key('Escape');
  assert.equal(await isOpen(), false);
});

test('with a book open: typing finds by the starts of words, Enter runs that menu item (Take Snapshot)', async () => {
  await importAndOpen('tide.md', ['# The Harbor', 'The tide came in over the stones.', 'The gulls rose.', '# Low Water', 'Mud and rope.'].join('\n\n'));
  await openPalette();
  await type('ta sn');
  const r = await rows();
  assert.deepEqual([r[0].name, r[0].off, r[0].sel], ['Take Snapshot', false, true]);
  assert.equal(await js(`document.querySelector('#command-palette .pal-input').getAttribute('aria-activedescendant')`), 'pal-i-0');
  await key('Return');
  assert.equal(await isOpen(), false);
  await until(async () => /Snapshot taken/.test(await toastText()));
  assert.equal(await js(`window.neo.snapshotList(book.id).then((l) => l.length)`), 1);
});

test('nothing typed: the last used come first; ↑ and ↓ move', async () => {
  await openPalette();
  assert.equal((await rows())[0].name, 'Take Snapshot');
  await type('find rep');
  await key('Return');
  await until(() => js(`!$('#searchbar').hidden`));
  await js(`closeSearch()`);
  await openPalette();
  assert.deepEqual((await rows()).slice(0, 2).map((x) => x.name), ['Find & Replace', 'Take Snapshot']);
  await key('Down');
  assert.equal((await rows()).findIndex((x) => x.sel), 1);
  await key('Up');
  await key('Up');
  assert.equal((await rows()).findIndex((x) => x.sel), 0, 'stops at the top');
  await key('Escape');
});

test('Esc puts the caret back where it was, and nothing typed reached the page', async () => {
  await caretAt(4);
  const before = await js(`document.querySelector('.chapter-body').innerHTML`);
  await openPalette();
  await type('xyz');
  await key('Escape');
  assert.equal(await isOpen(), false);
  const after = await js(`({
    html: document.querySelector('.chapter-body').innerHTML,
    inBody: document.activeElement === document.querySelector('.chapter-body'),
    at: getSelection().anchorOffset,
    node: getSelection().anchorNode.textContent.slice(0, 8)
  })`);
  assert.equal(after.html, before);
  assert.equal(after.inBody, true);
  assert.deepEqual([after.at, after.node], [4, 'The tide']);
});

test('Copy from the palette copies what\'s selected on the page', async () => {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const t = body.querySelector('p').firstChild;
    const r = document.createRange();
    r.setStart(t, 4);
    r.setEnd(t, 8);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  clipboard.writeText('nothing yet');
  await openPalette();
  await type('copy');
  assert.deepEqual((await rows())[0], { name: 'Copy', path: 'Edit', key: C('⌘C', 'Ctrl+C'), off: false, check: '', sel: true });
  await key('Return');
  await tick(300);
  assert.equal(clipboard.readText(), 'tide');
});

test('a checkbox command flips, and its tick follows', async () => {
  await openPalette();
  await type('typewriter');
  assert.equal((await rows())[0].check, '');
  await key('Return');
  await until(() => js(`!!library.typewriter`));
  await tick(300);
  await openPalette();
  await type('typewriter');
  assert.equal((await rows())[0].check, '✓');
  await key('Return');
  await until(() => js(`!library.typewriter`));
});

test('in a script: the script\'s own commands, with their keys; a book\'s that don\'t apply are gone', async () => {
  await importAndOpen('low-tide.fountain', ['Title: Low Tide', '', 'INT. HARBOR - NIGHT', '', 'The tide comes in.', '', 'MARA', 'We should go.', ''].join('\n'));
  await until(() => js(`isScript()`));
  await tick(300);
  await caretAt(3, 1); // in the action line
  await openPalette();
  const all = await rows();
  const find = (name) => all.find((r) => r.name === name);
  assert.deepEqual([find('Dialogue').path, find('Dialogue').key], ['Format', C('⌘5', 'Ctrl+5')]);
  assert.equal(find('Fountain (.fountain)').path, 'File › Export');
  assert.ok(find('Underline Scene Headings'));
  for (const gone of ['Flush Paragraph', 'Poetry Paragraph', 'Word (.docx)', 'Other Font…']) assert.equal(find(gone), undefined, gone);
  await type('dialogue');
  await key('Return');
  await until(() => js(`document.querySelectorAll('.chapter-body p')[1].classList.contains('sp-dialogue')`));
  // and back on the shelf, a book's commands again
  await js(`backToShelf()`);
  await until(() => js(`!isScript() || $('#editor-view').hidden`));
  await tick(400);
  await openPalette();
  const shelf = await rows();
  assert.ok(shelf.some((r) => r.name === 'Word (.docx)'));
  assert.ok(!shelf.some((r) => r.name === 'Dialogue'));
  await key('Escape');
});

test('⌘K again closes it; a click outside does too; it never opens over another dialog', async () => {
  await openPalette();
  await key('k', [MOD]);
  await tick(200);
  if (await isOpen()) await js(`togglePalette()`);
  assert.equal(await isOpen(), false);
  await openPalette();
  await js(`document.getElementById('command-palette').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  assert.equal(await isOpen(), false);
  await js(`showHelp()`);
  await tick(200);
  await js(`togglePalette()`);
  await tick(150);
  assert.equal(await isOpen(), false);
});

test('the shortcuts sheet lists it', async () => {
  const text = await js(`document.getElementById('keyboard-shortcuts').textContent`);
  assert.match(text, /Command palette/);
  assert.match(text, new RegExp(C('⌘K', 'Ctrl\\+K')));
  await key('Escape');
});

test('in another language: the menu\'s own words, found without their accents', async () => {
  await openPalette();
  await type('view francais');
  assert.deepEqual((await rows())[0].path, 'View › Language');
  await key('Return');
  // the window reloads in French
  await tick(1500);
  await until(() => js(`typeof library !== 'undefined' && !!library && document.documentElement.lang === 'fr'`).catch(() => false), 10000);
  await tick(400);
  await openPalette();
  await type('annuler');
  const r = (await rows())[0];
  assert.deepEqual([r.name, r.path, r.key], ['Annuler', 'Édition', C('⌘Z', 'Ctrl+Z')]);
  await key('Escape');
  await openPalette();
  await type('edition');
  assert.ok((await rows()).some((x) => x.name === 'Annuler' && x.path === 'Édition'), 'a place found without its accent');
  await key('Escape');
  let errors = '';
  try { errors = fs.readFileSync(path.join(LIB, 'neo-errors.log'), 'utf8'); } catch { /* none */ }
  assert.equal(errors, '');
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(400);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.stack || err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`     (⌘K as pressed opened it ${byKey.yes} of ${byKey.yes + byKey.no} times)`);
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
