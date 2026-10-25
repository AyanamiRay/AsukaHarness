import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PersonaStore } from '../src/persona.js';

const newStore = () => new PersonaStore(mkdtempSync(join(tmpdir(), 'asuka-persona-'))).load();

test('low-risk memories auto-accept, commitments wait for approval', () => {
  const store = newStore();
  const preference = store.propose({ text: '我习惯先给结论，再给理由', kind: 'preference', confidence: 0.9 });
  const commitment = store.propose({ text: '我答应过改代码前先说明影响范围', kind: 'commitment', confidence: 0.9 });

  assert.equal(preference.status, 'active');
  assert.equal(commitment.status, 'pending');
  assert.equal(store.memories('active').length, 1);
  assert.equal(store.memories('pending').length, 1);
});

test('approval and forgetting change what is compiled', () => {
  const store = newStore();
  const pending = store.propose({ text: '我答应过不替用户做不可逆决定', kind: 'boundary', confidence: 0.95 });
  store.accept(pending.id);

  let compiled = store.compile({ query: '部署到生产' });
  assert.match(compiled.text, /不可逆决定/);
  assert.equal(compiled.memoryIds.length, 1);

  store.forget(pending.id);
  compiled = store.compile();
  assert.doesNotMatch(compiled.text, /不可逆决定/);
  assert.equal(compiled.memoryIds.length, 0);
});

test('compile respects maxMemories and the token budget', () => {
  const store = newStore();
  for (let index = 0; index < 8; index += 1) {
    store.propose({
      text: `这是第 ${index} 条关于我自己的工作习惯的记忆，用来测试注入预算是否生效。`,
      kind: 'habit',
      confidence: 0.9,
    });
  }
  const compiled = store.compile({ maxMemories: 3, budgetTokens: 80 });
  assert.ok(compiled.memoryIds.length <= 3);
  assert.ok(compiled.tokens > 0);
});

test('card edits bump the version and change the rendered identity', () => {
  const store = newStore();
  const before = store.compile().text;
  const card = store.updateCard({ name: 'Asuka', traits: ['直接', '好奇'] });
  assert.equal(card.version, 2);
  const after = store.compile().text;
  assert.match(after, /直接/);
  assert.notEqual(before, after);
});

test('a reloaded store replays the same memories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asuka-persona-'));
  const store = new PersonaStore(dir).load();
  store.propose({ text: '我喜欢用表格对比方案', kind: 'preference', confidence: 0.8 });
  store.forget(store.memories()[0].id);

  const reloaded = new PersonaStore(dir).load();
  assert.equal(reloaded.memories('active').length, 0);
  assert.equal(reloaded.memories('shadowed').length, 1);
});
