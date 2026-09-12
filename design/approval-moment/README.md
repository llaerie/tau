# Design artboards

Source for the design canvas reviewed before the approval-moment rework.
Each `.dc.html` is one artboard; `canvas.json` places them and picks the launch view.

| File | What it shows |
|---|---|
| `Main.dc.html` | Desktop 1440x900, light. The approval moment, with working controls: approve, then undo |
| `Dark.dc.html` | Desktop 1440x900, dark. The applied and reversed states |
| `Mobile.dc.html` | Phone 390x844, light. The card above a collapsed composer, with the pending bar |
| `Before.dc.html` | Today's card at the same scale, composer drawn at its real 233px, marking where the approve button disappears |
| `Anatomy.dc.html` | Measurements, colour, what changed and what was deliberately kept |

Figures are Arielle's real demo numbers, including the case where the consequence
cannot be computed because her withholding is unconfirmed.

The published canvas is a 2.5 MB file built from these and is not committed.
Edit the artboards, then re-seed and republish through the `design` skill;
never hand-edit the seeded output.
