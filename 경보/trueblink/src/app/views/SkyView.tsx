// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
// All-sky navigator panel: the SPHEREx all-sky HiPS map (gl/SkyGlobe) with the challenge targets,
// a wavelength slider over the cube channels, zoom buttons, a pointing read-out and a "pick this spot"
// confirmation so a stray click on empty sky never starts a download.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { SkyPos } from "../../core/types";
import { formatDec, formatRa } from "../../core/coords";
import {
  FOV_MAX,
  FOV_MIN,
  SkyGlobe,
  type GlobeMarker,
  type GlobeView,
} from "../../gl/SkyGlobe";
import { useT } from "../i18n";
import {
  channelNear,
  formatFov,
  mapChannels,
  presetMarkers,
  samePos,
  zoomFov,
} from "./viewsUtil";
import "./strings";
import "./views.css";

export interface SkyViewProps {
  /** Called when the user picks a sky position or a marker. */
  onPick(pos: SkyPos, name?: string): void;
  /** Current field centre to highlight, if any. */
  center?: SkyPos | null;
}

const PLAY_STEP_MS = 1100;
const DEFAULT_VIEW: GlobeView = { ra: 83.8, dec: -1.2, fovDeg: 60 };
const PIN_COLOR = "#5fd38d";
const EXTRA_COLOR = "#7aa2ff";
const CENTER_COLOR = "#ffffff";

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** True while the element is on screen and the tab is visible. */
function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  useEffect(() => {
    const el = ref.current;
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) =>
        setOnScreen(entries.some((e) => e.isIntersecting)),
      );
      io.observe(el);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, [ref]);
  return onScreen && tabVisible;
}

/** True while the element is narrower than `px` (marker labels are kept short then). */
function useNarrow(ref: RefObject<HTMLElement | null>, px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < px));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return narrow;
}

export function SkyView({ onPick, center }: SkyViewProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<SkyGlobe | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const centerRef = useRef<SkyPos | null>(center ?? null);
  centerRef.current = center ?? null;

  const channels = useMemo(() => mapChannels(), []);
  const presets = useMemo(() => presetMarkers(), []);
  const [chIdx, setChIdx] = useState(() =>
    Math.max(0, channels.indexOf(channelNear(1.2, channels))),
  );
  const [view, setView] = useState<GlobeView>(() =>
    center
      ? { ra: center.ra, dec: center.dec, fovDeg: DEFAULT_VIEW.fovDeg }
      : DEFAULT_VIEW,
  );
  const [pin, setPin] = useState<SkyPos | null>(null);
  const pinRef = useRef<SkyPos | null>(null);
  pinRef.current = pin;
  const [playing, setPlaying] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const visible = useVisible(rootRef);
  const narrow = useNarrow(rootRef, 560);
  const channel = channels[chIdx];

  const openPin = useCallback(() => {
    const p = pinRef.current;
    if (!p) return;
    setPin(null);
    onPickRef.current({ ra: p.ra, dec: p.dec });
  }, []);

  // Create the globe once; dispose on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let globe: SkyGlobe;
    try {
      const c = centerRef.current;
      globe = new SkyGlobe(host, {
        view: c
          ? { ra: c.ra, dec: c.dec, fovDeg: DEFAULT_VIEW.fovDeg }
          : DEFAULT_VIEW,
        channel: channels[chIdx].cubeChannel,
      });
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    globeRef.current = globe;
    if (import.meta.env.DEV)
      (window as unknown as { __tbSkyGlobe?: SkyGlobe }).__tbSkyGlobe = globe;
    setView(globe.getView());
    const offView = globe.on("view", (v) => setView(v));
    const offPick = globe.on("pick", (p) => {
      const id = p.markerId;
      if (id === "pin") return openPin();
      if (id === "center") {
        const c = centerRef.current;
        if (c) globe.lookAt(c, Math.min(globe.getView().fovDeg, 8));
        return;
      }
      const m = id ? presets.find((x) => x.id === id) : undefined;
      if (m) {
        setPin(null);
        onPickRef.current({ ra: m.ra, dec: m.dec }, m.pickName);
        return;
      }
      setPin({ ra: p.ra, dec: p.dec });
    });
    return () => {
      offView();
      offPick();
      globe.dispose();
      if (globeRef.current === globe) globeRef.current = null;
    };
    // The globe is created once; channel and markers are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wavelength channel.
  useEffect(() => {
    globeRef.current?.setChannel(channel.cubeChannel);
  }, [channel]);

  // Markers: presets, the current field, the pin.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const here = t("views.sky.current");
    let centerOnPreset = false;
    const list: GlobeMarker[] = presets.map((m) => {
      const isCurrent =
        !!center &&
        Math.hypot(
          m.dec - center.dec,
          (((m.ra - center.ra + 540) % 360) - 180) *
            Math.cos((m.dec * Math.PI) / 180),
        ) < 0.1;
      if (isCurrent) centerOnPreset = true;
      return {
        id: m.id,
        ra: m.ra,
        dec: m.dec,
        label: isCurrent && !narrow ? `${m.label} · ${here}` : m.label,
        color: isCurrent ? CENTER_COLOR : m.challenge ? undefined : EXTRA_COLOR,
      };
    });
    if (center && !centerOnPreset)
      list.push({
        id: "center",
        ra: center.ra,
        dec: center.dec,
        label: here,
        color: CENTER_COLOR,
      });
    if (pin)
      list.push({
        id: "pin",
        ra: pin.ra,
        dec: pin.dec,
        label: t("views.sky.pin"),
        color: PIN_COLOR,
      });
    g.setMarkers(list);
  }, [presets, center, pin, t, glError, narrow]);

  // Follow a new field centre (not on first mount: the globe already starts there).
  const lastCenter = useRef<SkyPos | null>(center ?? null);
  useEffect(() => {
    const c = center ?? null;
    if (c && !samePos(c, lastCenter.current)) globeRef.current?.lookAt(c);
    lastCenter.current = c;
  }, [center]);

  // Play through wavelengths, only while visible and never under reduced motion.
  useEffect(() => {
    if (reduced && playing) setPlaying(false);
  }, [reduced, playing]);
  useEffect(() => {
    if (!playing || reduced || !visible) return;
    const id = setInterval(
      () => setChIdx((i) => (i + 1) % channels.length),
      PLAY_STEP_MS,
    );
    return () => clearInterval(id);
  }, [playing, reduced, visible, channels.length]);

  useEffect(() => {
    if (!pin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin]);

  const zoom = (factor: number) => {
    const g = globeRef.current;
    if (!g) return;
    const v = g.getView();
    g.lookAt(
      { ra: v.ra, dec: v.dec },
      zoomFov(v.fovDeg, factor, FOV_MIN, FOV_MAX),
    );
  };

  const decDeg = `${view.dec >= 0 ? "+" : ""}${view.dec.toFixed(4)}°`;

  return (
    <section className="tbv tbv-sky" aria-label={t("views.sky.title")}>
      <div className="tbv-stage" ref={rootRef}>
        <div className="tbv-gl" ref={hostRef} />
        {glError ? (
          <div className="tbv-nogl" role="note">
            <p>{t("views.sky.noGl")}</p>
            <div className="tbv-row">
              {presets
                .filter((m) => m.challenge)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="tbv-btn"
                    onClick={() =>
                      onPickRef.current({ ra: m.ra, dec: m.dec }, m.pickName)
                    }
                  >
                    {m.label}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <>
            <div className="tbv-cross" aria-hidden="true" />
            <div className="tbv-zoom">
              <button
                type="button"
                className="tbv-btn"
                onClick={() => zoom(0.5)}
                title={t("views.sky.zoomIn")}
                aria-label={t("views.sky.zoomIn")}
              >
                +
              </button>
              <button
                type="button"
                className="tbv-btn"
                onClick={() => zoom(2)}
                title={t("views.sky.zoomOut")}
                aria-label={t("views.sky.zoomOut")}
              >
                −
              </button>
              <button
                type="button"
                className="tbv-btn"
                onClick={() => zoom(1000)}
                title={t("views.sky.allSky")}
                aria-label={t("views.sky.allSky")}
              >
                <svg
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <circle
                    cx="10"
                    cy="10"
                    r="7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <ellipse
                    cx="10"
                    cy="10"
                    rx="3.4"
                    ry="7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M2.5 10h15"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                </svg>
              </button>
              {center && (
                <button
                  type="button"
                  className="tbv-btn"
                  onClick={() => globeRef.current?.lookAt(center, 5)}
                  title={t("views.sky.toField")}
                  aria-label={t("views.sky.toField")}
                >
                  <svg
                    viewBox="0 0 20 20"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M10 1v4M10 15v4M1 10h4M15 10h4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                </button>
              )}
            </div>
            <div className="tbv-readout" aria-live="off">
              <div>
                <b>{t("views.sky.pointing")}</b>
                <span className="tbv-mono">
                  {formatRa(view.ra, { digits: 1 })}{" "}
                  {formatDec(view.dec, { digits: 0 })}
                </span>
              </div>
              <div className="tbv-mono">
                {view.ra.toFixed(4)}° {decDeg} ·{" "}
                {t("views.sky.fov", { fov: formatFov(view.fovDeg) })}
              </div>
            </div>
            {pin && (
              <div
                className="tbv-pin"
                role="dialog"
                aria-label={t("views.sky.pinTitle")}
              >
                <h3>{t("views.sky.pinTitle")}</h3>
                <span className="tbv-mono">
                  {formatRa(pin.ra, { digits: 1 })}{" "}
                  {formatDec(pin.dec, { digits: 0 })} · {pin.ra.toFixed(4)}°{" "}
                  {pin.dec >= 0 ? "+" : ""}
                  {pin.dec.toFixed(4)}°
                </span>
                <p>{t("views.sky.pinBody")}</p>
                <div className="tbv-row">
                  <button
                    type="button"
                    className="tbv-btn"
                    onClick={() => setPin(null)}
                  >
                    {t("views.sky.cancel")}
                  </button>
                  <button
                    type="button"
                    className="tbv-btn primary"
                    onClick={openPin}
                    autoFocus
                  >
                    {t("views.sky.openHere")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="tbv-slider">
        <span className="tbv-label">{t("views.sky.wavelength")}</span>
        <input
          type="range"
          min={0}
          max={channels.length - 1}
          step={1}
          value={chIdx}
          onChange={(e) => setChIdx(Number(e.target.value))}
          aria-label={t("views.sky.wavelength")}
          aria-valuetext={`${channel.wavelength.toFixed(2)} µm`}
          disabled={!!glError}
        />
        <div className="tbv-wavebox">
          <span className="tbv-wave">{channel.wavelength.toFixed(2)} µm</span>
          <span className="tbv-det">
            {t("views.sky.channel", {
              det: channel.detector,
              ch: channel.channel,
            })}
          </span>
        </div>
      </div>
      <div className="tbv-row">
        <button
          type="button"
          className="tbv-btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={reduced || !!glError}
          aria-pressed={playing}
          title={reduced ? t("views.sky.reducedMotion") : undefined}
        >
          {playing ? "❚❚ " + t("views.sky.pause") : "▶ " + t("views.sky.play")}
        </button>
        {reduced && (
          <span className="tbv-help">{t("views.sky.reducedMotion")}</span>
        )}
      </div>
      <p className="tbv-caption">{t("views.sky.caption")}</p>
      <p className="tbv-help">{t("views.sky.help")}</p>
    </section>
  );
}
