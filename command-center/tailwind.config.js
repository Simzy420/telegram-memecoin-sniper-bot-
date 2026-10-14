/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#050816',
        hud: '#0a1028',
        panel: '#0d1636',
        cyan: {
          glow: '#22e9ff',
        },
        mag: '#e879f9',
      },
      fontFamily: {
        display: ['Orbitron', 'Sora', 'system-ui', 'sans-serif'],
        sans: ['Sora', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Book Antiqua', 'serif'],
        mono: ['Share Tech Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 233, 255, 0.25)',
        mag: '0 0 24px rgba(232, 121, 249, 0.28)',
      },
    },
  },
  plugins: [],
};
