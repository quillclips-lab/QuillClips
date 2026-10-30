import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import type {Bar} from '../types';

const Icon: React.FC<{platform: string; size: number}> = ({platform, size}) => {
	switch (platform) {
		case 'kick':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect width="10" height="10" rx="2.4" fill="#53FC18" />
					<path d="M2.6 2.2h1.6v2.2L6.4 2.2h1.4v1.2L5.6 5l2.2 1.6v1.2H6.4L4.2 5.6v2.2H2.6z" fill="#000" />
				</svg>
			);
		case 'twitch':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect width="10" height="10" rx="2.4" fill="#9146FF" />
					<path d="M2.4 2h5.4v3.8L6.2 7.4H4.8l-1 1v-1H2.4z" fill="#fff" />
					<path d="M4.3 3.4h.7v1.8h-.7zM5.9 3.4h.7v1.8h-.7z" fill="#9146FF" />
				</svg>
			);
		case 'youtube':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect y="1.6" width="10" height="6.8" rx="2" fill="#FF0033" />
					<path d="M4 3.3v3.4l2.9-1.7z" fill="#fff" />
				</svg>
			);
		case 'tiktok':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect width="10" height="10" rx="2.4" fill="#0a0a0a" />
					{[
						['#25F4EE', -0.25, -0.2],
						['#FE2C55', 0.25, 0.2],
						['#fff', 0, 0],
					].map(([c, dx, dy]) => (
						<g key={String(c)} transform={`translate(${dx} ${dy})`} fill="none" stroke={String(c)} strokeWidth="0.7">
							<circle cx="3.8" cy="6.6" r="1.2" />
							<path d="M4.65 6.6V2.2c0 .9.8 1.8 2.3 1.8" />
						</g>
					))}
				</svg>
			);
		case 'instagram':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<defs>
						<linearGradient id="ig" x1="0" y1="1" x2="0" y2="0">
							<stop offset="0" stopColor="#FEDA75" />
							<stop offset="0.3" stopColor="#FA7E1E" />
							<stop offset="0.55" stopColor="#D62976" />
							<stop offset="0.8" stopColor="#962FBF" />
							<stop offset="1" stopColor="#4F5BD5" />
						</linearGradient>
					</defs>
					<rect width="10" height="10" rx="2.4" fill="url(#ig)" />
					<rect x="2" y="2" width="6" height="6" rx="1.7" fill="none" stroke="#fff" strokeWidth="0.75" />
					<circle cx="5" cy="5" r="1.45" fill="none" stroke="#fff" strokeWidth="0.75" />
					<circle cx="6.75" cy="3.25" r="0.38" fill="#fff" />
				</svg>
			);
		case 'x':
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect width="10" height="10" rx="2.4" fill="#000" stroke="#3c3c3c" strokeWidth="0.25" />
					<path d="M2.4 2.4h1.8l3.4 5.2H5.8z" fill="#fff" />
					<path d="M7.4 2.4 2.6 7.6" stroke="#fff" strokeWidth="0.6" />
				</svg>
			);
		default:
			return (
				<svg width={size} height={size} viewBox="0 0 10 10">
					<rect width="10" height="10" rx="2.4" fill="#985CFF" />
					<rect x="4" y="1.8" width="2" height="4" rx="1" fill="#fff" />
					<path d="M2.9 5.1a2.1 2.1 0 0 0 4.2 0" fill="none" stroke="#fff" strokeWidth="0.55" />
					<path d="M4.72 6.8h.56V8h-.56zM3.8 7.7h2.4v.5H3.8z" fill="#fff" />
				</svg>
			);
	}
};

const Pill: React.FC<{platform: string; text: string; size: number; font: number}> = ({platform, text, size, font}) => (
	<div
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 14,
			padding: `10px 24px 10px 14px`,
			borderRadius: 999,
			background: 'rgba(8,8,8,0.7)',
			border: '2px solid rgba(255,255,255,0.15)',
			boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
		}}
	>
		<Icon platform={platform} size={size} />
		<span style={{fontFamily: "'Montserrat ExtraBold', sans-serif", fontSize: font, color: 'rgba(255,255,255,0.95)'}}>{text}</span>
	</div>
);

/** Creator / campaign person tag near the bottom: platform icon + username, optional Instagram line. */
export const BottomBar: React.FC<{bar: Bar; startFrame: number}> = ({bar, startFrame}) => {
	const frame = useCurrentFrame();
	if (!bar || (!bar.username && !bar.instagram)) {
		return null;
	}
	const k = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const name = bar.username.replace(/^@/, '');
	return (
		<AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', top: '81.5%', opacity: k}}>
			<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, transform: `translateY(${(1 - k) * 20}px)`}}>
				{name ? <Pill platform={bar.platform} text={name} size={48} font={38} /> : null}
				{bar.instagram ? <Pill platform="instagram" text={`@${bar.instagram.replace(/^@/, '')}`} size={38} font={30} /> : null}
			</div>
		</AbsoluteFill>
	);
};
