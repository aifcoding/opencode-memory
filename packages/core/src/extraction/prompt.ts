import { composeInstructions } from './instructions.js';

export const CAPTURE_EXTRACTOR_VERSION = 'extraction-v1';

/** 默认组合（用户未配置规则文件时使用）。 */
export const CAPTURE_PROMPT = composeInstructions();

export { composeInstructions } from './instructions.js';
