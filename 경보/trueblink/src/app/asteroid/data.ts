// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// Measured asteroid files (public/data/asteroids/*.json), bundled as lazy chunks so they load the same
// way in the app, the demo page and the unit tests, whatever the page's base URL.
import indexJson from '../../../public/data/asteroids/index.json';
import type { AsteroidFile, AsteroidIndexEntry } from './analysis';

const loaders = import.meta.glob<AsteroidFile>(['../../../public/data/asteroids/*.json', '!../../../public/data/asteroids/index.json'], { import: 'default' });

export const ASTEROID_INDEX: AsteroidIndexEntry[] = (indexJson as { asteroids: AsteroidIndexEntry[] }).asteroids;

const cache = new Map<string, Promise<AsteroidFile>>();

export function loadAsteroid(id: string): Promise<AsteroidFile> {
  let p = cache.get(id);
  if (!p) {
    const entry = ASTEROID_INDEX.find((a) => a.id === id);
    const key = entry ? Object.keys(loaders).find((k) => k.endsWith(`/${entry.file}`)) : undefined;
    if (!key) return Promise.reject(new Error(`unknown asteroid "${id}"`));
    p = loaders[key]();
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
