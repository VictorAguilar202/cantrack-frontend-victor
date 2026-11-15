import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CloseIcon, CrosshairIcon } from "../home/icons.js";
import { reverseAddress } from "../lib/marketplace.js";
import { MAP_ZOOM, PASTO_BOUNDS, PASTO_CENTER, clampLabel, isInsidePasto, roundCoordinate } from "./pasto.js";
import type { PickupPlace } from "./recentPickups.js";
import "./map.css";
import "./pickup-field.css";

type LeafletModule = typeof import("leaflet");

type PickupMapSheetProps = {
  open: boolean;
  /** The pin the field already has; the map opens on it (Pasto when null). */
  initial: { lat: number; lng: number } | null;
  onConfirm: (place: PickupPlace) => void;
  onClose: () => void;
  /** Where Leaflet comes from; defaults to the installed package. */
  loadLeaflet?: () => Promise<LeafletModule>;
};

/** Leaflet is heavy, so it loads on demand; tests inject a fake instead. */
async function loadLeafletFromPackage(): Promise<LeafletModule> {
  return ((await import("leaflet")) as unknown as { default: LeafletModule }).default;
}

/** The address of the map's centre is asked for once the map has been still this long. */
const SETTLE_MS = 400;
const FALLBACK_LABEL = "Punto en el mapa";
/** Close enough to read a street, far enough to see the block. */
const START_ZOOM = 16;
const LOCATE_ZOOM = 17;

type Address =
  | { state: "searching" }
  | { state: "ready"; label: string }
  | { state: "outside" };

/**
 * The full-screen map of the pickup field. The pin stays fixed in the middle while the map moves
 * under it (inDrive), the address under the pin follows, and "Listo" confirms the centre.
 */
export function PickupMapSheet({ open, ...rest }: PickupMapSheetProps) {
  // The sheet lives on <body>: the glass cards use backdrop-filter, which would otherwise make a
  // `position: fixed` child fill the card instead of the screen.
  return open ? createPortal(<SheetBody {...rest} />, document.body) : null;
}

function SheetBody({ initial, onConfirm, onClose, loadLeaflet = loadLeafletFromPackage }: Omit<PickupMapSheetProps, "open">) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const lookupToken = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);
  const centerRef = useRef<{ lat: number; lng: number } | null>(null);
  const onCloseRef = useRef(onClose);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [moving, setMoving] = useState(false);
  const [address, setAddress] = useState<Address>({ state: "searching" });
  const [notice, setNotice] = useState<string | null>(null);

  onCloseRef.current = onClose;

  // Keyboard and focus: Escape closes, and focus comes back to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    const container = canvasRef.current;
    if (container === null) {
      return undefined;
    }
    let cancelled = false;

    function settle(map: LeafletMap) {
      window.clearTimeout(settleTimer.current);
      const token = ++lookupToken.current;
      const center = map.getCenter();
      const lat = roundCoordinate(center.lat);
      const lng = roundCoordinate(center.lng);
      centerRef.current = { lat, lng };
      setMoving(false);
      if (!isInsidePasto(center.lat, center.lng)) {
        setAddress({ state: "outside" });
        return;
      }
      setAddress({ state: "searching" });
      settleTimer.current = window.setTimeout(() => {
        reverseAddress(center.lat, center.lng)
          .then((answer) => (answer.status === "ok" ? answer.results[0]?.label : undefined))
          .catch(() => undefined)
          .then((label) => {
            if (token === lookupToken.current) {
              setAddress({ state: "ready", label: clampLabel(label ?? "") || FALLBACK_LABEL });
            }
          });
      }, SETTLE_MS);
    }

    async function setup() {
      try {
        const L = await loadLeaflet();
        if (cancelled) {
          return;
        }
        const start = initial ?? PASTO_CENTER;
        const map = L.map(container as HTMLElement, {
          center: [start.lat, start.lng],
          zoom: initial === null ? MAP_ZOOM.start : START_ZOOM,
          minZoom: MAP_ZOOM.min,
          maxZoom: MAP_ZOOM.max,
          maxBounds: [
            [PASTO_BOUNDS.south, PASTO_BOUNDS.west],
            [PASTO_BOUNDS.north, PASTO_BOUNDS.east],
          ],
          maxBoundsViscosity: 0.9,
          zoomControl: false,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: MAP_ZOOM.max,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        map.on("movestart", () => {
          // Whatever is being looked up belongs to a spot the map is leaving.
          window.clearTimeout(settleTimer.current);
          lookupToken.current += 1;
          setMoving(true);
          setNotice(null);
          setAddress({ state: "searching" });
        });
        map.on("moveend", () => settle(map));
        mapRef.current = map;
        setPhase("ready");
        // The sheet animates in, so the canvas may have been measured mid-slide.
        window.setTimeout(() => mapRef.current?.invalidateSize(), 0);
        settle(map);
      } catch {
        if (!cancelled) {
          setPhase("failed");
        }
      }
    }

    void setup();

    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer.current);
      lookupToken.current += 1;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is built once per opening; the starting point is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      setNotice("Tu navegador no permite ubicarte.");
      return;
    }
    setNotice("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!isInsidePasto(latitude, longitude)) {
          setNotice("Estás fuera de Pasto: mueve el mapa para elegir el punto.");
          return;
        }
        setNotice(null);
        mapRef.current?.setView([latitude, longitude], LOCATE_ZOOM);
      },
      () => setNotice("No pudimos obtener tu ubicación. Mueve el mapa para elegir el punto."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const canConfirm = phase === "ready" && address.state === "ready";

  function confirm() {
    const center = centerRef.current;
    if (!canConfirm || center === null || address.state !== "ready") {
      return;
    }
    onConfirm({ label: address.label, lat: center.lat, lng: center.lng });
  }

  const addressText =
    address.state === "ready"
      ? address.label
      : address.state === "outside"
        ? "Ese punto queda fuera de Pasto."
        : "Buscando dirección…";

  return (
    <div className="pickup-sheet" role="dialog" aria-modal="true" aria-label="Elegir punto de recogida">
      <header className="pickup-sheet__bar">
        <button ref={closeRef} type="button" className="pickup-sheet__close" aria-label="Cerrar mapa" onClick={onClose}>
          <CloseIcon />
        </button>
        <h2 className="pickup-sheet__title">¿Dónde lo recogemos?</h2>
      </header>

      <div className="pickup-sheet__map">
        <div ref={canvasRef} className="pickup-sheet__canvas" />
        {phase === "failed" ? (
          <p className="pickup-sheet__fallback" role="alert">
            No pudimos cargar el mapa. Cierra esto y escribe la dirección.
          </p>
        ) : (
          <>
            <span className="pickup-sheet__pin" data-moving={moving} aria-hidden="true">
              <svg className="pickup-sheet__pin-shape" viewBox="0 0 44 56" focusable="false">
                <path d="M22 54S4 34 4 20a18 18 0 0 1 36 0c0 14-18 34-18 34Z" />
                <circle cx="22" cy="20" r="6" />
              </svg>
              <span className="pickup-sheet__pin-shadow" />
            </span>
            <button type="button" className="pickup-sheet__locate" aria-label="Mi ubicación" onClick={locate}>
              <CrosshairIcon />
            </button>
          </>
        )}
      </div>

      <div className="pickup-sheet__card">
        {notice !== null ? (
          <p className="pickup-sheet__notice" role="status">
            {notice}
          </p>
        ) : null}
        <p className="pickup-sheet__address" aria-live="polite">
          {addressText}
        </p>
        <button type="button" className="pickup-sheet__done" disabled={!canConfirm} onClick={confirm}>
          Listo
        </button>
      </div>
    </div>
  );
}
