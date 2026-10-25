# Stratus — Alpine Cloud Observatory

A local, buildless demo of **MapLibre GL JS 6.15 terrain + world-space volumetric clouds**, centered on the Matterhorn. No API key or dependency installation is required.

## Run

```sh
cd alpine-clouds
npm run dev
```

Open <http://127.0.0.1:4173>. The HTTP server is required for ES modules and the MapLibre worker. Internet access is required for Esri imagery and Mapterhorn elevation tiles. The app also requests Google Fonts; system fonts work if that request is blocked.

Drag to pan, right-drag to rotate/tilt, scroll to zoom. The map's keyboard navigation also works. Choose Alpine drift, Valley fog, or Golden hour, or adjust coverage, cloud-base altitude, depth, wind and sun. Clouds can be paused or hidden. Orbit runs until stopped or manually interacting with the camera. Reduced-motion preference starts clouds paused.

## Rendering

- `dist/app.js` sets up a Mercator map, satellite imagery, raster DEM terrain, hillshade, sky and controls.
- `dist/clouds.js` implements MapLibre's `CustomLayerInterface` with `renderingMode: '3d'`, sharing the map's WebGL 2 context.
- `dist/math.js` converts a local east/north/up frame in **meters** to Mercator coordinates, combines it with the current map matrix in Float64, then inverts it for view rays. This limits precision loss near mountain surfaces.
- A deterministic 64³ 3D texture supplies value noise and periodic Worley noise. Fractal noise, vertical profiles, domain warping and wind create a continuous density field.
- The cloud pass ray-marches 40/64/96 samples depending on quality, accumulating Beer–Lambert extinction with approximate sunlight attenuation, forward scattering and ambient light.
- **Terrain occlusion:** the custom layer copies the existing terrain depth attachment using `blitFramebuffer`, undoing MapLibre's reserved depth range before reconstructing surface positions. Each cloud ray stops at terrain, including when the camera enters the cloud layer.
- A lower-resolution cloud framebuffer is enlarged with depth-aware bilateral filtering. The final pass adds distance haze and premultiplied cloud color. Resolution is capped at 500,000 cloud pixels and reduces after sustained slow frames.
- Cloud rendering intentionally happens in `render`, after terrain is drawn. `prerender` runs too early to copy the current frame's terrain depth. Framebuffer, viewport, textures, blending, color/depth masks, program and VAO state are restored on return.
- Playback pauses in hidden tabs. GPU resources are deleted on removal; custom layers are added again when MapLibre rebuilds its style after context restoration.

To integrate with an existing **Mercator** MapLibre map, import `CloudLayer`, pass a `MercatorCoordinate` origin, a settings object matching `app.js`, and a status callback, then call `map.addLayer(layer)` after the terrain style is loaded. Keep the cloud layer after terrain and before any labels you want readable above clouds. Use a WebGL 2 context with antialiasing disabled so depth copying does not require multisample resolution. This implementation is pinned to MapLibre 6.15; it does not support globe projection.

## Verification and limits

`npm run check` checks JavaScript syntax and runs camera-coordinate tests. The vendored MapLibre module was imported in Node to verify the pinned version and required API exports. A separate offline rendering review checked MapLibre's source, ray reconstruction, terrain pass ordering, shader syntax, state handling and context recovery.

**Live browser/GPU verification remains pending:** browser preview authority was declined during development. Shader compilation, frame rate, visual quality and driver-specific framebuffer behavior have therefore not been confirmed on a live GPU. The local server served the complete module graph successfully. Treat this as an implementation ready for visual validation, not a measured production renderer.

Weather is illustrative, not live meteorological data. Lighting uses single-scattering approximations; the demo does not project cloud shadows onto terrain, simulate precipitation, or use temporal reprojection. Cloud geometry is local and planar; altitude uses the meter scale at the origin, so fidelity is intended for regional exploration. Terrain is exaggerated 1.15× for legibility. Clouds use altitude above sea level in that rendered coordinate system.

Site identity and static hosting configuration are retained in `.openai/hosting.json`. Publication uses the exact pushed source commit and its packaged static assets. The site's configured audience is preserved during deployment.

## Data and dependencies

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/) 6.15.0, vendored in `dist/vendor/`; license in `MAPLIBRE-LICENSE.txt`.
- [Mapterhorn elevation and attribution](https://mapterhorn.com/attribution), Terrarium raster DEM.
- Esri World Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community. Attribution is visible on the map.

Cloud rendering code in this project was written for this demo; it does not contain Kimi's renderer or image assets.
