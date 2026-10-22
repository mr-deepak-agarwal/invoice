import type { Config } from "tailwindcss";

// Design tokens grounded in the Indian "bahi-khata" ledger book tradition:
// pale ledger-paper background, hand-ruled line color, ink for text, and
// the red cloth-binding red ("bahi-red") as the primary accent — a nod to
// the red ledgers small Indian shopkeepers have used for generations.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#F0F2EA",
        "paper-raised": "#F7F8F3",
        ink: "#1C2321",
        "ink-soft": "#4A524C",
        slate: "#5B6660",
        "ledger-line": "#C7D0BE",
        "bahi-red": "#B33A2A",
        "bahi-red-dark": "#8C2F1B",
        marigold: "#C99A3C",
        "marigold-soft": "#EDD9AC",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      borderRadius: {
        card: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
