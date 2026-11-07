# Multiplication lesson with fading support

The user requested improvement after comparing the repeated four-step chain with Khan Academy/SplashLearn descriptions. Replace repetition in every round with five distinct short objectives; support decreases and the final task transfers the idea to a new picture.

1. Count the diamonds in the highlighted upper row of a two-row picture (3 diamonds per row). No quantity is prefilled or stated in its accessible label.
2. Start with one complete row of 4 diamonds; add two identical rows, with undo. Completing the requested grouping finishes this task without another forced count/expression chain.
3. Independently count the whole 4×5 diamond array and enter 20. No automatic total or worked sum appears before a correct answer.
4. Build the repeated addition for a 3×4 picture. Each of the three terms must be 4; another sum totaling 12 does not model the picture. The result is hidden until the sum is correctly built. The success explanation connects this addition to multiplication before the final task.
5. A new picture shows two baskets, each containing five apples. Independently enter a multiplication and its result. Accept 2×5=10 and 5×2=10; reject 1×10 even though its product matches, because those factors do not describe the groups.

Use simple Russian questions and concrete items. Only the first two tasks show persistent explanatory guidance; later tasks provide optional method hints that do not reveal numeric answers. The final picture has no diamond-row scaffolding, prior sum or answer choices. All five objectives must be completed before the existing account-bound save. Keep reset/back, retry without penalties, keyboard access, stale-event guards, and geometry's independent area/perimeter renderer. No new dependencies or art assets.

Test each objective's required response and ensure there is no mandatory full-chain repetition. Cover row versus whole-picture confusion, grouping undo, wrong/malformed counts, unequal addends with the same total, equivalent multiplication order and wrong same-product factorization, answer visibility, a11y labels, hint/reset/back, stale controls, saves, mobile/desktop screenshots and all 94 game compatibility.

Verification: 340 unit tests passed. The focused browser suite passed all five objectives and their error, accessibility, lifecycle and save cases. Eighteen screenshots were reviewed at 320/412/1280px. A regression check exposed the sticky Continue button covering the worked explanation; scoped static positioning fixed it and the overlap check now passes across all five activities. All 94 games / 470 rounds passed the compatibility browser suite. Independent code and lesson review found no actionable issues.
