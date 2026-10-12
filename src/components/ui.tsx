import React from "react";
import { Button, Card } from "@kleros/ui-components-library";
import { Link } from "react-router-dom";
import styled, { css } from "styled-components";

/** The library Button, typed to accept the DOM attributes it already forwards (aria-*, data-testid, type). */
export const LibButton = Button as React.FC<
  React.ComponentProps<typeof Button> &
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
      "data-testid"?: string;
    }
>;

export const Shell = styled.main`
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 16px 48px;
`;

export const PageHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 0 16px;
  p {
    color: var(--text-2);
    max-width: 70ch;
    margin-top: 4px;
  }
`;

export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
`;

/** A section on the library Card surface (its border, shadow and radius), sized by its content. */
export const Panel = styled(Card).attrs({ as: "section" })<{
  $span?: number;
  $tight?: boolean;
}>`
  width: auto;
  height: auto;
  padding: ${({ $tight }) => ($tight ? "8px 8px 4px" : "24px")};
  min-width: 0;
  grid-column: span ${({ $span }) => $span ?? 12};
  @media (max-width: 960px) {
    grid-column: span 12;
  }
  @media (max-width: 640px) {
    padding: ${({ $tight }) => ($tight ? "8px 4px 4px" : "16px")};
  }
`;

export const PanelHead = styled.div<{ $pad?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  ${({ $pad }) =>
    $pad &&
    css`
      padding: 12px 12px 4px;
      margin-bottom: 0;
    `}
  > div > p {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin-top: 4px;
    max-width: 60ch;
  }
`;

export const StepNum = styled.span`
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--purple);
  color: var(--on-accent);
  font-size: var(--fs-sm);
  margin-right: 10px;
  vertical-align: 2px;
`;

const calloutTone = {
  ok: css`
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: var(--ok-bg);
    > svg {
      color: var(--ok);
    }
  `,
  err: css`
    border-color: color-mix(in srgb, var(--err) 45%, transparent);
    background: var(--err-bg);
    > svg {
      color: var(--err);
    }
  `,
  warn: css`
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    background: var(--warn-bg);
    > svg {
      color: var(--warn);
    }
  `,
  info: css``,
};

export const CalloutBox = styled.div<{ $tone: keyof typeof calloutTone }>`
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  border: 1px solid var(--stroke);
  background: var(--surface-2);
  > svg {
    width: 18px;
    height: 18px;
    flex: none;
    margin-top: 2px;
  }
  h3 {
    margin-bottom: 4px;
  }
  p {
    color: var(--text-2);
    font-size: var(--fs-sm);
    overflow-wrap: anywhere;
  }
  ${({ $tone }) => calloutTone[$tone]}
`;

export const Callout: React.FC<{
  tone: keyof typeof calloutTone;
  title: string;
  children?: React.ReactNode;
  "data-testid"?: string;
}> = ({ tone, title, children, ...rest }) => (
  <CalloutBox
    $tone={tone}
    role={tone === "err" ? "alert" : undefined}
    {...rest}
  >
    {tone === "ok" ? (
      <Icon.check />
    ) : tone === "err" ? (
      <Icon.alert />
    ) : (
      <Icon.info />
    )}
    <div>
      <h3>{title}</h3>
      {children}
    </div>
  </CalloutBox>
);

export const ButtonLink = styled(Link)<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
  font-size: var(--fs-md);
  border-radius: 3px;
  padding: 9px 24px;
  text-decoration: none;
  min-height: 44px;
  color: ${({ $primary }) =>
    $primary ? "var(--on-primary, #1b1b2f)" : "var(--blue)"};
  background: ${({ $primary, theme }) =>
    $primary ? theme.klerosUIComponentsPrimaryBlue : "var(--surface)"};
  border: 1px solid ${({ theme }) => theme.klerosUIComponentsPrimaryBlue};
  &:hover {
    background: ${({ $primary, theme }) =>
      $primary
        ? theme.klerosUIComponentsSecondaryBlue
        : theme.klerosUIComponentsMediumBlue};
  }
`;

export const Pill = styled.span<{
  $tone?: "ok" | "warn" | "err" | "idle" | "live";
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  border: 1px solid transparent;
  ${({ $tone = "idle" }) =>
    $tone === "ok"
      ? css`
          color: var(--ok);
          background: var(--ok-bg);
        `
      : $tone === "warn"
        ? css`
            color: var(--warn);
            background: var(--warn-bg);
          `
        : $tone === "err"
          ? css`
              color: var(--err);
              background: var(--err-bg);
            `
          : $tone === "live"
            ? css`
                color: var(--blue);
                border-color: color-mix(in srgb, var(--blue) 40%, transparent);
              `
            : css`
                color: var(--text-2);
                border-color: var(--stroke);
              `}
`;

export const Swatch = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
  flex: none;
  background: ${({ $color }) => $color};
`;

export const FieldError = styled.p`
  color: var(--err);
  font-size: var(--fs-sm);
  margin-top: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  svg {
    width: 14px;
    height: 14px;
    flex: none;
  }
`;

const svgProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const Icon = {
  check: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  ),
  clock: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  ),
  alert: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.6v.1" />
    </svg>
  ),
  info: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4" />
      <path d="M8 4.9v.1" />
    </svg>
  ),
  sun: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </svg>
  ),
  moon: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z" />
    </svg>
  ),
  help: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.8.5-1.3.9-1.3 1.8" />
      <path d="M8 11.6v.1" />
    </svg>
  ),
  left: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M10 3L5 8l5 5" />
    </svg>
  ),
  right: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  ),
  close: (p: React.SVGAttributes<SVGElement>) => (
    <svg {...svgProps} {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
};

export const IconButton = styled.button`
  background: transparent;
  border: 1px solid var(--stroke);
  color: var(--text-2);
  border-radius: var(--r);
  width: 44px;
  height: 44px;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  &:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
  }
  svg {
    width: 18px;
    height: 18px;
  }
`;

/** A disclosure whose content is only in the DOM while open, so closed details never reach the page text. */
export const Disclosure: React.FC<{
  summary: string;
  children: React.ReactNode;
  "data-testid"?: string;
}> = ({ summary, children, "data-testid": testId }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <DisclosureBox data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {summary}
      </button>
      {open && <div className="body">{children}</div>}
    </DisclosureBox>
  );
};

const DisclosureBox = styled.div`
  > button {
    min-height: 44px;
    background: transparent;
    border: 0;
    padding: 0 4px;
    color: var(--blue);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .body {
    border-left: 2px solid var(--stroke-strong);
    padding: 4px 0 4px 14px;
    margin: 0 0 8px 6px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .body code,
  .body .mono {
    font-size: 0.8125rem;
  }
`;

/** True while the viewport is at most `px` wide. */
export function useNarrow(px = 640): boolean {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = React.useState(
    () => window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}
