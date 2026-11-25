import { describe, expect, it, vi } from "vitest";
import type { Address, SwitchRequest } from "../data";
import {
  initialRouteId,
  latestRequest,
  lookupCaseAcrossRoutes,
  requestsAcrossRoutes,
  routeInPath,
  requestKey,
  trackPath,
  trackTarget,
  type RouteSource,
} from "./routing";

const BASE = { id: "base", isDefault: true };
const ARC = { id: "arc", isDefault: false };
const ROUTES = [BASE, ARC];
const OWNER: Address = "0x00000000000000000000000000000000000000a1";

describe("Track URLs", () => {
  it("keep the bare /track/<id> for the default route and qualify every other route", () => {
    expect(trackPath(BASE, 1n)).toBe("/track/1");
    expect(trackPath(BASE, "2")).toBe("/track/2");
    expect(trackPath(ARC, 1n)).toBe("/track/arc/1");
  });
  it("key a request by route where React and the tests need one name", () => {
    expect(requestKey(BASE, 2n)).toBe("2");
    expect(requestKey(ARC, 2n)).toBe("arc-2");
  });
  it("read /track/<id> as the default route, so the live links /track/1 and /track/2 keep their requests", () => {
    expect(trackTarget({ disputeId: "1" }, ROUTES)).toEqual({ kind: "request", routeId: "base", id: 1n });
    expect(trackTarget({ disputeId: "2" }, ROUTES)).toEqual({ kind: "request", routeId: "base", id: 2n });
  });
  it("read /track/<route>/<id> as that route's request", () => {
    expect(trackTarget({ routeId: "arc", disputeId: "1" }, ROUTES)).toEqual({ kind: "request", routeId: "arc", id: 1n });
  });
  it("send the default route's qualified spelling to its one URL, and /track/<route> to the list", () => {
    expect(trackTarget({ routeId: "base", disputeId: "7" }, ROUTES)).toEqual({ kind: "redirect", to: "/track/7" });
    expect(trackTarget({ disputeId: "arc" }, ROUTES)).toEqual({ kind: "redirect", to: "/track" });
  });
  it("tell the list, an unknown route and a bad ID apart", () => {
    expect(trackTarget({}, ROUTES)).toEqual({ kind: "list" });
    expect(trackTarget({ disputeId: "abc" }, ROUTES)).toEqual({ kind: "not-an-id", routeId: "base" });
    expect(trackTarget({ routeId: "arc", disputeId: "x1" }, ROUTES)).toEqual({ kind: "not-an-id", routeId: "arc" });
    expect(trackTarget({ routeId: "optimism", disputeId: "1" }, ROUTES)).toEqual({ kind: "unknown-route", slug: "optimism" });
  });
  it("round-trip: every route's trackPath reads back as the same request", () => {
    for (const r of ROUTES) {
      const parts = trackPath(r, 42n).split("/").filter(Boolean);
      const params = parts.length === 3 ? { routeId: parts[1], disputeId: parts[2] } : { disputeId: parts[1] };
      expect(trackTarget(params, ROUTES)).toEqual({ kind: "request", routeId: r.id, id: 42n });
    }
  });
  it("name the route a page is about, for the top bar and the wallet", () => {
    expect(routeInPath("/track/1", ROUTES)).toBe("base");
    expect(routeInPath("/track/arc/3", ROUTES)).toBe("arc");
    expect(routeInPath("/track/base/3", ROUTES)).toBe("base");
    for (const p of ["/", "/track", "/track/abc", "/track/arc", "/case", "/case/214", "/track/optimism/3"]) expect(routeInPath(p, ROUTES)).toBeNull();
  });
});

describe("the route the Request page starts on", () => {
  it("is ?route=, else the stored choice, else the default route; unknown ids are ignored", () => {
    expect(initialRouteId(ROUTES, "?route=arc", "base")).toBe("arc");
    expect(initialRouteId(ROUTES, "", "arc")).toBe("arc");
    expect(initialRouteId(ROUTES, "?route=nope", null)).toBe("base");
    expect(initialRouteId(ROUTES, "", "gone")).toBe("base");
  });
});

const req = (id: bigint, homeDisputeId: bigint | null = null) => ({ disputeId: id, homeDisputeId }) as SwitchRequest;

const source = (r: { id: string; isDefault: boolean }, over: Partial<RouteSource> = {}): RouteSource => ({
  ...r,
  name: r.id === "arc" ? "Arc Testnet" : "Base Sepolia",
  missing: [],
  data: { requests: vi.fn(async () => []), caseRequest: vi.fn(async () => null) },
  ...over,
});

describe("requests across routes", () => {
  it("lists each route's requests, routes in config order, and never calls a route that is not set up", async () => {
    const base = source(BASE, { data: { requests: vi.fn(async () => [req(2n), req(1n)]), caseRequest: vi.fn() } });
    const arcRequests = vi.fn(async () => [req(1n)]);
    const arc = source(ARC, { missing: ["foreign.ForeignGateway"], data: { requests: arcRequests, caseRequest: vi.fn() } });
    const list = await requestsAcrossRoutes([base, arc], OWNER, String);
    expect(list.items.map((i) => [i.routeId, i.req.disputeId])).toEqual([
      ["base", 2n],
      ["base", 1n],
    ]);
    expect(list.failed).toEqual([]);
    expect(arcRequests).not.toHaveBeenCalled();
    expect(base.data.requests).toHaveBeenCalledWith(OWNER);
  });
  it("keeps one route's requests when another fails, and names the failed route", async () => {
    const base = source(BASE, { data: { requests: async () => [req(1n)], caseRequest: vi.fn() } });
    const arc = source(ARC, { data: { requests: async () => Promise.reject(new Error("503")), caseRequest: vi.fn() } });
    const list = await requestsAcrossRoutes([base, arc], OWNER, (e) => (e as Error).message);
    expect(list.items.map((i) => i.routeId)).toEqual(["base"]);
    expect(list.failed).toEqual([{ routeId: "arc", name: "Arc Testnet", message: "503" }]);
  });
  it("opens the latest request at once only when every route answered and one route has requests", () => {
    const one = { items: [{ routeId: "base", req: req(2n) }, { routeId: "base", req: req(1n) }], failed: [] };
    expect(latestRequest(one)?.req.disputeId).toBe(2n);
    const both = { items: [{ routeId: "base", req: req(2n) }, { routeId: "arc", req: req(1n) }], failed: [] };
    expect(latestRequest(both)).toBeNull(); // IDs of two routes cannot be compared
    expect(latestRequest({ items: one.items, failed: [{ routeId: "arc", name: "Arc Testnet", message: "503" }] })).toBeNull();
    expect(latestRequest({ items: [], failed: [] })).toBeNull();
  });
});

describe("court case lookup across routes", () => {
  // Both HomeGateways sit on Arbitrum Sepolia over one KlerosCore: case 214 is Base request 2, case 300 Arc request 1.
  const cases = (map: Record<string, bigint>) => vi.fn(async (c: bigint) => map[c.toString()] ?? null);

  it("finds a case in whichever route's HomeGateway opened it", async () => {
    const base = source(BASE, { data: { requests: vi.fn(), caseRequest: cases({ 214: 2n }) } });
    const arc = source(ARC, { data: { requests: vi.fn(), caseRequest: cases({ 300: 1n }) } });
    expect(await lookupCaseAcrossRoutes([base, arc], 214n)).toEqual({ kind: "found", routeId: "base", requestId: 2n });
    expect(await lookupCaseAcrossRoutes([base, arc], 300n)).toEqual({ kind: "found", routeId: "arc", requestId: 1n });
    expect(await lookupCaseAcrossRoutes([base, arc], 999n)).toEqual({ kind: "missing" });
    expect(base.data.caseRequest).toHaveBeenCalledWith(300n);
    expect(arc.data.caseRequest).toHaveBeenCalledWith(214n);
  });
  it("skips a route that is not set up without a call, so /case/214 works while Arc is blank", async () => {
    const arcCase = vi.fn(async () => Promise.reject(new Error("not set up")));
    const base = source(BASE, { data: { requests: vi.fn(), caseRequest: cases({ 214: 2n }) } });
    const arc = source(ARC, { missing: ["foreign.ForeignGateway"], data: { requests: vi.fn(), caseRequest: arcCase } });
    expect(await lookupCaseAcrossRoutes([base, arc], 214n)).toEqual({ kind: "found", routeId: "base", requestId: 2n });
    expect(await lookupCaseAcrossRoutes([base, arc], 999n)).toEqual({ kind: "missing" });
    expect(arcCase).not.toHaveBeenCalled();
  });
  it("lets a match win over another route's failure, but never calls a failure missing", async () => {
    const down = async () => Promise.reject(new Error("HTTP request failed. Status: 503"));
    const base = source(BASE, { data: { requests: vi.fn(), caseRequest: cases({ 214: 2n }) } });
    const arc = source(ARC, { data: { requests: vi.fn(), caseRequest: down } });
    expect(await lookupCaseAcrossRoutes([base, arc], 214n)).toEqual({ kind: "found", routeId: "base", requestId: 2n });
    const miss = await lookupCaseAcrossRoutes([base, arc], 999n);
    expect(miss.kind).toBe("error");
    expect(miss.kind === "error" && miss.message).toMatch(/^Arc Testnet: /);
    const alone = await lookupCaseAcrossRoutes([source(BASE, { data: { requests: vi.fn(), caseRequest: down } })], 1n);
    expect(alone.kind === "error" && alone.message).not.toMatch(/Base Sepolia:/); // one route: no route name to add
  });
  it("is an error when no route is set up, and a site of one route lets that route say why", async () => {
    const arc = source(ARC, { missing: ["foreign.ForeignGateway"] });
    const base = source({ ...BASE, isDefault: false }, { missing: ["home.HomeGateway"] });
    expect((await lookupCaseAcrossRoutes([base, arc], 1n)).kind).toBe("error");
    expect(arc.data.caseRequest).not.toHaveBeenCalled();
    expect(base.data.caseRequest).not.toHaveBeenCalled();
    const notSet = vi.fn(async () => Promise.reject(new Error("The Veashi contracts are not set up on the test networks yet")));
    const alone = source(BASE, { missing: ["home.HomeGateway"], data: { requests: notSet, caseRequest: notSet } });
    const r = await lookupCaseAcrossRoutes([alone], 1n);
    expect(r.kind === "error" && r.message).toMatch(/not set up/);
    const list = await requestsAcrossRoutes([alone], OWNER, (e) => (e as Error).message);
    expect(list.failed.map((f) => f.message)).toEqual(["The Veashi contracts are not set up on the test networks yet"]);
  });
});
