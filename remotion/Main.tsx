import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {BottomBar} from './components/BottomBar';
import {Captions} from './components/Captions';
import {GRADE_FILTER, GradeOverlay} from './components/ColorGrade';
import {HookIntro} from './components/HookIntro';
import {ProgressBar} from './components/ProgressBar';
import {TextPopups} from './components/TextPopup';
import {Text3DLayer} from './components/Text3D';
import {TrackingLabels} from './components/TrackingLabel';
import {TransitionDefs, TransitionOverlay, useTransitionStyle} from './components/Transitions';
import {VideoLayer} from './components/VideoLayer';
import {loadFonts} from './fonts';
import type {ClipProps} from './types';

loadFonts();

export const Main: React.FC<ClipProps> = (props) => {
	const frame = useCurrentFrame();
	const {style: trStyle} = useTransitionStyle(props.transitions);
	const hookEnd = props.hook?.f1 ?? 0;
	const isSplit = (f: number) => (props.cam[f]?.[0] ?? 0) === 1;
	const font = props.captionStyle.font;
	return (
		<AbsoluteFill style={{background: '#000', overflow: 'hidden'}}>
			<TransitionDefs transitions={props.transitions} />
			<AbsoluteFill style={trStyle}>
				<AbsoluteFill style={{filter: GRADE_FILTER[props.grade]}}>
					<VideoLayer segments={props.segments} cam={props.cam} media={props.media} srcWidth={props.srcWidth} srcHeight={props.srcHeight} />
				</AbsoluteFill>
				<GradeOverlay grade={props.grade} />
			</AbsoluteFill>
			<TransitionOverlay transitions={props.transitions} />
			<TrackingLabels labels={props.labels} />
			<Text3DLayer items={props.text3d} family={font} />
			<TextPopups popups={props.popups} font={font} />
			{frame >= hookEnd ? <Captions captions={props.captions} style={props.captionStyle} offsetFrames={hookEnd} splitAt={isSplit} /> : null}
			{props.hook ? <HookIntro {...props.hook} /> : null}
			<BottomBar bar={props.bar} startFrame={hookEnd} />
			{props.progressBar ? <ProgressBar startFrame={hookEnd} /> : null}
		</AbsoluteFill>
	);
};
