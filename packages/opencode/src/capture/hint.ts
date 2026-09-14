/**
 * suggestedDomain 的人类可读提示。
 *
 * 注意：这个函数必须放在独立模块，不能放在 plugin.ts。
 * opencode 的 legacy 插件 loader 会把插件模块的**所有运行时导出**都当成插件函数调用，
 * plugin.ts 里任何非 default 导出（函数/常量）都会导致 hooks 数组混入非对象值并崩溃。
 */
export function suggestedDomainHint(domain: 'code' | 'user' | 'business' | 'uncertain'): string {
  return {
    code: '适合在 OpenCode 中审批',
    user: '建议交个人 Agent 管理',
    business: '建议交业务 Agent 管理',
    uncertain: '请用户判断归属',
  }[domain];
}
