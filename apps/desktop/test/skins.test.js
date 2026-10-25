import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverSkins, normalizeSkin, readSkin, SkinError } from '../src/lib/skin-manifest.js';
import { hexToRgb, skinVariables, veilColor } from '../src/lib/skin-css.js';

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-skin-'));
}

function writeSkin(dir, manifest, files = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'skin.json'), JSON.stringify(manifest), 'utf8');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

test('normalizeSkin fills defaults and rejects escapes', () => {
  const skin = normalizeSkin({ name: 'A' }, { id: 'a', dir: '/tmp/x' });
  assert.equal(skin.size, 'cover');
  assert.equal(skin.position, 'center');
  assert.equal(skin.dim, 0.25);
  assert.equal(skin.tint, '#000000');

  assert.throws(() => normalizeSkin({ image: '../secret.jpg' }, { id: 'b', dir: '/tmp/b' }), SkinError);
  assert.throws(() => normalizeSkin({ image: 'a.gif' }, { id: 'c', dir: '/tmp/c' }), SkinError);
  assert.throws(() => normalizeSkin({}, { id: 'bad id', dir: '/tmp/d' }), SkinError);
});

test('discoverSkins skips invalid skins and lets user skins win', () => {
  const builtin = makeRoot();
  const user = makeRoot();

  writeSkin(join(builtin, 'aurora'), { name: '极光' }, { 'background.jpg': 'x' });
  writeSkin(join(builtin, 'broken'), { image: 'missing.jpg' });
  writeSkin(join(user, 'aurora'), { name: '我的极光', image: 'background.png' }, { 'background.png': 'x' });
  writeSkin(join(user, 'custom'), { name: 'Custom', tint: '#112233', dim: 0.4 });

  const { skins, warnings } = discoverSkins([
    { dir: builtin, source: 'builtin' },
    { dir: user, source: 'user' },
  ]);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0].dir, /broken$/);
  const aurora = skins.find((skin) => skin.id === 'aurora');
  assert.equal(aurora.source, 'user');
  assert.equal(aurora.name, '我的极光');
  assert.ok(skins.some((skin) => skin.id === 'custom'));
});

test('readSkin refuses a manifest outside the directory', () => {
  const root = makeRoot();
  writeSkin(join(root, 'x'), { image: '../../etc/passwd' });
  assert.throws(() => readSkin(join(root, 'x')), SkinError);
});

test('skinVariables maps the manifest onto CSS custom properties', () => {
  const skin = normalizeSkin(
    { image: 'bg.jpg', size: 'tile', blur: 6, dim: 0.4, tint: '#204060' },
    { id: 'demo', dir: '/tmp/demo' },
  );
  const vars = skinVariables(skin, 'data:image/jpeg;base64,AAA');

  assert.equal(vars['--dsh-skin-image'], 'url("data:image/jpeg;base64,AAA")');
  assert.equal(vars['--dsh-skin-size'], 'auto');
  assert.equal(vars['--dsh-skin-repeat'], 'repeat');
  assert.equal(vars['--dsh-skin-blur'], '6px');
  assert.equal(vars['--dsh-skin-veil'], 'rgba(32, 64, 96, 0.4)');
});

test('colour helpers handle short and long hex', () => {
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#102030'), [16, 32, 48]);
  assert.equal(veilColor('#000000', 2), 'rgba(0, 0, 0, 0.95)');
});
