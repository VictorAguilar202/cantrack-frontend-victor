// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_HOME_LABEL, PASTO, readHomePoint, readSavedHome, saveHomePoint } from "../../apps/web/src/lib/homePoint.js";
import {
  MAX_RECENT_PICKUPS,
  readRecentPickups,
  rememberPickup,
} from "../../apps/web/src/map/recentPickups.js";
import { MAX_LABEL_LENGTH, clampLabel } from "../../apps/web/src/map/pasto.js";

// What the pickup field keeps on the device: the saved home (with its label) and the recent pickups.
// Both are conveniences, so a blocked or corrupt storage must read as "nothing saved", never throw.

const HOME_KEY = "cantrack.homePoint";
const RECENTS_KEY = "cantrack.recentPickups";

describe("the saved home", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips the point with its label", () => {
    saveHomePoint({ lat: 1.22, lng: -77.28, label: "Carrera 27 15-30" });
    expect(readSavedHome()).toEqual({ lat: 1.22, lng: -77.28, label: "Carrera 27 15-30" });
    expect(readHomePoint()).toEqual({ lat: 1.22, lng: -77.28 });
  });

  it("names a home saved before labels existed", () => {
    saveHomePoint({ lat: 1.22, lng: -77.28 });
    expect(readSavedHome()?.label).toBe(DEFAULT_HOME_LABEL);
  });

  it("names a home whose label is blank", () => {
    saveHomePoint({ lat: 1.22, lng: -77.28, label: "   " });
    expect(readSavedHome()?.label).toBe(DEFAULT_HOME_LABEL);
  });

  it("is null with nothing saved, outside Pasto or corrupt; the weather point falls back to Pasto", () => {
    expect(readSavedHome()).toBeNull();
    expect(readHomePoint()).toEqual(PASTO);

    saveHomePoint({ lat: 4.6, lng: -74.08, label: "Bogotá" });
    expect(readSavedHome()).toBeNull();

    window.localStorage.setItem(HOME_KEY, "{not json");
    expect(readSavedHome()).toBeNull();
    expect(readHomePoint()).toEqual(PASTO);
  });

  it("clears with null", () => {
    saveHomePoint({ lat: 1.22, lng: -77.28, label: "x" });
    saveHomePoint(null);
    expect(readSavedHome()).toBeNull();
  });
});

describe("recent pickups", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the newest first", () => {
    rememberPickup({ label: "A", lat: 1.2, lng: -77.28 });
    rememberPickup({ label: "B", lat: 1.21, lng: -77.28 });
    expect(readRecentPickups().map((place) => place.label)).toEqual(["B", "A"]);
  });

  it("moves a repeated address to the front instead of listing it twice (any case)", () => {
    rememberPickup({ label: "Plaza", lat: 1.2, lng: -77.28 });
    rememberPickup({ label: "Parque", lat: 1.21, lng: -77.28 });
    rememberPickup({ label: "plaza", lat: 1.2146, lng: -77.2786 });
    expect(readRecentPickups()).toEqual([
      { label: "plaza", lat: 1.2146, lng: -77.2786 },
      { label: "Parque", lat: 1.21, lng: -77.28 },
    ]);
  });

  it("keeps only the last few", () => {
    for (let n = 0; n < MAX_RECENT_PICKUPS + 3; n += 1) {
      rememberPickup({ label: `Calle ${n}`, lat: 1.2, lng: -77.28 });
    }
    const recents = readRecentPickups();
    expect(recents).toHaveLength(MAX_RECENT_PICKUPS);
    expect(recents[0]?.label).toBe(`Calle ${MAX_RECENT_PICKUPS + 2}`);
  });

  it("drops entries that are not a place inside Pasto, and survives corrupt storage", () => {
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([
        { label: "Ok", lat: 1.2, lng: -77.28 },
        { label: "Bogotá", lat: 4.6, lng: -74.08 },
        { label: "", lat: 1.2, lng: -77.28 },
        { label: "Sin punto" },
        "texto",
        null,
      ]),
    );
    expect(readRecentPickups()).toEqual([{ label: "Ok", lat: 1.2, lng: -77.28 }]);

    window.localStorage.setItem(RECENTS_KEY, "{not json");
    expect(readRecentPickups()).toEqual([]);

    window.localStorage.setItem(RECENTS_KEY, JSON.stringify({ not: "a list" }));
    expect(readRecentPickups()).toEqual([]);
  });
});

describe("clampLabel", () => {
  it("trims and cuts to what the API stores", () => {
    expect(clampLabel("  Plaza de Nariño  ")).toBe("Plaza de Nariño");
    expect(clampLabel("x".repeat(MAX_LABEL_LENGTH + 30))).toHaveLength(MAX_LABEL_LENGTH);
  });
});
