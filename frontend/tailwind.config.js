/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
  	extend: {
  		maxWidth: {
  			'7xl': '90rem',   // 1440px (Tailwind default is 80rem/1280px)
  			'8xl': '96rem',   // 1536px — available for future wider layouts
  		},
  		screens: {
  			'3xl': '1920px',
  		},
  		fontSize: {
  			// Slightly larger base scale so text feels less compact
  			'base': ['1.0625rem', { lineHeight: '1.75' }],
  			'lg':   ['1.1875rem', { lineHeight: '1.75' }],
  			'xl':   ['1.3125rem', { lineHeight: '1.75' }],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
		colors: {
			/* IBO surface tokens (dark theme) */
			surface: {
				DEFAULT: 'rgb(var(--bg-default-rgb) / <alpha-value>)',
				card: 'rgb(var(--bg-paper-rgb) / <alpha-value>)',
				elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
				soft: 'rgb(var(--bg-soft-rgb) / <alpha-value>)',
			},
			ink: {
				DEFAULT: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
				soft: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
				muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
				accent: 'rgb(var(--text-accent-rgb) / <alpha-value>)',
			},
			line: 'rgb(var(--border-default-rgb) / <alpha-value>)',
			background: 'hsl(var(--background))',
			foreground: 'hsl(var(--foreground))',
			card: {
				DEFAULT: 'hsl(var(--card))',
				foreground: 'hsl(var(--card-foreground))'
			},
			popover: {
				DEFAULT: 'hsl(var(--popover))',
				foreground: 'hsl(var(--popover-foreground))'
			},
			primary: {
				DEFAULT: 'hsl(var(--primary))',
				foreground: 'hsl(var(--primary-foreground))'
			},
			secondary: {
				DEFAULT: 'hsl(var(--secondary))',
				foreground: 'hsl(var(--secondary-foreground))'
			},
			muted: {
				DEFAULT: 'hsl(var(--muted))',
				foreground: 'hsl(var(--muted-foreground))'
			},
			accent: {
				DEFAULT: 'hsl(var(--accent))',
				foreground: 'hsl(var(--accent-foreground))'
			},
			destructive: {
				DEFAULT: 'hsl(var(--destructive))',
				foreground: 'hsl(var(--destructive-foreground))'
			},
			border: 'hsl(var(--border))',
			input: 'hsl(var(--input))',
			ring: 'hsl(var(--ring))',
			chart: {
				'1': 'hsl(var(--chart-1))',
				'2': 'hsl(var(--chart-2))',
				'3': 'hsl(var(--chart-3))',
				'4': 'hsl(var(--chart-4))',
				'5': 'hsl(var(--chart-5))'
			}
		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};