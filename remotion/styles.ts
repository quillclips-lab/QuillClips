import type {CSSProperties} from 'react';
import {FONT_SCALE, fontStack} from './fonts';
import type {TextStyle} from './types';

export type StylePreset = {
	size: number;
	color: string;
	active: string;
	stroke: number;
	shadow: string;
	upper: boolean;
	inactiveOpacity: number;
	activeScale: number;
	box: boolean;
};

// The four caption looks; any of the four fonts can be combined with any look.
export const PRESETS: Record<TextStyle['style'], StylePreset> = {
	classic: {
		size: 78,
		color: '#ffffff',
		active: '#ffffff',
		stroke: 10,
		shadow: '0 6px 18px rgba(0,0,0,0.55)',
		upper: false,
		inactiveOpacity: 0.72,
		activeScale: 1.12,
		box: false,
	},
	yellow: {
		size: 84,
		color: '#ffffff',
		active: '#FFD400',
		stroke: 12,
		shadow: '0 8px 22px rgba(0,0,0,0.6)',
		upper: true,
		inactiveOpacity: 1,
		activeScale: 1.1,
		box: false,
	},
	minimal: {
		size: 62,
		color: '#ffffff',
		active: '#ffffff',
		stroke: 0,
		shadow: 'none',
		upper: false,
		inactiveOpacity: 0.55,
		activeScale: 1,
		box: true,
	},
	outline: {
		size: 92,
		color: '#ffffff',
		active: '#3CFF6B',
		stroke: 16,
		shadow: 'none',
		upper: true,
		inactiveOpacity: 1,
		activeScale: 1.1,
		box: false,
	},
};

export const textBase = (style: TextStyle, sizeMul = 1): {css: CSSProperties; preset: StylePreset} => {
	const preset = PRESETS[style.style] ?? PRESETS.yellow;
	const size = Math.round(preset.size * (FONT_SCALE[style.font] ?? 1) * sizeMul);
	return {
		preset,
		css: {
			fontFamily: fontStack(style.font),
			fontSize: size,
			lineHeight: 1.08,
			color: preset.color,
			textTransform: preset.upper ? 'uppercase' : 'none',
			WebkitTextStroke: preset.stroke ? `${Math.round(preset.stroke * sizeMul)}px #000` : undefined,
			paintOrder: 'stroke fill',
			textShadow: preset.shadow === 'none' ? undefined : preset.shadow,
			letterSpacing: style.font === 'Bebas Neue' ? 1 : 0,
		},
	};
};

export const ACCENT = '#e5484d';
export const HIGHLIGHT = '#FFD400';
