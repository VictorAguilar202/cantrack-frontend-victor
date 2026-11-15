import { isInsidePasto } from "./pasto.js";

/** A pickup the owner used before: the address text and its point. */
export type PickupPlace = { label: string; lat: number; lng: number };

const KEY = "cantrack.recentPickups";

/** InDrive shows a handful, not a history. */
export const MAX_RECENT_PICKUPS = 5;

function isPlace(value: unknown): value is PickupPlace {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const place = value as Partial<PickupPlace>;
  return (
    typeof place.label === "string" &&
    place.label.trim() !== "" &&
    typeof place.lat === "number" &&
    typeof place.lng === "number" &&
    isInsidePasto(place.lat, place.lng)
  );
}

/**
 * The last pickups used on this device, newest first. They live in localStorage
 * only: a convenience for the field, never the source of truth.
 */
export function readRecentPickups(): PickupPlace[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX_RECENT_PICKUPS) : [];
  } catch {
    return [];
  }
}

/** Put a pickup first, dropping an older entry with the same label. O(MAX_RECENT_PICKUPS). */
export function rememberPickup(place: PickupPlace): void {
  const same = (other: PickupPlace) => other.label.toLowerCase() === place.label.toLowerCase();
  const next = [place, ...readRecentPickups().filter((other) => !same(other))].slice(0, MAX_RECENT_PICKUPS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not critical.
  }
}
