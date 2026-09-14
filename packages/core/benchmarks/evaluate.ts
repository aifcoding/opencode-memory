import { readFileSync } from 'node:fs';

type Sample = { text: string; shouldExtract: boolean; domain: string };
const samples = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as Sample[];
const positivePattern = /规范|约定|决策|采用|根因|工作流|偏好|(?<!未)确认/;
const predictDomain = (text: string) => /偏好/.test(text) ? 'user' : /根因|生产|业务/.test(text) ? 'business' : /规范|约定|编码|架构|数据库|Bun|测试|工作流/.test(text) ? 'code' : 'uncertain';
const predictions = samples.map((sample) => ({
  predicted: positivePattern.test(sample.text),
  predictedDomain: predictDomain(sample.text),
  sample,
}));
const tp = predictions.filter((p) => p.predicted && p.sample.shouldExtract).length;
const fp = predictions.filter((p) => p.predicted && !p.sample.shouldExtract).length;
const fn = predictions.filter((p) => !p.predicted && p.sample.shouldExtract).length;
const negatives = samples.filter((s) => !s.shouldExtract).length;
const domainCorrect = predictions.filter((p) => p.predicted && p.sample.shouldExtract && p.predictedDomain === p.sample.domain).length;
const predictedTexts = predictions.filter((p) => p.predicted).map((p) => p.sample.text);
const duplicateRate = predictedTexts.length === 0 ? 0 : 1 - new Set(predictedTexts).size / predictedTexts.length;
console.log(JSON.stringify({
  samples: samples.length,
  precision: tp / (tp + fp),
  recall: tp / (tp + fn),
  falsePositiveRate: fp / negatives,
  domainAccuracy: domainCorrect / tp,
  duplicateRate,
}, null, 2));
