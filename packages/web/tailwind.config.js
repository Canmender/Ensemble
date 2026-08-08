/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0eefe",
          200: "#baddfe",
          300: "#7cc4fd",
          400: "#36a6fa",
          500: "#0c8ceb",
          600: "#006ec9",
          700: "#0157a3",
          800: "#064a86",
          900: "#0b3e6f",
        },
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d4d9e2",
          300: "#aeb7c6",
          400: "#828fa4",
          500: "#647289",
          600: "#4f5b70",
          700: "#414b5c",
          800: "#383f4d",
          900: "#232731",
        },
      },
      fontFamily: {
        sans: [
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
    },
  },
  plugins: [],
};
