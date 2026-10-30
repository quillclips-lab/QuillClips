import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {Grade} from '../types';

// Four grade presets: a CSS filter on the picture + optional tint/vignette layers on top.
export const GRADE_FILTER: Record<Grade, string> = {
	clean: 'contrast(1.04) saturate(1.06)',
	warm: 'sepia(0.12) saturate(1.16) contrast(1.05) brightness(1.02)',
	cinematic: 'contrast(1.13) saturate(0.86) brightness(0.96)',
	punchy: 'contrast(1.2) saturate(1.38) brightness(1.03)',
};

export const GradeOverlay: React.FC<{grade: Grade}> = ({grade}) => {
	if (grade === 'clean') {
		return null;
	}
	return (
		<AbsoluteFill style={{pointerEvents: 'none'}}>
			{grade === 'warm' ? <AbsoluteFill style={{background: 'rgba(255,150,60,0.08)', mixBlendMode: 'soft-light'}} /> : null}
			{grade === 'cinematic' ? (
				<>
					<AbsoluteFill
						style={{
							background: 'linear-gradient(180deg, rgba(0,90,110,0.22) 0%, rgba(255,140,60,0.12) 100%)',
							mixBlendMode: 'soft-light',
						}}
					/>
					<AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)'}} />
				</>
			) : null}
			{grade === 'punchy' ? (
				<AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 62%, rgba(0,0,0,0.35) 100%)'}} />
			) : null}
		</AbsoluteFill>
	);
};
