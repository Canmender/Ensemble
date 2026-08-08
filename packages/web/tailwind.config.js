/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 语义化设计 token（浅色/深色两套，见 index.css 的 CSS 变量）
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--c-primary) / <alpha-value>)",
          fg: "rgb(var(--c-primary-fg) / <alpha-value>)",
        },
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        destructive: "rgb(var(--c-destructive) / <alpha-value>)",
        ring: "rgb(var(--c-ring) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
        warning: "rgb(var(--c-warning) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.04)",
        "card-hover": "0 4px 12px -2px rgb(0 0 0 / 0.12)",
        pop: "0 10px 30px -5px rgb(0 0 0 / 0.25)",
      },
    },
  },
  plugins: [],
};
