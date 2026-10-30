import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {textBase} from '../styles';
import type {CaptionChunk, TextStyle, Word} from '../types';

const clean = (w: string, upper: boolean) => {
	const t = w.replace(/[,;:]$/, '');
	return upper ? t.toUpperCase() : t;
};

/** A line of words where the currently spoken word is highlighted (karaoke). */
export const KaraokeLine: React.FC<{
	words: Word[];
	style: TextStyle;
	t: number;
	sizeMul?: number;
	block?: boolean; // hook: already-spoken words stay lit, upcoming words are dimmed
}> = ({words, style, t, sizeMul = 1, block = false}) => {
	const {fps} = useVideoConfig();
	const {css, preset} = textBase(style, sizeMul);
	let activeIdx = -1;
	words.forEach((w, i) => {
		if (w.s <= t) {
			activeIdx = i;
		}
	});
	return (
		<div
			style={{
				...css,
				display: 'flex',
				flexWrap: 'wrap',
				justifyContent: 'center',
				columnGap: '0.38em',
				rowGap: '0.04em',
				textAlign: 'center',
				padding: preset.box ? '0.18em 0.45em' : 0,
				background: preset.box ? 'rgba(0,0,0,0.55)' : undefined,
				borderRadius: preset.box ? 18 : 0,
			}}
		>
			{words.map((w, i) => {
				const active = i === activeIdx;
				const since = Math.max(0, (t - w.s) * fps);
				const pop = active ? spring({frame: since, fps, config: {damping: 14, stiffness: 260, mass: 0.6}}) : 0;
				const scale = active ? interpolate(pop, [0, 1], [1, preset.activeScale]) : 1;
				let opacity = 1;
				if (block) {
					opacity = i > activeIdx ? 0.45 : 1;
				} else if (!active) {
					opacity = preset.inactiveOpacity;
				}
				return (
					<span
						key={i}
						style={{
							display: 'inline-block',
							transform: `scale(${scale})`,
							color: active ? preset.active : preset.color,
							opacity,
						}}
					>
						{clean(w.w, preset.upper)}
					</span>
				);
			})}
		</div>
	);
};

export const Captions: React.FC<{
	captions: CaptionChunk[];
	style: TextStyle;
	offsetFrames: number;
	splitAt: (frame: number) => boolean;
}> = ({captions, style, splitAt}) => {
	const frame = useCurrentFrame();
	const {fps, height, width} = useVideoConfig();
	const t = frame / fps;
	const chunk = captions.find((c) => t >= c.s && t < c.e);
	if (!chunk) {
		return null;
	}
	const appear = spring({frame: (t - chunk.s) * fps, fps, config: {damping: 18, stiffness: 300}});
	const split = splitAt(frame);
	return (
		<AbsoluteFill
			style={{
				justifyContent: split ? 'center' : 'flex-end',
				alignItems: 'center',
				paddingBottom: split ? 0 : Math.round(height * 0.3),
				paddingLeft: width * 0.07,
				paddingRight: width * 0.07,
			}}
		>
			<div style={{transform: `scale(${interpolate(appear, [0, 1], [0.86, 1])})`, opacity: appear}}>
				<KaraokeLine words={chunk.words} style={style} t={t} />
			</div>
		</AbsoluteFill>
	);
};
