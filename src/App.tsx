import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { SetupProvider, useSetup, type AppSetup } from "./components/setup";
import { ToastProvider } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { NetworkDown, setupCopy } from "./components/NetworkDown";
import { PageHead, Shell } from "./components/ui";
import { AccountControl, WalletProvider } from "./components/wallet";
import { CasePage } from "./pages/CasePage";
import { RequestPage } from "./pages/RequestPage";
import { TrackPage } from "./pages/TrackPage";
import { ThemeMode } from "./theme/ThemeMode";

/** A new page starts at the top (a hash link keeps its own target). */
const ScrollTop: React.FC = () => {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
};

/**
 * The Request page, on the route picked there. `?route=<id>` picks a route (a link to the Arc route, say) and then leaves
 * the URL, so the viewer's own pick holds from there; the page starts afresh for each route (its oracles, fees and
 * quote are that route's).
 */
const RequestRoute: React.FC = () => {
  const { routes, selectedId, selectRoute } = useSetup();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const asked = q.get("route");
    if (asked === null) return;
    selectRoute(asked);
    q.delete("route");
    const search = q.toString();
    nav({ pathname: loc.pathname, search: search ? `?${search}` : "", hash: loc.hash }, { replace: true });
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  return <RequestPage key={routes.length > 1 ? selectedId : undefined} />;
};

export type Boot = { setup: AppSetup; error?: undefined } | { setup?: undefined; error: string };

const SetupError: React.FC<{ error: string }> = ({ error }) => {
  const copy = setupCopy();
  return (
    <>
      <TopBar />
      <Shell>
        <PageHead>
          <div>
            <h1>{copy.heading}</h1>
            <p>{copy.lede}</p>
          </div>
        </PageHead>
        <NetworkDown error={error} onRetry={() => window.location.reload()} />
      </Shell>
    </>
  );
};

export const App: React.FC<{ boot: Boot }> = ({ boot }) => {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ThemeMode>
      <ToastProvider>
        <BrowserRouter>
          <ScrollTop />
          {boot.setup ? (
            <WagmiProvider config={boot.setup.config}>
              <QueryClientProvider client={queryClient}>
                <SetupProvider setup={boot.setup}>
                  <WalletProvider>
                    <TopBar account={<AccountControl />} />
                    <Routes>
                      <Route path="/" element={<RequestRoute />} />
                      <Route path="/track" element={<TrackPage />} />
                      <Route path="/track/:disputeId" element={<TrackPage />} />
                      <Route path="/track/:routeId/:disputeId" element={<TrackPage />} />
                      <Route path="/case" element={<CasePage />} />
                      <Route path="/case/:caseId" element={<CasePage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </WalletProvider>
                </SetupProvider>
              </QueryClientProvider>
            </WagmiProvider>
          ) : (
            <SetupError error={boot.error} />
          )}
        </BrowserRouter>
      </ToastProvider>
    </ThemeMode>
  );
};
