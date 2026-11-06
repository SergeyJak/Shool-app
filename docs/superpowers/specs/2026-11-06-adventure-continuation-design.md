# Continue the hundred-game adventure

The user asked to continue the remaining games in the style of the six finished levels. The existing approved curriculum is `docs/math-adventure-100-games-roadmap.md`. Deliver interactive teaching games for levels7–100; preserve the real first six, their art and interactions, existing account isolation and server progress. Do not redesign diagnostics or silently mark earlier skills mastered. Use the current unlock model for compatibility; completing every teaching round is sufficient, with unlimited hints/retries and no8/10 gate for new games. The existing scores API receives the same successful10/10 completion envelope as the first six. Do not change production financial or lesson data.

## Approach and visual direction

Replace the generic ten-question fallback with a declarative curriculum and several reusable, genuinely interactive scene renderers. Alternatives rejected:94 copies of handwritten game controllers would duplicate cleanup, grading and save logic; retaining the generic multiple-choice quiz would contradict the requested first-six style. Existing forest/river/castle art, cream cards, purple raised buttons, soft green boards, friendly animals and the celebratory owl carry through. Each level has a named mission, five short progressively harder rounds, an interactive board, a contextual hint, and an explanation on success. Touch and keyboard work without mandatory dragging. Wrong attempts retain the scene and offer help. Respect reduced motion.

## Shared data contract (all levels and rounds are plain serializable objects)

Packs export an array through CommonJS; in the browser append it to `(globalThis.AdventureLevelPacks ||= [])`. Four disjoint packs cover7–30,31–55,56–80,81–100. Each descriptor is `{level,title,chapter,skill,icon,scene,intro,success,rounds}`. Level is one-based; chapter=`Math.ceil(level/5)`; skill is a curriculum skill id; scene one of `shop,train,forest,balloon,city,island,cave,castle,workshop,clock,geometry,fractions,river,market,mountain,laboratory,space,logic`. Five rounds per descriptor. Every round includes `{mechanic,prompt,hint,explanation,...fields}`. Do not include HTML, functions or a generic quiz mechanic. Use Russian child-facing text.

Allowed round schemas:
- `compose`: integer `target`, positive integer `pieces:[{label,value,icon?}]`, optional `unit`, `displayScale` (10/100 for integer decimal units), `maxPieces`. Targets must be reachable in at most25 presses. A `scene` of balloon/safe/balance may change the board illustration but not correctness.
- `order`: `items:[{id,label,value?,icon?}]`, `solution:[ids]`. Distinct ids, all used once; maximum7 items. Put together a train, ordered route or expression using movable/tappable tiles.
- `share`: integer `total`, `groups`, `each`, optional `unit`, `groupLabels`. `total=groups*each`;2–6 groups, total<=36. Distribute items into containers with undo/reset.
- `rectangle`: integer `cols,rows` (2–10), `targetArea?`, `targetPerimeter?`, `requireRectangle` boolean. At least one target; feasible construction on the grid. `requireRectangle:false` permits painting the exact area anywhere. At most60 cells required, except a percentage task may use10×10 with whole-row paint controls.
- `fraction`: integer `parts` (2–16), `target:{n,d}` with0<n<=d and `parts*n/d` integral. Paint a pizza/strip to represent the requested fraction; equivalent fractions are welcome.
- `route`: integer `start,target`, positive `steps:[integer]` (or positive and negative if useful), optional `unit`; target must be reachable within12 presses. Move a character along a number path; allow undo/reset.
- `clock`: integer `hour` (0–23), `minute` (0–55, multiple of5), optional `startHour,startMinute`. Set analog hands with hour and5-minute controls; target may result from an elapsed-time story.
- `calendar`: integer `year,month` (1–12), `day` valid for that month. Select a date on a real Monday-first calendar; instructions may use a relative date or week calculation.
- `match`: `pairs:[{id,left,right}]` (2–4 distinct pairs), optional `visual` string. Match mathematical representations, figures, operations or statements.
- `sort`: `bins:[{id,label}]` (2–3), `items:[{id,label,bin,icon?}]` (3–6). Select an item then its correct container. Wrong placement keeps it available.
- `sequence`: `terms:[number|string|null]`, `solution:[number|string]` of equal length, `choices:[number|string]`. Fill missing positions by tapping a slot then a tile; choices may be reused. Maximum7 terms; at least2 blanks; every needed value present in choices.
- `coordinate`: integer `xMin,xMax,yMin,yMax`, `targets:[{x,y}]` (1–4), `mode:'point'|'robot'`, optional `start:{x,y}`. Bounds contain at most9 positions per axis; Cartesian y increases upward. Select points or move robot with arrows through targets.
- `bars`: `labels:[string]`, `values:[integer]`, integer `maxValue<=12`, optional `unit`. Rebuild a bar chart from the story/data using plus/minus controls.2–4 bars.
- `measure`: numeric `min,max,step,target`, optional `start,unit,displayScale`; target lies exactly on a valid step. Move a ruler/scale/volume indicator with range and increment/decrement controls, then verify.

## Rendering interface

`public/adventure/mechanics-basic.js` and `mechanics-advanced.js` export a map of `mechanicName -> render(ctx)` through CommonJS and merge into `globalThis.AdventureMechanics` in the browser. Root owns basic (`compose,order,share,rectangle,fraction,route`); advanced owns the other8. `ctx` contains:
- `root`: empty scene element; `task`: current round; `level`: descriptor.
- `el(tag,className,text?)`: create DOM node; `button(text,onClick,className='ag-control')`: safe type=button with managed listener and aria label equal to text (caller may override).
- `listen(element,event,handler)`: listener cleaned up on round exit, guarded after completion.
- `feedback(text,kind='info')`: visible live-region feedback (`info,error,success`).
- `solve(explanation?)`: mark this round solved once, freeze board controls, show Continue; no automatic navigation/timing.
- `setHint(fn)`: optional dynamic hint callback; otherwise the declared hint is used.
- `format(value,displayScale=1)`: Russian numeric display, integer-backed decimals.
Renderers must add semantic `.ag-*` classes and data attributes for UI state (not hidden answer dumps); no timers, unsafe HTML or test-only APIs. Generated controls must fit360px viewports. Every renderer's completion can be reached through real input events.

The runner controls outer `#question,#counter,#meterFill,#feedback,#next`, per-round hints/reset/back, listener cleanup and one-shot completion. App calls `AdventureGames.start(oneBasedLevel,{root,question,counter,meter,feedback,next,onComplete,onExit})` and receives `destroy()`. Leaving the game or changing account destroys the active controller. Completion preserves existing per-account `persist`/`syncResult` with expected userId; replaying does not award stars twice.

## Verification

Node tests validate catalog coverage, hand-checked representative mathematics, task solvability and completion/state cleanup. HTTP+Chromium browser tests exercise all94 games by actual controls, wrong attempts/hints/reset, completion and save/reload; representative mechanics at360/412 and desktop widths, screenshot inspection and clean console. Existing first-six and account-isolation suites remain green. Browser plugin is unavailable; use the repository's established Puppeteer/Chromium workflow, not a new browser dependency.
