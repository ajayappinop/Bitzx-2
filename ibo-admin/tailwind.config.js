/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'ui-monospace', 'monospace'],
      },
      colors: {
        gold: {
          DEFAULT: '#FE6C02',
          light: 'var(--ibo-accent-text)',
          dark: '#B44D01',
        },
        surface: {
          DEFAULT: 'rgb(var(--ibo-surface-rgb) / <alpha-value>)',
          dark: 'rgb(var(--ibo-bg-rgb) / <alpha-value>)',
          card: 'rgb(var(--ibo-card-rgb) / <alpha-value>)',
          border: 'var(--ibo-border-solid)',
          hover: 'var(--ibo-hover)',
        },
      },
    },
  },
  plugins: [],
};
