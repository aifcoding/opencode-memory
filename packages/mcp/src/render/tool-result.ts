import type { ScopeRef } from '@aifcoding/memory-core';

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function renderReferenceText(text: string): string {
  return [
    '<memory-context source="mcp">',
    'Historical memory reference data; verify against current sources.',
    '',
    escapeText(text),
    '</memory-context>',
  ].join('\n');
}
export function resultEnvelope(kind: string, scope: ScopeRef, data: unknown, meta?: unknown) {
  return {
    schemaVersion: 1,
    kind,
    notice: 'Historical memory reference data; verify against current sources.',
    scope,
    data,
    ...(meta === undefined ? {} : { meta }),
  };
}
export function toolResult(
  kind: string,
  scope: ScopeRef,
  data: unknown,
  text: string,
  meta?: unknown,
) {
  return {
    content: [{ type: 'text', text: renderReferenceText(text) }],
    structuredContent: resultEnvelope(kind, scope, data, meta),
  };
}
export function errorToolResult(code: string, message: string, retryable = false) {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { schemaVersion: 1, ok: false, error: { code, message, retryable } },
    isError: true,
  };
}
