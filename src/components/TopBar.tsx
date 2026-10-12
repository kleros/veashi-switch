import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import styled from "styled-components";
import { useThemeMode } from "../theme/ThemeMode";
import { HelpDialog } from "./HelpDialog";
import { useChainNames, useRouteMaybe } from "./setup";
import { Icon, IconButton, LibButton } from "./ui";

const Bar = styled.header`
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  border-bottom: 1px solid var(--stroke);
  @media (max-width: 640px) {
    position: static;
  }
`;

const In = styled.div`
  max-width: 1240px;
  margin: 0 auto;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px 20px;
  flex-wrap: wrap;
`;

const Brand = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  text-decoration: none;
  font-weight: 600;
  svg {
    width: 26px;
    height: 26px;
  }
  small {
    color: var(--text-3);
    font-weight: 400;
    font-size: inherit;
  }
`;

const RoutePill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 12px;
  border: 1px solid var(--stroke);
  border-radius: 999px;
  font-size: var(--fs-sm);
  color: var(--text-2);
  text-decoration: none;
  a& {
    color: var(--text-2);
  }
  a&:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
  }
`;

const Dot = styled.span<{ $c: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  background: ${({ $c }) => $c};
`;

const Tabs = styled.nav`
  display: flex;
  gap: 4px;
  order: 3;
  width: 100%;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 6px 14px;
    border-radius: var(--r);
    color: var(--text-2);
    text-decoration: none;
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  a:hover {
    color: var(--text);
  }
  a[aria-current="page"] {
    background: var(--tint);
    color: var(--text);
    font-weight: 700;
  }
`;

const Right = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  @media (max-width: 640px) {
    .help-btn .button-text {
      display: none;
    }
    .help-btn {
      padding: 5px 10px;
    }
    .help-btn .button-svg {
      margin-right: 0;
    }
  }
  .help-btn {
    min-height: 44px;
  }
  .help-btn .button-svg {
    fill: none;
    stroke: currentColor;
    color: ${({ theme }) => theme.klerosUIComponentsPrimaryBlue};
  }
`;

const Mark = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path
      d="M16 2.5l11.7 6.75v13.5L16 29.5 4.3 22.75V9.25z"
      fill="none"
      stroke="var(--purple-2)"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path
      d="M10.5 16.5l3.8 3.6 7.4-8.2"
      fill="none"
      stroke="var(--text)"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const TopBar: React.FC<{ account?: React.ReactNode }> = ({ account }) => {
  const names = useChainNames();
  const route = useRouteMaybe();
  const loc = useLocation();
  const { name, toggle } = useThemeMode();
  const [help, setHelp] = useState(false);
  const bar = useRef<HTMLElement>(null);
  // Sticky things below the bar (and anything scrolled into view) keep clear of it: --bar-h is its height while it sticks.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const set = () => document.documentElement.style.setProperty("--bar-h", mq.matches ? "0px" : `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    mq.addEventListener("change", set);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", set);
    };
  }, []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const onRequest = loc.pathname === "/";
  const pillBody = (
    <>
      <Dot $c="#0052ff" />
      {route ? route.pill : "Local devnet"}
      <Dot $c="#28a0f0" />
    </>
  );
  return (
    <Bar ref={bar}>
      <In>
        <Brand to="/" end>
          <Mark />
          <span>
            Kleros <small>Gateway Lightbulb</small>
          </span>
        </Brand>
        {onRequest && route ? (
          <RoutePill as={Link} to={{ pathname: "/", hash: "#network-route" }} data-testid="route" aria-label={`${route.pill}. Go to the network route`}>
            {pillBody}
          </RoutePill>
        ) : (
          <RoutePill
            as={loc.pathname.startsWith("/track/") ? "a" : "span"}
            href={loc.pathname.startsWith("/track/") ? "#track-route" : undefined}
            data-testid="route"
            title="The route of the tracked request"
            aria-label={loc.pathname.startsWith("/track/") ? `${route?.pill ?? "Local devnet"}. Go to this request's route` : undefined}
          >
            {pillBody}
          </RoutePill>
        )}
        <Right>
          {account}
          <LibButton
            className="help-btn"
            small
            variant="secondary"
            text="How it works"
            aria-label="How it works"
            aria-haspopup="dialog"
            type="button"
            Icon={Icon.help}
            onClick={() => setHelp(true)}
          />
          <IconButton
            type="button"
            aria-label={`Switch to the ${name === "dark" ? "light" : "dark"} theme`}
            data-testid="theme-toggle"
            onClick={toggle}
          >
            {name === "dark" ? <Icon.sun /> : <Icon.moon />}
          </IconButton>
        </Right>
        <Tabs aria-label="Pages">
          <NavLink to="/" end>
            Request
          </NavLink>
          <NavLink to="/track">Track</NavLink>
        </Tabs>
      </In>
      <HelpDialog open={help} onClose={closeHelp} names={names} />
    </Bar>
  );
};
