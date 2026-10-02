# Riftwell contributor notes

Keep the interface focused on Lending and Marketplace. Use dark surfaces, the selected market’s accent color and a restrained portal motif. KittenSwap is the default and only current market, with a light-green accent. Use original local artwork, accessible keyboard interactions, responsive layouts and reduced-motion support. Keep preview data explicit. Never claim live liquidity, yield or wallet operations from illustrative data.

Contract prototypes are experimental and must not be deployed live without explicit release authorization and the required evidence. Preserve the 0.5% fee basis, exact accounting and custody boundaries. Retain upstream license notices. Do not add private research, counterparties, personal identifiers or credentials to this public repository.

## Conservative GitHub Actions use

Follow the current user approval policy for Actions budgets and exceptions. Validate locally first, inspect the diff and batch coherent changes before remote CI. Before any dispatch, rerun, push, pull-request creation/update, merge, or trigger change that can start Actions, inspect repository run history for the current UTC day using read-only tools. Include all workflows, branches and actors; queued, running and completed runs; and rerun attempts of older runs. Account for duplicate events, downstream chains, scheduled services and GitHub-generated workflows. Estimate runs and runner minutes. A skipped or cancelled job is not a daily cap. Coordinate parallel agents before acting.

Escalate exceptions, unknown monthly usage and CI/release conflicts to the coordinating assistant under the current approval policy. Report unavailable usage as unknown; do not expand billing access. Preserve stricter project pauses, required checks and release evidence. Do not alter triggers or bypass checks merely to fit a budget. If publication is blocked, retain durable work locally and report the exact blocker. Do not copy permission grants or numeric approval thresholds into repository instructions.
