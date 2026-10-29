import type { PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { v1Plugin } from './plugin-v1';
import { v2Setup } from './plugin-v2';

// 双入口：
// - v1（1.18.29+）识别对象入口的 server()，行为与旧版完全一致；
// - v2 识别 id + setup(ctx)，由 plugin-v2.ts 做宿主适配。
// 只保留 default 导出：v1 legacy loader 会把所有运行时导出都当插件调用。
const v2 = { id: 'opencode-memory', setup: v2Setup };

export default {
  ...v2,
  async server(input: PluginInput, options?: PluginOptions) {
    return v1Plugin(input, options);
  },
};
