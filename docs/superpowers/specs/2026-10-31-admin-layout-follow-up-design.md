# Admin layout follow-up

The owner's screenshots identify two presentation defects in the approved Admin design: an unconstrained page width and shop crawl inputs/actions sharing stretched wrapping rows. This is a bounded layout correction; no new functionality or provider behavior is needed.

Use a centered Admin container capped at 76rem with responsive gutters. Group shop crawl into Scope (seasons, presets, sports, content options) and Run crawl (start/resume/stop, saved progress, separate faces backfill). Put cursor adjustment in a folded recovery section; retain advanced settings, activity log and manual override. On phones stack the sections and keep all inputs within the viewport.

Approach: correct the production container and reorganize existing JSX with scoped CSS. A width-only change would leave the crawl controls mixed together; replacing the workflow would exceed this request. Existing handlers, disabled states, defaults, requests, safety guards and data remain unchanged. The offline preview must use the actual page width, with no artificial outer width constraint.

Verification uses the actual component in an isolated offline preview at wide desktop, ordinary desktop and phone widths, existing component tests and the required offline release gates. No live maintenance action or Real request.
