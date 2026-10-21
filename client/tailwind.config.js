/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette: #22819A  #90C2E7  #CDD4DD  #FEF7F8
        teal: { DEFAULT: '#22819A', dark: '#1A6579', light: '#DDEEF5' },
        sky: { DEFAULT: '#90C2E7', light: '#E8F2FA' },
        mist: { 50: '#FEF7F8', 100: '#EEF1F5', DEFAULT: '#CDD4DD', 300: '#AEB9C6' },
        // Darker shades derived from the palette, for text (the palette has no dark colour)
        ink: { DEFAULT: '#14303A', soft: '#2B4954' },
        steel: { DEFAULT: '#5A6B79', dark: '#3E4F5C' },
        // Status colours (scanner needs clear green / amber / red)
        ok: { DEFAULT: '#2F7D4F', light: '#DCEFE3' },
        warn: { DEFAULT: '#E0A21F', light: '#F8EBC9' },
        bad: { DEFAULT: '#B03A2E', light: '#F5DCD8' },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
