/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        whatsapp: '#25D366',
        facebook: '#1877F2',
        viber: '#665CAC',
        linkedin: '#0A66C2',
      },
    },
  },
  plugins: [],
}
