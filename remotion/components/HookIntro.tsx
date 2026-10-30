import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {TextStyle, Word} from '../types';
import {KaraokeLine} from './Captions';

/** Hook intro: the voice-over sentence, big, with each word lighting up as it is spoken. */
export const HookIntro: React.FC<{f1: number; words: Word[]; text: string; style: TextStyle}> = ({f1, words, text, style}) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	if (frame >= f1) {
		return null;
	}
	const t = frame / fps;
	const enter = spring({frame, fps, config: {damping: 16, stiffness: 180}});
	const exit = interpolate(frame, [f1 - 5, f1], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const list: Word[] = words.length ? words : text.split(/\s+/).map((w) => ({w, s: 0, e: 0}));
	const sizeMul = list.length > 14 ? 0.92 : list.length > 9 ? 1.04 : 1.16;
	return (
		<AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingBottom: 260, paddingLeft: width * 0.06, paddingRight: width * 0.06}}>
			<div style={{transform: `scale(${interpolate(enter, [0, 1], [0.8, 1])}) translateY(${(1 - enter) * 40}px)`, opacity: enter * exit}}>
				<KaraokeLine words={list} style={style} t={words.length ? t : 999} sizeMul={sizeMul} block />
			</div>
		</AbsoluteFill>
	);
};
