// Renders one QuillClips edit with Remotion (video only; audio is mixed by the worker).
// Usage: node scripts/render-remotion.mjs --props props.json --out video.mp4 --media-dir <dir>
//        [--concurrency 3] [--gl angle] [--bitrate 8M] [--preset medium] [--cache data/cache/remotion]
// Prints one JSON object per line: {"stage": "...", "progress": 0..1} and finally {"done": true}.
import {createHash} from 'node:crypto';
import {createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, selectComposition} from '@remotion/renderer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');

const hashDir = (dir, h) => {
	for (const name of readdirSync(dir).sort()) {
		const p = path.join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			hashDir(p, h);
		} else {
			h.update(name);
			h.update(readFileSync(p));
		}
	}
	return h;
};

// Serve the media directory (proxy clip) with HTTP range support for OffthreadVideo.
const serve = (dir) =>
	new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
			const file = path.join(dir, name);
			if (!file.startsWith(path.resolve(dir)) || !existsSync(file)) {
				res.writeHead(404).end();
				return;
			}
			const size = statSync(file).size;
			const range = req.headers.range;
			const headers = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'};
			if (range) {
				const [s, e] = range.replace('bytes=', '').split('-');
				const start = parseInt(s, 10) || 0;
				const end = e ? parseInt(e, 10) : size - 1;
				res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
				createReadStream(file, {start, end}).pipe(res);
			} else {
				res.writeHead(200, {...headers, 'Content-Length': size});
				createReadStream(file).pipe(res);
			}
		});
		server.listen(0, '127.0.0.1', () => resolve(server));
	});

const main = async () => {
	const props = JSON.parse(readFileSync(args.props, 'utf8'));
	const cacheRoot = path.resolve(args.cache || path.join(ROOT, 'data', 'cache', 'remotion'));
	const pkg = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'remotion', 'package.json'), 'utf8'));
	const key = hashDir(path.join(ROOT, 'remotion'), createHash('sha1').update(pkg.version)).digest('hex').slice(0, 16);
	const bundleDir = path.join(cacheRoot, `bundle-${key}`);

	say({stage: 'browser', progress: 0});
	await ensureBrowser();

	let serveUrl = bundleDir;
	if (!existsSync(path.join(bundleDir, 'index.html'))) {
		say({stage: 'bundle', progress: 0});
		// drop stale bundles
		if (existsSync(cacheRoot)) {
			for (const n of readdirSync(cacheRoot)) {
				if (n.startsWith('bundle-')) {
					rmSync(path.join(cacheRoot, n), {recursive: true, force: true});
				}
			}
		}
		serveUrl = await bundle({
			entryPoint: path.join(ROOT, 'remotion', 'index.ts'),
			outDir: bundleDir,
			publicDir: path.join(ROOT, 'public'),
			onProgress: (p) => say({stage: 'bundle', progress: p / 100}),
		});
	}

	const server = await serve(path.resolve(args['media-dir']));
	const {port} = server.address();
	const inputProps = {...props, media: `http://127.0.0.1:${port}/${encodeURIComponent(props.media)}`};
	const composition = await selectComposition({serveUrl, id: 'QuillClip', inputProps});
	const gl = args.gl && args.gl !== 'auto' ? args.gl : null;
	let last = -1;
	await renderMedia({
		composition,
		serveUrl,
		codec: 'h264',
		outputLocation: args.out,
		inputProps,
		muted: true,
		concurrency: Number(args.concurrency || 3),
		chromiumOptions: {gl},
		videoBitrate: args.bitrate || '8M',
		x264Preset: args.preset || 'medium',
		pixelFormat: 'yuv420p',
		timeoutInMilliseconds: 120000,
		onProgress: ({progress}) => {
			const p = Math.round(progress * 100);
			if (p !== last) {
				last = p;
				say({stage: 'render', progress});
			}
		},
	});
	server.close();
	say({done: true});
};

main().catch((err) => {
	say({error: String(err?.stack || err).slice(0, 4000)});
	process.exit(1);
});
