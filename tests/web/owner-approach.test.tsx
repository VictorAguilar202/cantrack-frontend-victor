// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// The owner sees how the walker is coming, but only after he tapped "Voy en
// camino": the detail then allows `approach` and the screen polls it every 10 s
// until the walk starts (409), drawing his position and the street route.

const mockWalks = vi.fn();
const mockSummary = vi.fn();
const mockDetail = vi.fn();
const mockLive = vi.fn();
const mockApproach = vi.fn();
const lastMap: { current: Record<string, unknown> } = { current: {} };

vi.mock("../../apps/web/src/lib/marketplace.js", () => ({
  fetchOwnerWalks: mockWalks,
  fetchWalkSummary: mockSummary,
  fetchWalkDetail: mockDetail,
  fetchLiveWalk: mockLive,
  fetchApproach: mockApproach,
  cancelWalk: vi.fn(),
  reportNoShow: vi.fn(),
  rateWalk: vi.fn(),
  repeatWalk: vi.fn(),
  fetchReplay: vi.fn(),
}));
vi.mock("../../apps/web/src/map/MarkersMap.js", () => ({
  MarkersMap: (props: { label: string; markers: { label: string }[] }) => {
    if (props.label === "Mapa de llegada") {
      lastMap.current = props as unknown as Record<string, unknown>;
    }
    return <div data-testid="map" aria-label={props.label} data-labels={props.markers.map((m) => m.label).join("|")} />;
  },
}));

const START = "2099-01-02T22:00:00+00:00";
const LINE: [number, number][] = [[1.212, -77.283], [1.2136, -77.2811]];

function detail(over: Record<string, unknown> = {}) {
  return {
    id: "w1", status: "assigned", dog: { id: "d1", name: "Luna" },
    walker: { id: "m1", name: "Mateo", allTimeRating: 4.8, ratingCount: 23 },
    requestedTime: START, windowEnd: "2099-01-02T23:00:00+00:00", durationHours: 0.75, priceCop: 15000,
    offerCount: 3, timeline: [], rating: null, report: null, allowedActions: ["cancel", "approach"], ...over,
  };
}

function approach(over: Record<string, unknown> = {}) {
  return {
    enRouteAt: "2026-10-01T00:00:00+00:00",
    position: { lat: 1.212, lng: -77.283, updatedAt: null },
    pickup: { lat: 1.2136, lng: -77.2811 },
    route: { source: "osrm", distanceKm: 0.8, minutes: 10, geometry: LINE },
    ...over,
  };
}

async function open() {
  const { OwnerWalksScreen } = await import("../../apps/web/src/owner/OwnerWalksScreen.js");
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(<OwnerWalksScreen userId="owner-1" />);
  await user.click(await screen.findByRole("button", { name: "Abrir paseo de Luna" }));
  return user;
}

beforeEach(() => {
  cleanup();
  lastMap.current = {};
  for (const mock of [mockWalks, mockSummary, mockDetail, mockLive, mockApproach]) {
    mock.mockReset();
  }
  mockWalks.mockResolvedValue({
    items: [{ id: "w1", status: "assigned", dogId: "d1", dogName: "Luna", walkerId: "m1", walkerName: "Mateo",
              requestedTime: START, durationHours: 0.75, priceCop: 15000, canRate: false, hasReport: false }],
    nextCursor: null,
  });
  mockSummary.mockResolvedValue({ month: { walks: 0, km: 0, minutes: 0 }, counts: { upcoming: 0, active: 0, past: 0 } });
  mockDetail.mockResolvedValue(detail());
  mockApproach.mockResolvedValue(approach());
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("Owner follows the walker coming", () => {
  it("draws his position, the house and the street route, with the minutes left", async () => {
    await open();
    expect(await screen.findByLabelText("Mapa de llegada")).toHaveAttribute("data-labels", "Paseador|Tu casa");
    expect(screen.getByRole("status")).toHaveTextContent("Mateo llega en ~10 min");
    expect(lastMap.current.path).toEqual(LINE);
    expect(lastMap.current.pathStraight).toBeFalsy();
    expect(mockApproach).toHaveBeenCalledWith("w1");
  });

  it("is not there, and asks nothing, until the walker is on the way", async () => {
    mockDetail.mockResolvedValue(detail({ allowedActions: ["cancel"] }));
    await open();
    await screen.findByText(/Paseo de Luna/);
    expect(screen.queryByLabelText("Mapa de llegada")).not.toBeInTheDocument();
    expect(mockApproach).not.toHaveBeenCalled();
  });

  it("waits for a position when there is none yet", async () => {
    mockApproach.mockResolvedValue(approach({ position: null, route: null }));
    await open();
    expect(await screen.findByText("Esperando la ubicación de Mateo…")).toBeInTheDocument();
    expect(lastMap.current.path ?? null).toBeNull();
  });

  it("marks a straight fallback so the line is dashed", async () => {
    mockApproach.mockResolvedValue(approach({ route: { source: "straight", distanceKm: 0.3, minutes: 4, geometry: LINE } }));
    await open();
    await screen.findByLabelText("Mapa de llegada");
    await waitFor(() => expect(lastMap.current.pathStraight).toBe(true));
  });

  it("refreshes every 10 s, and stops for good when the walk starts (409)", async () => {
    const { ApiError } = await import("../../apps/web/src/lib/apiError.js");
    mockApproach
      .mockResolvedValueOnce(approach())
      .mockResolvedValueOnce(approach({ route: { source: "osrm", distanceKm: 0.4, minutes: 5, geometry: LINE } }))
      .mockRejectedValue(new ApiError("The walker is not on the way.", 409));
    await open();
    expect(await screen.findByText("Mateo llega en ~10 min")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await screen.findByText("Mateo llega en ~5 min")).toBeInTheDocument();

    mockDetail.mockResolvedValue(detail({ status: "in_walk", allowedActions: ["track"] }));
    mockLive.mockResolvedValue({ position: null, minutesElapsed: 0 });
    await vi.advanceTimersByTimeAsync(10_100);
    await waitFor(() => expect(screen.queryByLabelText("Mapa de llegada")).not.toBeInTheDocument());
    const calls = mockApproach.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockApproach.mock.calls.length).toBe(calls);
  });
});
