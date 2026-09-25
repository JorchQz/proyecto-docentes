// Tokens de diseño compartidos para Tailwind (CDN).
// Cargar SIEMPRE justo después de https://cdn.tailwindcss.com y antes del render,
// para que el CDN lea esta config. Reemplaza los bloques tailwind.config inline.
window.tailwind = window.tailwind || {};
tailwind.config = {
	theme: {
		extend: {
			colors: {
				board: { DEFAULT: '#1e3a8a', deep: '#16276b', soft: '#26499f' },
				chalk: '#f6f8fe',
				ink: '#1c2434',
				mute: '#5b6473',
				line: '#e7e6df',
				action: { DEFAULT: '#059669', dark: '#047a55' },
				paper: '#faf9f4',
				gisAmarillo: '#f2cf6b',
				gisCoral: '#ef9277',
				gisMenta: '#79c8a6',
				gisLavanda: '#a99fe0',
				gisCielo: '#85b8e6',
				gisDurazno: '#f0b285',
			},
			fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
			maxWidth: { content: '1180px' },
		},
	},
};
