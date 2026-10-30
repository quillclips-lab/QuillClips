import {ThreeCanvas} from '@remotion/three';
import React, {useEffect, useMemo, useState} from 'react';
import {continueRender, delayRender, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';
import {FontLoader, type Font} from 'three/examples/jsm/loaders/FontLoader.js';
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js';
import {ACCENT} from '../styles';
import type {Text3DItem} from '../types';

// three.js typeface JSON generated locally from the bundled TTFs (worker/app/fonts3d.py)
const TYPEFACE: Record<string, string> = {
	Anton: 'Anton-Regular.json',
	'Bebas Neue': 'BebasNeue-Regular.json',
	'Montserrat Black': 'Montserrat-Black.json',
	'Archivo Black': 'ArchivoBlack-Regular.json',
};

const useTypeface = (family: string): Font | null => {
	const [font, setFont] = useState<Font | null>(null);
	const [handle] = useState(() => delayRender(`3D font ${family}`));
	useEffect(() => {
		let alive = true;
		fetch(staticFile(`fonts3d/${TYPEFACE[family] ?? TYPEFACE.Anton}`))
			.then((r) => r.json())
			.then((json) => {
				if (alive) {
					setFont(new FontLoader().parse(json));
				}
				continueRender(handle);
			})
			.catch((err) => {
				console.error(err);
				continueRender(handle);
			});
		return () => {
			alive = false;
		};
	}, [family, handle]);
	return font;
};

const Scene: React.FC<{item: Text3DItem; font: Font; dur: number}> = ({item, font, dur}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const geometry = useMemo(() => {
		const g = new TextGeometry(item.text.toUpperCase(), {
			font,
			size: 1,
			depth: 0.38,
			curveSegments: 6,
			bevelEnabled: true,
			bevelThickness: 0.05,
			bevelSize: 0.03,
			bevelSegments: 3,
		});
		g.computeBoundingBox();
		g.center();
		return g;
	}, [font, item.text]);
	const materials = useMemo(
		() => [
			new THREE.MeshStandardMaterial({color: '#ffffff', metalness: 0.25, roughness: 0.3}),
			new THREE.MeshStandardMaterial({color: ACCENT, metalness: 0.4, roughness: 0.45}),
		],
		[],
	);
	const box = geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -0.5, 0), new THREE.Vector3(1, 0.5, 0));
	const textW = box.max.x - box.min.x;
	const fit = Math.min(1.25, 2.15 / Math.max(0.1, textW));
	const enter = spring({frame, fps, config: {damping: 13, stiffness: 150, mass: 0.8}});
	const exit = interpolate(frame, [dur - 7, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
	const p = frame / Math.max(1, dur);
	let rotX = 0;
	let rotY = 0;
	let camZ = 6;
	if (item.motion === 'orbit') {
		rotY = interpolate(p, [0, 1], [-0.85, 0.45]);
		rotX = -0.12;
	} else if (item.motion === 'flip') {
		rotX = interpolate(enter, [0, 1], [-Math.PI / 2, 0]) + Math.sin(frame / 9) * 0.05;
		rotY = Math.sin(frame / 14) * 0.12;
	} else {
		camZ = interpolate(p, [0, 1], [9, 5.4], {easing: Easing.out(Easing.quad)});
		rotY = interpolate(p, [0, 1], [-0.32, 0.1]);
		rotX = -0.08;
	}
	const s = fit * enter * exit;
	return (
		<>
			<ambientLight intensity={0.7} />
			<directionalLight position={[2.5, 3, 5]} intensity={2.1} />
			<pointLight position={[-3, -1, 3]} intensity={18} color={'#ffd2b0'} />
			<group position={[0, 0.95, 6 - camZ]} rotation={[rotX, rotY, 0]} scale={[s, s, s]}>
				<mesh geometry={geometry} material={materials} />
			</group>
		</>
	);
};

const Text3DClip: React.FC<{item: Text3DItem; family: string; dur: number}> = ({item, family, dur}) => {
	const {width, height} = useVideoConfig();
	const font = useTypeface(family);
	return (
		<ThreeCanvas width={width} height={height} camera={{fov: 40, position: [0, 0, 6]}} gl={{alpha: true, antialias: true}} style={{position: 'absolute', inset: 0}}>
			{font ? <Scene item={item} font={font} dur={dur} /> : null}
		</ThreeCanvas>
	);
};

/** Extruded 3D text with camera/text motion (orbit, push, flip), rendered with @remotion/three. */
export const Text3DLayer: React.FC<{items: Text3DItem[]; family: string}> = ({items, family}) => {
	const {fps} = useVideoConfig();
	return (
		<>
			{items.map((it) => {
				const f0 = Math.round(it.start * fps);
				const dur = Math.max(1, Math.round(it.end * fps) - f0);
				return (
					<Sequence key={`${it.start}-${it.text}`} from={f0} durationInFrames={dur} layout="none">
						<Text3DClip item={it} family={family} dur={dur} />
					</Sequence>
				);
			})}
		</>
	);
};
