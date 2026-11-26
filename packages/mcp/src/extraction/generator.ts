import type { TextGenerator } from '@aifcoding/memory-core';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  /** 环境变量名；值只在进程内读取，不写入配置或日志。 */
  apiKeyEnv: string;
  timeoutMs: number;
}

/** 最小 openai-compatible 生成器：一次 chat/completions，无重试。 */
export function createOpenAiCompatibleGenerator(options: OpenAiCompatibleOptions): TextGenerator {
  return {
    async generate(input) {
      const apiKey = process.env[options.apiKeyEnv];
      if (!apiKey) throw new Error('missing_api_key');
      const signal = input.signal ?? AbortSignal.timeout(options.timeoutMs);
      const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: input.instructions },
            { role: 'user', content: input.data },
          ],
          max_tokens: input.maxOutputTokens,
        }),
        signal,
      });
      if (!response.ok) throw new Error(`generator_http_${response.status}`);
      const body = (await response.json()) as any;
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('generator_empty');
      if (text.length > 400_000) throw new Error('generator_response_too_large');
      return { text };
    },
  };
}
