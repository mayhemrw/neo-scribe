'use strict';

// The command palette's parts that don't need a window: how a command is
// matched and ordered (app.js, COMMAND PALETTE) and how the menu is walked
// into commands with their shortcuts (main.js). The palette itself, on
// NEO's real menu, is in palette.e2e.js (npm run test:palette).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const slice = (file, from, to) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${file}: ${from} … ${to}`);
  return src.slice(a, b);
};
const plain = (x) => JSON.parse(JSON.stringify(x));

const win = vm.createContext({});
vm.runInContext(slice('app.js', '// a string\'s words without accents', '// the last few used, on this computer'), win);
vm.runInContext('this.api = { paletteScore, paletteFilter, paletteId, paletteWords };', win);
const { paletteScore, paletteId } = win.api;
const filter = (...a) => plain(win.api.paletteFilter(...a)).map((x) => x.label);

const main = vm.createContext({ Menu: { getApplicationMenu: () => null }, process: { platform: 'linux' } });
vm.runInContext(slice('main.js', 'const ACCEL_MAC', '// One command chosen'), main);
vm.runInContext('this.api = { accelText, paletteItems };', main);
const { accelText } = main.api;
const paletteItems = (...a) => plain(main.api.paletteItems(...a));

const C = (label, path = [], extra = {}) => ({ label, path, enabled: true, ...extra });
const ITEMS = [
  C('Paperback for KDP…', ['File', 'Export']),
  C('Take Snapshot', ['File']),
  C('Undo', ['Edit']),
  C('Find & Replace', ['Edit']),
  C('Spellcheck Pass', ['Edit'], { enabled: false }),
  C('Spellcheck Language Notes', ['Help']),
  C('Paragraph', ['View', 'Focus Mode']),
  C('Café Lights', ['Format'])
];

test('words: typed words start words of the name first, then of its place, then anywhere', () => {
  assert.deepEqual(filter(ITEMS, 'spell pa'), ['Spellcheck Pass'], 'only the one whose words both start');
  assert.deepEqual(filter(ITEMS, 'spell'), ['Spellcheck Language Notes', 'Spellcheck Pass'], 'the greyed one after');
  // a word of the place: "focus par" is Paragraph under Focus Mode
  assert.deepEqual(filter(ITEMS, 'focus par'), ['Paragraph']);
  // the name's own words before its place's
  assert.deepEqual(filter(ITEMS, 'export'), ['Paperback for KDP…']);
  assert.ok(paletteScore(ITEMS[0], 'kdp') < paletteScore(ITEMS[0], 'export'));
  // inside a word, last
  assert.deepEqual(filter(ITEMS, 'napshot'), ['Take Snapshot']);
  // nothing found, nothing listed
  assert.deepEqual(filter(ITEMS, 'zebra'), []);
  assert.equal(paletteScore(ITEMS[2], 'undo zebra'), null);
});

test('words in order before out of order; a name matched further in after', () => {
  assert.ok(paletteScore(C('Take Snapshot'), 'take snap') < paletteScore(C('Take Snapshot'), 'snap take'));
  assert.ok(paletteScore(C('Snapshot Notes'), 'snap') < paletteScore(C('Take Snapshot'), 'snap'));
});

test('accents and case don\'t matter', () => {
  assert.deepEqual(filter(ITEMS, 'CAFE'), ['Café Lights']);
  assert.deepEqual(filter(ITEMS, 'café l'), ['Café Lights']);
});

test('nothing typed: the last used first, then the menu in order', () => {
  const recent = [paletteId(ITEMS[3]), 'Gone › Not In The Menu', paletteId(ITEMS[1])];
  assert.deepEqual(filter(ITEMS, '', recent).slice(0, 4), ['Find & Replace', 'Take Snapshot', 'Paperback for KDP…', 'Undo']);
  assert.equal(filter(ITEMS, '  ', recent).length, ITEMS.length);
  assert.equal(paletteId(ITEMS[0]), 'File › Export › Paperback for KDP…');
});

test('the whole name typed comes first, whatever the menu\'s order', () => {
  const items = [C('Paperback for KDP…', ['File', 'Export']), C('Paper', ['View', 'Page']), C('Night', ['View', 'Page'])];
  assert.deepEqual(filter(items, 'paper'), ['Paper', 'Paperback for KDP…']);
  assert.deepEqual(filter(items, 'PAPER '), ['Paper', 'Paperback for KDP…']);
  assert.deepEqual(filter(items, 'paper kdp'), ['Paperback for KDP…']);
});

test('shortcuts as each platform shows them', () => {
  assert.equal(accelText('CmdOrCtrl+Shift+T', 'darwin'), '⇧⌘T');
  assert.equal(accelText('CmdOrCtrl+Shift+T', 'win32'), 'Ctrl+Shift+T');
  assert.equal(accelText('CmdOrCtrl+Alt+Right', 'darwin'), '⌥⌘→');
  assert.equal(accelText('CmdOrCtrl+Alt+Right', 'linux'), 'Ctrl+Alt+→');
  assert.equal(accelText('CmdOrCtrl-Plus', 'win32'), 'Ctrl++');
  assert.equal(accelText('CmdOrCtrl-Minus', 'darwin'), '⌘−');
  assert.equal(accelText('CmdOrCtrl+,', 'linux'), 'Ctrl+,');
  assert.equal(accelText('CmdOrCtrl+/', 'darwin'), '⌘/');
  assert.equal(accelText('Shift+CmdOrCtrl+Z', 'darwin'), '⇧⌘Z');
  assert.equal(accelText('', 'linux'), '');
  assert.equal(accelText(undefined, 'linux'), '');
});

test('the menu walked: commands with their place, what the menu hides or greys', () => {
  const item = (o) => ({ type: 'normal', visible: true, enabled: true, ...o });
  const sub = (label, items, o = {}) => item({ label, submenu: { items }, ...o });
  const menu = {
    items: [
      sub('NEO', [
        item({ label: 'About NEO', role: 'about' }),
        item({ label: 'Services', role: 'services' })
      ]),
      sub('File', [
        item({ label: 'Email Draft to Myself', accelerator: 'CmdOrCtrl+E' }),
        item({ type: 'separator' }),
        sub('New Books Open To', [
          item({ label: 'Blank Page', type: 'radio', checked: true }),
          item({ label: 'Outline First', type: 'radio', checked: false })
        ]),
        sub('Greyed', [item({ label: 'Hidden inside' })], { enabled: false }),
        item({ label: 'Take Snapshot', accelerator: 'CmdOrCtrl+S', registerAccelerator: false })
      ]),
      sub('Edit', [
        item({ label: 'Undo', role: 'undo', getDefaultRoleAccelerator: () => 'CommandOrControl+Z' }),
        item({ label: 'Find && Replace', accelerator: 'CmdOrCtrl+F' })
      ]),
      sub('Format', [
        item({ label: 'Body Font', visible: false, submenu: { items: [item({ label: 'Georgia' })] } }),
        item({ label: 'Flush Paragraph\tShift+Enter', type: 'checkbox', checked: false }),
        item({ label: 'Dialogue\tCtrl+5', type: 'radio', checked: true })
      ]),
      sub('View', [
        item({ id: 'palette', label: 'Command Palette…', accelerator: 'CmdOrCtrl+K' }),
        item({ label: 'Vim Keys', type: 'checkbox', checked: true, enabled: false })
      ])
    ]
  };
  assert.deepEqual(paletteItems(menu, 'win32'), [
    { key: '0.0', label: 'About NEO', path: ['NEO'], shortcut: '', enabled: true, checked: null },
    { key: '1.0', label: 'Email Draft to Myself', path: ['File'], shortcut: 'Ctrl+E', enabled: true, checked: null },
    { key: '1.2.0', label: 'Blank Page', path: ['File', 'New Books Open To'], shortcut: '', enabled: true, checked: true },
    { key: '1.2.1', label: 'Outline First', path: ['File', 'New Books Open To'], shortcut: '', enabled: true, checked: false },
    { key: '1.4', label: 'Take Snapshot', path: ['File'], shortcut: 'Ctrl+S', enabled: true, checked: null },
    { key: '2.0', label: 'Undo', path: ['Edit'], shortcut: 'Ctrl+Z', enabled: true, checked: null },
    { key: '2.1', label: 'Find & Replace', path: ['Edit'], shortcut: 'Ctrl+F', enabled: true, checked: null },
    { key: '3.1', label: 'Flush Paragraph', path: ['Format'], shortcut: 'Shift+Enter', enabled: true, checked: false },
    { key: '3.2', label: 'Dialogue', path: ['Format'], shortcut: 'Ctrl+5', enabled: true, checked: true },
    { key: '4.1', label: 'Vim Keys', path: ['View'], shortcut: '', enabled: false, checked: true }
  ]);
  assert.equal(paletteItems(menu, 'darwin')[1].shortcut, '⌘E');
  assert.deepEqual(paletteItems(null), []);
});

test('a command chosen after the menu was rebuilt: found again by its name and place, never by name alone', () => {
  const clicked = [];
  const item = (label, o = {}) => ({ type: 'normal', visible: true, enabled: true, label, click: () => clicked.push(label + (o.tag || '')), ...o });
  const menus = {
    items: [
      { label: 'File', type: 'normal', visible: true, enabled: true, submenu: { items: [item('Take Snapshot'), item('Undo', { tag: ' (a chapter so titled)' })] } },
      { label: 'Edit', type: 'normal', visible: true, enabled: true, submenu: { items: [item('Undo', { tag: ' (Edit)' }), item('Greyed', { enabled: false }), item('Find && Replace')] } }
    ]
  };
  const ctx = vm.createContext({ Menu: { getApplicationMenu: () => menus }, process: { platform: 'linux' }, logError: () => {} });
  vm.runInContext(slice('main.js', 'const ACCEL_MAC', "ipcMain.handle('palette:items'"), ctx);
  const run = (...a) => vm.runInContext('paletteRun', ctx)(null, ...a);
  // where it was, named the same: clicked
  assert.equal(run('1.0', 'Undo', ['Edit']), true);
  assert.deepEqual(clicked.splice(0), ['Undo (Edit)']);
  // a label Windows and Linux write with && for its &
  assert.equal(run('1.2', 'Find & Replace', ['Edit']), true);
  assert.deepEqual(clicked.splice(0), ['Find && Replace']);
  // the menu moved: found by name and place, not the first "Undo" anywhere
  assert.equal(run('0.0', 'Undo', ['Edit']), true);
  assert.deepEqual(clicked.splice(0), ['Undo (Edit)']);
  // a name in no place it's known by, or no place given: nothing runs
  assert.equal(run('0.0', 'Undo', ['View']), false);
  assert.equal(run('0.0', 'Undo'), false);
  assert.deepEqual(clicked, []);
  // greyed: never clicked
  assert.equal(run('1.1', 'Greyed', ['Edit']), false);
  assert.deepEqual(clicked, []);
});
