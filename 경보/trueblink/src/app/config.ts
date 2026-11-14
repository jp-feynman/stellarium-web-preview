// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// App-wide constants: name, links and data credits. Change the display name here only.

export const APP_NAME = 'TrueBlink for SPHEREx';
export const APP_SHORT_NAME = 'TrueBlink';
export const TAGLINE = 'Blink the infrared sky over time, comparing like with like.';
export const REPOSITORY_URL = 'https://github.com/jp-feynman/stellarium-web-preview/tree/main/%EA%B2%BD%EB%B3%B4/trueblink';
export const LICENSE_NAME = 'Apache-2.0';

/**
 * The separate sky app (Stellarium Web Lab + SPHEREx, AGPL-3.0, a teammate's planetarium on the
 * Stellarium Web Engine) when the combined site hosts it under /sky/ (npm run build:site). TrueBlink
 * contains none of its code: it only probes this address once and links to it with URL parameters
 * (?ra=&dec=&fov=&view=sky&spherex=<channel>&name=). Override at build time with VITE_SKY_APP_URL.
 */
export const SKY_APP_URL: string = (import.meta.env?.VITE_SKY_APP_URL as string | undefined) || './sky/';
/** SPHEREx cube channel the sky app shows first (21 = 1.195 um) and its field of view in degrees. */
export const SKY_APP_CHANNEL = 21;
export const SKY_APP_FOV_DEG = 20;

export interface DataCredit {
  id: string;
  name: string;
  provider: string;
  doi?: string;
  url: string;
  /** What we use it for, in plain words. */
  use: string;
}

export const DATA_CREDITS: DataCredit[] = [
  {
    id: 'spherex-dr1',
    name: 'SPHEREx DR1 Level-2 spectral images',
    provider: 'NASA / JPL-Caltech / IPAC (IRSA)',
    doi: '10.26131/IRSA678',
    url: 'https://doi.org/10.26131/IRSA678',
    use: 'Every image you blink (read pixel by pixel from the public AWS bucket nasa-irsa-spherex).',
  },
  {
    id: 'spherex-qr3',
    name: 'SPHEREx Quick Release 3 spectral images',
    provider: 'NASA / JPL-Caltech / IPAC (IRSA)',
    doi: '10.26131/IRSA662',
    url: 'https://doi.org/10.26131/IRSA662',
    use: 'The newest visits (from May 2026), giving a third epoch for most of the sky.',
  },
  {
    id: 'spherex-cube',
    name: 'SPHEREx DR1 all-sky spectral cube',
    provider: 'NASA / JPL-Caltech / IPAC (IRSA)',
    doi: '10.26131/IRSA679',
    url: 'https://doi.org/10.26131/IRSA679',
    use: 'Static reference images and the all-sky navigator.',
  },
  {
    id: 'gaia-dr3',
    name: 'Gaia Data Release 3',
    provider: 'ESA / Gaia DPAC',
    doi: '10.1051/0004-6361/202243940',
    url: 'https://www.cosmos.esa.int/web/gaia/dr3',
    use: 'Star positions and proper motions for overlays and for checking our measured motions.',
  },
  {
    id: 'allwise',
    name: 'AllWISE',
    provider: 'NASA / JPL-Caltech / IPAC (IRSA)',
    doi: '10.26131/IRSA1',
    url: 'https://doi.org/10.26131/IRSA1',
    use: 'Older infrared images (2010) that make slow motions obvious.',
  },
  {
    id: '2mass',
    name: '2MASS',
    provider: 'University of Massachusetts / IPAC (IRSA)',
    doi: '10.26131/IRSA2',
    url: 'https://doi.org/10.26131/IRSA2',
    use: 'Near-infrared images from 1998-2001 as a long time baseline.',
  },
  {
    id: 'cds',
    name: 'CDS Sesame, SIMBAD and VizieR',
    provider: 'CDS, Strasbourg Astronomical Observatory',
    url: 'https://cds.unistra.fr/',
    use: 'Turning a name into coordinates and catalogue queries.',
  },
  {
    id: 'skybot',
    name: 'SkyBoT',
    provider: 'IMCCE, Paris Observatory',
    url: 'https://ssp.imcce.fr/webservices/skybot/',
    use: 'Known asteroids and comets that crossed the field.',
  },
];

/** Required acknowledgement sentence for SPHEREx data (IRSA SPHEREx mission page). */
export const SPHEREX_ACKNOWLEDGEMENT =
  'This publication makes use of data products from the Spectro-Photometer for the History of the Universe, ' +
  'Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory ' +
  'and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.';

export const LINKS = {
  explanatorySupplement: 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf',
  anomalyImages: 'https://spherex.caltech.edu/page/anomalyimages',
  irsaSpherex: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
  challenge: 'https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/',
} as const;

/** Default field of view (arcsec) and blink speed (ms per frame). */
export const DEFAULT_FOV_ARCSEC = 180;
export const DEFAULT_SPEED_MS = 600;
export const MIN_FOV_ARCSEC = 60;
export const MAX_FOV_ARCSEC = 780;
/** Never blink faster than this: frames at different brightness flash, see WCAG 2.3.1 (three flashes a second). */
export const MIN_SPEED_MS = 350;
export const MAX_SPEED_MS = 3000;

/** Real pipeline: exposures loaded per field before "load more", parallel cutout loads, search timeout. */
export const MAX_EXPOSURES_PER_FIELD = 360;
export const PARALLEL_CUTOUTS = 12;
export const SEARCH_TIMEOUT_MS = 12000;
/** Field-of-view choices offered in the viewer (arcsec). */
export const FOV_CHOICES_ARCSEC = [120, 180, 300, 600];
