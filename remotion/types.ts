export type Word = {w: string; s: number; e: number};

export type CaptionChunk = {s: number; e: number; words: Word[]};

export type TextStyleKey = 'classic' | 'yellow' | 'minimal' | 'outline';

export type TextStyle = {
	style: TextStyleKey;
	font: string;
	max_words?: number;
};

export type Segment = {f0: number; f1: number; src: number; teaser?: boolean};

// [mode, s, tx, ty, s2, tx2, ty2]; mode 0 = single crop, 1 = split (top/bottom), 2 = wide (s = zoom)
export type CamFrame = number[];

export type Popup = {
	start: number;
	end: number;
	text: string;
	animation: PopupAnimation;
	position: 'top' | 'upper' | 'center';
};

export type PopupAnimation =
	| 'pop'
	| 'slam'
	| 'typewriter'
	| 'bounce'
	| 'slide_up'
	| 'glitch'
	| 'wave'
	| 'blur_in'
	| 'highlight'
	| 'counter';

export type Text3DItem = {start: number; end: number; text: string; motion: 'orbit' | 'push' | 'flip'};

export type Label = {f0: number; f1: number; text: string; anchors: (number[] | null)[]};

export type TransitionType = 'whip' | 'zoom' | 'glitch' | 'flash' | 'blur' | 'shake';

export type Transition = {type: TransitionType; f0: number; f1: number; at: number; hook?: boolean};

export type Grade = 'clean' | 'warm' | 'cinematic' | 'punchy';

export type Bar = {platform: string; username: string; instagram?: string} | null;

export type ClipProps = {
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
	media: string;
	srcWidth: number;
	srcHeight: number;
	segments: Segment[];
	cam: CamFrame[];
	grade: Grade;
	captions: CaptionChunk[];
	captionStyle: TextStyle;
	hook: {f1: number; words: Word[]; text: string; style: TextStyle} | null;
	popups: Popup[];
	text3d: Text3DItem[];
	labels: Label[];
	transitions: Transition[];
	progressBar: boolean;
	bar: Bar;
	editStyle: string;
};
