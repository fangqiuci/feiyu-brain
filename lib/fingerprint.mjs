// 人格指纹：她还是不是她。
//
// 静默漂移只能事后发现，所以每次出生/蜕壳算一次指纹，写进 audit。
// 升级、降级、从快照恢复之后一比，就知道"人设有没有被动过"。

import { createHash } from 'node:crypto';

export function fingerprint(units = [], traits = {}) {
  const basis = (units ?? [])
    .map((u) => `${u.id}:${u.kind}:${String(u.text ?? '').slice(0, 40)}`)
    .sort()
    .join('|');
  const t = Object.keys(traits ?? {})
    .sort()
    .map((k) => `${k}=${Number(traits[k]).toFixed(3)}`)
    .join(',');
  return createHash('sha256').update(`${basis}#${t}`).digest('hex').slice(0, 16);
}

export function describe(fp) {
  return fp ? `人设指纹 ${fp}` : '人设指纹（还没算过）';
}
