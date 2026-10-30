import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ACCENT} from '../styles';
import type {Label} from '../types';

/** A name tag + arrow that follows a tracked face (anchors = face box per frame, output pixels). */
export const TrackingLabels: React.FC<{labels: Label[]}> = ({labels}) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	const lb = labels.find((l) => frame >= l.f0 && frame < l.f1);
	if (!lb) {
		return null;
	}
	const i = frame - lb.f0;
	// hold the last known anchor across short gaps so the tag doesn't blink
	let a: number[] | null = null;
	for (let j = i; j >= Math.max(0, i - 8); j--) {
		if (lb.anchors[j]) {
			a = lb.anchors[j];
			break;
		}
	}
	if (!a) {
		return null;
	}
	const [x, y, w] = a;
	const enter = spring({frame: i, fps, config: {damping: 14, stiffness: 220}});
	const exit = interpolate(frame, [lb.f1 - 6, lb.f1], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	const cx = x + w / 2;
	const tagY = Math.max(40, y - 190);
	// Archivo Black caps run ~0.78em per glyph: shrink long tags to fit, then keep the whole tag inside the frame
	const margin = 40;
	const fontSize = Math.min(40, (width - 2 * margin - 48) / Math.max(1, lb.text.length * 0.78));
	const half = Math.min(width / 2 - margin, (lb.text.length * 0.78 * fontSize + 48) / 2);
	const tagX = Math.min(width - margin - half, Math.max(margin + half, cx));
	return (
		<AbsoluteFill style={{opacity: enter * exit}}>
			<svg width={width} height={y} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
				<path
					d={`M ${tagX} ${tagY + 64} Q ${tagX + 30} ${(tagY + 64 + y) / 2} ${cx} ${y - 18}`}
					stroke="#fff"
					strokeWidth={7}
					fill="none"
					strokeLinecap="round"
					strokeDasharray={600}
					strokeDashoffset={600 * (1 - enter)}
				/>
				<path d={`M ${cx - 16} ${y - 40} L ${cx} ${y - 14} L ${cx + 16} ${y - 40}`} stroke="#fff" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={enter} />
			</svg>
			<div
				style={{
					position: 'absolute',
					left: tagX,
					top: tagY,
					transform: `translateX(-50%) scale(${enter})`,
					background: ACCENT,
					color: '#fff',
					fontFamily: "'Archivo Black', sans-serif",
					fontSize,
					padding: '10px 24px',
					borderRadius: 14,
					whiteSpace: 'nowrap',
					boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
					textTransform: 'uppercase',
				}}
			>
				{lb.text}
			</div>
		</AbsoluteFill>
	);
};
