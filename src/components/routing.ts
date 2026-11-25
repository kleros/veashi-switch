// Several routes, one site: the URLs of a route's requests, the route a URL names, and the reads that span every route
// (the wallet's requests, a court case number). Pure, so unit tests can hold them.
//
// Request IDs are per route (each ForeignGateway counts its disputes from 1), so a URL names the route, except for the
// default (first) route, whose requests keep the bare /track/<id> they always had:
//   /track/<id>            a request of the default route (the live links /track/1 and /track/2)
//   /track/<route>/<id>    a request of any other route, e.g. /track/arc/1
//   /case/<number>         a Kleros court case, looked up in every route's HomeGateway (they share one court, so a case
//                          number is opened by one HomeGateway only); the court template's frontendUrl lands here
import type { Address, RouteData, SwitchData, SwitchRequest } from "../data";
import { lookupCase } from "./readState";

/** What the URL helpers need of a route. */
export interface RouteRef {
  id: string;
  isDefault: boolean;
}

/** What the cross-route reads need of a route. */
export interface RouteSource extends RouteRef {
  name: string; // the foreign chain's name, how routes are told apart in messages ("Arc Testnet")
  missing: string[]; // non-empty: not set up yet, and never read
  data: Pick<SwitchData, "requests" | "caseRequest">;
}

/** A route as the cross-route reads take it. */
export const routeSource = (r: RouteData): RouteSource => ({
  id: r.id,
  isDefault: r.isDefault,
  name: r.env.foreign.name,
  missing: r.missing,
  data: r.data,
});

const DIGITS = /^\d+$/;

/** The Track URL of a request: bare on the default route, route-qualified on any other. */
export function trackPath(route: RouteRef, requestId: bigint | string): string {
  return route.isDefault ? `/track/${requestId.toString()}` : `/track/${route.id}/${requestId.toString()}`;
}

/** A key that names one request across routes (React keys, test ids): "5" on the default route, "arc-5" on another. */
export function requestKey(route: RouteRef, requestId: bigint | string): string {
  return route.isDefault ? requestId.toString() : `${route.id}-${requestId.toString()}`;
}

/** What a /track URL asks for, from its parameters (`/track/:disputeId` or `/track/:routeId/:disputeId`). */
export type TrackTarget =
  | { kind: "list" } // /track: the wallet's requests
  | { kind: "request"; routeId: string; id: bigint }
  | { kind: "not-an-id"; routeId: string } // the route is known, the ID is not a whole number
  | { kind: "unknown-route"; slug: string }
  | { kind: "redirect"; to: string }; // a non-canonical spelling of another URL

export function trackTarget(params: { routeId?: string; disputeId?: string }, routes: RouteRef[]): TrackTarget {
  const def = routes.find((r) => r.isDefault) ?? routes[0];
  const { routeId, disputeId } = params;
  if (routeId === undefined) {
    if (disputeId === undefined || disputeId === "") return { kind: "list" };
    if (DIGITS.test(disputeId)) return { kind: "request", routeId: def.id, id: BigInt(disputeId) };
    // /track/<route> alone: the list spans every route
    if (routes.length > 1 && routes.some((r) => r.id === disputeId)) return { kind: "redirect", to: "/track" };
    return { kind: "not-an-id", routeId: def.id };
  }
  const route = routes.find((r) => r.id === routeId);
  if (!route) return { kind: "unknown-route", slug: routeId };
  if (disputeId === undefined || !DIGITS.test(disputeId)) return { kind: "not-an-id", routeId: route.id };
  // the default route's requests have one URL: /track/base/1 is /track/1
  if (route.isDefault) return { kind: "redirect", to: trackPath(route, disputeId) };
  return { kind: "request", routeId: route.id, id: BigInt(disputeId) };
}

/**
 * The route a URL is about (`/track/<id>` or `/track/<route>/<id>`), or null for a page about none in particular (the
 * Track list, a court case looked up in every route). The top bar and the wallet follow it.
 */
export function routeInPath(pathname: string, routes: RouteRef[]): string | null {
  const def = routes.find((r) => r.isDefault) ?? routes[0];
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "track") return null;
  if (parts.length === 2 && DIGITS.test(parts[1])) return def?.id ?? null;
  if (parts.length === 3 && routes.some((r) => r.id === parts[1])) return parts[1];
  return null;
}

/** The route the Request page starts on: `?route=<id>`, else the viewer's last choice, else the default route. */
export function initialRouteId(routes: RouteRef[], search: string, stored: string | null): string {
  const def = (routes.find((r) => r.isDefault) ?? routes[0]).id;
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(search).get("route");
  } catch {
    asked = null;
  }
  for (const id of [asked, stored]) if (id && routes.some((r) => r.id === id)) return id;
  return def;
}

/** One request, with the route it belongs to. */
export interface RoutedRequest {
  routeId: string;
  req: SwitchRequest;
}

/** The wallet's requests on every set-up route: per route newest first, routes in config order; failures beside them. */
export interface RoutedList {
  items: RoutedRequest[];
  failed: { routeId: string; name: string; message: string }[];
}

/** The routes a cross-route read calls: the set-up ones; a site of one route asks it whatever (it says why it cannot). */
const readable = (routes: RouteSource[]) => (routes.length === 1 ? routes : routes.filter((r) => r.missing.length === 0));

/**
 * Lists `owner`'s requests on every route. A route that is not set up is skipped without a call; one route failing
 * does not hide another's requests.
 */
export async function requestsAcrossRoutes(
  routes: RouteSource[],
  owner: Address,
  describe: (e: unknown) => string,
): Promise<RoutedList> {
  const live = readable(routes);
  const settled = await Promise.allSettled(live.map((r) => r.data.requests(owner)));
  const out: RoutedList = { items: [], failed: [] };
  settled.forEach((s, i) => {
    const r = live[i];
    if (s.status === "fulfilled") out.items.push(...s.value.map((req) => ({ routeId: r.id, req })));
    else out.failed.push({ routeId: r.id, name: r.name, message: describe(s.reason) });
  });
  return out;
}

/** The request `/track` opens at once: the newest one, when every route answered and only one of them has any. */
export function latestRequest(list: RoutedList): RoutedRequest | null {
  if (list.failed.length > 0 || list.items.length === 0) return null;
  const routesWithItems = new Set(list.items.map((i) => i.routeId));
  return routesWithItems.size === 1 ? list.items[0] : null;
}

/** A court case number looked up in every route: found (with its route), no route's case, or a failed read. */
export type RoutedCaseLookup =
  | { kind: "loading" }
  | { kind: "found"; routeId: string; requestId: bigint }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * Finds the request a Kleros court case opened, in every set-up route at once (routes that are not set up are never
 * called): each route asks its own HomeGateway (`disputeIDtoHash`), then its own ForeignGateway. The routes share one
 * court, whose case numbers are opened by one HomeGateway each, so the first route that finds it (in config order) has
 * it, whatever the others answer. With no match, a failed read is an error: the case may be on the route that did not
 * answer.
 */
export async function lookupCaseAcrossRoutes(routes: RouteSource[], caseId: bigint): Promise<RoutedCaseLookup> {
  const live = readable(routes);
  if (live.length === 0) return { kind: "error", message: "No network of this site is set up yet, so there is no court case to look up." };
  const results = await Promise.all(live.map((r) => lookupCase(r.data, caseId)));
  const hit = results.findIndex((r) => r.kind === "found");
  if (hit >= 0) {
    const found = results[hit] as { kind: "found"; requestId: bigint };
    return { kind: "found", routeId: live[hit].id, requestId: found.requestId };
  }
  const errors = results.flatMap((r, i) => (r.kind === "error" ? [{ name: live[i].name, message: r.message }] : []));
  if (errors.length === 0) return { kind: "missing" };
  if (live.length === 1) return { kind: "error", message: errors[0].message };
  return { kind: "error", message: errors.map((e) => `${e.name}: ${e.message}`).join(" ") };
}
