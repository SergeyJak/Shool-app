# Understandable treasure rows

The user could not understand level16's instruction to assemble a rectangle from treasure rows. The screenshot showed empty cells, a sticky purple hover despite a zero count, and geometry terminology in an introductory multiplication game.

Rewrite all five rounds in direct, grammatical Russian: fill a specified number of rows with a specified number of treasures in each. Explain tapping empty cells and tapping again to remove a treasure. Show actual treasure icons, total collected and completed-row counts; reserve area/perimeter for the geometry games. Keep progression, required answers and the shared grid mechanics intact. Distinguish empty/selected states even under touch hover.

Validate the reported second round, all five rounds, touch/keyboard undo, retry/hint/reset, server save, mobile/desktop layout, and a geometry round retaining area/perimeter. No new image assets or dependencies.

Verification: the browser regression failed before the change because the action instruction was missing. After the change, `test:treasure-rows` passes all five rounds, touch/keyboard undo, row/treasure counts, retry/hint/reset, save and the unaffected geometry display. Screenshots inspected at 320, 412 and 1280px. `npm test` passes 339 tests and `test:adventure-levels` passes all 470 rounds. Independent review found the five prompts/hints/explanations natural in Russian and no actionable UI or code issues.
