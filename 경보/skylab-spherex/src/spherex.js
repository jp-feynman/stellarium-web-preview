// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026.
/* Stellarium Web Lab + SPHEREx v1.3.0 — SPDX-License-Identifier: AGPL-3.0-only */
// SPHEREx all-sky imagery as a Stellarium Web Engine layer.
//
// The engine draws an image HiPS through two built-in modules with complementary fades:
//   milkyway: smoothstep(10°, 20°, fov) -> full above 20°, gone below 10° (src/modules/milkyway.c)
//   dss:      smoothstep(20°, 10°, fov) -> full below 10°, gone above 20° (src/modules/dss.c)
// core.add(type, {}) creates an extra instance of a module class as a child of core, which the
// engine updates and renders like the built-in one. One instance of each type per channel gives a
// SPHEREx layer at every field of view, under the stars, lines and labels (render orders 5 and 6).
// milkyway.addDataSource() accepts only one source per instance, so a channel change mounts a new
// pair and retires the old pair once the new tiles have had time to arrive.
import { CHANNELS, DEFAULT_CHANNEL, SPHEREX_CUBE_URL, USABLE_CHANNELS, isUsableChannel } from './spherex-channels.js';

const PROBE_TIMEOUT_MS = 6000;
const RETIRE_FADE_MS = 2500;
const RETIRE_REMOVE_MS = 4500;

export function nearestUsableChannel(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_CHANNEL;
  return USABLE_CHANNELS.reduce((best, channel) => (Math.abs(channel - number) < Math.abs(best - number) ? channel : best), USABLE_CHANNELS[0]);
}

export function channelInfo(channel) {
  return CHANNELS[channel - 1];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer' });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the per-channel rewriter: next to the app when it is hosted under /sky/ of the TrueBlink
 * site ('../hips/spherex/'), or provided by this app's own preview server ('./hips/spherex/').
 * A static host that answers every path with an HTML page is not mistaken for it.
 */
export async function probeRewriter(appBase) {
  for (const relative of ['../hips/spherex/', './hips/spherex/']) {
    const root = new URL(relative, appBase).href;
    const text = await fetchText(root + '1/properties');
    if (text && /^\s*hips_tile_format\s*=\s*png/m.test(text) && /^\s*hips_order\s*=/m.test(text)) return root;
  }
  return null;
}

export class SpherexLayer {
  constructor(stel, appBase) {
    this.stel = stel;
    this.appBase = appBase;
    this.channel = DEFAULT_CHANNEL;
    this.enabled = false;
    this.rewriterRoot = undefined; // undefined: not probed yet; null: none, channel 1 straight from IRSA.
    this.mounted = null;
    this.probing = null;
    this.listeners = new Set();
  }

  onChange(listener) { this.listeners.add(listener); }
  emit() { for (const listener of this.listeners) listener(this); }

  /** True when every channel is available; false when only channel 1 can be shown. */
  get perChannel() { return Boolean(this.rewriterRoot); }
  get probed() { return this.rewriterRoot !== undefined; }

  probe() {
    if (!this.probing) {
      this.probing = probeRewriter(this.appBase).then((root) => {
        this.rewriterRoot = root;
        if (!root) this.channel = 1;
        this.emit();
        return root;
      });
    }
    return this.probing;
  }

  sourceUrl(channel) {
    return this.rewriterRoot ? `${this.rewriterRoot}${channel}` : SPHEREX_CUBE_URL;
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    const core = this.stel.core;
    // The bundled visible-light Milky Way would blend confusingly with the infrared mosaic.
    core.milkyway.visible = !enabled;
    if (enabled) {
      this.emit();
      await this.probe();
      if (!this.enabled) return;
      this.mount(this.perChannel ? this.channel : 1);
    } else if (this.mounted) {
      this.mounted.wide.visible = false;
      this.mounted.narrow.visible = false;
    }
    this.emit();
  }

  async setChannel(channel) {
    if (!isUsableChannel(channel)) channel = nearestUsableChannel(channel);
    if (this.probed && !this.perChannel) channel = 1;
    this.channel = channel;
    if (this.enabled && this.probed) this.mount(channel);
    this.emit();
  }

  mount(channel) {
    const current = this.mounted;
    const url = this.sourceUrl(channel);
    if (current && current.url === url) {
      current.wide.visible = true;
      current.narrow.visible = true;
      return;
    }
    const core = this.stel.core;
    const wide = core.add('milkyway', {});
    wide.addDataSource({ url });
    const narrow = core.add('dss', {});
    narrow.addDataSource({ url });
    this.mounted = { url, channel, wide, narrow };
    if (current) this.retire(current);
  }

  retire(pair) {
    // The new pair is drawn after the old one; the old tiles stay underneath while new ones load.
    const core = this.stel.core;
    setTimeout(() => { pair.wide.visible = false; pair.narrow.visible = false; }, RETIRE_FADE_MS);
    setTimeout(() => { core.remove(pair.wide); core.remove(pair.narrow); }, RETIRE_REMOVE_MS);
  }
}
