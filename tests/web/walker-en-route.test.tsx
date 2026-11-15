// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// "Voy en camino" lives in Cómo llegar, where the walker's position is known:
// the tap tells the owner he is coming, and from then on his position is
// shared (never before the tap).

const mockEnRoute = vi.fn();
const mockHeartbeat = vi.fn();

vi.mock("../../apps/web/src/lib/marketplace.js", () => ({
  fetchWalkingRoute: vi.fn().mockRejectedValue(new Error("no streets")),
  markEnRoute: mockEnRoute,
  sendHeartbeat: mockHeartbeat,
}));
vi.mock("../../apps/web/src/map/MarkersMap.js", () => ({
  MarkersMap: () => <div data-testid="map" />,
}));

const TARGET = { requestId: "r1", dogName: "Luna", lat: 1.2136, lng: -77.2811 };

function fakeGeolocation() {
  const geolocation = {
    watchPosition: (ok: (position: unknown) => void) => {
      ok({ coords: { latitude: 1.212, longitude: -77.283 } });
      return 1;
    },
    clearWatch: vi.fn(),
  };
  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
}

async function panel(props: Record<string, unknown> = {}) {
  const { NavPanel } = await import("../../apps/web/src/walker/NavPanel.js");
  const user = userEvent.setup();
  render(<NavPanel walkerId="walker-1" target={TARGET} onClose={() => undefined} {...props} />);
  return user;
}

beforeEach(() => {
  mockEnRoute.mockReset().mockResolvedValue({ id: "r1", enRouteAt: "2026-10-01T00:00:00+00:00" });
  mockHeartbeat.mockReset().mockResolvedValue({});
  fakeGeolocation();
});
afterEach(cleanup);

describe("Voy en camino", () => {
  it("is offered before the walker sets off, and sends nothing yet", async () => {
    await panel();
    expect(await screen.findByRole("button", { name: /voy en camino/i })).toBeTruthy();
    expect(mockEnRoute).not.toHaveBeenCalled();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });

  it("the tap tells the server once and swaps the button for a status", async () => {
    const user = await panel();
    await user.click(await screen.findByRole("button", { name: /voy en camino/i }));
    await waitFor(() => expect(mockEnRoute).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText(/el dueño te ve llegar/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /voy en camino/i })).toBeNull();
    expect(mockEnRoute).toHaveBeenCalledTimes(1);
  });

  it("after the tap his position goes up so the owner can follow him", async () => {
    const user = await panel();
    await user.click(await screen.findByRole("button", { name: /voy en camino/i }));
    await waitFor(() => expect(mockHeartbeat).toHaveBeenCalledWith(1.212, -77.283));
  });

  it("a walk already on the way shows the status, not the button", async () => {
    await panel({ enRouteAt: "2026-10-01T00:00:00+00:00" });
    expect(await screen.findByText(/el dueño te ve llegar/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /voy en camino/i })).toBeNull();
    expect(mockEnRoute).not.toHaveBeenCalled();
    await waitFor(() => expect(mockHeartbeat).toHaveBeenCalled());
  });

  it("a failed tap says so and keeps the button", async () => {
    mockEnRoute.mockRejectedValueOnce(new Error("boom"));
    const user = await panel();
    await user.click(await screen.findByRole("button", { name: /voy en camino/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /voy en camino/i })).toBeTruthy();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });

  it("the demo preview never calls the server", async () => {
    const user = await panel({ demo: true });
    await user.click(await screen.findByRole("button", { name: /voy en camino/i }));
    expect(await screen.findByText(/el dueño te ve llegar/i)).toBeTruthy();
    expect(mockEnRoute).not.toHaveBeenCalled();
    expect(mockHeartbeat).not.toHaveBeenCalled();
  });
});
