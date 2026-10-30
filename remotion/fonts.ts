import {continueRender, delayRender, staticFile} from 'remotion';

// Bundled OFL fonts (public/fonts). Family names match the names used in Settings / props.
export const FONT_FILES: Record<string, string> = {
	Anton: 'Anton-Regular.ttf',
	'Bebas Neue': 'BebasNeue-Regular.ttf',
	'Montserrat Black': 'Montserrat-Black.ttf',
	'Archivo Black': 'ArchivoBlack-Regular.ttf',
	'Montserrat SemiBold': 'Montserrat-SemiBold.ttf',
	'Montserrat ExtraBold': 'Montserrat-ExtraBold.ttf',
};

// Visual size compensation: condensed display faces need a larger font-size to read the same.
export const FONT_SCALE: Record<string, number> = {
	Anton: 1.18,
	'Bebas Neue': 1.36,
	'Montserrat Black': 1,
	'Archivo Black': 0.98,
};

let loaded = false;

export const loadFonts = () => {
	if (loaded || typeof document === 'undefined') {
		return;
	}
	loaded = true;
	const handle = delayRender('Loading fonts');
	Promise.all(
		Object.entries(FONT_FILES).map(([family, file]) =>
			new FontFace(family, `url(${staticFile(`fonts/${file}`)})`).load().then((f) => {
				document.fonts.add(f);
			}),
		),
	)
		.then(() => continueRender(handle))
		.catch((err) => {
			console.error(err);
			continueRender(handle);
		});
};

export const fontStack = (family: string) => `'${family}', 'Montserrat Black', sans-serif`;
