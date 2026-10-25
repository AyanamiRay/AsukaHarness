import assert from 'node:assert/strict';
import test from 'node:test';

import { candidatePaths, locateDsh } from '../src/lib/dsh-locator.js';

const existsAlways = () => true;
const existsNever = () => false;

test('explicit settings win', () => {
  const result = locateDsh({
    explicit: '/opt/dsh',
    env: {},
    exists: existsAlways,
    which: () => '/usr/bin/dsh',
  });
  assert.equal(result.command, '/opt/dsh');
  assert.equal(result.source, 'settings');
});

test('DSH_BIN is used before PATH', () => {
  const result = locateDsh({
    env: { DSH_BIN: '/custom/dsh' },
    exists: existsAlways,
    which: () => '/usr/bin/dsh',
  });
  assert.equal(result.command, '/custom/dsh');
  assert.equal(result.source, 'env');
});

test('PATH lookup is accepted without a filesystem check', () => {
  const result = locateDsh({ env: {}, exists: existsNever, which: () => '/usr/bin/dsh' });
  assert.equal(result.command, '/usr/bin/dsh');
  assert.equal(result.source, 'path');
});

test('falls back to well-known locations, then reports failure', () => {
  const home = '/home/tester';
  const expected = candidatePaths({ platform: 'linux', env: {}, home })[0];
  const found = locateDsh({
    env: {},
    home,
    platform: 'linux',
    exists: (value) => value === expected,
    which: () => null,
  });
  assert.equal(found.command, expected);
  assert.equal(found.source, 'common');

  const missing = locateDsh({ env: {}, home, platform: 'linux', exists: existsNever, which: () => null });
  assert.equal(missing.command, null);
  assert.ok(missing.tried.length > 0);
});

test('windows candidates live under APPDATA', () => {
  const paths = candidatePaths({
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
    home: 'C:\\Users\\me',
  });
  assert.ok(paths.some((value) => value.endsWith('dsh.cmd')));
});
