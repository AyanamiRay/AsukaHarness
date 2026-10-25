import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SETTINGS, normalizeSettings, patchSettings } from '../src/lib/config.js';

test('normalizeSettings returns defaults for junk input', () => {
  for (const input of [null, undefined, 'nope', 42, [], { window: 'x' }]) {
    const settings = normalizeSettings(input);
    assert.equal(settings.skin, 'aurora');
    assert.equal(settings.window.width, DEFAULT_SETTINGS.window.width);
    assert.equal(settings.zoomFactor, 1);
  }
});

test('normalizeSettings clamps and validates values', () => {
  const settings = normalizeSettings({
    port: 70000,
    zoomFactor: 99,
    skin: '../../etc/passwd',
    host: 'not valid host',
    extraArgs: ['--foo', 42, 'bad\narg'],
    window: { width: 100, height: 100, x: 'left', y: 12 },
  });

  assert.equal(settings.port, null);
  assert.equal(settings.zoomFactor, 2.5);
  assert.equal(settings.skin, 'aurora');
  assert.equal(settings.host, '127.0.0.1');
  assert.deepEqual(settings.extraArgs, ['--foo']);
  assert.equal(settings.window.width, 640);
  assert.equal(settings.window.height, 480);
  assert.equal(settings.window.x, null);
  assert.equal(settings.window.y, 12);
});

test('normalizeSettings keeps a valid port and skin id', () => {
  const settings = normalizeSettings({ port: 3080, skin: 'my-skin_2', globalShortcut: '' });
  assert.equal(settings.port, 3080);
  assert.equal(settings.skin, 'my-skin_2');
  assert.equal(settings.globalShortcut, '');
});

test('patchSettings deep-merges the window object', () => {
  const base = normalizeSettings({ window: { width: 1000, height: 700, x: 10, y: 20 } });
  const next = patchSettings(base, { window: { maximized: true } });
  assert.equal(next.window.width, 1000);
  assert.equal(next.window.maximized, true);
  assert.equal(next.window.x, 10);
});
