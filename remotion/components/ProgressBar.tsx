import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {ACCENT} from '../styles';

export const ProgressBar: React.FC<{startFrame: number}> = ({startFrame}) => {
	const frame = useCurrentFrame();
	const {durationInFrames, width} = useVideoConfig();
	if (frame < startFrame) {
		return null;
	}
	const p = (frame - startFrame) / Math.max(1, durationInFrames - startFrame - 1);
	return (
		<div style={{position: 'absolute', left: 0, top: 0, width, height: 12, background: 'rgba(0,0,0,0.35)'}}>
			<div style={{width: `${Math.min(100, p * 100)}%`, height: '100%', background: ACCENT, boxShadow: `0 0 16px ${ACCENT}`}} />
		</div>
	);
};
