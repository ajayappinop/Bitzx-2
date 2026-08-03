/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        display: ['Syne', 'system-ui', 'sans-serif'],
        /* Numbers / prices / tickers — Inter only (replaces JetBrains Mono) */
        mono: ['Inter', 'Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        /* Brand accents mapped from IBO logo gradient (blue → cyan → lime) */
        gold: {
          DEFAULT: '#0EA4AB',
          light:   '#C5E35B',
          dark:    '#1B5FFF',
        },
        /* Theme-aware surfaces — flip via data-theme CSS variables */
        surface: {
          DEFAULT: 'var(--ibo-surface)',
          dark:    'var(--ibo-bg)',
          card:    'var(--ibo-card)',
          border:  'var(--ibo-border-solid)',
          hover:   'var(--ibo-hover)',
        },
        ink: {
          DEFAULT: 'var(--ibo-ink)',
          secondary: 'var(--ibo-ink-secondary)',
          muted: 'var(--ibo-muted)',
        },
      },
      maxWidth: {
        '8xl':  '90rem',   /* 1440px */
        '9xl':  '110rem',  /* 1760px */
        '10xl': '120rem',  /* 1920px */
      },
      animation: {
        'ticker':   'ticker 30s linear infinite',
        'fade-up':  'fadeUp 0.6s ease both',
        'glow':     'glow 3s ease-in-out infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'product-strip': 'productStrip 42s linear infinite',
      },
      keyframes: {
        ticker: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        productStrip: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        glow: {
          '0%,100%': { boxShadow: '0 0 20px rgba(14,164,171,0.25)' },
          '50%':     { boxShadow: '0 0 50px rgba(197,227,91,0.35)' },
        },
        pulseGold: {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
};
