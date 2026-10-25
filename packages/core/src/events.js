/**
 * The session event vocabulary for the Asuka Harness core.
 *
 * Everything the model can see must be reconstructable from these events.
 * New event types are additive; readers must ignore unknown types only when the
 * event carries `ignorable: true`.
 */
export const EVENT = Object.freeze({
  SESSION_START: 'session/start',
  TURN_START: 'turn/start',
  TURN_END: 'turn/end',
  STEP_START: 'step/start',
  STEP_END: 'step/end',
  REQUEST_HEADER: 'request/header',
  SYSTEM_MESSAGE: 'system/message',
  USER_MESSAGE: 'user/message',
  ASSISTANT_MESSAGE: 'assistant/message',
  ASSISTANT_ATTEMPT: 'assistant/attempt',
  TOOL_CALL: 'tool/call',
  TOOL_RESULT: 'tool/result',
  COMPACTION_SUMMARY: 'compaction/summary',
  COMPACTION_PRUNE: 'compaction/prune',
  PERSONA_SNAPSHOT: 'persona/snapshot',
  ERROR: 'error',
});

export const KNOWN_EVENT_TYPES = new Set(Object.values(EVENT));

/** @param {{ type?: string } | null | undefined} event */
export function isKnownEvent(event) {
  return Boolean(event && KNOWN_EVENT_TYPES.has(event.type));
}
