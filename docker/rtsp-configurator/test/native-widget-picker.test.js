import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/editor.js'), 'utf8');
const block = code.slice(code.indexOf('  const typeNames ='), code.indexOf('  function findGrid() {'));
assert.ok(block.includes('cloneFirstPartyWidget'));
assert.ok(block.includes('findNativeWidgetTemplate'));
const functions = new Function('document', 'location', 'visible', 'label', 'getComputedStyle',
  'innerWidth', 'ADDON', 'slot', block +
  'return { findNativeWidgetTemplate, cloneFirstPartyWidget };');

function fixture(names, pathname = '/configurator/activities/tv/ui') {
  let picker;
  const tiles = names.map(text => {
    const card = {
      parentElement: null, isConnected: true,
      getBoundingClientRect: () => ({ width: 178, height: 86 }),
    };
    const leaf = {
      isConnected: true, textContent: text, children: [], parentElement: card,
      closest: selector => selector.includes('button') ? card : null,
      getBoundingClientRect: () => ({ width: 104, height: 28 })
    };
    return { card, leaf };
  });
  picker = {
    parentElement: null,
    getBoundingClientRect: () => ({ width: 430, height: 460 }),
    contains: card => tiles.some(x => x.card === card),
  };
  tiles.forEach(x => { x.card.parentElement = picker; });
  const document = { querySelectorAll: () => tiles.map(x => x.leaf) };
  const visible = () => true;
  const label = el => String(el?.textContent || '').trim();
  const fn = functions(document, { pathname }, visible, label,
    () => ({ display: 'block' }), 1200, 'uc-video-stream-addon', null);
  return fn.findNativeWidgetTemplate();
}

test('uses real Media Player card next to built-in Button and Select widget entries', () => {
  const result = fixture(['Button', 'Select', 'Media Player']);
  assert.equal(result?.sourceText, 'Media Player');
});
test('German widget picker is supported', () => {
  const result = fixture(['Taste', 'Auswahl', 'Medienplayer']);
  assert.equal(result?.sourceText, 'Medienplayer');
});
test('does not inject for isolated Media Player or unrelated menus', () => {
  assert.equal(fixture(['Media Player']), null);
  assert.equal(fixture(['Button', 'Select']), null);
  assert.equal(fixture(['Button', 'Select', 'Media Player'], '/dashboard'), null);
});
test('native option is visually cloned, with unique IDs and custom video icon', () => {
  assert.match(block, /\.cloneNode\(true\)/);
  assert.match(block, /removeAttribute\('id'\)/);
  assert.match(block, /aria-label', 'Video Stream'/);
  assert.match(block, /data-uc-video-stream-native/);
  assert.match(block, /stopImmediatePropagation/);
  assert.match(block, /application\/x-uc-video-stream/);
});
