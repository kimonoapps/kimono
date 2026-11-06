# Artifacts

An artifact is a page you make for the person: a chart of their spending, a
chore chart, a recipe scaler, a little game, or an animation that explains an
idea. It appears in the chat while you write it, and the person can open it
beside the chat or full screen.

## Making one

- Write it to `/workspace/artifacts/<name>.html`. The name is lowercase
  letters, digits, `-` and `_`. Start the file with `<title>A short name</title>`.
- Write the page's content only: no `<!doctype>`, `<html>`, `<head>` or `<body>`.
  Kimono's kit is already loaded under it (the tags below, `window.K`, and a
  stylesheet in Kimono's colours).
- It is a real page: any HTML, CSS and JavaScript works, and you can draw
  anything yourself with SVG, canvas or the DOM. The kit is a shortcut, not a
  limit. Inline `<style>` and `<script>` are fine.
- It has **no network**: no `fetch`, no CDN, no images from the web. Put data
  in the page. Pictures go in as `data:` URLs, or as files (see Sound,
  video and pictures). What's available: the kit,
  three.js (`await K.loadThree()`), and KaTeX (see Maths).
- Write it in one go with Write. The person watches it render as you write,
  so put the important part first. Keep it under about 200 KB.
- To change one, use Edit on the file. Every place it is shown updates. To
  show one again further down the chat, run `kimono-show <name>`.
- Say in one short line what you made. Don't describe what they can already see.

## Maths

Write LaTeX anywhere in the page's words and it is typeset: `$…$` or `\(…\)`
inside a sentence, `$$…$$` or `\[…\]` for an equation on its own line. A dollar
amount stays money (`$5 and $10`). Maths inside `<code>`, `<pre>` and scripts is
left as written.

```html
<p>The roots of $ax^2+bx+c=0$ are</p>
$$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$
<k-math>\begin{pmatrix}a&b\\c&d\end{pmatrix}^{-1}=\frac{1}{ad-bc}\begin{pmatrix}d&-b\\-c&a\end{pmatrix}</k-math>
<p>So <k-math inline>\sqrt{2}</k-math> is irrational.</p>
```

`<k-math>` holds one formula on its own line (`inline` puts it in a sentence);
use it for a long one, or when the `$` signs would be awkward. In script,
`K.renderMath(latex, { display })` returns an element to put anywhere.

## Components

Everything a component needs is in its start tag, so it draws as soon as it is
written. Data is JSON in a single-quoted attribute.

```html
<k-grid cols="3"> … </k-grid>                 columns; one column on a phone
<k-card title="Month by month"> … </k-card>   a group on a soft background
<k-row> … </k-row>                            things side by side, wrapping
<k-stat label="Spent" value="$3,482" delta="−6%" note="Plan was $3,600"></k-stat>
<k-chart type="line|area|bar|hbar|pie|donut|scatter" x="month" y="rent,food"
  labels="Rent,Food" prefix="$" suffix="" stacked min="0" max="100" height="280"
  title="…" colors="suo,indigo" data='[{"month":"Jan","rent":900,"food":320}]'></k-chart>
<k-table data='[{"name":"Sam","chores":4}]' columns="name,chores"></k-table>   sortable
<k-tabs><k-tab label="This week"> … </k-tab><k-tab label="Last week"> … </k-tab></k-tabs>
<k-slider name="rate" label="Interest" min="0" max="10" step="0.1" value="4" unit="%"></k-slider>
<k-progress value="6" max="10" label="6 of 10 chores"></k-progress>
<k-callout tone="good|warn"> … </k-callout>
```

- `<k-chart>` rows may also be arrays: `data='[["Jan",900,320],["Feb",880,310]]'`.
- Change a component by setting its attributes from script, e.g.
  `chart.setAttribute("data", JSON.stringify(rows))`. It redraws.
- `K.watch("rate", v => …)` runs whenever a `k-slider` named `rate` moves;
  `K.value("rate")` reads it. `K.format(1234.5, { prefix: "$" })` formats numbers.
- Colours by name: `suo` (rose), `indigo`, `moss`, `amber`, `plum`, `teal`,
  `rust`, `ink`, `soft`. Plain buttons, inputs and tables are already styled.

## Animations: `<k-scene>`

A scene is an animation written as code, which plays while you write it and
can be replayed, paused and scrubbed. Kimono draws the play, pause and time
controls under the card, and a slider for each `slider()`: **never build
playback controls or sliders for a scene yourself.**

```html
<title>What a derivative is</title>
<k-scene height="380">
<script type="text/kimono-scene">
title("The slope of $x^2$ at every point")
axes({ x: [-3, 3], y: [-1, 9] })
const f = (x) => x * x
plot(f, { label: "y = x²" })
const a = tracker(-2)
dot(() => [a.v, f(a.v)], { label: () => `x = ${a.v.toFixed(1)}` })
tangent(f, () => a.v)
caption("Slide along: the tangent's slope is the derivative, $2x$.")
animate(a, 2.2, 3.5)
</script>
</k-scene>
```

Rules:
- **One statement per line.** Each line plays as soon as it is written.
- The script runs again from the top whenever it grows or is replayed, so it
  must give the same result each time. `random()` repeats within a scene.
- Each call is a step on a timeline. Steps play one after another; `wait(s)`
  pauses, and `together(() => { … })` plays its steps at the same time.
- Anything that should move takes a function: `dot(() => [a.v, f(a.v)])`.
- Maths in words goes between `$…$`, or `$$…$$` for an equation on its own
  line (KaTeX). In a JS string, write a backslash twice: `"$\\sqrt{x}$"`, or
  use `String.raw`.
- Aim for 10 to 40 seconds, a caption for each idea, and one scene per artifact.
- `height` is 200 to 520.

### Time and values
- `wait(s)`, `together(fn)`
- `tracker(v)` a value that can move: `t.v`. `animate(t, to, seconds, "inOut"|"out"|"linear"|"spring")`, `set(t, v)`
- `slider(name, min, max, start, { label, step, unit })` a slider on Kimono's card; read `s.v`. `animate()` works on it too; once the person moves it, theirs wins.
- `drag([x, y], { label, on: f })` a point the person drags (2D); read `p.x`, `p.y`, `p.v`. `on` keeps it on `y = f(x)`.

### Words
- `title(text)`, `caption(text)` (one at a time; the next replaces it)
- `formula(latex, { at: "right" })` an equation pinned to the stage (top left by default), over 2D or 3D. Equations shown at once stack; `.fade()` them when the next line starts. `latex` may be a function, so its numbers stay live: `` formula(() => `\theta = ${deg}^\circ`) ``.
- `tint(tex, color)` colours a symbol, so it matches what it names in the drawing: `` formula(`${tint("r", "indigo")}\cos\theta`) ``, and draw `r` on the model in indigo too.
- `narrate("media/<file>", text, seconds)` a spoken step: plays the clip, shows `text` as the caption, and lasts `seconds` (see Narration)
- `text([x, y], words, { color, size, align })`, `tex([x, y], latex)`

### 2D
- `axes({ x: [min, max], y: [min, max], labels: ["x", "y"], grid })`
- `plot(f, { color, label, from, to, width })`, `param(t => [x, y], { t: [a, b] })`, `polar(θ => r, { t: [a, b] })`
- `implicit((x, y) => F, { level })` the curve F = level
- `points([[x, y], …])`, `bars([…] or [[x, y], …], { color, width })`
- `dot(pos, { label })`, `line(a, b, { dashed })`, `arrow(a, b, { label })`, `vline(x)`, `hline(y)`
- `area(f, a, b)`, `between(f, g, a, b)` shading
- `tangent(f, x)`, `secant(f, a, b)`
- `riemann(f, a, b, n, { method: "left"|"right"|"mid"|"trap" })` (n may be a slider)
- `vectorField((x, y) => [u, v])`, `slopeField((x, y) => dy/dx)`
- `integrate(f, a, b)`, `derivative(f)` numbers for your own use
- Every step returns `.fade(seconds)` to take it away later.

### 3D (x right, y across, z up)
- `axes3d({ x: [..], y: [..], z: [..] })` frames the camera on this box
- `surface((x, y) => z, { color, opacity, wire })`, `surfaceParam((u, v) => [x, y, z], { u: [..], v: [..] })`
- `curve3d(t => [x, y, z], { t: [a, b] })`, `point3d(pos)`, `vector3d(to, { from })`, `label3d(pos, text)`
- Solids of revolution, round the x axis:
  - `region3d(f, g, a, b)` the flat region between y = f and y = g, standing up
  - `revolve(f, g, a, b, { color, opacity })` the solid (g may be `null`), sweeping round
  - `washer(x, f, g, { dx })` / `disc(x, f, { dx })` one slice at x (x may move)
  - `washers(f, g, a, b, n)` / `discs(f, a, b, n)` n slices, added up (n may be a slider)
- `orbit(degrees, seconds)`, `camera({ az, el, dist }, seconds)`. The person can also turn the view by dragging.

### Any 3D model: `model()`

For a real thing (an engine, a heart, a molecule, the solar system), build it
yourself with three.js and let the scene move it. It keeps time with the
scene, so narration, pause, scrub and replay all work.

- `model(build, move, { frame })`: `build(T)` gets THREE and returns your model
  (a `T.Group` of meshes, in three's own units, y up, centred near the origin).
  `move(obj, t, T)` runs every frame: set positions, rotations and colours from
  trackers you `animate()` on the timeline (or from `t`, seconds since the step
  began). It must give the same picture for the same time: no randomness, no
  state carried between frames. `frame: r` frames the camera on a box `r` each
  way from the middle.
- `tag(part, "words", { offset: [x, y, z] })` a label that follows a part (the
  three.js object, or a function returning it) or a point `[x, y, z]`. A step's
  `.fade(seconds)` takes it away; fade a line's labels when the next line starts.
- Put the model's code in an ordinary `<script>` before the `<k-scene>`
  (`window.engine = { build, move, parts }`), so the scene stays one statement a
  line. Keep a handle on the parts you'll move or tag.
- Drive it with trackers: one tracker for the main motion (a crank angle, an
  orbit angle), `animate(t, to, seconds, "linear")` inside each narrated line's
  `together()`, so the motion lasts exactly as long as the line.
- Use `camera()` and `orbit()` to show it from the side that explains each line.
- Explain it with its maths: draw guides on the model (a radius, an angle's arc,
  a length with end ticks) in the colours of the symbols, label them with
  `tag(part, "$r$")`, and show the equations with `formula()`, live numbers
  included, a few per line, faded when the next line starts.

```
const a = tracker(0)
model((T) => engine.build(T), () => engine.move(a.v), { frame: 1.85 })
together(() => { narrate("media/engine-2.mp3", "Intake: the piston slides down…", 5.85); animate(a, PI, 5.85, "linear"); tag(() => engine.parts.intake, "Intake valve") })
```

### Example: washers

```
title("Volume by washers: turn a region round the $x$-axis")
axes3d({ x: [0, 4], y: [-2.2, 2.2], z: [-2.2, 2.2] })
const R = (x) => sqrt(x)
const r = (x) => x / 2
caption("Take the region between $y=\\sqrt{x}$ and $y=\\tfrac{x}{2}$.")
region3d(R, r, 0, 4)
caption("Spin it round the $x$-axis.")
revolve(R, r, 0, 4, { color: "indigo" })
const x = slider("x", 0.2, 3.8, 1.2, { label: "Slice at x" })
caption("One thin slice is a washer: $\\pi(R^2-r^2)\\,\\Delta x$.")
washer(() => x.v, R, r)
animate(x, 3.2, 2.5)
const n = slider("n", 2, 40, 6, { step: 1, label: "Washers" })
washers(R, r, 0, 4, () => n.v, { color: "moss" })
animate(n, 30, 3)
caption("Add them up: $V=\\pi\\int_0^4\\left(x-\\tfrac{x^2}{4}\\right)dx=\\tfrac{8\\pi}{3}$")
```

Inside a scene you also have `sin cos tan exp log sqrt abs pow floor round min max PI range(a, b, step) color(name)`.

## Narration

A scene can speak: an explainer with a voice is a scene whose captions are
narrated. Kimono adds a sound switch to the scene's controls, and pause, scrub and replay
keep the voice in step.

1. Write what's said, one line per step, to a file, and voice it first:
   `kimono-say --lines /workspace/media/heart.txt --name heart`. It makes
   `media/heart-1.mp3`, `heart-2.mp3`… and prints a `narrate(…)` step for each,
   with its length.
2. Paste those steps into the scene, with what each line explains drawn
   alongside it: put a step and its drawing in `together(() => { … })`, and
   use the printed seconds for `animate()` so the motion lasts as long as the voice.
3. Write the artifact after the clips exist. If you make or change clips
   afterwards, run `kimono-show <name>` so Kimono picks them up.

```
title("One heartbeat")
together(() => { narrate("media/heart-1.mp3", "It starts with a spark in the right atrium.", 2.75); dot([0.3, 0.8], { label: "SA node" }) })
together(() => { narrate("media/heart-2.mp3", "The atria squeeze, pushing blood down into the ventricles.", 3.2); animate(squeeze, 1, 3.2) })
```

- Spoken lines are plain words: write maths as it's said ("x squared"); the
  caption may show it as `$x^2$` (edit the caption, not the clip).
- Keep each line to a sentence or two, so captions and drawings change with it.
- Use one voice for a scene (`--voice`; `kimono-say --voices` lists them).

## Sound, video and pictures

An artifact can play and show files: name them `media/<file>`, from
`/workspace/media/` (what `kimono-say` and `kimono-fetch` make, or anything you
put there). `<audio controls src="media/song.mp3">`, `<video src="media/clip.mp4">`
and `<img src="media/photo.jpg">` all work; in script, `K.media("song.mp3")` is
the address. Kimono copies the files the page names when it keeps the
artifact, up to 50 MB each; they load once it's kept, not while you're writing.
