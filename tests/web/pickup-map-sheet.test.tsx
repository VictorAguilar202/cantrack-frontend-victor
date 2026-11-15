// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The full-screen map of the pickup field: the pin stays in the middle while the map moves under it,
// the address under the pin follows, "Listo" confirms. Leaflet is faked; the test moves the map by
// changing the fake's centre and firing the handlers the component registered.

const mockReverse = vi.fn();

vi.mock("../../apps/web/src/lib/marketplace.js", () => ({
  reverseAddress: mockReverse,
}));

const handlers: Record<string, () => void> = {};
let center = { lat: 0, lng: 0 };
let mapOptions: { center: [number, number]; zoom: number; maxBounds: unknown } | null = null;
const setView = vi.fn();
const mapRemove = vi.fn();
const invalidateSize = vi.fn();

const fakeMap = {
  on: (name: string, handler: () => void) => {
    handlers[name] = handler;
    return fakeMap;
  },
  getCenter: () => center,
  setView: (target: [number, number], zoom: number) => {
    setView(target, zoom);
    center = { lat: target[0], lng: target[1] };
    handlers.moveend?.();
    return fakeMap;
  },
  invalidateSize,
  remove: mapRemove,
};

const fakeLeaflet = {
  map: (_element: HTMLElement, options: { center: [number, number]; zoom: number; maxBounds: unknown }) => {
    mapOptions = options;
    center = { lat: options.center[0], lng: options.center[1] };
    return fakeMap;
  },
  tileLayer: () => ({ addTo: () => undefined }),
} as unknown as typeof import("leaflet");

async function moveMapTo(lat: number, lng: number) {
  center = { lat, lng };
  await act(async () => {
    handlers.movestart?.();
    handlers.moveend?.();
  });
}

function result(label: string) {
  return { status: "ok", results: [{ label, detail: "Pasto", lat: 1.2, lng: -77.28 }] };
}

async function renderSheet(props: Partial<{ open: boolean; initial: { lat: number; lng: number } | null; loadLeaflet: () => Promise<typeof import("leaflet")> }> = {}) {
  const { PickupMapSheet } = await import("../../apps/web/src/map/PickupMapSheet.js");
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <PickupMapSheet
      open={props.open ?? true}
      initial={props.initial === undefined ? { lat: 1.2136, lng: -77.2811 } : props.initial}
      onConfirm={onConfirm}
      onClose={onClose}
      loadLeaflet={props.loadLeaflet ?? (async () => fakeLeaflet)}
    />,
  );
  return { user, onConfirm, onClose };
}

const dialog = () => screen.findByRole("dialog", { name: "Elegir punto de recogida" });

describe("PickupMapSheet", () => {
  beforeEach(() => {
    cleanup();
    for (const key of Object.keys(handlers)) delete handlers[key];
    mapOptions = null;
    for (const mock of [mockReverse, setView, mapRemove, invalidateSize]) mock.mockReset();
    mockReverse.mockResolvedValue(result("Calle 18 22-10"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders nothing while closed and does not load the map", async () => {
    const loadLeaflet = vi.fn(async () => fakeLeaflet);
    await renderSheet({ open: false, loadLeaflet });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(loadLeaflet).not.toHaveBeenCalled();
  });

  it("opens centred on the current pin and shows its address", async () => {
    await renderSheet();
    await dialog();

    await waitFor(() => expect(mapOptions).not.toBeNull());
    expect(mapOptions?.center).toEqual([1.2136, -77.2811]);
    expect(mapOptions?.zoom).toBe(16);
    expect(await screen.findByText("Calle 18 22-10")).toBeInTheDocument();
    expect(mockReverse).toHaveBeenCalledWith(1.2136, -77.2811);
  });

  it("opens on Pasto when there is no pin yet", async () => {
    await renderSheet({ initial: null });
    await waitFor(() => expect(mapOptions).not.toBeNull());
    expect(mapOptions?.center).toEqual([1.2136, -77.2811]);
    expect(mapOptions?.zoom).toBe(14);
  });

  it("keeps the map inside the service area", async () => {
    await renderSheet();
    await waitFor(() => expect(mapOptions).not.toBeNull());
    expect(mapOptions?.maxBounds).toEqual([
      [1.12, -77.36],
      [1.3, -77.2],
    ]);
  });

  it("looks the address up after the map stops moving, not while it moves", async () => {
    await renderSheet();
    await screen.findByText("Calle 18 22-10");
    mockReverse.mockClear();
    mockReverse.mockResolvedValue(result("Carrera 27 15-30"));

    await act(async () => {
      handlers.movestart?.();
    });
    expect(screen.getByText("Buscando dirección…")).toBeInTheDocument();
    expect(mockReverse).not.toHaveBeenCalled();

    await moveMapTo(1.2201, -77.2745);
    expect(await screen.findByText("Carrera 27 15-30")).toBeInTheDocument();
    expect(mockReverse).toHaveBeenCalledTimes(1);
    expect(mockReverse).toHaveBeenCalledWith(1.2201, -77.2745);
  });

  it("drops a slow address for a spot the map already left", async () => {
    await renderSheet();
    await screen.findByText("Calle 18 22-10");

    let resolveSlow: (value: unknown) => void = () => undefined;
    mockReverse.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)));
    await moveMapTo(1.22, -77.27);
    await waitFor(() => expect(mockReverse).toHaveBeenCalledTimes(2));

    mockReverse.mockResolvedValueOnce(result("Plaza de Nariño"));
    await moveMapTo(1.2146, -77.2786);
    expect(await screen.findByText("Plaza de Nariño")).toBeInTheDocument();

    await act(async () => resolveSlow(result("Dirección vieja")));
    expect(screen.queryByText("Dirección vieja")).not.toBeInTheDocument();
    expect(screen.getByText("Plaza de Nariño")).toBeInTheDocument();
  });

  it("Listo confirms the centre of the map with its address, rounded to six decimals", async () => {
    const { user, onConfirm } = await renderSheet();
    await screen.findByText("Calle 18 22-10");
    mockReverse.mockResolvedValue(result("Plaza de Nariño"));
    await moveMapTo(1.21461234567, -77.27861234567);
    await screen.findByText("Plaza de Nariño");

    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(onConfirm).toHaveBeenCalledWith({ label: "Plaza de Nariño", lat: 1.214612, lng: -77.278612 });
  });

  it("cannot confirm while the address is still loading", async () => {
    await renderSheet();
    await screen.findByText("Calle 18 22-10");
    await act(async () => {
      handlers.movestart?.();
    });
    expect(screen.getByRole("button", { name: "Listo" })).toBeDisabled();
  });

  it("a point outside Pasto says so, never asks the API and cannot be confirmed", async () => {
    await renderSheet();
    await screen.findByText("Calle 18 22-10");
    mockReverse.mockClear();

    await moveMapTo(4.6, -74.08);
    expect(await screen.findByText("Ese punto queda fuera de Pasto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toBeDisabled();
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it("falls back to a plain name when no address is found, and still confirms", async () => {
    const { user, onConfirm } = await renderSheet();
    await screen.findByText("Calle 18 22-10");
    mockReverse.mockResolvedValue({ status: "ok", results: [] });
    await moveMapTo(1.2, -77.3);

    expect(await screen.findByText("Punto en el mapa")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(onConfirm).toHaveBeenCalledWith({ label: "Punto en el mapa", lat: 1.2, lng: -77.3 });
  });

  it("falls back the same way when the lookup is down or fails", async () => {
    mockReverse.mockRejectedValue(new Error("network"));
    await renderSheet();
    expect(await screen.findByText("Punto en el mapa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toBeEnabled();
  });

  it("the close button and Escape both close it", async () => {
    const { user, onClose } = await renderSheet();
    await dialog();
    await user.click(screen.getByRole("button", { name: "Cerrar mapa" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has a fixed pin in the middle that the map does not carry", async () => {
    await renderSheet();
    const sheet = await dialog();
    expect(sheet.querySelector(".pickup-sheet__pin")).not.toBeNull();
  });

  describe("Mi ubicación", () => {
    it("moves the map to where I am", async () => {
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (ok: (position: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: 1.2, longitude: -77.28 } }),
        },
      });
      const { user } = await renderSheet();
      await screen.findByText("Calle 18 22-10");
      await user.click(screen.getByRole("button", { name: "Mi ubicación" }));
      expect(setView).toHaveBeenCalledWith([1.2, -77.28], 17);
    });

    it("refuses a position outside Pasto", async () => {
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (ok: (position: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: 4.6, longitude: -74.08 } }),
        },
      });
      const { user } = await renderSheet();
      await screen.findByText("Calle 18 22-10");
      await user.click(screen.getByRole("button", { name: "Mi ubicación" }));
      expect(setView).not.toHaveBeenCalled();
      expect(screen.getByText("Estás fuera de Pasto: mueve el mapa para elegir el punto.")).toBeInTheDocument();
    });

    it("explains a denied permission", async () => {
      vi.stubGlobal("navigator", {
        geolocation: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
      });
      const { user } = await renderSheet();
      await screen.findByText("Calle 18 22-10");
      await user.click(screen.getByRole("button", { name: "Mi ubicación" }));
      expect(screen.getByText("No pudimos obtener tu ubicación. Mueve el mapa para elegir el punto.")).toBeInTheDocument();
    });
  });

  it("says so when the map cannot load, and cannot confirm", async () => {
    await renderSheet({
      loadLeaflet: async () => {
        throw new Error("chunk failed");
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el mapa. Cierra esto y escribe la dirección.");
    expect(screen.getByRole("button", { name: "Listo" })).toBeDisabled();
  });

  it("removes the map when it closes", async () => {
    const { PickupMapSheet } = await import("../../apps/web/src/map/PickupMapSheet.js");
    const props = { initial: null, onConfirm: () => undefined, onClose: () => undefined, loadLeaflet: async () => fakeLeaflet };
    const view = render(<PickupMapSheet open {...props} />);
    await waitFor(() => expect(mapOptions).not.toBeNull());
    view.rerender(<PickupMapSheet open={false} {...props} />);
    expect(mapRemove).toHaveBeenCalled();
  });
});
