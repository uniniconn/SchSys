import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#111827', soft: '#4b5563' },
        line: { DEFAULT: '#c7ccd6', strong: '#98a1b0' },
        brand: { DEFAULT: '#1d4ed8', dark: '#1739a8' },
        soft: '#f4f6fa',
        danger: '#b91c1c',
        ok: '#15803d',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Microsoft YaHei"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
