import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import globalStyle from "../theme/GlobalStyle.ts?raw";
import loaderSource from "./Loader.tsx?raw";
import { LOADER_MOTION } from "./Loader";

// The boot loader in index.html is the Loader's mark in plain HTML and CSS, shown before the app's code runs: the two
// must move the same way, so a change to one that forgets the other fails here.

const norm = (css: string) => css.replace(/\s+/g, " ").trim();

/** The body of `@keyframes <name> { … }` in the given CSS, by brace matching. */
function keyframesBody(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) throw new Error(`no @keyframes ${name}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return norm(css.slice(open + 1, i));
  }
  throw new Error(`unclosed @keyframes ${name}`);
}

/** The declarations of the first rule whose whole selector is `selector` (not a selector list containing it). */
function rule(css: string, selector: string): string {
  const match = new RegExp(`(^|[\\n};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule ${selector}`);
  return norm(match[2]);
}

describe("the boot loader moves like <Loader>", () => {
  it("has the same keyframes", () => {
    expect(keyframesBody(indexHtml, "boot-travel")).toBe(norm(LOADER_MOTION.travel));
    expect(keyframesBody(indexHtml, "boot-glow")).toBe(norm(LOADER_MOTION.glow));
    expect(keyframesBody(indexHtml, "boot-in")).toBe(norm(LOADER_MOTION.enter));
  });
  it("has the same cycle, fade-in, delay and easing (the app's --ease-out)", () => {
    const easeOut = /--ease-out:\s*([^;]+);/.exec(globalStyle)?.[1].trim();
    expect(easeOut).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(rule(indexHtml, ".boot-mark")).toContain(
      `animation: boot-in ${LOADER_MOTION.enterDuration} ${easeOut} ${LOADER_MOTION.enterDelay} both;`,
    );
    expect(rule(indexHtml, ".boot-dot")).toContain(`animation: boot-travel ${LOADER_MOTION.cycle} linear infinite;`);
    expect(rule(indexHtml, ".boot-lit")).toContain(`animation: boot-glow ${LOADER_MOTION.cycle} ease-in-out infinite;`);
  });
  it("rests the dot at the same place under reduced motion", () => {
    const rest = "transform: translateX(0.625em);";
    expect(norm(loaderSource)).toContain(rest);
    expect(rule(indexHtml.slice(indexHtml.indexOf("prefers-reduced-motion")), ".boot-dot")).toContain(rest);
  });
});
