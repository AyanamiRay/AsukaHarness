import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SessionLog, deriveMessages } from '../src/session.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'asuka-session-'));

test('append assigns sequence numbers and derives roles', () => {
  const log = new SessionLog(join(tempDir(), 's.jsonl'), { sessionId: 's1' });
  log.append('user/message', { id: 'm1', content: [{ type: 'text', text: 'hi' }] });
  log.append('assistant/message', { id: 'm2', content: [{ type: 'text', text: 'hello' }] });

  const messages = log.deriveMessages({ system: 'you are asuka' });
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user', 'assistant'],
  );
  assert.equal(log.lastSeq, 2);
});

test('compaction shadows old events and keeps one summary', () => {
  const log = new SessionLog(join(tempDir(), 's.jsonl'));
  for (let index = 1; index <= 6; index += 1) {
    log.append('user/message', { id: `m${index}`, content: [{ type: 'text', text: `msg ${index}` }] });
  }
  log.append('compaction/summary', { id: 'c1', summary: 'the first three messages', fromSeq: 1, toSeq: 3 });
  log.append('compaction/prune', { shadow: [1, 2, 3] });

  const messages = log.deriveMessages();
  const texts = messages.map((message) => message.content?.[0]?.text ?? '');
  assert.equal(messages.length, 4);
  assert.ok(texts.some((text) => text.includes('the first three messages')));
  assert.ok(!texts.includes('msg 1'));
});

test('a torn tail is dropped instead of failing the load', () => {
  const file = join(tempDir(), 's.jsonl');
  writeFileSync(file, `${JSON.stringify({ seq: 1, type: 'user/message', content: [] })}\n{"seq":2,"ty`, 'utf8');
  const log = new SessionLog(file).load();
  assert.equal(log.events.length, 1);
  assert.equal(log.dropped, 1);
});

test('deriveMessages is pure and does not mutate the log', () => {
  const events = [
    { seq: 1, type: 'user/message', content: [{ type: 'text', text: 'a' }] },
    { seq: 2, type: 'compaction/summary', summary: 's', fromSeq: 1, toSeq: 1 },
  ];
  const first = deriveMessages(events);
  const second = deriveMessages(events);
  assert.deepEqual(first, second);
  assert.equal(events.length, 2);
});
