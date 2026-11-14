import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../navigation.js', import.meta.url), 'utf8');

function setup(connection) {
  const listeners = new Map();
  const attributes = new Map();
  const link = {
    href: 'https://example.test/sky-lab/planetarium/',
    addEventListener: (name, fn) => listeners.set(name, fn),
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const status = { hidden: true, textContent: '' };
  const resources = [], activity = [], navigations = [];
  const events = new Map(), frames = new Map(), timers = new Map();
  let serial = 0;
  vm.runInNewContext(source, {
    URL,
    navigator: { connection },
    document: {
      baseURI: 'https://example.test/sky-lab/',
      querySelectorAll: () => [link], getElementById: () => status,
      createElement: () => ({}), head: { append: (resource) => resources.push(resource) },
    },
    window: {
      __hero: { setActive: (value) => activity.push(value) },
      location: { assign: (url) => navigations.push(url) },
      addEventListener: (name, fn) => events.set(name, fn),
    },
    requestAnimationFrame: (fn) => { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn) => { const id = ++serial; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  function click(extra = {}) {
    const event = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    listeners.get('click')(event);
    return event;
  }
  function paint() {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((fn) => fn());
  }
  return { link, status, resources, activity, navigations, listeners, attributes, events, frames, timers, click, paint };
}

test('prewarms only two engine files once, on pointer or keyboard intent', () => {
  const s = setup();
  assert.equal(s.resources.length, 0);
  s.listeners.get('focusin')();
  s.listeners.get('pointerenter')();
  assert.deepEqual(s.resources.map((r) => r.href), [
    'https://example.test/sky-lab/planetarium/engine/stellarium-web-engine.js',
    'https://example.test/sky-lab/planetarium/engine/stellarium-web-engine.wasm',
  ]);
  assert.ok(s.resources.every((r) => r.rel === 'prefetch'));
});

test('does not prefetch on a metered or slow connection', () => {
  for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
    const s = setup(connection);
    s.listeners.get('pointerenter')();
    assert.equal(s.resources.length, 0);
  }
});

test('pauses the hero and paints feedback before one same-tab navigation', () => {
  const s = setup();
  assert.equal(s.click().defaultPrevented, true);
  assert.deepEqual(s.activity, [false]);
  assert.equal(s.status.hidden, false);
  assert.match(s.status.textContent, /플라네타리움 준비/);
  s.click(); // Repeated clicks should not schedule duplicate navigation.
  s.paint();
  assert.equal(s.navigations.length, 0);
  s.paint();
  assert.deepEqual(s.navigations, [s.link.href]);
  assert.equal(s.timers.size, 0);
});

test('preserves modified clicks, middle clicks, downloads and new-tab links', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    const s = setup();
    assert.equal(s.click({ [modifier]: true }).defaultPrevented, false);
    assert.equal(s.activity.length, 0);
  }
  for (const attrs of [{ target: '_blank' }, { download: '' }]) {
    const s = setup();
    for (const [key, value] of Object.entries(attrs)) s.attributes.set(key, value);
    assert.equal(s.click().defaultPrevented, false);
  }
  const s = setup();
  assert.equal(s.click({ button: 1 }).defaultPrevented, false);
  assert.equal(s.navigations.length, 0);
});

test('restores the hero and link when returning through browser history', () => {
  const s = setup();
  s.click();
  s.events.get('pagehide')();
  s.events.get('pageshow')();
  assert.equal(s.status.hidden, true);
  assert.equal(s.attributes.has('aria-busy'), false);
  assert.equal(s.frames.size, 0);
  assert.equal(s.timers.size, 0);
  assert.equal(s.activity.at(-1), true);
  s.paint();
  assert.equal(s.navigations.length, 0);
  assert.equal(s.click().defaultPrevented, true); // A new transition still works.
});

test('still navigates once if animation callbacks are suspended', () => {
  const s = setup();
  s.link.href += '?view=allsky';
  s.click();
  assert.match(s.status.textContent, /전천 지도 준비/);
  const timer = [...s.timers.values()][0];
  timer();
  timer();
  s.paint();
  assert.deepEqual(s.navigations, [s.link.href]);
});
