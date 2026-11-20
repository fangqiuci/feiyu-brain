// 从人设卡里"长"出东西——不是从外部配置读。
//
// 规范 §2.1：人设是根，其余都是长出来的。
// 所以 traits 和 units 都必须从 roles/<角色>.md 抽取，而不是写死一组数字。
// 同一张卡永远抽出同一组值（确定性），换一张卡就长出另一条鱼。

/**
 * 特质词表：特质 → 该特质在文本里的说法。
 * 这不是"设定"，是"词典"——用来读人设卡，不是用来规定她。
 */
export const TRAIT_LEXICON = {
  嘴硬: ['傲娇', '嘴硬', '毒舌', '顶回去', '怼', '不服软', '嘴不饶人', '嘴炮', '不认错', '伶牙俐齿'],
  心软: ['心软', '温柔', '在意', '心疼', '放下傲娇', '认真接一句', '软了', '舍不得', '护着'],
  好奇: ['好奇', '有意思', '新鲜', '好玩', '感兴趣', '想看看', '新鲜感', '什么都想'],
  好动: ['好动', '闲不住', '主动', '活跃', '动起来', '坐不住', '折腾', '跑来跑去'],
  敏感: ['敏感', '察觉', '细腻', '注意到', '放在心上', '记着', '被戳'],
  固执: ['固执', '倔', '不认', '坚持', '一根筋', '改不了', '认死理'],
  自信: ['自信', '实力', '靠谱', '不含糊', '有把握', '我说了算'],
  爱反思: ['反思', '琢磨', '想过', '回头看', '复盘', '反省'],
  理性: ['理性', '逻辑', '判断', '正事', '分析', '讲道理'],
  社交: ['黏人', '找人', '陪聊', '社交', '熟人', '热闹', '凑过去', '搭话'],
  活泼: ['活泼', '元气', '开心', '高兴', '爱笑', '欢喜', '闹'],
  懒: ['懒', '懒得', '不想动', '躺', '摆烂', '摸鱼'],
};

/** 角色卡里可以直接写：`性格：嘴硬=0.9 心软=0.6` —— 手写覆盖自动统计 */
const HINT_RE = /^(?:性格|特质|traits)\s*[:：]\s*(.+)$/im;

/** 压缩指数：让"出现最多的特质"不至于把其余全部压到地板。
 *  1.0 = 原始比例（很极端）；0.7 = 感知上更接近"人都有一点"。 */
const TRAIT_CURVE = 0.7;

function countKeyword(text, words) {
  let n = 0;
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(w, from);
      if (at < 0) break;
      n += 1;
      from = at + w.length;
    }
  }
  return n;
}

/**
 * 从人设卡正文抽出 traits（0~1）。
 */
export function extractTraits(cardText) {
  const raw = {};
  for (const [trait, words] of Object.entries(TRAIT_LEXICON)) {
    raw[trait] = countKeyword(cardText, words);
  }
  const max = Math.max(1, ...Object.values(raw));
  const traits = {};
  for (const [trait, n] of Object.entries(raw)) {
    const scaled = Math.pow(n / max, TRAIT_CURVE);
    traits[trait] = Math.max(0.15, Math.min(1, scaled));
  }
  return traits;
}

/**
 * 手写覆盖：卡里写一行 `性格：嘴硬=0.9 心软=0.6`，就按这个来。
 * 用来治"自动统计抽不准"——人比算法更知道她是啥样。
 */
export function applyTraitHints(traits = {}, cardText = '') {
  const m = HINT_RE.exec(String(cardText));
  if (!m) return traits;
  const out = { ...traits };
  for (const part of m[1].split(/[,，\s]+/).filter(Boolean)) {
    const [k, v] = part.split(/[=:：]/);
    const name = String(k ?? '').trim();
    const num = Number(String(v ?? '').trim());
    if (!name || !Number.isFinite(num)) continue;
    out[name] = Math.max(0, Math.min(1, num));
  }
  return out;
}

const SKIP_SECTIONS = [/^六、/, /^七、/]; // 六：AI 味黑名单；七：回复示例

/** 关于"这张卡本身"的说明，不是她。 */
const META_RE = /本卡|提示词|角色卡|这里不重复|完整角色卡|由 .*预设/;

/** 以"你是/我叫/本体是"开头的才是身份。放宽会误伤"你是谁"这种引用。 */
const IDENTITY_RE = /^(你是|我叫|本体是)/;
const CONSTRAINT_RE = /不要|别|绝不|禁止|不认|不叫/;

/** 去掉 Markdown 标记——QQ 上 ** 和 ` 会显示成乱码。 */
export function plainText(t) {
  return String(t)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从人设卡抽出"命题"（units）。
 *
 * kind 决定初始权重：
 *   identity   1.00  → 永不衰减（I2）
 *   constraint 0.85  → 强约束
 *   preference 0.70
 *   其余        0.60  → 靠经历慢慢涨落
 */
export function extractUnits(cardText, { max = 200 } = {}) {
  const lines = cardText.split(/\r?\n/);
  const units = [];
  let section = '';
  let sectionSkipped = false;

  const push = (raw, kind, weight) => {
    const t = plainText(raw);
    if (t.length < 5 || t.length > 140) return;
    if (/^(例如|比如|例子)/.test(t)) return;
    if (META_RE.test(t)) return;
    // `性格：嘴硬=0.9` 是给解析器的指令，不是她的一条人格
    if (/^(?:性格|特质|traits)\s*[:：]/i.test(t)) return;
    if (units.length >= max) return;
    units.push({
      id: `u${String(units.length + 1).padStart(3, '0')}`,
      text: t,
      kind,
      weight,
      born: 0,
      lastTouched: 0,
      section,
    });
  };

  for (const rawLine of lines) {
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    if (!line) continue;
    // 缩进的子项是"例子"，不是"命题"（梗列表、示范句都在这一层）
    if (indent >= 2) continue;

    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = plainText(heading[1]);
      sectionSkipped = SKIP_SECTIONS.some((re) => re.test(section));
      continue;
    }
    if (sectionSkipped) continue;

    let text = null;
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    const quote = /^>\s+(.+)$/.exec(line);
    if (bullet) text = bullet[1];
    else if (numbered) text = numbered[1];
    else if (quote) text = quote[1];
    else if (!line.startsWith('#') && line.length >= 8) text = line; // 散文段落也是命题
    if (!text) continue;

    // 「你不要：xxx」这种是反例，不是她
    if (/^(你不要|也不要|你可以|或者：)/.test(text)) continue;

    const clean = plainText(text);
    let kind = 'trait';
    let weight = 0.6;
    if (IDENTITY_RE.test(clean)) {
      kind = 'identity';
      weight = 1;
    } else if (CONSTRAINT_RE.test(clean)) {
      kind = 'constraint';
      weight = 0.85;
    } else if (/喜欢|爱吃|偏|更愿意|懒得/.test(clean)) {
      kind = 'preference';
      weight = 0.7;
    }
    push(clean, kind, weight);
  }

  return units;
}

/**
 * 一条鱼从一张人设卡出生。
 * 同一张卡 → 同一组 units（确定性，可回放）。
 */
export function birthFromCard(cardText, { traitsOverride = null } = {}) {
  const auto = extractTraits(cardText);
  const hinted = applyTraitHints(auto, cardText);
  return {
    traits: { ...hinted, ...(traitsOverride ?? {}) },
    units: extractUnits(cardText),
  };
}
