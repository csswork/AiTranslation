/**
 * 待对比的方案。每个方案只描述「在线上请求体的基础上改什么」：
 * 评测脚本照常调用扩展自己的 AITrProviders，发出请求前把请求体交给 patch。
 * 所以 baseline 永远等于当前代码的真实行为，改了 providers.js 之后不用同步这里。
 *
 * patch(body, ctx) 返回新的请求体。
 *   body: OpenAI 兼容的 /chat/completions 请求体（messages[0] 是系统提示词）
 *   ctx:  { mode: 'single' | 'batch', sample, target }  target 是目标语言的英文名
 */

// 后台托管翻译用的是另一份基础提示词，直接引用，评测托管路径时不用抄一份
import { styleGuide, systemPrompt as hostedSystemPrompt } from '../../backend/src/translation/hosted.js';

/** 改系统提示词：fn(原提示词, ctx) 返回新的提示词。 */
export function withSystem(fn) {
  return (body, ctx) => ({
    ...body,
    messages: body.messages.map((message, index) =>
      index === 0 && message.role === 'system' ? { ...message, content: fn(message.content, ctx) } : message),
  });
}


const isFragments = (ctx) => ctx.mode === 'batch';

/** 去掉已经落地的中文风格指南，用来回看它带来的差别。 */
const withoutStyle = (prompt, ctx) => {
  const guide = styleGuide(ctx.target, isFragments(ctx));
  return guide ? prompt.replace(`\n${guide}`, '') : prompt;
};

/** 换成后台托管翻译的提示词（请求参数两边相同：不开思考、温度 1.3）。 */
const hosted = (prompt, ctx) => hostedSystemPrompt(ctx.target, undefined, isFragments(ctx) && ctx.sample.texts.length > 1);

export const variants = {
  baseline: { note: '线上现状', patch: (body) => body },

  'temp-0.7': { note: '温度 0.7', patch: (body) => ({ ...body, temperature: 0.7 }) },
  'temp-1.0': { note: '温度 1.0', patch: (body) => ({ ...body, temperature: 1.0 }) },
  'no-style': { note: '去掉中文风格指南（落地前的提示词）', patch: withSystem(withoutStyle) },
  hosted: { note: '后台托管翻译的提示词', patch: withSystem(hosted) },
  'hosted-no-style': { note: '后台托管提示词，去掉中文风格指南', patch: withSystem((prompt, ctx) => withoutStyle(hosted(prompt, ctx), ctx)) },
  thinking: { note: '开启思考', patch: (body) => ({ ...body, thinking: { type: 'enabled' } }) },
};
