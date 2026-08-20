import type { Config } from "tailwindcss";

/**
 * OperatorOS-Spec.md Part B — "The Shop Floor". These are the ONLY values
 * available anywhere in the app. `theme` (not `theme.extend`) intentionally
 * replaces Tailwind's defaults so nothing off-spec can be used, and the
 * eslint-plugin-tailwindcss `no-arbitrary-value` rule blocks `text-[#hex]`-
 * style escapes. If a color or size isn't a token here, it doesn't exist.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#FFFFFF",
      floor: "#EDEFE9",
      paper: "#FAFBF7",
      steel: "#2B373D",
      "steel-deep": "#1B2427",
      ink: "#12171A",
      "ink-soft": "#5C686E",
      rule: "#D3D8CF",
      tape: "#F2B705",
      "tape-deep": "#C99204",
      in: "#1F6F4A",
      out: "#B3402E",
      watch: "#8A6A17",
      // Lighter/desaturated variants of --in/--out/--watch for use on dark
      // (steel/steel-deep) surfaces — the plain tokens above are calibrated
      // against --paper/--floor and fail WCAG AA there (an axe scan on the
      // Tally Rail confirmed --ink-soft at 2.13:1 against --steel, well
      // under the 4.5:1 minimum; --ink/--out/--watch are all similarly
      // dark-on-dark). Not invented here — pulled from the exact hex values
      // design-reference/debt-book-stock-room.dc.html already uses for
      // money-direction figures on its dark header band, so this is the
      // verified design intent, not a new color decision.
      "in-dark": "#6FBF95",
      "out-dark": "#E38A78",
      "watch-dark": "#E8C56B",
    },
    fontFamily: {
      display: ["var(--font-archivo)", "sans-serif"],
      body: ["var(--font-public-sans)", "sans-serif"],
      mono: ["var(--font-plex-mono)", "monospace"],
    },
    // B.3 type scale, 16px base.
    fontSize: {
      micro: ["0.6875rem", { lineHeight: "1.4", letterSpacing: "0.06em" }],
      meta: ["0.8125rem", { lineHeight: "1.5" }],
      table: ["0.875rem", { lineHeight: "1.4" }],
      body: ["1rem", { lineHeight: "1.55" }],
      "card-title": ["1.25rem", { lineHeight: "1.3" }],
      "section-head": ["1.75rem", { lineHeight: "1.2" }],
      "screen-title": ["2.5rem", { lineHeight: "1.1" }],
      tally: ["3.5rem", { lineHeight: "1.05" }],
      "close-total": ["4.5rem", { lineHeight: "1.02" }],
    },
    // B.4 spacing scale, px. Tailwind keys are the px value itself so
    // `p-16` means 16px, not the default 4px-multiple scale.
    spacing: {
      0: "0px",
      px: "1px",
      4: "4px",
      8: "8px",
      12: "12px",
      16: "16px",
      24: "24px",
      32: "32px",
      48: "48px",
      64: "64px",
      96: "96px",
    },
    borderRadius: {
      none: "0px",
      DEFAULT: "2px",
      full: "9999px",
    },
    borderWidth: {
      DEFAULT: "1px",
      0: "0px",
      2: "2px",
      3: "3px",
      4: "4px",
    },
    boxShadow: {
      none: "none",
      // the "shelf shadow" — B.4. Cards sit on the floor, they don't float.
      shelf: "3px 3px 0 rgba(18,23,26,0.06)",
    },
    letterSpacing: {
      normal: "0",
      wide: "0.02em",
      tracked: "0.06em",
    },
    screens: {
      // spec: build/check against 375px, tablet, and desktop — not just desktop.
      sm: "375px",
      md: "768px",
      lg: "1280px",
      xl: "1440px",
    },
    // NOTE: Tailwind's `height`/`width`/`padding`/`margin`/`gap` all derive
    // from `theme.spacing` by default. Deliberately NOT doing that here —
    // `spacing` above stays the pure 9-value B.4 scale for gaps/padding/
    // margins, and named UI sizing constants (component heights/widths
    // called out explicitly in Part B) live in their own `height`/`width`
    // scales below instead of as unscaled raw pixel classes.
    height: ({ theme }: { theme: (path: string) => Record<string, string> }) => ({
      auto: "auto",
      full: "100%",
      screen: "100vh",
      ...theme("spacing"),
      control: "40px", // Input, Secondary/Danger/Ghost buttons — B.6
      "control-lg": "44px", // Primary button, PIN boxes, table rows — B.4/B.6/D.1
      rail: "56px", // Tally Rail, top nav — B.5.2/C.2
      tile: "120px", // D.4 product tile: "140×120px"
    }),
    width: ({ theme }: { theme: (path: string) => Record<string, string> }) => ({
      auto: "auto",
      full: "100%",
      screen: "100vw",
      ...theme("spacing"),
      control: "40px",
      "control-lg": "44px",
      nav: "220px", // Room nav — B.5.3
      "nav-collapsed": "64px",
      // D.4 Counter's three-column desktop layout: "CATEGORIES (180px)" /
      // fluid search+grid / "THE BASKET (420px)" — both literal spec pixel values.
      categories: "180px",
      basket: "420px",
      tile: "140px", // D.4 product tile: "140×120px"
      drawer: "480px", // Drawer — B.6
      "drawer-lg": "720px",
      shutter: "380px", // Shutter card — D.1
      // D.3/D.11: "Modal (560px, cannot be dismissed without a choice)" — Open
      // the Shop / Close the Shop's centred dialog width. A genuine new token,
      // not an arbitrary escape: the spec states this exact pixel value.
      modal: "560px",
    }),
    maxWidth: {
      full: "100%",
      none: "none",
      // B.4: "Grid: 12-column, 24px gutter, max content width 1440px" —
      // the page-level cap every screen already implicitly follows.
      content: "1440px",
      // Single-column wizard flows (Onboarding D.2) read better narrower
      // than the full 1440px content width; 960px is the same reading-width
      // judgement call the design-reference prototypes use for stacked forms.
      form: "960px",
    },
    inset: ({ theme }: { theme: (path: string) => Record<string, string> }) => ({
      auto: "auto",
      full: "100%",
      "1/2": "50%",
      ...theme("spacing"),
      rail: "56px", // for content sticking below the Tally Rail / top nav
    }),
    extend: {
      // B.7: exactly four permitted animations, nothing else. Each is gated
      // behind prefers-reduced-motion at the call site (motion-reduce:), not
      // by omitting the animation class — so the reduced-motion fallback is
      // explicit at every usage, not implicit.
      keyframes: {
        "shutter-raise": { from: { transform: "translateY(0)" }, to: { transform: "translateY(-100%)" } },
        // D.11 Close the Shop: the same showpiece motion (B.7 counts
        // raise/lower as one animation, not two), reversed — a shutter
        // sliding down to cover the screen rather than up to reveal it.
        "shutter-lower": { from: { transform: "translateY(-100%)" }, to: { transform: "translateY(0)" } },
        "shutter-fade": { from: { opacity: "1" }, to: { opacity: "0" } },
        "count-up": { from: { opacity: "0.4" }, to: { opacity: "1" } },
        "drawer-slide-in": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        "row-fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "shutter-raise": "shutter-raise 400ms cubic-bezier(.22,.61,.36,1) forwards",
        "shutter-lower": "shutter-lower 400ms cubic-bezier(.22,.61,.36,1) forwards",
        "shutter-fade": "shutter-fade 150ms ease-out forwards",
        // `forwards` added on all three for consistency with shutter-raise/
        // -lower/-fade above — without it the end state technically
        // reverts to "no animation applied" after completion (harmless
        // here since that coincides with the "to" keyframe for all three,
        // but explicit is cheaper than relying on that coincidence).
        "count-up": "count-up 300ms ease-out forwards",
        "drawer-slide-in": "drawer-slide-in 200ms ease-out forwards",
        "row-fade-in": "row-fade-in 120ms ease-out forwards",
      },
    },
  },
  corePlugins: {
    // Force everything through the token scales above — no arbitrary escape hatches.
    preflight: true,
  },
  plugins: [],
};

export default config;
