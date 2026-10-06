import type { Config } from 'tailwindcss';

// Tokens: a calm paper canvas, a deep "night shift" navy for navigation, and one bold device —
// the aging heat scale (teal → amber → brick) that colours every aging number in the product.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F3F4F1',
        panel: '#FFFFFF',
        line: '#DCDFD8',
        ink: { DEFAULT: '#1B2330', soft: '#4A5566', faint: '#7B8594' },
        night: { DEFAULT: '#14223A', 2: '#1C2E4C', 3: '#2A4066', text: '#C9D3E3' },
        signal: { DEFAULT: '#1F5FBF', soft: '#E6EEFA' },
        age: {
          0: '#2C8C83', 1: '#5FA37B', 2: '#B9A443', 3: '#D98A2B', 4: '#C8612A', 5: '#A9402B', 6: '#7E2A26',
        },
      },
      fontFamily: {
        sans: ['"Public Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};

export default config;
