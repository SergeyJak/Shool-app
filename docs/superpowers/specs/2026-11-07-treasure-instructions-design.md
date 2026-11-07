# Equal-group multiplication lesson

The user approved replacing fill-all-cell busywork with an educational sequence: build one row, repeat that group, independently count all diamonds, and connect repeated addition to multiplication. Use direct Russian instructions and concrete diamonds; avoid the unclear «по N сокровища» wording.

Each of the five rounds now has four teaching steps:
1. Fill a single row with the requested number of diamonds, with reversible touch/keyboard placement.
2. Add identical rows. Copies preserve the group size; the learner can undo the last copy.
3. Enter the independently counted total. No visible total, equation, answer-filled input or hint gives that total before a correct answer. Wrong answers remain retryable.
4. Build one additive term for each row, then select the multiplication representing those groups. Matching only the total is insufficient: unequal terms such as 3 + 5 + 4 cannot represent three rows of four.

The final answer is explained after the learner completes the sequence. Each round must reach that point before Continue appears; all five rounds are required before the existing account-bound save. Reset restarts the current round's sequence and Exit never awards an unfinished level. Detached phase controls cannot advance a later step. Phase changes preserve keyboard focus and helper/reset/back controls.

Keep the approved curriculum targets, first six games, geometry area/perimeter games, other fourteen-mechanic implementations, backend progression and saves. No new assets or dependencies. The existing rectangle descriptor's treasure presentation dispatches to a dedicated lesson renderer; the geometry renderer stays independent.

QA covers all five shapes, total/row-count confusion, wrong/malformed answers, wrong and equivalent-but-unequal addition, multiplication retry, hints without answer leakage, undo/reset/back/stale events, touch/keyboard, save timing, 320/412/1280px screenshots and geometry compatibility. The all 94 browser solver uses native controls for the complete teaching sequence.

Verification: the rewritten browser regression failed against the former fill-all implementation, then passed the complete lesson. The final focused suite also checks six additive terms at 320px without overflow or overlap. `npm test`: 339 passed. `test:adventure-levels`: 94 games / 470 rounds passed, including save/replay and original-game compatibility. Ten lesson screenshots were inspected. Independent code/educational review approved the four-step gates, equal-term validation, answer visibility, lifecycle and accessibility; visual QA corrected a clipped input placeholder before the final run.
