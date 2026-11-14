// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// "3D stack" panel: the loaded frames as slices along time or wavelength (gl/CubeView), with the
// shared display stretch from the store and the target's predicted track when it has proper motion.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkyFrame } from "../../core/types";
import { mjdToIsoDate } from "../../core/types";
import {
  CubeView,
  type CubeAxis,
  type CubeHoverInfo,
  type CubeViewPreset,
} from "../../gl/CubeView";
import { useApp } from "../store";
import { session, useSessionVersion } from "../session";
import { useT } from "../i18n";
import { exposureStack, hasProperMotion, predictedTrack } from "./viewsUtil";
import "./strings";
import "./views.css";

type Source = "sequence" | "exposures";

const MAX_EXPOSURE_SLICES = 240;
const TRACK_COLOR = "#ff7a66";
const PRESETS: CubeViewPreset[] = ["oblique", "front", "side", "top"];

function dateText(f: SkyFrame): string {
  const a = mjdToIsoDate(f.meta.mjdMin);
  const b = mjdToIsoDate(f.meta.mjdMax);
  if (!Number.isFinite(f.meta.mjdMin) || !Number.isFinite(f.meta.mjdMax))
    return mjdToIsoDate(f.meta.mjd);
  if (a === b) return a;
  return `${a} – ${a.slice(0, 4) === b.slice(0, 4) ? b.slice(5) : b}`;
}

function waveText(f: SkyFrame): string {
  const { waveMin, waveMax, wavelength } = f.meta;
  if (
    Number.isFinite(waveMin) &&
    Number.isFinite(waveMax) &&
    waveMax - waveMin > 0.02
  )
    return `${waveMin.toFixed(2)}–${waveMax.toFixed(2)} µm`;
  return `${wavelength.toFixed(3)} µm`;
}

export function CubePanel() {
  const t = useT();
  const frames = useApp((s) => s.frames);
  const sequence = useApp((s) => s.sequence);
  const stretch = useApp((s) => s.stretch);
  const target = useApp((s) => s.target);
  const demo = useApp((s) => s.demo);
  const sv = useSessionVersion();

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CubeView | null>(null);
  const [source, setSource] = useState<Source>("sequence");
  const [axis, setAxis] = useState<CubeAxis>("time");
  const [preset, setPreset] = useState<CubeViewPreset>("oblique");
  const [hover, setHover] = useState<CubeHoverInfo | null>(null);
  const [ready, setReady] = useState(false);

  // Every loaded single-exposure frame of the session (read on each session bump).
  const expAll = useMemo(() => [...session.exposureFrames.values()], [sv]);
  const expStack = useMemo(
    () => exposureStack(expAll, MAX_EXPOSURE_SLICES),
    [expAll],
  );
  const effSource: Source =
    source === "exposures" && expStack.length > 0 ? "exposures" : "sequence";
  const shown = effSource === "exposures" ? expStack : frames;
  const moving = hasProperMotion(target);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const v = new CubeView(host);
    viewRef.current = v;
    if (import.meta.env.DEV)
      (window as unknown as { __tbCubeView?: CubeView }).__tbCubeView = v;
    const off = v.on("hover", (h) => setHover(h));
    setReady(true);
    return () => {
      off();
      v.dispose();
      if (viewRef.current === v) viewRef.current = null;
      setReady(false);
    };
  }, []);

  // Slices and axis. Re-fit the camera when the axis or the slice source changes.
  const lastKey = useRef("");
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !ready) return;
    v.setFrames(shown, axis);
    setHover(null);
    const key = `${axis}|${effSource}`;
    if (key !== lastKey.current && shown.length > 0) {
      v.setView(preset);
      lastKey.current = key;
    }
    // preset is applied by its own handler; only axis / source changes re-fit here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, axis, effSource, ready]);

  useEffect(() => {
    if (ready) viewRef.current?.setStretch(stretch);
  }, [stretch, ready]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v || !ready) return;
    if (moving && target && shown.length > 0) {
      const path = predictedTrack(target, shown);
      v.setTracks(
        path.length
          ? [{ path, color: TRACK_COLOR, label: t("views.cube.trackLabel") }]
          : [],
      );
    } else {
      v.setTracks([]);
    }
  }, [moving, target, shown, ready, t]);

  const choosePreset = (p: CubeViewPreset) => {
    setPreset(p);
    viewRef.current?.setView(p);
  };

  const hoverFrame = hover ? shown[hover.frameIndex] : undefined;
  const empty = shown.length === 0;

  return (
    <section className="tbv tbv-cube" aria-label={t("views.cube.title")}>
      <div className="tbv-row">
        <span className="tbv-group">
          <span className="tbv-label">{t("views.cube.axis")}</span>
          <div
            className="tbv-seg"
            role="group"
            aria-label={t("views.cube.axis")}
          >
            <button
              type="button"
              className={axis === "time" ? "on" : ""}
              aria-pressed={axis === "time"}
              onClick={() => setAxis("time")}
            >
              {t("views.cube.time")}
            </button>
            <button
              type="button"
              className={axis === "wavelength" ? "on" : ""}
              aria-pressed={axis === "wavelength"}
              onClick={() => setAxis("wavelength")}
            >
              {t("views.cube.wavelength")}
            </button>
          </div>
        </span>
        <span className="tbv-group">
          <span className="tbv-label">{t("views.cube.source")}</span>
          <div
            className="tbv-seg"
            role="group"
            aria-label={t("views.cube.source")}
          >
            <button
              type="button"
              className={effSource === "sequence" ? "on" : ""}
              aria-pressed={effSource === "sequence"}
              onClick={() => setSource("sequence")}
            >
              {t("views.cube.sequence", { n: frames.length })}
            </button>
            <button
              type="button"
              className={effSource === "exposures" ? "on" : ""}
              aria-pressed={effSource === "exposures"}
              onClick={() => setSource("exposures")}
              disabled={expAll.length === 0}
              title={
                expAll.length === 0 ? t("views.cube.noExposures") : undefined
              }
            >
              {t("views.cube.exposures", { n: expAll.length })}
            </button>
          </div>
        </span>
      </div>

      <div className="tbv-stage">
        <div className="tbv-gl" ref={hostRef} />
        {demo && !empty && (
          <span className="tbv-demo" title={t("views.demoNote")}>
            {t("views.demo")}
          </span>
        )}
        {empty && (
          <div className="tbv-empty" role="note">
            {t("views.cube.empty")}
          </div>
        )}
      </div>

      <div className="tbv-row">
        <span className="tbv-label">{t("views.cube.view")}</span>
        <div className="tbv-seg" role="group" aria-label={t("views.cube.view")}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={preset === p ? "on" : ""}
              aria-pressed={preset === p}
              onClick={() => choosePreset(p)}
              disabled={empty}
            >
              {t(`views.cube.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="tbv-hover" aria-live="off">
        {hover && hoverFrame ? (
          <>
            <span>
              {t("views.cube.slice", { k: hover.slice + 1, n: shown.length })}
            </span>
            <span className="tbv-time">{dateText(hoverFrame)}</span>
            <span className="tbv-wave">{waveText(hoverFrame)}</span>
            <span>
              {hoverFrame.meta.nExposures > 1
                ? `${hoverFrame.meta.nExposures} exp`
                : `D${hoverFrame.meta.detectors.join("+")}`}
            </span>
          </>
        ) : (
          !empty && <span>{t("views.cube.hoverHint")}</span>
        )}
      </div>

      {effSource === "exposures" && expAll.length > expStack.length && (
        <p className="tbv-help">
          {t("views.cube.sampled", {
            shown: expStack.length,
            total: expAll.length,
          })}
        </p>
      )}
      {moving && target && !empty && (
        <p className="tbv-track">
          {axis === "time"
            ? t("views.cube.track", { name: target.name })
            : t("views.cube.trackWave")}
        </p>
      )}
      {sequence === "difference" && effSource === "sequence" && <p className="tbv-help">{t("views.cube.diffNote")}</p>}
      <p className="tbv-caption">{t("views.cube.caption")}</p>
      {demo && !empty && <p className="tbv-help">{t("views.demoNote")}</p>}
    </section>
  );
}
