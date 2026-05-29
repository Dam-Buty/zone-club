import { BufferAttribute, Mesh } from 'three';
import { UVUnwrapper } from 'xatlas-three';

// Vendored from lucas-jones/three-lightmap-baker (src/atlas/generateAtlas.ts).
// Adapted for this project: the lightmap atlas is written to `uv1` (modern three
// samples `material.lightMap` from `uv1`, not `uv2`). xatlas-three's `packAtlas`
// only accepts 'uv' | 'uv2' as output, so we pack into a temporary `uv2` and then
// rename it to `uv1`.

const unwrapper = new UVUnwrapper({ BufferAttribute: BufferAttribute });

enum ProgressCategory {
	AddMesh,
	ComputeCharts,
	PackCharts,
	BuildOutputMeshes,
}

export const loadXAtlasThree = async () => {
	const onProgress = (mode: number, progress: number) => {
		console.log(`🗺️ XAtlas ${ProgressCategory[mode]} ${progress}%`);
	};
	await unwrapper.loadLibrary(
		onProgress,
		'https://cdn.jsdelivr.net/npm/xatlasjs@0.1.0/dist/xatlas.wasm',
		'https://cdn.jsdelivr.net/npm/xatlasjs@0.1.0/dist/xatlas.js',
	);

	console.log('🗺️ XAtlas loaded');
};

export const generateAtlas = async (meshs: Mesh[]) => {
	const geometry = meshs.map((mesh) => mesh.geometry);

	// Padding between charts to avoid bilinear bleed across atlas islands.
	unwrapper.packOptions.padding = 4;

	// Pack the shared lightmap UVs into a temporary `uv2` attribute (the only
	// non-'uv' output xatlas-three supports), reading the input UVs from `uv`.
	await unwrapper.packAtlas(geometry, 'uv2', 'uv');

	// Rename uv2 -> uv1 so three samples the lightMap from the correct channel.
	for (const g of geometry) {
		const uv2 = g.getAttribute('uv2');
		if (uv2) {
			g.setAttribute('uv1', uv2);
			g.deleteAttribute('uv2');
		}
	}
};
