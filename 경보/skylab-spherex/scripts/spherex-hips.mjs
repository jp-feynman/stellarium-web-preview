// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026.
/* Stellarium Web Lab + SPHEREx v1.3.0 — SPDX-License-Identifier: AGPL-3.0-only */
// Per-channel rewriter for the SPHEREx all-sky HiPS cube.
//
// The Stellarium Web Engine builds tile URLs as <base>/NorderK/DirD/NpixN.<ext> and cannot add
// the cube's _<frame> suffix. This presents every spectral channel as its own ordinary image HiPS:
//   GET /hips/spherex/<c>/properties                 -> generated HiPS properties (text/plain)
//   GET /hips/spherex/<c>/Norder<k>/Dir<d>/Npix<n>.png -> 302 to the IRSA tile of cube frame c - 1
//   GET /hips/spherex/<c>/Norder3/Allsky.png          -> 302 to the IRSA Allsky image of that frame
// Everything else under /hips/spherex/ is 404. Only GET and HEAD are answered.
import { CHANNELS, SPHEREX_CUBE_URL, SPHEREX_RELEASE_DATE, cubeTileName, formatWavelength, isUsableChannel } from '../src/spherex-channels.js';

export const SPHEREX_PREFIX = '/hips/spherex/';
const MAX_ORDER = 5;
const CACHE = 'public, max-age=86400';

export function spherexProperties(channel) {
  const row = CHANNELS[channel - 1];
  const um = formatWavelength(channel);
  return [
    `creator_did          = ivo://IPAC/P/SPHEREx/DR1/cube?channel=${channel}`,
    'creator              = NASA/JPL-Caltech/IPAC, NASA/IPAC Infrared Science Archive (IRSA)',
    `obs_title            = SPHEREx all-sky ${um} um (channel ${channel})`,
    `obs_description      = One spectral channel (cube frame ${channel - 1}) of the SPHEREx DR1 all-sky data cube, served as an ordinary image HiPS. Year-long average: it shows no change over time.`,
    'obs_copyright        = NASA/JPL-Caltech/IPAC, IRSA. SPHEREx DR1 all-sky cube, DOI 10.26131/IRSA679',
    'obs_copyright_url    = https://irsa.ipac.caltech.edu/Missions/spherex.html',
    'obs_ack              = This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.',
    'dataproduct_type     = image',
    'hips_version         = 1.4',
    `hips_release_date    = ${SPHEREX_RELEASE_DATE}`,
    'hips_frame           = equatorial',
    `hips_order           = ${MAX_ORDER}`,
    'hips_order_min       = 0',
    'hips_tile_width      = 512',
    'hips_tile_format     = png',
    'hips_pixel_cut       = 0 40',
    'hips_pixel_function  = asinh',
    `em_min               = ${(row.min * 1e-6).toExponential(4)}`,
    `em_max               = ${(row.max * 1e-6).toExponential(4)}`,
    'moc_sky_fraction     = 1',
    '',
  ].join('\n');
}

/**
 * Resolve a pathname below /hips/spherex/ to a response description:
 * { status: 200, body } for properties, { status: 302, location } for tiles, or { status: 404 }.
 */
export function resolveSpherexPath(pathname) {
  const match = /^\/hips\/spherex\/(\d{1,3})\/(.+)$/.exec(pathname);
  if (!match) return { status: 404 };
  const channel = Number(match[1]);
  if (String(channel) !== match[1] || !isUsableChannel(channel)) return { status: 404 };
  const rest = match[2];
  if (rest === 'properties') return { status: 200, body: spherexProperties(channel) };
  const tile = /^Norder(\d)\/Dir(\d{1,6})\/Npix(\d{1,6})\.png$/.exec(rest);
  if (tile) {
    const [order, dir, pix] = tile.slice(1).map(Number);
    if (order > MAX_ORDER || pix >= 12 * 4 ** order || dir !== Math.floor(pix / 10000) * 10000) return { status: 404 };
    return { status: 302, location: `${SPHEREX_CUBE_URL}/Norder${order}/Dir${dir}/${cubeTileName(channel, pix)}` };
  }
  if (rest === 'Norder3/Allsky.png') {
    return { status: 302, location: `${SPHEREX_CUBE_URL}/Norder3/${channel === 1 ? 'Allsky.png' : `Allsky_${channel - 1}.png`}` };
  }
  return { status: 404 };
}

/** Node http handler. Returns true when the request was below /hips/spherex/ and has been answered. */
export function handleSpherexHips(req, res, pathname) {
  if (!pathname.startsWith(SPHEREX_PREFIX)) return false;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': CACHE };
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { ...cors, Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return true;
  }
  const result = resolveSpherexPath(pathname);
  if (result.status === 200) {
    const body = Buffer.from(result.body);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } else if (result.status === 302) {
    res.writeHead(302, { ...cors, Location: result.location });
    res.end();
  } else {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Not found');
  }
  return true;
}
