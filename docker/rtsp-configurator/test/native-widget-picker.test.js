import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/editor.js'), 'utf8');
const detection = source.slice(source.indexOf('  const typeNames ='), source.indexOf('  function cloneFirstPartyWidget('));
const detect = new Function(
  'document', 'location', 'visible', 'ADDON', 'isEditorOpen', 'recentAddControl',
  detection + 'return findNativeWidgetTemplate;'
);

function fixture(names, options = {}) {
  const cards = [];
  const labels = [];
  const parent = {
    children: cards, parentElement: null,
    getBoundingClientRect: () => ({ width: 460, height: 450 }),
    closest: () => null
  };
  for (const item of names) {
    const value = typeof item === 'string' ? { label: item } : item;
    const card = {
      parentElement: parent, children: [],
      closest: () => null,
      getBoundingClientRect: () => ({ width: 180, height: 65 }),
      contains(node) { return this.children.includes(node); }
    };
    const el = {
      textContent: value.label || '', children: [], parentElement: card,
      getAttribute: key => value.attrs?.[key] || null,
      closest: selector => selector.startsWith('#') ||
        selector.startsWith('[data-uc-video-stream') ? null : card,
      getBoundingClientRect: () => ({ width: 145, height: 28 })
    };
    card.children.push(el); cards.push(card); labels.push(el);
  }
  const document = { querySelectorAll: () => labels };
  const finder = detect(document, { pathname: options.path || '/configurator/activities/tv/ui' },
    () => true, 'uc-video-stream-addon', () => options.editor !== false,
    options.recent ? Date.now() : 0);
  return finder();
}

test('detects stock Media Player, Button and Select cards', () => {
  assert.equal(fixture(['Media Player', 'Button', 'Select'])?.sourceText, 'Media Player');
});
test('detects the official Media / Icon / Text widget labels', () => {
  assert.equal(fixture(['Media widget', 'Icon widget', 'Text widget'])?.sourceText, 'Media widget');
});
test('supports localized media widgets and split accessibility labels', () => {
  assert.equal(fixture(['Medienplayer', 'Taste', 'Auswahl'])?.sourceText, 'Medienplayer');
  assert.equal(fixture([
    { label: '', attrs: { 'aria-label': 'Media Player' } },
    'Button'
  ])?.sourceText, 'Media Player');
});
test('does not insert in unrelated pages or without a widget picker', () => {
  assert.equal(fixture(['Media Player']), null);
  assert.equal(fixture(['Button', 'Select']), null);
  assert.equal(fixture(['Media Player', 'Select'], { path: '/dashboard' }), null);
});
test('native style is taken from the real card without cloning Vue listeners', () => {
  assert.match(source, /\.cloneNode\(true\)/);
  assert.match(source, /removeAttribute\('id'\)/);
  assert.match(source, /aria-label', 'Video Stream'/);
  assert.match(source, /data-uc-video-stream-native/);
  assert.match(source, /application\/x-uc-video-stream/);
  assert.match(source, /ucVideoStreamDiagnostics/);
});
