// 身体驱动：真的去开 App、真的去截图、真的去卸载。
//
// 三种驱动：
//   adb      Android 手机 / 平板 / 模拟器（真开 App、真截图、真卸载）
//   desktop  电脑（启动程序、截屏；卸载一律拒绝——太危险）
//   dry      没有设备时的占位驱动，返回 E_NO_DEVICE
//
// 设计约束（对应《规范》§八）：
//   · 每个动作都必须留下 evidence，没有证据的动作不算发生
//   · 卸载要过「临界点 + 三问」，不是想删就删
//   · 驱动失败不抛异常，返回 { ok:false, code, reason }

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

function ok(extra = {}) {
  return { ok: true, ...extra };
}

function fail(code, reason) {
  return { ok: false, code, reason };
}

/* ── Android（adb）────────────────────────────────────────────── */

export class AdbDriver {
  constructor({ adbPath = 'adb', deviceId = '', evidenceDir = 'evidence', timeoutMs = 15000 } = {}) {
    this.kind = 'adb';
    this.adbPath = adbPath;
    this.deviceId = deviceId;
    this.evidenceDir = evidenceDir;
    this.timeoutMs = timeoutMs;
  }

  async adb(args, { binary = false } = {}) {
    const full = this.deviceId ? ['-s', this.deviceId, ...args] : args;
    const { stdout } = await run(this.adbPath, full, {
      timeout: this.timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: binary ? 'buffer' : 'utf8',
    });
    return stdout;
  }

  async devices() {
    try {
      const out = await this.adb(['devices']);
      return String(out)
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('*'))
        .map((l) => l.split(/\s+/))
        .filter(([id, state]) => id && state === 'device')
        .map(([id]) => id);
    } catch {
      return [];
    }
  }

  async exec(action) {
    try {
      const list = await this.devices();
      if (!list.length) return fail('E_NO_DEVICE', 'adb 没连上任何设备（先开 USB 调试 / 启动模拟器）');
      if (!this.deviceId) this.deviceId = list[0];

      switch (action.type) {
        case 'screenshot': {
          const buf = await this.adb(['exec-out', 'screencap', '-p'], { binary: true });
          const dir = this.evidenceDir;
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `shot-${Date.now()}.png`);
          fs.writeFileSync(file, buf);
          return ok({ evidence: file, bytes: buf.length });
        }
        case 'open_app': {
          const pkg = action.package;
          if (!pkg) return fail('E_ARGS', 'open_app 需要 package');
          await this.adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
          const shot = await this.exec({ type: 'screenshot' });
          return ok({ evidence: shot.evidence, app: pkg });
        }
        case 'uninstall': {
          const pkg = action.package;
          if (!pkg) return fail('E_ARGS', 'uninstall 需要 package');
          const out = await this.adb(['uninstall', pkg]);
          if (!/Success/i.test(String(out))) return fail('E_UNINSTALL', String(out).trim().slice(0, 120));
          return ok({ evidence: `adb:uninstall:${pkg}`, app: pkg });
        }
        case 'tap': {
          await this.adb(['shell', 'input', 'tap', String(action.x ?? 0), String(action.y ?? 0)]);
          return ok({ evidence: `adb:tap:${action.x},${action.y}` });
        }
        case 'swipe': {
          await this.adb(['shell', 'input', 'swipe', String(action.x1), String(action.y1), String(action.x2), String(action.y2), String(action.ms ?? 300)]);
          return ok({ evidence: `adb:swipe` });
        }
        default:
          return fail('E_UNKNOWN_ACTION', `不认识的动作用：${action.type}`);
      }
    } catch (e) {
      return fail('E_DRIVER', String(e?.message ?? e).slice(0, 200));
    }
  }
}

/* ── 桌面（Windows）──────────────────────────────────────────── */

export class DesktopDriver {
  constructor({ evidenceDir = 'evidence', timeoutMs = 20000 } = {}) {
    this.kind = 'desktop';
    this.evidenceDir = evidenceDir;
    this.timeoutMs = timeoutMs;
  }

  async exec(action) {
    try {
      switch (action.type) {
        case 'open_app': {
          const target = action.target || action.package;
          if (!target) return fail('E_ARGS', 'open_app 需要 target');
          await run('powershell', ['-NoProfile', '-Command', `Start-Process ${JSON.stringify(target)}`], { timeout: this.timeoutMs });
          return ok({ evidence: `desktop:start:${target}`, app: target });
        }
        case 'screenshot': {
          const dir = this.evidenceDir;
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `shot-${Date.now()}.png`);
          const ps = [
            'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
            '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;',
            '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;',
            '$g=[System.Drawing.Graphics]::FromImage($bmp);',
            '$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);',
            `$bmp.Save('${file.replace(/\\/g, '\\\\')}');`,
          ].join('');
          await run('powershell', ['-NoProfile', '-Command', ps], { timeout: this.timeoutMs });
          return fs.existsSync(file) ? ok({ evidence: file }) : fail('E_SCREENSHOT', '截屏没生成文件');
        }
        case 'uninstall':
          // 桌面卸载 = 删程序，不可逆。一律拒绝，走人工。
          return fail('E_FORBIDDEN', '电脑上不允许自己卸载软件——太不可逆，必须人来');
        default:
          return fail('E_UNKNOWN_ACTION', `电脑上不支持：${action.type}`);
      }
    } catch (e) {
      return fail('E_DRIVER', String(e?.message ?? e).slice(0, 200));
    }
  }
}

/* ── 空驱动：没有设备时 ─────────────────────────────────────── */

export class DryDriver {
  constructor() {
    this.kind = 'dry';
  }

  async exec() {
    return fail('E_NO_DEVICE', '没有接任何设备——想而不得');
  }
}

/**
 * 按身体类型造驱动。
 * @param {object} body   createBody() 的结果
 * @param {object} [opts] { adbPath, deviceId, evidenceDir }
 */
export function driverFor(body, opts = {}) {
  if (!body) return new DryDriver();
  if (body.kind === 'phone' || body.kind === 'tablet' || body.emulated) {
    return new AdbDriver({ ...opts, evidenceDir: opts.evidenceDir ?? `state/evidence/${body.kind}` });
  }
  if (body.kind === 'desktop') {
    return new DesktopDriver({ ...opts, evidenceDir: opts.evidenceDir ?? 'state/evidence/desktop' });
  }
  return new DryDriver();
}

export { ok, fail };
