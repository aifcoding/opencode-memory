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
