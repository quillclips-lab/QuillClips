import React from 'react';
import {AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Transition} from '../types';

/**
 * Six transitions, each applied around a cut (f0..at..f1):
 * whip (directional motion blur + slide), zoom (scale burst), glitch (RGB split + slices),
 * flash (white flash), blur (defocus), shake (camera shake).
 * `useTransition` returns the transform/filter for the picture; `TransitionOverlay` draws the overlays.
 */
export const activeTransition = (transitions: Transition[], frame: number) =>
	transitions.find((t) => frame >= t.f0 && frame < t.f1) ?? null;

// -1 .. 0 (at the cut) .. 1
const phase = (t: Transition, frame: number) =>
	frame < t.at ? interpolate(frame, [t.f0, t.at], [-1, 0]) : interpolate(frame, [t.at, Math.max(t.at + 1, t.f1)], [0, 1]);

export const useTransitionStyle = (transitions: Transition[]): {style: React.CSSProperties; svgBlur: number} => {
	const frame = useCurrentFrame();
	const {width} = useVideoConfig();
	const t = activeTransition(transitions, frame);
	if (!t) {
		return {style: {}, svgBlur: 0};
	}
	const p = phase(t, frame);
	const k = 1 - Math.abs(p); // 1 at the cut
	switch (t.type) {
		case 'whip':
			return {style: {transform: `translateX(${-p * width * 0.35}px) scale(${1 + 0.08 * k})`, filter: 'url(#qc-whip)'}, svgBlur: 60 * k};
		case 'zoom':
			return {style: {transform: `scale(${1 + 0.55 * k * k})`, filter: `blur(${10 * k}px)`}, svgBlur: 0};
		case 'blur':
			return {style: {filter: `blur(${26 * k}px) brightness(${1 + 0.15 * k})`, transform: `scale(${1 + 0.04 * k})`}, svgBlur: 0};
		case 'shake': {
			const a = 34 * k;
			return {
				style: {
					transform: `translate(${(random(`sx${frame}`) - 0.5) * a}px, ${(random(`sy${frame}`) - 0.5) * a}px) rotate(${(random(`r${frame}`) - 0.5) * k * 2.4}deg) scale(${1 + 0.06 * k})`,
				},
				svgBlur: 0,
			};
		}
		case 'glitch':
			return {style: {filter: 'url(#qc-glitch)', transform: `translateX(${(random(`g${frame}`) - 0.5) * 40 * k}px)`}, svgBlur: 0};
		default:
			return {style: {}, svgBlur: 0};
	}
};

/** SVG filter defs used by whip (horizontal blur) and glitch (channel split). */
export const TransitionDefs: React.FC<{transitions: Transition[]}> = ({transitions}) => {
	const frame = useCurrentFrame();
	const t = activeTransition(transitions, frame);
	const k = t ? 1 - Math.abs(phase(t, frame)) : 0;
	const d = Math.round(18 * k + 4);
	return (
		<svg width={0} height={0} style={{position: 'absolute'}}>
			<defs>
				<filter id="qc-whip" x="-10%" y="0" width="120%" height="100%">
					<feGaussianBlur stdDeviation={`${t?.type === 'whip' ? 60 * k : 0} 0`} />
				</filter>
				<filter id="qc-glitch" x="-5%" y="0" width="110%" height="100%">
					<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
					<feOffset in="r" dx={d} dy={0} result="ro" />
					<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
					<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
					<feOffset in="b" dx={-d} dy={0} result="bo" />
					<feBlend in="ro" in2="g" mode="screen" result="rg" />
					<feBlend in="rg" in2="bo" mode="screen" />
				</filter>
			</defs>
		</svg>
	);
};

export const TransitionOverlay: React.FC<{transitions: Transition[]}> = ({transitions}) => {
	const frame = useCurrentFrame();
	const {height} = useVideoConfig();
	const t = activeTransition(transitions, frame);
	if (!t) {
		return null;
	}
	const k = 1 - Math.abs(phase(t, frame));
	if (t.type === 'flash') {
		return <AbsoluteFill style={{background: '#fff', opacity: Math.pow(k, 1.6) * 0.95}} />;
	}
	if (t.type === 'zoom') {
		return <AbsoluteFill style={{background: '#fff', opacity: Math.pow(k, 3) * 0.35}} />;
	}
	if (t.type === 'glitch') {
		const bars = Array.from({length: 7}, (_, i) => i);
		return (
			<AbsoluteFill style={{mixBlendMode: 'screen'}}>
				{bars.map((i) => {
					const y = random(`gy${frame}-${i}`) * height;
					const h = 8 + random(`gh${frame}-${i}`) * 70;
					const col = i % 3 === 0 ? 'rgba(255,0,80,0.55)' : i % 3 === 1 ? 'rgba(0,255,230,0.5)' : 'rgba(255,255,255,0.35)';
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: (random(`gx${frame}-${i}`) - 0.5) * 120,
								right: 0,
								top: y,
								height: h * k,
								background: col,
							}}
						/>
					);
				})}
			</AbsoluteFill>
		);
	}
	if (t.type === 'whip') {
		return <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 100%)', opacity: k}} />;
	}
	return null;
};
