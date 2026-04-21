/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/react-app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary:  { DEFAULT: '#004aad', light: '#1a6dd4', dim: '#003a8a' },
        nurse:    { DEFAULT: '#10b981', light: '#34d399' },
        doctor:   { DEFAULT: '#7c3aed', light: '#8b5cf6' },
        surface:  '#ffffff',
        appbg:    '#f0f4fa',
        border:   '#e2e8f0',
        muted:    '#64748b',
      },
      fontFamily: {
        sans:    ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
        mono:    ['DM Mono', 'monospace'],
      },
      borderRadius: {
        card:   '14px',
        cardlg: '20px',
      },
      boxShadow: {
        card:   '0 4px 24px rgba(0,74,173,0.08)',
        cardlg: '0 8px 40px rgba(0,74,173,0.14)',
      },
    },
  },
  plugins: [],
};
