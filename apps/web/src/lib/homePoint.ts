import { isInsidePasto } from "../map/pasto.js";

/** Pasto, the fallback pickup and weather point. */
export const PASTO = { lat: 1.2136, lng: -77.2811 } as const;

const KEY = "cantrack.homePoint";

export type Point = { lat: number; lng: number };

/** A saved home: the point plus the address text the owner wrote in Perfil. */
export type SavedHome = Point & { label: string };

/** What to call a home that was saved before labels were kept. */
export const DEFAULT_HOME_LABEL = "Mi casa";

function readRaw(): Partial<SavedHome> | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      return JSON.parse(raw) as Partial<SavedHome>;
    }
  } catch {
    // Storage blocked or a corrupt value: treated as no saved home.
  }
  return null;
}

/**
 * The owner's saved home point (written by Perfil), else Pasto. It is kept in
 * localStorage only so Inicio and Explorar can start without another call;
 * the source of truth stays `GET /owners/{id}/profile`.
 */
export function readHomePoint(): Point {
  const parsed = readRaw();
  if (parsed !== null && typeof parsed.lat === "number" && typeof parsed.lng === "number") {
    return { lat: parsed.lat, lng: parsed.lng };
  }
  return PASTO;
}

/** The saved home with its label, only when one exists and lies inside Pasto. */
export function readSavedHome(): SavedHome | null {
  const parsed = readRaw();
  if (
    parsed === null ||
    typeof parsed.lat !== "number" ||
    typeof parsed.lng !== "number" ||
    !isInsidePasto(parsed.lat, parsed.lng)
  ) {
    return null;
  }
  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  return { lat: parsed.lat, lng: parsed.lng, label: label === "" ? DEFAULT_HOME_LABEL : label };
}

export function saveHomePoint(point: (Point & { label?: string }) | null): void {
  try {
    if (point === null) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(point));
    }
  } catch {
    // Not critical.
  }
}
