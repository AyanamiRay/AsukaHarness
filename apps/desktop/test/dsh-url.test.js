import assert from 'node:assert/strict';
import test from 'node:test';

import { isLoopbackUrl, parseDshUrl, stripAnsi } from '../src/lib/dsh-url.js';

test('parses the plain banner', () => {
  const url = parseDshUrl('booting\ndsh web: http://127.0.0.1:3080/?token=abc123\nready');
  assert.equal(url, 'http://127.0.0.1:3080/?token=abc123');
});

test('strips ANSI colour codes', () => {
  const text = '\u001b[32mdsh web:\u001b[0m \u001b[4mhttp://127.0.0.1:3080/?token=x\u001b[0m';
  assert.equal(parseDshUrl(text), 'http://127.0.0.1:3080/?token=x');
  assert.equal(stripAnsi('\u001b[31mhi\u001b[0m'), 'hi');
});

test('rejects non-http and malformed values', () => {
  assert.equal(parseDshUrl('dsh web: file:///etc/passwd'), null);
  assert.equal(parseDshUrl('dsh web: not a url'), null);
  assert.equal(parseDshUrl('nothing here'), null);
});

test('handles a banner split across chunks', () => {
  assert.equal(parseDshUrl('dsh web: http://127.0.0.1:'), null);
});

test('recognises loopback origins', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:3080/'), true);
  assert.equal(isLoopbackUrl('http://localhost:3080/'), true);
  assert.equal(isLoopbackUrl('http://[::1]:3080/'), true);
  assert.equal(isLoopbackUrl('http://10.0.0.2:3080/'), false);
});
