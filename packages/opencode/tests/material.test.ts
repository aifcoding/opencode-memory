import { test, expect } from 'bun:test';
import { captureMaterials, extractionMaterial, originOf } from '../src/context/material';

test('maps host message types to origins without trusting role', () => {
  expect(originOf({ type: 'user', id: 'msg_123' })).toEqual({ origin: 'human' });
  expect(
    originOf({ type: 'user', id: 'msg_aut_1', metadata: { automation: { id: 'aut_1' } } }),
  ).toEqual({ origin: 'host', reason: 'automation' });
  expect(originOf({ type: 'user', id: 'msg_aut_2' })).toEqual({
    origin: 'host',
    reason: 'automation',
  });
  expect(originOf({ type: 'assistant' })).toEqual({ origin: 'model' });
  expect(originOf({ type: 'compaction' })).toEqual({ origin: 'host', reason: 'compaction' });
  expect(originOf({ type: 'synthetic' })).toEqual({ origin: 'host', reason: 'synthetic' });
  expect(originOf({ type: 'system' })).toEqual({ origin: 'host', reason: 'system' });
  expect(originOf({ type: 'shell' })).toEqual({ origin: 'host', reason: 'shell' });
  expect(originOf({})).toEqual({ origin: 'unknown' });
});

test('automation injection is not treated as human input', () => {
  const materials = captureMaterials([
    { type: 'user', id: 'msg_1', text: '记住 probe 的端口是 18093' },
    {
      type: 'user',
      id: 'msg_aut_2',
      text: '检查部署是否成功：背景 finance/ad-svr 分支…请按顺序验证:',
      metadata: { automation: { id: 'aut_1' } },
    },
  ]);
  // 当前材料仍是最后一条人工消息；automation 只可能作为前文，且 origin 为 host。
  expect(materials?.current).toMatchObject({ origin: 'human', messageId: 'msg_1' });
});

test('compaction summary and system notices never become material', () => {
  const materials = captureMaterials([
    { type: 'compaction', id: 'msg_c', text: '## Objective\n- ship auto memory' },
    { type: 'synthetic', id: 'msg_s', text: 'notice' },
    { type: 'system', id: 'msg_y', text: 'instructions' },
  ]);
  expect(materials).toBeUndefined();
});

test('collects previous human and model turns around the current one', () => {
  const materials = captureMaterials([
    { type: 'user', id: 'msg_1', text: '发布流程改成先跑 e2e' },
    { type: 'assistant', id: 'msg_2', content: [{ type: 'text', text: '好的，已记录 e2e 优先' }] },
    { type: 'user', id: 'msg_3', text: '记住这个' },
  ]);
  expect(materials?.current).toMatchObject({ origin: 'human', messageId: 'msg_3' });
  expect(materials?.previousUser).toMatchObject({ text: '发布流程改成先跑 e2e', origin: 'human' });
  expect(materials?.previousAssistant?.origin).toBe('model');
  expect(materials?.previousAssistant?.text).toContain('e2e 优先');
});

test('assistant text comes from text parts only', () => {
  const materials = captureMaterials([
    { type: 'assistant', id: 'msg_1', content: [
      { type: 'reasoning', text: '内部推理不应作为前文' },
      { type: 'tool', tool: 'bash', state: {} },
      { type: 'text', text: '对外答复' },
    ] },
    { type: 'user', id: 'msg_2', text: '问一句' },
  ]);
  expect(materials?.previousAssistant?.text).toBe('对外答复');
});

test('blank messages are ignored', () => {
  const materials = captureMaterials([
    { type: 'user', id: 'msg_1', text: '   ' },
    { type: 'user', id: 'msg_2', text: '记住 test.port=18096' },
  ]);
  expect(materials?.current.messageId).toBe('msg_2');
});

test('an automation turn boundary resets the assistant context', () => {
  const materials = captureMaterials([
    { type: 'assistant', id: 'msg_a1', content: [{ type: 'text', text: '你最喜欢什么颜色？' }] },
    { type: 'user', id: 'msg_aut', text: '检查部署', metadata: { automation: { id: 'aut_1' } } },
    { type: 'assistant', id: 'msg_a2', content: [{ type: 'text', text: '部署检查完成' }] },
    { type: 'user', id: 'msg_h2', text: '记住这个' },
  ]);
  // 自动化交互产生的回复不能当作人工上一轮；
  expect(materials?.previousAssistant?.text).toBe('你最喜欢什么颜色？');
});

test('compaction boundary stops pairing with pre-compaction turns', () => {
  const materials = captureMaterials([
    { type: 'assistant', id: 'msg_a1', content: [{ type: 'text', text: '旧交互的回复' }] },
    { type: 'compaction', id: 'msg_c', text: '## Objective' },
    { type: 'user', id: 'msg_h2', text: '记住这个' },
  ]);
  expect(materials?.previousAssistant).toBeUndefined();
});

test('synthetic notices do not break the human pairing', () => {
  const materials = captureMaterials([
    { type: 'user', id: 'msg_h1', text: '发布流程改成先跑 e2e' },
    { type: 'assistant', id: 'msg_a1', content: [{ type: 'text', text: '已记录' }] },
    { type: 'synthetic', id: 'msg_s', text: 'notice' },
    { type: 'user', id: 'msg_h2', text: '记住这个' },
  ]);
  expect(materials?.previousUser?.text).toBe('发布流程改成先跑 e2e');
  expect(materials?.previousAssistant?.text).toBe('已记录');
});

test('extraction material excludes injected, system and unknown messages', () => {
  const materials = extractionMaterial([
    { type: 'user', id: 'msg_h1', text: '记住 test.port=18096' },
    { type: 'assistant', id: 'msg_a1', content: [{ type: 'text', text: '已记录' }] },
    { type: 'user', id: 'msg_aut', text: '检查部署', metadata: { automation: { id: 'aut_1' } } },
    { type: 'compaction', id: 'msg_c', text: '## Objective' },
    { type: 'synthetic', id: 'msg_s', text: 'notice' },
    { type: 'shell', id: 'msg_sh', text: 'ls' },
    { id: 'msg_u' },
  ]);

  expect(materials.map((entry) => entry.id)).toEqual(['msg_h1', 'msg_a1']);
  expect(materials[0]).toMatchObject({ role: 'user', synthetic: false });
  expect(materials[1]).toMatchObject({ role: 'assistant', synthetic: false });
});
