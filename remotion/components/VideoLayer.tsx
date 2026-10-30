import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CamFrame, ClipProps, Segment} from '../types';

type Props = Pick<ClipProps, 'segments' | 'cam' | 'media' | 'srcWidth' | 'srcHeight'>;

const Source: React.FC<{
	media: string;
	trimBefore: number;
	style: React.CSSProperties;
}> = ({media, trimBefore, style}) => (
	<OffthreadVideo src={media} trimBefore={trimBefore} muted style={{position: 'absolute', maxWidth: 'none', ...style}} />
);

/** One kept stretch of the source. The camera (crop/zoom/split/wide) is precomputed per output frame. */
const Shot: React.FC<Props & {seg: Segment}> = ({seg, cam, media, srcWidth, srcHeight}) => {
	const local = useCurrentFrame();
	const {fps, width, height} = useVideoConfig();
	const c: CamFrame = cam[Math.min(cam.length - 1, seg.f0 + local)] ?? [0, 1, 0, 0, 0, 0, 0];
	const trimBefore = Math.round(seg.src * fps);
	const mode = c[0];
	const dim = seg.teaser ? 'brightness(0.55) saturate(0.85)' : undefined;

	if (mode === 1) {
		const half = height / 2;
		const panel = (s: number, tx: number, ty: number, top: number) => (
			<div style={{position: 'absolute', left: 0, top, width, height: half, overflow: 'hidden'}}>
				<Source media={media} trimBefore={trimBefore} style={{left: tx, top: ty, width: srcWidth * s, height: srcHeight * s}} />
			</div>
		);
		return (
			<AbsoluteFill style={{filter: dim}}>
				{panel(c[1], c[2], c[3], 0)}
				{panel(c[4], c[5], c[6], half)}
				<div style={{position: 'absolute', left: 0, right: 0, top: half - 3, height: 6, background: '#050505'}} />
			</AbsoluteFill>
		);
	}
	if (mode === 2) {
		const z = c[1] || 1;
		const fgW = width * z;
		const fgH = (srcHeight / srcWidth) * fgW;
		const coverS = Math.max(width / srcWidth, height / srcHeight) * 1.1;
		return (
			<AbsoluteFill style={{filter: dim, overflow: 'hidden', background: '#000'}}>
				<Source
					media={media}
					trimBefore={trimBefore}
					style={{
						left: (width - srcWidth * coverS) / 2,
						top: (height - srcHeight * coverS) / 2,
						width: srcWidth * coverS,
						height: srcHeight * coverS,
						filter: 'blur(38px) brightness(0.5) saturate(1.2)',
					}}
				/>
				<Source media={media} trimBefore={trimBefore} style={{left: (width - fgW) / 2, top: (height - fgH) / 2, width: fgW, height: fgH}} />
			</AbsoluteFill>
		);
	}
	const [, s, tx, ty] = c;
	return (
		<AbsoluteFill style={{filter: dim, overflow: 'hidden', background: '#000'}}>
			<Source media={media} trimBefore={trimBefore} style={{left: tx, top: ty, width: srcWidth * s, height: srcHeight * s}} />
		</AbsoluteFill>
	);
};

export const VideoLayer: React.FC<Props> = (props) => (
	<AbsoluteFill style={{background: '#000'}}>
		{props.segments.map((seg) => (
			<Sequence key={`${seg.f0}-${seg.src}`} from={seg.f0} durationInFrames={seg.f1 - seg.f0} layout="none">
				<Shot {...props} seg={seg} />
			</Sequence>
		))}
	</AbsoluteFill>
);
