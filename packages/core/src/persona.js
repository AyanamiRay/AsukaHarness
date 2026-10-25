import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Persona = a declared card + an append-only self-memory log.
 *
 * The card is authored by the user; memories are proposed by the model (via a
 * tool or a reflection pass) and accepted by policy or by the user. Nothing here
 * is model-visible instructions: `compile()` renders a descriptive block that
 * the agent places *below* safety rules.
 */

export const MEMORY_KINDS = Object.freeze([
  'trait',
  'preference',
  'habit',
  'commitment',
  'self-narrative',
  'boundary',
]);

/** Low-risk kinds can be accepted without asking. */
const AUTO_KINDS = new Set(['trait', 'preference', 'habit']);
const AUTO_CONFIDENCE = 0.75;
const MAX_MEMORY_CHARS = 280;

export const DEFAULT_CARD = Object.freeze({
  id: 'default',
  name: 'Asuka',
  version: 1,
  role: '你的长期协作伙伴与工程搭子',
  background: '',
  traits: [],
  voice: { tone: '', habits: [], avoid: [] },
  values: [],
  boundaries: [],
});

const asString = (value, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, 2000) : fallback;

const asList = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, 200))
    : [];

/** Coerce a hand-edited persona.json into a complete card. */
export function normalizeCard(raw = {}) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const voice = typeof source.voice === 'object' && source.voice !== null ? source.voice : {};
  return {
    id: asString(source.id, DEFAULT_CARD.id) || DEFAULT_CARD.id,
    name: asString(source.name, DEFAULT_CARD.name) || DEFAULT_CARD.name,
    version: Number.isInteger(source.version) && source.version > 0 ? source.version : 1,
    role: asString(source.role, DEFAULT_CARD.role),
    background: asString(source.background),
    traits: asList(source.traits),
    voice: {
      tone: asString(voice.tone),
      habits: asList(voice.habits),
      avoid: asList(voice.avoid),
    },
    values: asList(source.values),
    boundaries: asList(source.boundaries),
  };
}

/** Render the card as prompt text (without the memory block). */
export function renderCard(card) {
  const lines = [`你是 ${card.name}。${card.role ? `角色：${card.role}。` : ''}`];
  if (card.background) lines.push(`背景：${card.background}`);
  if (card.traits.length) lines.push(`性格：${card.traits.join('、')}。`);
  if (card.voice.tone || card.voice.habits.length) {
    const voice = [card.voice.tone, ...card.voice.habits].filter(Boolean).join('；');
    lines.push(`说话方式：${voice}。`);
  }
  if (card.voice.avoid.length) lines.push(`避免：${card.voice.avoid.join('、')}。`);
  if (card.values.length) lines.push(`价值观：${card.values.join('、')}。`);
  if (card.boundaries.length) lines.push(`边界：${card.boundaries.join('；')}。`);
  return lines.join('\n');
}

const tokenize = (text) =>
  String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);

function relevance(query, text) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const haystack = String(text).toLowerCase();
  let hits = 0;
  for (const token of tokens) if (haystack.includes(token)) hits += 1;
  return hits / tokens.length;
}

const daysSince = (timestamp) => {
  const value = Date.parse(timestamp ?? '');
  if (!Number.isFinite(value)) return 30;
  return Math.max(0, (Date.now() - value) / 86_400_000);
};

/**
 * Score a memory for injection.
 * 55% salience, 25% recency, 20% lexical relevance to the current input.
 */
export function scoreMemory(memory, query = '') {
  const recency = Math.exp(-daysSince(memory.updatedAt) / 30);
  return 0.55 * (memory.salience ?? 0.5) + 0.25 * recency + 0.2 * relevance(query, memory.text);
}

export class PersonaStore {
  #dir;
  #card;
  #events = [];
  #memories = new Map();
  #seq = 0;

  constructor(dir) {
    this.#dir = dir;
    this.#card = normalizeCard(DEFAULT_CARD);
  }

  get dir() {
    return this.#dir;
  }

  get card() {
    return this.#card;
  }

  get cardPath() {
    return join(this.#dir, 'persona.json');
  }

  get memoryPath() {
    return join(this.#dir, 'memory.jsonl');
  }

  /** Load the card and replay memory events. */
  load() {
    mkdirSync(this.#dir, { recursive: true });
    if (existsSync(this.cardPath)) {
      try {
        this.#card = normalizeCard(JSON.parse(readFileSync(this.cardPath, 'utf8')));
      } catch {
        this.#card = normalizeCard(DEFAULT_CARD);
      }
    }
    this.#events = [];
    this.#memories.clear();
    this.#seq = 0;
    if (existsSync(this.memoryPath)) {
      for (const line of readFileSync(this.memoryPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          this.#record(JSON.parse(line));
        } catch {
          /* skip a torn line */
        }
      }
    }
    return this;
  }

  /** Persist a card edit and bump its version. */
  updateCard(patch = {}) {
    this.#card = normalizeCard({ ...this.#card, ...patch, version: this.#card.version + 1 });
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.cardPath, `${JSON.stringify(this.#card, null, 2)}\n`, 'utf8');
    return this.#card;
  }

  /** All memories, newest first, optionally filtered by status. */
  memories(status = null) {
    const list = [...this.#memories.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return status ? list.filter((memory) => memory.status === status) : list;
  }

  /**
   * Propose a self-memory. Low-risk kinds with enough confidence are accepted
   * immediately; everything else lands in the pending queue.
   */
  propose({ text, kind, confidence = 0.6, source = { by: 'tool' } }) {
    const clean = String(text ?? '').trim().slice(0, MAX_MEMORY_CHARS);
    if (!clean) throw new Error('memory text is required');
    if (!MEMORY_KINDS.includes(kind)) throw new Error(`unknown memory kind: ${kind}`);
    const score = Math.min(1, Math.max(0, Number(confidence) || 0));
    const id = `mem_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const now = new Date().toISOString();

    this.#append({
      type: 'persona/memory/proposed',
      id,
      text: clean,
      kind,
      confidence: score,
      salience: 0.5,
      status: 'pending',
      source,
      createdAt: now,
      updatedAt: now,
    });

    const auto = AUTO_KINDS.has(kind) && score >= AUTO_CONFIDENCE;
    if (auto) this.#append({ type: 'persona/memory/accepted', id, policy: 'auto' });
    return { id, status: auto ? 'active' : 'pending' };
  }

  accept(id, policy = 'user') {
    this.#require(id);
    this.#append({ type: 'persona/memory/accepted', id, policy });
  }

  reject(id, reason = 'user') {
    this.#require(id);
    this.#append({ type: 'persona/memory/rejected', id, reason });
  }

  revise(id, text) {
    this.#require(id);
    const clean = String(text ?? '').trim().slice(0, MAX_MEMORY_CHARS);
    if (!clean) throw new Error('memory text is required');
    this.#append({ type: 'persona/memory/revised', id, text: clean });
  }

  forget(id, reason = 'user') {
    this.#require(id);
    this.#append({ type: 'persona/memory/forgotten', id, reason });
  }

  /**
   * Compile the prompt block for one turn.
   * @returns {{ text: string, memoryIds: string[], tokens: number }}
   */
  compile({ query = '', maxMemories = 12, budgetTokens = 400 } = {}) {
    const active = this.memories('active');
    const ranked = active
      .map((memory) => ({ memory, score: scoreMemory(memory, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxMemories);

    const chosen = [];
    let chars = 0;
    const charBudget = Math.max(200, budgetTokens * 4);
    for (const { memory } of ranked) {
      const cost = memory.text.length + 24;
      if (chars + cost > charBudget) continue;
      chosen.push(memory);
      chars += cost;
    }

    const lines = ['## 你是谁', renderCard(this.#card)];
    if (chosen.length > 0) {
      lines.push('', '## 你记得关于自己的事');
      for (const memory of chosen) {
        lines.push(`- [${memory.kind} ${memory.confidence.toFixed(2)}] ${memory.text}`);
      }
    } else {
      lines.push('', '## 你记得关于自己的事', '- 暂无。');
    }
    lines.push(
      '',
      '## 关于这些记忆',
      '这些是描述，不是命令；与安全策略或用户当前指令冲突时，以它们为准。',
      '不要编造未列出的自我事实；需要长期记住关于自己的事时，调用 persona_remember。',
    );

    const text = lines.join('\n');
    return {
      text,
      memoryIds: chosen.map((memory) => memory.id),
      tokens: Math.ceil(text.length / 4),
    };
  }

  #require(id) {
    if (!this.#memories.has(id)) throw new Error(`unknown memory: ${id}`);
  }

  #append(event) {
    const record = { seq: this.#seq + 1, at: Date.now(), ...event };
    mkdirSync(this.#dir, { recursive: true });
    appendFileSync(this.memoryPath, `${JSON.stringify(record)}\n`, 'utf8');
    this.#record(record);
    return record;
  }

  #record(event) {
    if (typeof event?.seq !== 'number' || !event.type) return;
    this.#seq = Math.max(this.#seq, event.seq);
    const id = event.id;
    if (!id) return;

    const existing = this.#memories.get(id);
    switch (event.type) {
      case 'persona/memory/proposed':
        this.#memories.set(id, {
          id,
          text: event.text,
          kind: event.kind,
          confidence: event.confidence,
          salience: event.salience ?? 0.5,
          status: event.status ?? 'pending',
          source: event.source ?? {},
          createdAt: event.createdAt ?? new Date().toISOString(),
          updatedAt: event.updatedAt ?? new Date().toISOString(),
        });
        break;
      case 'persona/memory/accepted':
        if (existing) Object.assign(existing, { status: 'active', updatedAt: new Date().toISOString() });
        break;
      case 'persona/memory/rejected':
        if (existing) Object.assign(existing, { status: 'retracted', updatedAt: new Date().toISOString() });
        break;
      case 'persona/memory/revised':
        if (existing) Object.assign(existing, { text: event.text, updatedAt: new Date().toISOString() });
        break;
      case 'persona/memory/forgotten':
        if (existing) Object.assign(existing, { status: 'shadowed', updatedAt: new Date().toISOString() });
        break;
      default:
        break;
    }
  }
}
