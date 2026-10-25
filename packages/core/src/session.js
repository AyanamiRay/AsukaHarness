import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { EVENT } from './events.js';

/**
 * Append-only session log with a JSONL backing file.
 *
 * The log is the single source of truth: messages sent to a model are derived
 * from it, never stored separately. A torn tail (crash mid-write) is dropped on
 * load and reported through `load().dropped`.
 */
export class SessionLog {
  #file;
  #sessionId;
  #events = [];
  #seq = 0;
  #dropped = 0;

  constructor(file, { sessionId = 'session' } = {}) {
    this.#file = file;
    this.#sessionId = sessionId;
  }

  get file() {
    return this.#file;
  }

  get sessionId() {
    return this.#sessionId;
  }

  get dropped() {
    return this.#dropped;
  }

  get events() {
    return this.#events.slice();
  }

  get lastSeq() {
    return this.#seq;
  }

  /** Read the file, skipping a torn final line instead of failing. */
  load() {
    this.#events = [];
    this.#seq = 0;
    this.#dropped = 0;
    if (!existsSync(this.#file)) return this;

    const lines = readFileSync(this.#file, 'utf8').split('\n');
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      try {
        const event = JSON.parse(text);
        if (typeof event?.seq === 'number' && typeof event?.type === 'string') {
          this.#events.push(event);
          this.#seq = Math.max(this.#seq, event.seq);
        } else {
          this.#dropped += 1;
        }
      } catch {
        this.#dropped += 1;
      }
    }
    return this;
  }

  /**
   * Append one event. `seq` and `at` are assigned here so callers never invent
   * ordering.
   */
  append(type, payload = {}) {
    const event = {
      seq: this.#seq + 1,
      type,
      at: Date.now(),
      ...payload,
    };
    mkdirSync(dirname(this.#file), { recursive: true });
    appendFileSync(this.#file, `${JSON.stringify(event)}\n`, 'utf8');
    this.#events.push(event);
    this.#seq = event.seq;
    return event;
  }

  /** Model-visible messages derived from the log. */
  deriveMessages({ system = null } = {}) {
    return deriveMessages(this.#events, { system });
  }
}

/**
 * Fold the log into chat messages, honouring compaction shadows.
 *
 * Shadowing rules:
 * - `compaction/prune` lists event seqs to hide.
 * - `compaction/summary` hides `fromSeq..toSeq` and contributes one summary
 *   message at its own position.
 *
 * @param {object[]} events
 * @param {{ system?: string | null }} options
 */
export function deriveMessages(events, { system = null } = {}) {
  const shadowed = new Set();
  for (const event of events) {
    if (event.type === EVENT.COMPACTION_PRUNE) {
      for (const seq of event.shadow ?? []) shadowed.add(seq);
    }
    if (event.type === EVENT.COMPACTION_SUMMARY) {
      for (let seq = event.fromSeq; seq <= event.toSeq; seq += 1) shadowed.add(seq);
    }
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: [{ type: 'text', text: system }] });

  for (const event of events) {
    if (shadowed.has(event.seq)) continue;
    switch (event.type) {
      case EVENT.SYSTEM_MESSAGE:
        messages.push({ role: 'system', content: event.content ?? [] });
        break;
      case EVENT.USER_MESSAGE:
        messages.push({ role: 'user', content: event.content ?? [] });
        break;
      case EVENT.ASSISTANT_MESSAGE:
        messages.push({ role: 'assistant', content: event.content ?? [] });
        break;
      case EVENT.TOOL_RESULT:
        messages.push({ role: 'tool', callId: event.callId, content: event.content ?? [] });
        break;
      case EVENT.COMPACTION_SUMMARY:
        messages.push({
          role: 'system',
          content: [{ type: 'text', text: `[Earlier conversation summary]\n${event.summary}` }],
        });
        break;
      default:
        break;
    }
  }

  return messages;
}
