/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./login.html",
    "./src/**/*.{ts,tsx,html}",
  ],
  theme: {
    extend: {
      /* tokens.css のスペーシングと整合（0.25rem 刻み） */
      spacing: {
        0: "0",
        1: "var(--space-1, 0.25rem)",
        2: "var(--space-2, 0.5rem)",
        3: "var(--space-3, 0.75rem)",
        4: "var(--space-4, 1rem)",
        5: "var(--space-5, 1.25rem)",
        6: "var(--space-6, 1.5rem)",
        8: "var(--space-8, 2rem)",
      },
      fontSize: {
        xs: "var(--font-size-xs)",
        sm: "var(--font-size-sm)",
        md: "var(--font-size-md)",
        base: "var(--font-size-base)",
        lg: "var(--font-size-lg)",
        xl: "var(--font-size-xl)",
        "2xl": "var(--font-size-2xl)",
        "3xl": "var(--font-size-3xl)",
      },
      fontWeight: {
        normal: "var(--font-weight-normal)",
        medium: "var(--font-weight-medium)",
        semibold: "var(--font-weight-semibold)",
        bold: "var(--font-weight-bold)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      colors: {
        gray: {
          50: "var(--gray-50)",
          100: "var(--gray-100)",
          200: "var(--gray-200)",
          300: "var(--gray-300)",
          400: "var(--gray-400)",
          500: "var(--gray-500)",
          600: "var(--gray-600)",
          700: "var(--gray-700)",
          800: "var(--gray-800)",
        },
        brand: "var(--brand)",
        danger: "var(--danger)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
  corePlugins: {
    /* 既存 app.css と競合しにくくするため preflight は有効のまま（必要なら false に変更可能） */
  },
};
