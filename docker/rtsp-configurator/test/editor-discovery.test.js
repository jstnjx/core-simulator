import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/editor.js'), 'utf8');
const declarations = source.slice(source.indexOf('  const visible ='), source.indexOf('  let activityRows ='));
const detector = source.slice(source.indexOf('  function findExactText('), source.indexOf('  function findGrid() {'));
assert.ok(declarations.includes('const label'));
assert.ok(detector.includes('function findPalette'));

const detect = new Function('document', 'location', 'getComputedStyle', 'innerWidth', 'ADDON',
  declarations + detector + 'return findPalette();');

function control(text, left = 870) {
  const el = {
    textContent: text, children: [], className: '', id: '', isConnected: true,
    matches: value => value.includes('button'), closest: () => null,
    getBoundingClientRect: () => ({ width: 90, height: 35, left, right: left + 90 })
  };
  el.parentElement = { children: [el], className: 'tools', getBoundingClientRect: () => ({ width: 140 }) };
  return el;
}
function fixture(labels, path = '/configurator/activities/tv/ui') {
  const elements = labels.map(text => control(text));
  const document = { querySelectorAll: () => elements };
  const getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  return detect(document, { pathname: path }, getComputedStyle, 1200, 'uc-video-stream-addon');
}

test('current UI editor: show Video Stream alongside Add, without Widgets heading', () => {
  const found = fixture(['User interface','Button mapping','Move','Edit','Select','Test','Add','Grid','Reset']);
  assert.equal(found?.source, 'add');
  assert.equal(found?.heading.textContent, 'Add');
});

test('Move mode: Video Stream remains discoverable beside Grid / Reset', () => {
  const found = fixture(['User interface','Button mapping','Move','Edit','Select','Test','Grid','Reset']);
  assert.equal(found?.source, 'tools');
});

test('legacy UI editor: place beside Widgets', () => {
  assert.equal(fixture(['Widgets','User interface','Move','Edit','Select','Test','Grid'])?.source, 'widgets');
});

test('German UI editor matches localized tools', () => {
  assert.equal(fixture(['Benutzeroberfläche','Bewegen','Bearbeiten','Auswählen','Testen','Hinzufügen','Raster'])?.source, 'add');
});

test('other Configurator views do not get a Video Stream widget', () => {
  assert.equal(fixture(['Activities','Devices','Add','Grid']), null);
  assert.equal(fixture(['Widgets','Move','Edit','Select','Test','Grid'], '/dashboard'), null);
});
