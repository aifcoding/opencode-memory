/** 一次纯文本生成；不依赖宿主 SDK，由适配器实现。 */
export interface GenerationRequest {
  instructions: string;
  /** 已筛选、脱敏、裁剪的材料（不可信数据）。 */
  data: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface GenerationResult {
  text: string;
}

export interface TextGenerator {
  generate(input: GenerationRequest): Promise<GenerationResult>;
}
