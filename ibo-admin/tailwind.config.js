/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        gold: { DEFAULT: '#0EA4AB', light: '#C5E35B', dark: '#1B5FFF' },
        surface: {
          DEFAULT: '#0a1024',
          dark: '#050a1a',
          card: '#0d1530',
          border: '#1a2748',
          hover: '#121c38',
        },
      },
    },
  },
  plugins: [],
};
