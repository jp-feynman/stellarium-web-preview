// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Every Level-2 file that covers the target, one row per exposure and detector. Rendering is
// windowed (only the rows in view exist in the DOM) so thousands of rows stay fast. Each row links
// to the public FITS file in the S3 bucket; the whole table can be exported as CSV.

import { useMemo, useRef, useState } from 'react';
import { useT } from './chart';
import { detectorColor, fill, fmtNum, mjdToUtc, s3HttpsUrl, sortRows, toCsv, windowRange } from './helpers';
import type { SortDir } from './helpers';
import type { Translate } from './strings';

export type ExposureStatus = 'pending' | 'loaded' | 'off-detector' | 'error';

export interface ExposureRow {
  id: string;
  obsId: string;
  detector: number;
  mjd: number;
  wavelength: number;
  bandwidth: number;
  cubeChannel: number;
  release: string;
  collection: string;
  flagsSummary?: string;
  s3Key: string;
  status: ExposureStatus;
}

export interface ExposureTableProps {
  rows: ExposureRow[];
  onSelect?: (id: string) => void;
  t?: Translate;
  /** Visible height of the scrolling body in px (default 360). */
  height?: number;
}

const ROW_H = 30;

type Col = { key: keyof ExposureRow; label: string; width: string; render: (r: ExposureRow) => string; num?: boolean };

/** Column order of the CSV export (raw values, MJD and an ISO time for convenience). */
export const EXPOSURE_CSV_COLUMNS = ['id', 'obsId', 'detector', 'mjd', 'utc', 'wavelength', 'bandwidth', 'cubeChannel', 'release', 'collection', 'flagsSummary', 'status', 'url'] as const;

/** CSV text of the exposure table (pure; tested). */
export function exposuresToCsv(rows: readonly ExposureRow[]): string {
  return toCsv(
    rows.map((r) => ({ ...r, utc: mjdToUtc(r.mjd, true), url: s3HttpsUrl(r.s3Key), flagsSummary: r.flagsSummary ?? '' })),
    EXPOSURE_CSV_COLUMNS,
  );
}

export function downloadText(text: string, filename: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExposureTable(props: ExposureTableProps) {
  const t = useT(props.t);
  const [sortKey, setSortKey] = useState<keyof ExposureRow>('mjd');
  const [dir, setDir] = useState<SortDir>('asc');
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewH = props.height ?? 360;

  const cols: Col[] = [
    { key: 'mjd', label: t('tbl.date'), width: '11.5rem', render: (r) => mjdToUtc(r.mjd, true) },
    { key: 'obsId', label: t('tbl.obsId'), width: '11rem', render: (r) => r.obsId },
    { key: 'detector', label: t('tbl.det'), width: '3.2rem', render: (r) => `D${r.detector}`, num: true },
    { key: 'wavelength', label: t('tbl.wave'), width: '4.6rem', render: (r) => fmtNum(r.wavelength, 3), num: true },
    { key: 'bandwidth', label: t('tbl.band'), width: '4.6rem', render: (r) => fmtNum(r.bandwidth, 4), num: true },
    { key: 'cubeChannel', label: t('tbl.chan'), width: '4.4rem', render: (r) => (r.cubeChannel > 0 ? String(r.cubeChannel) : '–'), num: true },
    { key: 'release', label: t('tbl.release'), width: '4.2rem', render: (r) => r.release },
    { key: 'collection', label: t('tbl.collection'), width: '8.5rem', render: (r) => r.collection },
    { key: 'flagsSummary', label: t('tbl.flags'), width: '9rem', render: (r) => r.flagsSummary ?? '' },
    { key: 'status', label: t('tbl.status'), width: '6.4rem', render: (r) => t(`tbl.status.${r.status}`) },
  ];
  const grid = [...cols.map((c) => c.width), '3.4rem'].join(' ');

  const sorted = useMemo(() => sortRows(props.rows, sortKey, dir), [props.rows, sortKey, dir]);
  const { start, end } = windowRange(scrollTop, viewH, ROW_H, sorted.length);

  const toggleSort = (k: keyof ExposureRow) => {
    if (k === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setDir('asc');
    }
  };
  const select = (id: string) => {
    setSelected(id);
    props.onSelect?.(id);
  };

  return (
    <section className="rs-card rs-table" aria-label={t('tbl.title')}>
      <header className="rs-cardhead">
        <h3>{t('tbl.title')}</h3>
        <span className="rs-muted">{fill(t('tbl.count'), { n: props.rows.length })}</span>
        <button type="button" className="rs-btn" onClick={() => downloadText(exposuresToCsv(sorted), 'trueblink-exposures.csv', 'text/csv')}>
          {t('common.exportCsv')}
        </button>
      </header>
      <div className="rs-tablescroll">
        <div role="table" aria-rowcount={sorted.length + 1} className="rs-tableinner" style={{ ['--rs-grid' as string]: grid }}>
          <div role="row" className="rs-tr rs-th" aria-rowindex={1}>
            {cols.map((c) => (
              <div role="columnheader" key={c.key} aria-sort={sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={c.num ? 'rs-num' : undefined}>
                <button type="button" onClick={() => toggleSort(c.key)} aria-label={fill(t('tbl.sortBy'), { c: c.label })}>
                  {c.label}
                  <span aria-hidden="true" className="rs-sortmark">
                    {sortKey === c.key ? (dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
              </div>
            ))}
            <div role="columnheader">{t('tbl.file')}</div>
          </div>
          <div ref={bodyRef} className="rs-tbody" style={{ height: viewH }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} tabIndex={0} aria-label={t('tbl.title')}>
            <div style={{ height: sorted.length * ROW_H, position: 'relative' }}>
              {sorted.slice(start, end).map((r, k) => {
                const i = start + k;
                return (
                  <div
                    role="row"
                    aria-rowindex={i + 2}
                    key={r.id}
                    className={`rs-tr${selected === r.id ? ' rs-sel' : ''} rs-st-${r.status}`}
                    style={{ position: 'absolute', top: i * ROW_H, height: ROW_H, left: 0, right: 0 }}
                    onClick={() => select(r.id)}
                  >
                    {cols.map((c) => (
                      <div role="cell" key={c.key} className={c.num ? 'rs-num' : undefined} title={c.render(r)}>
                        {c.key === 'detector' ? <span className="rs-detchip" style={{ background: detectorColor(r.detector) }} aria-hidden="true" /> : null}
                        {c.render(r)}
                      </div>
                    ))}
                    <div role="cell">
                      <a href={s3HttpsUrl(r.s3Key)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {t('tbl.open')}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
