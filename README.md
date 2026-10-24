# BookLab Playground

An interactive order-book research playground, with a separate welcome screen and browser-local experiments.

- Historical Coinbase BTC-USD replay and clearly labeled synthetic sessions.
- Timestamp-paced replay, seeking, speed controls and top-six-level book inspection.
- Adjustable target horizon, unchanged-price deadband, feature set and training share.
- Browser worker fitting: class-balanced softmax logistic regression, train-only standardization,
  validation-selected regularization, refit on development data and purged chronological test.
- Majority and imbalance-rule baselines, class metrics and exploratory paired time-block intervals.
- Explicitly invalid future-target and shuffled-split teaching modes.
- Local saved runs, settings restoration and JSON export.
- A separate fixed Python reference result; browser models are their own implementation.

Static source is in `dist/`. No external API key is needed. The committed output runs
without a build. After editing `scripts/motion.mjs`, install dependencies and run
`npm run build:motion` to regenerate its bundled output. Run `npm test` for meaningful
mathematical and protocol checks. Vercel serves the static directory. `vercel.json` selects `dist/` and rebuilds the Motion bundle on deployment.

The welcome screen keeps the generated alpine composition separate from the laboratory.
Motion animates a short mountain zoom on entry; reduced-motion preferences skip it.
Main views carry a faint mountain backdrop. Terms, privacy, storage controls and a
research checklist are available in native dialogs on both sides. Fonts and all other
application assets are self-hosted. See `DESIGN.md` for the art direction and references.

The recorded sample came from the BookLab capture/replay pipeline created in this conversation.
Its observed span is shorter than the full capture attempt. Capture windows are historical,
not current prices. Synthetic samples do not establish market performance.

## Verification

Ten Node behavioral tests cover fixed-class metrics, session censoring, timestamp purging,
train-only scaling, deterministic fitting, held-out feature perturbations, explicit invalid
protocols, rejected parameters and welcome/deep-link routing. Browser QA covers setting changes, saved runs, reloading,
leakage labeling, replay, export, dataset inspection and the narrow layout.

The default recorded sample is small. Its few time blocks cannot establish persistent signal.
No trading execution, fees, fills or profitability are simulated. Whole-paper FI-2010
reproduction and multiple real days remain separate research work.

## Hosting

The Vercel version serves only `dist/`. Hash routes need no SPA rewrite. No exchange
credentials, API keys, database or backend are required. Notebook runs are stored per
origin, so saved runs at another address do not automatically appear at the Vercel URL.
Export a result before leaving the original address if you want a separate copy.
