import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PinIcon } from "../auth/icons.js";
import { ClockIcon, CloseIcon, CrosshairIcon, HomeIcon, MapIcon } from "../home/icons.js";
import { reverseAddress, searchAddress, type AddressResult } from "../lib/marketplace.js";
import { PickupMapSheet } from "./PickupMapSheet.js";
import { clampLabel, isInsidePasto, roundCoordinate } from "./pasto.js";
import { readRecentPickups, type PickupPlace } from "./recentPickups.js";
import "./pickup-field.css";

/** What the field hands back: the text the owner sees and the pin behind it. */
export type PickupValue = PickupPlace;

type PickupFieldProps = {
  value: PickupValue | null;
  onChange: (value: PickupValue | null) => void;
  /** The owner's saved home, offered before typing. */
  home?: PickupValue | null;
  /** The form could not use the field as it is. */
  invalid?: boolean;
  /** Where Leaflet comes from for the full-screen map; tests inject a fake. */
  loadLeaflet?: () => Promise<typeof import("leaflet")>;
};

/** A search waits for this many characters, and for the owner to stop typing. */
const MIN_QUERY = 3;
const DEBOUNCE_MS = 300;

type Row =
  | { kind: "locate"; title: string; detail: string }
  | { kind: "place"; title: string; detail: string; place: PickupPlace; icon: "home" | "recent" | "result" }
  | { kind: "map"; title: string; detail: string };

type Search =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; results: AddressResult[] }
  | { state: "unavailable" };

/** Room the list wants below the box before it flips above it. */
const MIN_ROOM_PX = 220;
const MAX_LIST_PX = 340;
const EDGE_PX = 16;

type PanelPlace = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const LOCATE_ROW: Row = { kind: "locate", title: "Mi ubicación", detail: "Usar el GPS del celular" };
const MAP_ROW: Row = { kind: "map", title: "Elegir en el mapa", detail: "Mueve el mapa hasta el punto" };

function rowIcon(row: Row): ReactNode {
  if (row.kind === "locate") return <CrosshairIcon />;
  if (row.kind === "map") return <MapIcon />;
  if (row.icon === "home") return <HomeIcon />;
  if (row.icon === "recent") return <ClockIcon />;
  return <PinIcon />;
}

/**
 * The pickup field, inDrive style: one text box that finds the address as the owner types, with
 * "Mi ubicación", the saved home and recent pickups before typing, and a map icon that opens a
 * full-screen map with a fixed pin. It never holds a half-typed pin: editing the text drops the
 * pin (`onChange(null)`) until a place is picked again.
 */
export function PickupField({ value, onChange, home = null, invalid = false, loadLeaflet }: PickupFieldProps) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchToken = useRef(0);
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recents, setRecents] = useState<PickupPlace[]>([]);
  const [place, setPlace] = useState<PanelPlace | null>(null);

  const query = text.trim();
  const searching = value === null && query.length >= MIN_QUERY;

  // A value set from outside (the saved home, the assistant) shows as text.
  useEffect(() => {
    if (value !== null) {
      setText(value.label);
    }
  }, [value]);

  // Search as you type: debounced, and an answer for old text is dropped.
  useEffect(() => {
    const token = ++searchToken.current;
    if (!searching) {
      setSearch({ state: "idle" });
      return undefined;
    }
    setSearch({ state: "loading" });
    const timer = window.setTimeout(() => {
      searchAddress(query)
        .then((answer) => {
          if (token === searchToken.current) {
            setSearch(answer.status === "ok" ? { state: "ok", results: answer.results } : { state: "unavailable" });
          }
        })
        .catch(() => {
          if (token === searchToken.current) {
            setSearch({ state: "unavailable" });
          }
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, searching]);

  // The list is drawn on <body>, under the box. Inside the glass card its blur would only see the
  // card itself (a backdrop-filter does not blur past an ancestor that has one), so the cards
  // behind it would show through sharp. It follows the box while the screen scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    function measure() {
      const box = wrapperRef.current?.getBoundingClientRect();
      if (box === undefined) {
        return;
      }
      const room = window.innerHeight - box.bottom - EDGE_PX;
      const flip = room < MIN_ROOM_PX && box.top - EDGE_PX > room;
      setPlace({
        left: box.left,
        width: box.width,
        ...(flip ? { bottom: window.innerHeight - box.top + 8 } : { top: box.bottom + 8 }),
        maxHeight: Math.max(120, Math.min(MAX_LIST_PX, (flip ? box.top - EDGE_PX : room) - 8)),
      });
    }
    measure();
    window.addEventListener("resize", measure);
    // Capture: the screen scrolls inside its own container, and scroll events do not bubble.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const rows = buildRows();

  function buildRows(): Row[] {
    if (!searching) {
      const needle = query.toLowerCase();
      const matches = (place: PickupPlace) => needle === "" || place.label.toLowerCase().includes(needle);
      const list: Row[] = [LOCATE_ROW];
      if (home !== null && matches(home)) {
        list.push({ kind: "place", title: home.label, detail: "Tu casa", place: home, icon: "home" });
      }
      for (const recent of recents) {
        if (matches(recent) && recent.label !== home?.label) {
          list.push({ kind: "place", title: recent.label, detail: "Reciente", place: recent, icon: "recent" });
        }
      }
      return list;
    }
    if (search.state === "ok") {
      const found: Row[] = search.results.map((result) => ({
        kind: "place",
        title: result.label,
        detail: result.detail,
        place: { label: clampLabel(result.label), lat: result.lat, lng: result.lng },
        icon: "result",
      }));
      return found.length > 0 ? found : [MAP_ROW];
    }
    return search.state === "unavailable" ? [MAP_ROW] : [];
  }

  function show() {
    setRecents(readRecentPickups());
    setOpen(true);
  }

  function pick(place: PickupPlace) {
    setText(place.label);
    setNotice(null);
    setOpen(false);
    setActive(-1);
    onChange(place);
  }

  function locate() {
    setOpen(false);
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      setNotice("Tu navegador no permite ubicarte.");
      return;
    }
    setNotice("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!isInsidePasto(latitude, longitude)) {
          setNotice("Estás fuera de Pasto: escribe la dirección o usa el mapa.");
          return;
        }
        void reverseAddress(latitude, longitude)
          .then((answer) => (answer.status === "ok" ? answer.results[0]?.label : undefined))
          .catch(() => undefined)
          .then((label) => {
            setNotice(null);
            pick({
              label: clampLabel(label ?? "Mi ubicación"),
              lat: roundCoordinate(latitude),
              lng: roundCoordinate(longitude),
            });
          });
      },
      () => setNotice("No pudimos obtener tu ubicación. Escribe la dirección o usa el mapa."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function openMap() {
    setOpen(false);
    setSheetOpen(true);
  }

  function activate(row: Row) {
    if (row.kind === "locate") locate();
    else if (row.kind === "map") openMap();
    else pick(row.place);
  }

  function onType(next: string) {
    setText(next);
    setNotice(null);
    setActive(-1);
    setOpen(true);
    if (value !== null) {
      onChange(null);
    }
  }

  function clear() {
    setText("");
    setNotice(null);
    setActive(-1);
    onChange(null);
    inputRef.current?.focus();
    show();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) show();
      setActive((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      // Never submit the surrounding form from here: it would publish the request.
      event.preventDefault();
      const row = rows[active];
      if (open && row !== undefined) {
        activate(row);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;
  const statusText =
    searching && search.state === "loading"
      ? "Buscando…"
      : searching && search.state === "unavailable"
        ? "No pudimos buscar direcciones ahora. Usa el mapa."
        : searching && search.state === "ok" && search.results.length === 0
          ? "No encontramos ese lugar en Pasto."
          : null;

  return (
    <div className="pickup-field">
      <div
        ref={wrapperRef}
        className="pickup-field__anchor"
        onBlur={(event) => {
          if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        <div className={`pickup-field__box${invalid ? " pickup-field__box--invalid" : ""}`}>
          <span className="pickup-field__pin">
            <PinIcon />
          </span>
          <input
            ref={inputRef}
            className="pickup-field__input"
            type="text"
            role="combobox"
            aria-label="Dirección de recogida"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            aria-invalid={invalid ? true : undefined}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={80}
            placeholder="Escribe una dirección o un lugar"
            value={text}
            onChange={(event) => onType(event.target.value)}
            onFocus={show}
            onClick={() => {
              if (!open) show();
            }}
            onKeyDown={onKeyDown}
          />
          {text !== "" ? (
            <button type="button" className="pickup-field__clear" aria-label="Borrar dirección" onClick={clear}>
              <CloseIcon />
            </button>
          ) : null}
          <button type="button" className="pickup-field__map" aria-label="Elegir en el mapa" onClick={openMap}>
            <MapIcon />
          </button>
        </div>

        {open && place !== null
          ? createPortal(
              // A mouse down on the list must not blur the box, or the click would never land.
              <div
                className="pickup-field__panel"
                style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <div className="pickup-field__scroll" style={{ maxHeight: place.maxHeight }}>
                  {rows.length > 0 ? (
                    <ul id={listId} role="listbox" aria-label="Sugerencias de dirección" className="pickup-field__list">
                      {rows.map((row, index) => (
                        <li
                          key={`${row.kind}-${row.title}-${index}`}
                          id={optionId(index)}
                          role="option"
                          aria-selected={index === active}
                          className="pickup-field__option"
                          onClick={() => activate(row)}
                          onMouseEnter={() => setActive(index)}
                        >
                          <span className="pickup-field__option-icon">{rowIcon(row)}</span>
                          <span className="pickup-field__option-text">
                            <span className="pickup-field__option-title">{row.title}</span>
                            <span className="pickup-field__option-detail">{row.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {statusText !== null ? (
                    <p className="pickup-field__status" role="status">
                      {statusText}
                    </p>
                  ) : null}
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>

      {notice !== null ? (
        <p className="pickup-field__notice" role="status">
          {notice}
        </p>
      ) : null}

      <PickupMapSheet
        open={sheetOpen}
        initial={value === null ? null : { lat: value.lat, lng: value.lng }}
        loadLeaflet={loadLeaflet}
        onClose={() => setSheetOpen(false)}
        onConfirm={(place) => {
          setSheetOpen(false);
          pick(place);
        }}
      />
    </div>
  );
}
