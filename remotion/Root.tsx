import React from 'react';
import {Composition} from 'remotion';
import {Main} from './Main';
import type {ClipProps} from './types';

const defaults: ClipProps = {
	fps: 30,
	width: 1080,
	height: 1920,
	durationInFrames: 90,
	media: '',
	srcWidth: 1920,
	srcHeight: 1080,
	segments: [],
	cam: [],
	grade: 'clean',
	captions: [],
	captionStyle: {style: 'yellow', font: 'Montserrat Black', max_words: 3},
	hook: null,
	popups: [],
	text3d: [],
	labels: [],
	transitions: [],
	progressBar: true,
	bar: null,
	editStyle: 'balanced',
};

export const RemotionRoot: React.FC = () => (
	<Composition
		id="QuillClip"
		component={Main}
		durationInFrames={defaults.durationInFrames}
		fps={30}
		width={1080}
		height={1920}
		defaultProps={defaults}
		calculateMetadata={({props}) => ({
			durationInFrames: Math.max(1, props.durationInFrames),
			fps: props.fps,
			width: props.width,
			height: props.height,
		})}
	/>
);
