// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Rutas along the streets + "Voy en camino": three named functions in
// apps/web/src/lib/marketplace.ts.
// - fetchDayRoutePath(walkerId, date?)  GET  /walkers/:id/route/path?date=
// - markEnRoute(requestId)              POST /bidding/requests/:id/en-route
// - fetchApproach(requestId)            GET  /bidding/requests/:id/approach

vi.mock("../../apps/web/src/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-123" } } }),
    },
  },
}));

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function market() {
  return import("../../apps/web/src/lib/marketplace.js");
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
  return { url: String(url), init };
}

describe("Rutas along the streets", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchDayRoutePath GETs the day line", async () => {
    const line = { source: "osrm", distanceKm: 1.9, minutes: 25, geometry: [[1.2136, -77.2811], [1.22, -77.27]] };
    mockFetch.mockResolvedValueOnce(jsonResponse(line));
    const { fetchDayRoutePath } = await market();
    await expect(fetchDayRoutePath("walker-1", "2026-10-05")).resolves.toEqual(line);
    const { url, init } = lastCall();
    expect(url).toContain("/walkers/walker-1/route/path?date=2026-10-05");
    expect((init.method ?? "GET").toUpperCase()).toBe("GET");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-123");
  });

  it("fetchDayRoutePath without a date asks for today", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ source: "straight", distanceKm: 0, minutes: 0, geometry: [] }));
    const { fetchDayRoutePath } = await market();
    await fetchDayRoutePath("walker-1");
    expect(lastCall().url).toMatch(/\/walkers\/walker-1\/route\/path$/);
  });

  it("markEnRoute POSTs to en-route", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "r 1", enRouteAt: "2026-10-01T00:00:00+00:00" }));
    const { markEnRoute } = await market();
    await expect(markEnRoute("r 1")).resolves.toEqual({ id: "r 1", enRouteAt: "2026-10-01T00:00:00+00:00" });
    const { url, init } = lastCall();
    expect(url).toContain("/bidding/requests/r%201/en-route");
    expect(init.method).toBe("POST");
  });

  it("fetchApproach GETs the approach", async () => {
    const approach = {
      enRouteAt: "2026-10-01T00:00:00+00:00",
      position: { lat: 1.212, lng: -77.283, updatedAt: null },
      pickup: { lat: 1.2136, lng: -77.2811 },
      route: null,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(approach));
    const { fetchApproach } = await market();
    await expect(fetchApproach("r1")).resolves.toEqual(approach);
    expect(lastCall().url).toContain("/bidding/requests/r1/approach");
  });
});
