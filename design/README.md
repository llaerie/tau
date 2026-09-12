# Design canvases

Two separate canvases, each with its own sources and layout manifest.
Every `.dc.html` is one artboard; `canvas.json` places them.
The seeded `*.html` output bakes in a 2.5 MB editor and is gitignored;
re-seed it from the sources through the `design` skill rather than editing it.

| Directory | Canvas | What it settles |
|---|---|---|
| `approval-moment/` | Approval Moment | How the draft-preview-approve-apply card behaves: hierarchy, the applied and undo states, the pending bar, and where the approve button lives |
| `assistant-directions/` | Assistant Directions | Which visual direction the product commits to: Vault (dark, instrument) or Daylight (cream and pine, document) |

The two canvases answer different questions and can be decided independently.
The approval-moment layout holds under either direction; the direction changes
its material, not its anatomy.

Figures throughout are Arielle's real demo numbers. Her take-home is $2,732
before income tax with withholding unconfirmed, so both directions have to
carry an incomplete figure rather than a clean one.
