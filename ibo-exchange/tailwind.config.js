/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* Brand accents — Delta India orange primary + green positive */
        gold: {
          DEFAULT: '#FE6C02',
          light:   '#00A876',
          dark:    '#B44D01',
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
          '0%,100%': { boxShadow: '0 0 20px rgba(254, 108, 2,0.25)' },
          '50%':     { boxShadow: '0 0 50px rgba(0, 168, 118,0.35)' },
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

