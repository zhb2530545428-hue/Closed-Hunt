import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0b0e14",
          800: "#11151f",
          700: "#1a2030",
          600: "#262d42",
          500: "#3a4360",
        },
        blood: "#c0392b",
        toxic: "#7fb800",
        gold: "#e0a526",
      },
    },
  },
  plugins: [],
};

export default config;
