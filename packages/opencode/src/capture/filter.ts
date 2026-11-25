import { redactCredentialText } from '@aifcoding/memory-core';

export interface CaptureMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface RawCaptureMessage {
  info?: { role?: string; id?: string };
  parts?: Array<{ id?: string; type?: string; text?: string; synthetic?: boolean }>;
}

export function filterCaptureMessages(messages: RawCaptureMessage[]): CaptureMessage[] {
  return messages.flatMap((message) => {
    const role = message.info?.role;
    if (role !== 'user' && role !== 'assistant') return [];
    return (message.parts ?? []).flatMap((part) =>
      part.type === 'text' &&
      !part.synthetic &&
      !message.info?.id?.startsWith('msg_mem_') &&
      !part.id?.startsWith('prt_mem_') &&
      part.text
        ? [{ id: message.info?.id ?? '', role, text: part.text }]
        : [],
    );
  });
}

/** 发送给模型之前按消息脱敏；返回脱敏后的材料与命中计数。 */
export function redactCaptureMaterial(messages: CaptureMessage[]): {
  messages: CaptureMessage[];
  redacted: number;
} {
  let redacted = 0;
  const cleaned = messages.map((message) => {
    const result = redactCredentialText(message.text);
    redacted += result.hits;
    return { ...message, text: result.text };
  });
  return { messages: cleaned, redacted };
}
