// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The pickup field (inDrive style): one text box that finds the address as you type, "Mi ubicación",
// the saved home and recent pickups before typing, and a map icon that opens the full-screen map.
// Photon is behind the API, so searchAddress / reverseAddress are mocked here.

const mockSearch = vi.fn();
const mockReverse = vi.fn();

vi.mock("../../apps/web/src/lib/marketplace.js", () => ({
  searchAddress: mockSearch,
  reverseAddress: mockReverse,
}));

vi.mock("../../apps/web/src/map/PickupMapSheet.js", () => ({
  PickupMapSheet: ({
    open,
    initial,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    initial: { lat: number; lng: number } | null;
    onConfirm: (value: { label: string; lat: number; lng: number }) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="mapa falso" data-initial={JSON.stringify(initial)}>
        <button type="button" onClick={() => onConfirm({ label: "Parque Bolívar", lat: 1.22, lng: -77.28 })}>
          Confirmar mapa
        </button>
        <button type="button" onClick={onClose}>
          Cerrar mapa falso
        </button>
      </div>
    ) : null,
}));

type Place = { label: string; lat: number; lng: number };

const HOME: Place = { label: "Mi casa, Calle 18", lat: 1.2136, lng: -77.2811 };

const PLAZA = { label: "Plaza de Nariño", detail: "Centro, Pasto", lat: 1.2146, lng: -77.2786 };
const UNICENTRO = { label: "Unicentro Pasto", detail: "Torobajo, Pasto", lat: 1.2201, lng: -77.2745 };

let latest: Place | null = null;

function Harness({ home = null, initial = null }: { home?: Place | null; initial?: Place | null }) {
  const [value, setValue] = useState<Place | null>(initial);
  latest = value;
  return <PickupFieldUnderTest value={value} onChange={setValue} home={home} />;
}

let PickupFieldUnderTest: typeof import("../../apps/web/src/map/PickupField.js").PickupField;

async function setup(props: { home?: Place | null; initial?: Place | null } = {}) {
  ({ PickupField: PickupFieldUnderTest } = await import("../../apps/web/src/map/PickupField.js"));
  const user = userEvent.setup();
  render(<Harness {...props} />);
  return user;
}

const box = () => screen.getByRole("combobox", { name: "Dirección de recogida" });

describe("PickupField", () => {
  beforeEach(() => {
    cleanup();
    latest = null;
    window.localStorage.clear();
    mockSearch.mockReset();
    mockReverse.mockReset();
    mockSearch.mockResolvedValue({ status: "ok", results: [PLAZA, UNICENTRO] });
    mockReverse.mockResolvedValue({ status: "ok", results: [{ label: "Calle 18 22-10", detail: "Centro, Pasto", lat: 1.2, lng: -77.28 }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("before typing", () => {
    it("offers my location, the saved home and the recent pickups", async () => {
      window.localStorage.setItem(
        "cantrack.recentPickups",
        JSON.stringify([{ label: "Parque Infantil", lat: 1.213, lng: -77.28 }]),
      );
      const user = await setup({ home: HOME });
      await user.click(box());

      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        expect.stringContaining("Mi ubicación"),
        expect.stringContaining("Mi casa, Calle 18"),
        expect.stringContaining("Parque Infantil"),
      ]);
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("works with no home and no recents: only my location", async () => {
      const user = await setup();
      await user.click(box());
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    it("picks the saved home", async () => {
      const user = await setup({ home: HOME });
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi casa, Calle 18/ }));

      expect(latest).toEqual(HOME);
      expect(box()).toHaveValue("Mi casa, Calle 18");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("shows the prefilled value as text", async () => {
      await setup({ initial: HOME });
      expect(box()).toHaveValue("Mi casa, Calle 18");
    });
  });

  describe("search as you type", () => {
    it("waits for three characters and then searches once, with the trimmed text", async () => {
      const user = await setup();
      await user.type(box(), "pl");
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(mockSearch).not.toHaveBeenCalled();

      await user.type(box(), "a ");
      await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
      expect(mockSearch).toHaveBeenCalledWith("pla");
    });

    it("shows the label and the detail of each result", async () => {
      const user = await setup();
      await user.type(box(), "plaza");

      const first = await screen.findByRole("option", { name: /Plaza de Nariño/ });
      expect(first).toHaveTextContent("Centro, Pasto");
      expect(screen.getByRole("option", { name: /Unicentro Pasto/ })).toHaveTextContent("Torobajo, Pasto");
    });

    it("picking a result sets the pin and the text, and closes the list", async () => {
      const user = await setup();
      await user.type(box(), "plaza");
      await user.click(await screen.findByRole("option", { name: /Plaza de Nariño/ }));

      expect(latest).toEqual({ label: "Plaza de Nariño", lat: 1.2146, lng: -77.2786 });
      expect(box()).toHaveValue("Plaza de Nariño");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("editing the text drops the pin until a new place is picked", async () => {
      const user = await setup({ initial: HOME });
      await user.type(box(), "x");
      expect(latest).toBeNull();
    });

    it("ignores a slow answer for text that is no longer in the box", async () => {
      let resolveFirst: (value: unknown) => void = () => undefined;
      mockSearch
        .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
        .mockResolvedValueOnce({ status: "ok", results: [UNICENTRO] });
      const user = await setup();

      await user.type(box(), "pla");
      await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
      await user.type(box(), "za");
      await screen.findByRole("option", { name: /Unicentro Pasto/ });

      resolveFirst({ status: "ok", results: [PLAZA] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole("option", { name: /Plaza de Nariño/ })).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Unicentro Pasto/ })).toBeInTheDocument();
    });

    it("says so when nothing matches, and still offers the map", async () => {
      mockSearch.mockResolvedValue({ status: "ok", results: [] });
      const user = await setup();
      await user.type(box(), "zzzz");

      expect(await screen.findByText("No encontramos ese lugar en Pasto.")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Elegir en el mapa/ })).toBeInTheDocument();
    });

    it("says so when the search is down, and still offers the map", async () => {
      mockSearch.mockResolvedValue({ status: "unavailable", results: [] });
      const user = await setup();
      await user.type(box(), "plaza");

      expect(await screen.findByText("No pudimos buscar direcciones ahora. Usa el mapa.")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Elegir en el mapa/ })).toBeInTheDocument();
    });

    it("treats a failed request like an unavailable search", async () => {
      mockSearch.mockRejectedValue(new Error("network"));
      const user = await setup();
      await user.type(box(), "plaza");
      expect(await screen.findByText("No pudimos buscar direcciones ahora. Usa el mapa.")).toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("arrow down then Enter picks the first result; Escape closes the list", async () => {
      const user = await setup();
      await user.type(box(), "plaza");
      await screen.findByRole("option", { name: /Plaza de Nariño/ });

      await user.keyboard("{ArrowDown}{Enter}");
      expect(latest).toMatchObject({ label: "Plaza de Nariño" });

      await user.clear(box());
      await user.type(box(), "plaza");
      await screen.findByRole("listbox");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("keeps the active option in aria-activedescendant", async () => {
      const user = await setup();
      await user.type(box(), "plaza");
      await screen.findByRole("option", { name: /Plaza de Nariño/ });

      await user.keyboard("{ArrowDown}{ArrowDown}");
      const active = screen.getByRole("option", { name: /Unicentro Pasto/ });
      expect(box()).toHaveAttribute("aria-activedescendant", active.id);
    });
  });

  describe("Mi ubicación", () => {
    function stubGeolocation(lat: number, lng: number) {
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (ok: (position: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: lat, longitude: lng } }),
        },
      });
    }

    it("reverse-geocodes where I am and fills the field", async () => {
      stubGeolocation(1.2, -77.28);
      const user = await setup();
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi ubicación/ }));

      await waitFor(() => expect(latest).toEqual({ label: "Calle 18 22-10", lat: 1.2, lng: -77.28 }));
      expect(mockReverse).toHaveBeenCalledWith(1.2, -77.28);
    });

    it("falls back to the plain name when the address lookup fails", async () => {
      stubGeolocation(1.2, -77.28);
      mockReverse.mockResolvedValue({ status: "unavailable", results: [] });
      const user = await setup();
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi ubicación/ }));

      await waitFor(() => expect(latest).toEqual({ label: "Mi ubicación", lat: 1.2, lng: -77.28 }));
    });

    it("refuses a position outside Pasto and says so", async () => {
      stubGeolocation(4.6, -74.08);
      const user = await setup();
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi ubicación/ }));

      expect(await screen.findByText("Estás fuera de Pasto: escribe la dirección o usa el mapa.")).toBeInTheDocument();
      expect(latest).toBeNull();
      expect(mockReverse).not.toHaveBeenCalled();
    });

    it("explains a browser that cannot locate", async () => {
      vi.stubGlobal("navigator", {});
      const user = await setup();
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi ubicación/ }));
      expect(await screen.findByText("Tu navegador no permite ubicarte.")).toBeInTheDocument();
    });

    it("explains a denied permission", async () => {
      vi.stubGlobal("navigator", {
        geolocation: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
      });
      const user = await setup();
      await user.click(box());
      await user.click(screen.getByRole("option", { name: /Mi ubicación/ }));
      expect(await screen.findByText("No pudimos obtener tu ubicación. Escribe la dirección o usa el mapa.")).toBeInTheDocument();
    });
  });

  describe("the map icon", () => {
    it("opens the map starting at the current pin, and a confirmed point fills the field", async () => {
      const user = await setup({ initial: HOME });
      await user.click(screen.getByRole("button", { name: "Elegir en el mapa" }));

      expect(screen.getByRole("dialog", { name: "mapa falso" })).toHaveAttribute(
        "data-initial",
        JSON.stringify({ lat: 1.2136, lng: -77.2811 }),
      );
      await user.click(screen.getByRole("button", { name: "Confirmar mapa" }));

      expect(latest).toEqual({ label: "Parque Bolívar", lat: 1.22, lng: -77.28 });
      expect(box()).toHaveValue("Parque Bolívar");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens with no starting point when nothing is picked yet", async () => {
      const user = await setup();
      await user.click(screen.getByRole("button", { name: "Elegir en el mapa" }));
      expect(screen.getByRole("dialog")).toHaveAttribute("data-initial", "null");
    });

    it("closing the map leaves the field as it was", async () => {
      const user = await setup({ initial: HOME });
      await user.click(screen.getByRole("button", { name: "Elegir en el mapa" }));
      await user.click(screen.getByRole("button", { name: "Cerrar mapa falso" }));
      expect(latest).toEqual(HOME);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("the list's own map row opens it too", async () => {
      mockSearch.mockResolvedValue({ status: "ok", results: [] });
      const user = await setup();
      await user.type(box(), "zzzz");
      await user.click(await screen.findByRole("option", { name: /Elegir en el mapa/ }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("clearing", () => {
    it("the clear button empties the text and the pin", async () => {
      const user = await setup({ initial: HOME });
      await user.click(screen.getByRole("button", { name: "Borrar dirección" }));
      expect(box()).toHaveValue("");
      expect(latest).toBeNull();
    });

    it("has no clear button when the box is empty", async () => {
      await setup();
      expect(screen.queryByRole("button", { name: "Borrar dirección" })).not.toBeInTheDocument();
    });
  });

  it("marks the box invalid when the form says so", async () => {
    ({ PickupField: PickupFieldUnderTest } = await import("../../apps/web/src/map/PickupField.js"));
    render(<PickupFieldUnderTest value={null} onChange={() => undefined} home={null} invalid />);
    expect(box()).toHaveAttribute("aria-invalid", "true");
  });
});
