// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MarkersMap } from "../../apps/web/src/map/MarkersMap.js";

// The routed line is drawn like a navigation app: a dark border under a thick
// lime stroke, round ends, a dot at each end. A straight fallback is dashed.
// Leaflet itself is faked; the test reads what the component asked it to draw.

type Drawn = { kind: "polyline" | "circle"; args: unknown[]; options: Record<string, unknown> };

function fakeLeaflet() {
  const drawn: Drawn[] = [];
  const layer = () => {
    const self = { addTo: () => self, bindTooltip: () => self, on: () => self };
    return self;
  };
  const group = { addTo: () => group, clearLayers: vi.fn() };
  const map = { remove: vi.fn(), setView: vi.fn(), fitBounds: vi.fn() };
  const L = {
    map: () => map,
    tileLayer: () => layer(),
    layerGroup: () => group,
    marker: () => layer(),
    divIcon: () => ({}),
    latLngBounds: (points: unknown) => points,
    polyline: (points: unknown, options: Record<string, unknown>) => {
      drawn.push({ kind: "polyline", args: [points], options });
      return layer();
    },
    circleMarker: (point: unknown, options: Record<string, unknown>) => {
      drawn.push({ kind: "circle", args: [point], options });
      return layer();
    },
  };
  return { L, drawn };
}

const PATH: [number, number][] = [[1.2136, -77.2811], [1.2125, -77.28], [1.215, -77.279]];
const MARKERS = [{ id: "a", lat: 1.2136, lng: -77.2811, label: "A" }, { id: "b", lat: 1.215, lng: -77.279, label: "B" }];

async function draw(props: Partial<React.ComponentProps<typeof MarkersMap>>) {
  const { L, drawn } = fakeLeaflet();
  render(<MarkersMap label="Mapa" markers={MARKERS} loadLeaflet={async () => L as never} {...props} />);
  await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
  return drawn;
}

afterEach(cleanup);

describe("MarkersMap routed line", () => {
  it("draws a dark border first and the lime stroke on top, both rounded", async () => {
    const lines = (await draw({ path: PATH })).filter((item) => item.kind === "polyline");
    expect(lines).toHaveLength(2);
    const [border, stroke] = lines as [Drawn, Drawn];
    expect(border.args[0]).toEqual(PATH);
    expect(stroke.args[0]).toEqual(PATH);
    expect(border.options.color).toBe("#16301f");
    expect(stroke.options.color).toBe("#a8dd3e");
    expect(border.options.weight as number).toBeGreaterThan(stroke.options.weight as number);
    for (const line of [border, stroke]) {
      expect(line.options.lineCap).toBe("round");
      expect(line.options.lineJoin).toBe("round");
      expect(line.options.dashArray).toBeUndefined();
    }
  });

  it("puts a dot at each end of the line", async () => {
    const dots = (await draw({ path: PATH })).filter((item) => item.kind === "circle");
    expect(dots.map((dot) => dot.args[0])).toEqual([PATH[0], PATH[PATH.length - 1]]);
  });

  it("dashes the line when it is only the straight fallback", async () => {
    const lines = (await draw({ path: PATH, pathStraight: true })).filter((item) => item.kind === "polyline");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.options.dashArray).toBeTruthy();
    }
  });

  it("a path wins over joining the pins", async () => {
    const lines = (await draw({ path: PATH, connect: true })).filter((item) => item.kind === "polyline");
    expect(lines.every((line) => line.args[0] === PATH)).toBe(true);
  });

  it("without a path, connect still joins the pins with the old trail", async () => {
    const lines = (await draw({ connect: true })).filter((item) => item.kind === "polyline");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.args[0]).toEqual([[1.2136, -77.2811], [1.215, -77.279]]);
  });
});
