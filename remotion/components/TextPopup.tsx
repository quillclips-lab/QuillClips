import React from 'react';
import {AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {fontStack, FONT_SCALE} from '../fonts';
import {HIGHLIGHT} from '../styles';
import type {Popup, PopupAnimation} from '../types';

/**
 * Animated text pop-ups. Ten named animations (EDL `popups[].animation`):
 * pop, slam, typewriter, bounce, slide_up, glitch, wave, blur_in, highlight, counter.
 */
export const POPUP_ANIMATIONS: PopupAnimation[] = [
	'pop',
	'slam',
	'typewriter',
	'bounce',
	'slide_up',
	'glitch',
	'wave',
	'blur_in',
	'highlight',
	'counter',
];

const POS_Y: Record<Popup['position'], number> = {top: 0.15, upper: 0.29, center: 0.44};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const formatCount = (text: string, p: number) => {
	const m = text.match(/(\d[\d,.]*)/);
	if (!m) {
		return text;
	}
	const raw = m[1];
	const target = parseFloat(raw.replace(/,/g, ''));
	const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
	const v = target * p;
	let s = decimals ? v.toFixed(decimals) : Math.round(v).toString();
	if (raw.includes(',')) {
		const [i, d] = s.split('.');
		s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : '');
	}
	return text.replace(raw, s);
};

const PopupBody: React.FC<{p: Popup; font: string; local: number; dur: number}> = ({p, font, local, dur}) => {
	const {fps, width} = useVideoConfig();
	const len = p.text.length;
	const base = Math.round(Math.min(150, (width * 0.86) / Math.max(4, len * 0.62)) * (FONT_SCALE[font] ?? 1));
	const text: React.CSSProperties = {
		fontFamily: fontStack(font),
		fontSize: base,
		lineHeight: 1,
		color: '#fff',
		textTransform: 'uppercase',
		WebkitTextStroke: `${Math.max(8, Math.round(base * 0.11))}px #000`,
		paintOrder: 'stroke fill',
		textShadow: '0 10px 30px rgba(0,0,0,0.55)',
		whiteSpace: 'nowrap',
	};
	const sp = (cfg = {damping: 12, stiffness: 220, mass: 0.7}) => spring({frame: local, fps, config: cfg});

	switch (p.animation) {
		case 'slam': {
			const k = interpolate(local, [0, 5], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
			const shake = local >= 5 && local < 11 ? (random(`slam${local}`) - 0.5) * 26 * (1 - (local - 5) / 6) : 0;
			return <div style={{...text, transform: `translate(${shake}px, ${shake * 0.6}px) scale(${interpolate(k, [0, 1], [2.8, 1])})`, opacity: k}}>{p.text}</div>;
		}
		case 'typewriter': {
			const n = Math.floor(interpolate(local, [0, Math.min(dur * 0.55, len * 2.2)], [0, len], clamp));
			const cursor = Math.floor(local / 8) % 2 === 0 && n < len;
			return (
				<div style={text}>
					{p.text.slice(0, n)}
					<span style={{opacity: cursor ? 1 : 0, color: HIGHLIGHT}}>|</span>
					<span style={{opacity: 0}}>{p.text.slice(n)}</span>
				</div>
			);
		}
		case 'bounce': {
			const s = sp({damping: 7, stiffness: 160, mass: 0.9});
			return <div style={{...text, transform: `translateY(${interpolate(s, [0, 1], [-520, 0])}px)`}}>{p.text}</div>;
		}
		case 'slide_up': {
			const s = sp({damping: 20, stiffness: 200, mass: 0.8});
			return (
				<div style={{overflow: 'hidden', padding: '0 20px 20px'}}>
					<div style={{...text, transform: `translateY(${interpolate(s, [0, 1], [base * 1.4, 0])}px)`, opacity: s}}>{p.text}</div>
				</div>
			);
		}
		case 'glitch': {
			const strong = local < 9 || (local % 23 < 2 && local < dur - 6);
			const dx = strong ? (random(`gl${local}`) - 0.5) * 22 : 0;
			return (
				<div
					style={{
						...text,
						transform: `translateX(${dx}px) skewX(${strong ? (random(`sk${local}`) - 0.5) * 18 : 0}deg)`,
						textShadow: strong ? `${-8 + dx}px 0 #ff2a6d, ${8 - dx}px 0 #05d9e8, 0 10px 30px rgba(0,0,0,0.5)` : text.textShadow,
						opacity: interpolate(local, [0, 2], [0, 1], clamp),
					}}
				>
					{p.text}
				</div>
			);
		}
		case 'wave':
			return (
				<div style={{...text, display: 'flex'}}>
					{p.text.split('').map((ch, i) => {
						const s = spring({frame: local - i * 1.6, fps, config: {damping: 10, stiffness: 200}});
						const wob = Math.sin((local - i * 3) / 5) * 8 * Math.min(1, local / 12);
						return (
							<span key={i} style={{display: 'inline-block', whiteSpace: 'pre', transform: `translateY(${interpolate(s, [0, 1], [90, 0]) + wob}px)`, opacity: s}}>
								{ch}
							</span>
						);
					})}
				</div>
			);
		case 'blur_in': {
			const k = interpolate(local, [0, 10], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
			return (
				<div style={{...text, filter: `blur(${(1 - k) * 28}px)`, transform: `scale(${interpolate(k, [0, 1], [1.35, 1])})`, letterSpacing: `${(1 - k) * 0.3}em`, opacity: k}}>
					{p.text}
				</div>
			);
		}
		case 'highlight': {
			const wipe = interpolate(local, [0, 7], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
			const tIn = interpolate(local, [4, 9], [0, 1], clamp);
			return (
				<div style={{position: 'relative', padding: '8px 28px'}}>
					<div style={{position: 'absolute', inset: 0, background: HIGHLIGHT, transformOrigin: 'left center', transform: `scaleX(${wipe}) skewX(-6deg)`, borderRadius: 8}} />
					<div style={{...text, position: 'relative', color: '#000', WebkitTextStroke: undefined, textShadow: 'none', opacity: tIn}}>{p.text}</div>
				</div>
			);
		}
		case 'counter': {
			const k = interpolate(local, [0, Math.min(dur * 0.6, 30)], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
			const s = sp();
			return <div style={{...text, color: k >= 1 ? HIGHLIGHT : '#fff', transform: `scale(${interpolate(s, [0, 1], [0.6, 1]) + (k >= 1 ? 0.04 : 0)})`}}>{formatCount(p.text, k)}</div>;
		}
		case 'pop':
		default: {
			const s = sp();
			return <div style={{...text, transform: `scale(${s}) rotate(${interpolate(s, [0, 1], [-6, 0])}deg)`}}>{p.text}</div>;
		}
	}
};

export const TextPopups: React.FC<{popups: Popup[]; font: string}> = ({popups, font}) => {
	const frame = useCurrentFrame();
	const {fps, height} = useVideoConfig();
	const t = frame / fps;
	const p = popups.find((x) => t >= x.start && t < x.end);
	if (!p) {
		return null;
	}
	const f0 = Math.round(p.start * fps);
	const f1 = Math.round(p.end * fps);
	const local = frame - f0;
	const dur = f1 - f0;
	const out = interpolate(frame, [f1 - 5, f1], [1, 0], clamp);
	return (
		<AbsoluteFill style={{alignItems: 'center'}}>
			<div
				style={{
					position: 'absolute',
					top: height * POS_Y[p.position],
					left: 0,
					right: 0,
					display: 'flex',
					justifyContent: 'center',
					opacity: out,
					transform: `translateY(-50%) scale(${interpolate(out, [0, 1], [0.85, 1])})`,
				}}
			>
				<PopupBody p={p} font={font} local={local} dur={dur} />
			</div>
		</AbsoluteFill>
	);
};
