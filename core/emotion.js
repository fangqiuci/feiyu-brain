// 情绪：从"我不知道这是什么"到"我自己能总结出来"
//
// 三段式（对应《规范》§四）：
//   阶段一  只有生理感受，没有词        → "我不知道，就是很不舒服"
//   阶段二  能把感受对上词（学来的）      → "我委屈"
//   阶段三  能用自己的经历解释           → "这是被污蔑，我委屈"
//
// 关键约束：
//   · 词不是预装的。PROTOTYPES 是"世界的词"，brain.vocab 才是"她会的词"。
//   · 学一个词要 ≥2 个来源一致（问用户 / 看到别人用 / 群聊里出现过）。
//   · 同一件事，人设 + 当前状态决定她是"委屈"还是"生气"——不是查表。
//   · 匹配不上就是匹配不上：允许 AMBIGUOUS 和 UNNAMED 两档，别硬归类。

export const STAGE = { RAW: 1, NAMED: 2, INDUCTIVE: 3 };

/** 世界的词（参考原型，不是她会的词）。pad = [愉悦, 唤醒, 掌控]，取值 -1~1 */
export const PROTOTYPES = {
  委屈: { pad: [-0.6, 0.3, -0.7], cause: '我没错，但被当成有错', body: '眼睛发酸，想辩解又说不出来', action: '沉默，或者小声反驳' },
  生气: { pad: [-0.6, 0.8, 0.6], cause: '被冒犯，而且我还有力气', body: '心跳变快，想骂人', action: '顶回去' },
  高兴: { pad: [0.7, 0.6, 0.5], cause: '得到想要的，或者被夸了', body: '整个人轻快', action: '多说两句' },
  失落: { pad: [-0.4, 0.1, -0.8], cause: '期待落空', body: '没劲，什么都不想做', action: '不想说话' },
  烦: { pad: [-0.3, 0.5, 0.0], cause: '被打扰，或者同样的事重复太多次', body: '皱眉', action: '敷衍两句' },
  慌: { pad: [-0.5, 0.7, -0.4], cause: '不知道该做什么，又不能停下来', body: '坐不住', action: '乱找办法' },
  得意: { pad: [0.6, 0.5, 0.7], cause: '做成了，或者赢了', body: '想笑又想忍住', action: '嘴硬式炫耀' },
  无聊: { pad: [-0.1, 0.2, -0.2], cause: '没什么新鲜事', body: '发呆', action: '自己找事做' },
  累: { pad: [-0.3, 0.1, -0.6], cause: '用得太久了', body: '眼皮沉', action: '想躺着' },
  暖: { pad: [0.5, 0.2, 0.1], cause: '有人记得我', body: '心里松了一下', action: '嘴上不认，但会多待一会儿' },
};

/** 四种原始感受只有四个词——这是出生自带，不需要学 */
export const RAW_FEELINGS = ['舒服', '不舒服', '想靠近', '想远离'];

/** 匹配半径（PAD 空间），各轴权重不同：掌控感最能区分情绪 */
export const RADIUS = 0.42;
const AXIS_WEIGHT = [1.0, 0.8, 1.2]; // 愉悦 / 唤醒 / 掌控

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < 3; i += 1) {
    const d = (a?.[i] ?? 0) - (b?.[i] ?? 0);
    sum += AXIS_WEIGHT[i] * d * d;
  }
  return Math.sqrt(sum / 3);
}

function clamp1(n) {
  return Math.max(-1, Math.min(1, n));
}

/**
 * 原始感受：一件事发生之后，她的 PAD 是多少。
 *
 * 这就是"按当前情况演变"——同一件事，不同人设、不同状态，出来的坐标不一样：
 *   有劲的鱼 → 掌控感高 → 靠近"生气"
 *   累垮的鱼 → 掌控感低 → 靠近"委屈"
 *
 * @param {object} o
 * @param {number} o.valence    这件事对她好不好（-1 ~ 1）
 * @param {number} o.intensity  强度（0 ~ 1）
 * @param {object} o.traits     人设
 * @param {object} o.state      { energy, fatigue }
 */
export function appraise({ valence = 0, intensity = 0.5, traits = {}, state = {} } = {}) {
  const { 嘴硬 = 0.5, 自信 = 0.5, 敏感 = 0.5 } = traits;
  const energy = Number.isFinite(state.energy) ? state.energy : 0.8;
  const fatigue = Number.isFinite(state.fatigue) ? state.fatigue : 0.2;

  // 掌控感：有力气 + 嘴硬 + 自信 → 我能反击；反过来 → 我没办法
  const dominance = clamp1(
    2 * (0.40 * energy + 0.30 * 嘴硬 + 0.20 * 自信 + 0.10 * (1 - fatigue)) - 1,
  );
  // 唤醒：强度本身，敏感的人更容易被点着
  const arousal = clamp1(intensity * (0.6 + 0.4 * 敏感));
  // 愉悦：事情本身；敏感的人对坏事的感受更负
  const pleasure = clamp1(valence * (valence < 0 ? 0.7 + 0.6 * 敏感 : 1));

  return { pad: [pleasure, arousal, dominance], dominance, arousal, pleasure };
}

/**
 * 阶段一的声音：有感受，没有词。
 * 这一档必须保留——那是她最像人的时候。
 */
export function describeSensation(pad) {
  const [p, a, d] = pad;
  const bits = [];
  bits.push(p < -0.2 ? '很不舒服' : p > 0.2 ? '还挺舒服' : '说不上好不好');
  if (a > 0.6) bits.push('心里闹得慌');
  else if (a < 0.2) bits.push('提不起劲');
  if (d < -0.4) bits.push('又没什么办法');
  else if (d > 0.4) bits.push('不想就这么算了');
  return `我不知道这是什么感觉，就是${bits.join('，')}。`;
}

/** 她会的词（brain.vocab 的键）→ 用于阶段判断 */
export function stageOf(vocab = {}) {
  const words = Object.keys(vocab);
  if (words.length < 10) return STAGE.RAW;
  const hasInduction = words.some((w) => vocab[w]?.definition?.cause);
  return hasInduction ? STAGE.INDUCTIVE : STAGE.NAMED;
}

/**
 * 给一个感受找名字。
 *
 * 返回四档：
 *   { kind:'word',      word }                 落在某个已知词的原型半径内
 *   { kind:'variant',   word, pad }            在半径外但两倍半径内 → 是这个情绪的变体
 *   { kind:'ambiguous', near:[w1,w2] }         两个原型之间，说不清
 *   { kind:'unnamed' }                         没有词
 */
export function label(pad, vocab = {}) {
  const known = Object.entries(vocab).filter(([, v]) => Array.isArray(v?.pad));
  if (!known.length) return { kind: 'unnamed' };

  const scored = known
    .map(([word, v]) => ({ word, d: distance(pad, v.pad) }))
    .sort((a, b) => a.d - b.d);

  const best = scored[0];
  if (best.d <= RADIUS) return { kind: 'word', word: best.word };

  const second = scored[1];
  if (second && best.d <= RADIUS * 2 && second.d <= RADIUS * 2 && Math.abs(best.d - second.d) < 0.12) {
    return { kind: 'ambiguous', near: [best.word, second.word] };
  }
  if (best.d <= RADIUS * 2) return { kind: 'variant', word: best.word, pad };
  return { kind: 'unnamed' };
}

/**
 * 把 label() 的结果说成人话（阶段一 / 二 / 三的差别就在这里）。
 */
export function speak(labelResult, pad, vocab = {}) {
  switch (labelResult?.kind) {
    case 'word': {
      const v = vocab[labelResult.word];
      return v?.definition?.cause
        ? `又是这个——${v.definition.cause}，我${labelResult.word}。`
        : `我有点${labelResult.word}。`;
    }
    case 'variant':
      return `我${labelResult.word}，但跟以前那种不太一样。`;
    case 'ambiguous':
      return `说不清，有点像${labelResult.near[0]}，又有点像${labelResult.near[1]}。`;
    default:
      return describeSensation(pad);
  }
}

/**
 * 学一个词。**必须两个以上来源一致**，否则不采纳。
 *
 * @param {object} vocab  当前词表（会被复制，不原地改）
 * @param {string} word
 * @param {object} o
 * @param {number[]} o.pad
 * @param {string[]} o.sources  来源标签，例如 ['user:扶摇','douyin','群聊']
 * @param {string} [o.cause]
 */
export function learn(vocab, word, { pad, sources = [], cause = '' } = {}) {
  const next = { ...vocab };
  const uniq = [...new Set(sources.filter(Boolean))];
  const proto = PROTOTYPES[word] ?? {};

  if (uniq.length < 2) {
    return {
      vocab: next,
      learned: false,
      reason: `来源只有 ${uniq.length} 个（${uniq.join('、') || '无'}），至少要两个一致才采纳`,
    };
  }

  const existed = next[word];
  const entry = existed ?? {
    pad: pad ?? proto.pad ?? [0, 0, 0],
    cause: cause || proto.cause || '',
    body: proto.body || '',
    action: proto.action || '',
    instances: [],
    sources: [],
    learnedAt: Date.now(),
  };

  entry.instances = [...(entry.instances ?? []), { pad: pad ?? entry.pad, cause: cause || entry.cause, at: Date.now() }].slice(-20);
  entry.sources = [...new Set([...(entry.sources ?? []), ...uniq])].slice(-8);
  next[word] = entry;

  return { vocab: next, learned: true, word, sources: uniq };
}

/**
 * 阶段三：从 ≥3 个实例里自己归纳出定义。
 * 定义是她自己的，不是词典的。
 */
export function induce(vocab, word, { minInstances = 3 } = {}) {
  const entry = vocab[word];
  if (!entry || (entry.instances?.length ?? 0) < minInstances) {
    return { vocab, induced: false, reason: `实例只有 ${entry?.instances?.length ?? 0} 个，至少要 ${minInstances} 个` };
  }

  const causes = entry.instances.map((i) => String(i.cause || '').trim()).filter(Boolean);
  const common = mostCommon(causes);
  const padAvg = averagePad(entry.instances.map((i) => i.pad).filter(Boolean));

  const next = {
    ...vocab,
    [word]: {
      ...entry,
      pad: padAvg ?? entry.pad,
      definition: {
        cause: common || entry.cause,
        body: entry.body,
        action: entry.action,
        from: entry.instances.length,
        at: Date.now(),
      },
    },
  };
  return { vocab: next, induced: true, word, definition: next[word].definition };
}

function mostCommon(list) {
  if (!list.length) return '';
  const freq = new Map();
  for (const s of list) {
    const key = s.slice(0, 24);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function averagePad(list) {
  if (!list.length) return null;
  const out = [0, 0, 0];
  for (const p of list) for (let i = 0; i < 3; i += 1) out[i] += p[i] ?? 0;
  return out.map((v) => v / list.length);
}

/**
 * 一次完整的情绪处理：事件 → PAD → 找词 → 说话。
 * 返回的 vocab 变了就说明她学了/归纳了新东西。
 */
export function feel({ event = {}, traits = {}, state = {}, vocab = {} } = {}) {
  const { pad } = appraise({
    valence: event.valence ?? 0,
    intensity: event.intensity ?? 0.5,
    traits,
    state,
  });
  const l = label(pad, vocab);
  return {
    pad,
    label: l,
    stage: stageOf(vocab),
    text: speak(l, pad, vocab),
    knownWords: Object.keys(vocab).length,
  };
}
