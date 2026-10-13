# View in your room: WebXR augmented reality

## Goal

A reader on an Android phone taps an AR button on the stage and sees the
explainer's mechanism standing on their floor or table through the camera. It
keeps moving: the timeline, the dock and the live readings work exactly as on the
page. When the reader leaves AR, the page carries on from the same state.

## Decisions

- WebXR `immersive-ar` only. The button appears only where
  `navigator.xr.isSessionSupported('immersive-ar')` resolves true. Today that is
  Chrome on Android with ARCore. Safari on iPhone has no WebXR, so iPhones get no
  button. AR Quick Look for iOS is out of scope and may come later as its own task.
- Same renderer, same scene, same store (approach A). No clone of the model, no
  second renderer, no exported file.
- Only the mechanism is shown. The backdrop group (ground, sky, trees, water), the
  stage grid, fog, the scene background and the part labels are hidden. A soft
  contact shadow sits under the model.
- The model is fitted into a 0.5 m cube when placed. The reader scales it with a
  pinch. There is no real size mode.
- The overlay shows the existing gauge (`[data-gauge]`, the live readings) at the
  top and the existing dock at the bottom, unchanged. Chapters, labels and the rest
  of the page are not shown.
- The button is a round icon button left of the full screen button, in the same
  style. Its name, "View in your room", is in `aria-label` and `title`.
- AR is on for every explainer by default. An explainer turns it off with
  `scene.ar: false` in its definition. Explainers whose environment carries the
  meaning of the process are turned off after a review of each explainer in the AR
  preview.

## Architecture

### Contract

`SceneOptions` gets one optional field:

```ts
ar?: boolean; // default true; false hides the AR button for this explainer
```

Nothing else in the explainer contract changes. An explainer whose environment is
not yet in the `backdrop` group gets its environment materials moved into that
group, or gets `ar: false`.

### Modules

```
src/core/xr/
  support.ts        isArSupported(): Promise<boolean>, never throws
  button.ts         mountArButton(root, explainer, enter): shows the button when
                    supported and ar !== false, runs enter on click
  session.ts        startArSession(host, overlayRoot): requests the session,
                    wires the loop, placement, gestures, exit; returns end()
  arScene.ts        prepareArScene(shell): hides backdrop, stage grid, fog,
                    background and labels, wraps the scene content in a placement
                    group, fits it into the cube; returns restore()
  placement.ts      hit-test source, reticle, tap to place
  gestures.ts       pure gesture maths: drag moves on the floor plane, pinch scales
                    within limits, twist turns around the vertical axis
  ar.css            overlay layout in AR: hides #scene and the stage buttons,
                    pins gauge on top and dock at the bottom, safe-area insets
```

`src/core/xr/*` is loaded with a dynamic `import()` on the first tap, except
`support.ts` and `button.ts`, which are tiny and live in the main explainer chunk.
The explainer JavaScript budget stays as it is.

### Shell changes (`src/core/scene/shell.ts`)

The host gets an XR mode the AR module can switch on and off:

- `enterXr()`: stops the requestAnimationFrame loop and drives frames from
  `renderer.setAnimationLoop`, rendering every frame (an XR session needs a frame
  every time). Label layout and label occlusion are skipped. The rig camera state
  is saved.
- `exitXr()`: clears the animation loop, restores the rig camera, restarts the
  normal loop, invalidates the frame.

`viewport.ts` stops resizing the renderer while a session runs, since
`renderer.xr` owns the size during a session.

### Flow

1. Page load: `mountArButton` checks support once. Unsupported or `ar: false`:
   the button stays `hidden`.
2. Tap: the AR chunk loads. `renderer.xr.enabled = true`, then
   `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'],
optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: stage } })`.
   The stage element gets `data-ar`, and `ar.css` turns it into the overlay.
3. `prepareArScene` hides the environment and fits the model. `enterXr` hands
   frames to XR. A hint at the top says to move the phone to find a surface.
4. When hit-test finds a surface, a reticle shows. A tap places the model there.
   The hint changes to a short gesture tip and fades out.
5. After placement: one finger drags the model on the plane, two fingers pinch to
   scale and twist to turn. A tap on the dock or the gauge never moves the model:
   both stop `beforexrselect` and pointer events from reaching the gesture layer.
6. Exit: the exit button in the overlay, or the system back gesture. On the
   session `end` event, in this order: `data-ar` removed and the AR controls
   hidden, so the page layout is back before the viewport resizes; `restore()`
   from `prepareArScene`; `exitXr()`; `renderer.xr.enabled = false`; the page
   depth range restored; the orbit controls on again; `data-takeover` removed.
   The page shows the same phase, speed and toggles as in AR.

### Errors

- `requestSession` rejects (camera permission denied, ARCore missing): the scene
  stays as it was, and a short message shows on the stage for a few seconds.
- Hit-test never finds a surface: the hint stays, the exit button works.
- The tab is hidden during a session: the browser ends the session, and the end
  handler restores the page.

### Copy

New core keys in `src/core/locales/*.json`, all 8 languages, written by a writer
subagent in the project voice:

- `stage.ar`: "View in your room"
- `ar.exit`: "Leave AR"
- `ar.find`: "Move your phone slowly to find the floor or a table"
- `ar.place`: "Tap to place the model"
- `ar.gestures`: "Drag to move, pinch to resize, twist to turn"
- `ar.failed`: "AR could not start on this phone"

## Testing

- Unit (`vitest`, happy-dom): `support.ts` with and without `navigator.xr`, with a
  rejecting `isSessionSupported`; the button stays hidden for `ar: false`;
  `gestures.ts` maths; `arScene.ts` hides exactly the backdrop, stage grid and
  labels, fits a known box into 0.5 m, and `restore()` brings back every visibility,
  parent, transform, fog and background.
- Shell: `enterXr`/`exitXr` switch loops and restore the rig camera, with a mocked
  renderer.
- AR preview: a dev-only `?ar-preview` query applies `prepareArScene` without a
  session, over a plain backdrop. An e2e tool screenshots every explainer in this
  mode, one contact sheet per device. The review of that sheet decides which
  explainers get `ar: false` or backdrop fixes.
- e2e smoke: on desktop Chromium the AR button is hidden on every explainer.
- On a device: the reader tests on an Android phone with Chrome. This cannot run
  in CI.

## Out of scope

- iOS (AR Quick Look and USDZ export).
- Real size mode.
- Part labels and chapter text in AR.
- Lighting estimation from the camera.
