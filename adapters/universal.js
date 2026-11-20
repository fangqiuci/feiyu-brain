// 适配器三：任意平台（带自己的传输）
//
// 只要你能把消息变成 { sender, text, chatId }，就能用这个。
// 大脑不认识平台——它只认识事件。

import { normalizeEvent } from '../core/event.js';

/**
 * 最小宿主：把"收到消息"和"注入 prompt"接起来。
 *
 * @param {object} opts
 * @param {object} opts.brain   createBrain() 的返回值
 * @param {(injected:string, event:object) => string} [opts.buildSystemPrompt]
 * @param {(system:string, event:object) => void} [opts.onContext]
 */
export function createUniversalHost({ brain, buildSystemPrompt, onContext } = {}) {
  if (!brain) throw new Error('需要 brain 实例');

  return {
    /**
     * 收到一条消息 → 返回该拼进 system prompt 的那一段。
     * 顺便让她"经历"这条消息（权重会动）。
     */
    handle(rawEvent) {
      const event = normalizeEvent(rawEvent, rawEvent?.platform ?? 'universal');
      const { text: injected } = brain.wake(event);
      const system = buildSystemPrompt ? buildSystemPrompt(injected, event) : injected;
      if (onContext) onContext(system, event);
      return { event, injected, system };
    },

    /** 只记录，不唤醒（比如她自己发的消息、系统通知） */
    record(rawEvent) {
      return brain.observe(normalizeEvent(rawEvent, rawEvent?.platform ?? 'universal'));
    },
  };
}

export { normalizeEvent };
