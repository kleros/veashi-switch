import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { SetupProvider, type AppSetup } from "./components/setup";
import { ToastProvider } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { NetworkDown } from "./components/NetworkDown";
import { PageHead, Shell } from "./components/ui";
import { AccountControl, WalletProvider } from "./components/wallet";
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

export type Boot = { setup: AppSetup; error?: undefined } | { setup?: undefined; error: string };

const SetupError: React.FC<{ error: string }> = ({ error }) => (
  <>
    <TopBar />
    <Shell>
      <PageHead>
        <div>
          <h1>Local network unavailable</h1>
          <p>This app talks only to contracts on a local two-chain demo network.</p>
        </div>
      </PageHead>
      <NetworkDown error={error} onRetry={() => window.location.reload()} />
    </Shell>
  </>
);

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
                      <Route path="/" element={<RequestPage />} />
                      <Route path="/track" element={<TrackPage />} />
                      <Route path="/track/:disputeId" element={<TrackPage />} />
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
