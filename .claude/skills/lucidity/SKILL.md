---
name: lucidity
description: Project context for Lucidity, the iMessage dementia-caregiver agent built at HackNC 2026 (Photon Spectrum + GLM-5.3 + TypeScript). Use whenever working in this repo — changing features, debugging the bot, running the demo, writing about the project, or planning next steps.
---

# Lucidity project context

Lucidity lets dementia caregivers text what they notice over iMessage; an AI agent saves structured records, runs NPI-Q / ZBI check-ins (scored by code), sends reminders, and a clinician on a second phone reads a code-compiled profile and approves every message sent back. Built at HackNC 2026 (Oct 10–11, 2026); all data synthetic.

## Read these first (source of truth)

- `docs/CONTEXT.md` — the problem, the three layers (Connect / Intelligence / Care), the design rules, what's real vs simulated, the prioritized "what's next".
- `docs/HOW_IT_WORKS.md` — message routing order, every feature and its guardrails, saved data, code map, running, demo script, gotchas.
- `docs/PROJECT_JOURNAL.md` — build history, decisions and why, bugs found and fixes, setup lessons, demo/video plan, pitch text, post-hackathon plan.

## Non-negotiable rules (keep these when changing anything)

- Safety rules run on every message **before** the AI; emergency wording is fixed, never generated (including after an AI escalation).
- Scores and anything that must be exact come from **plain code**, never the model. Incomplete questionnaires get no total. "I don't know" is unknown, never "no".
- Nothing clinical reaches a caregiver until the clinician approves the **exact** text.
- The AI is checked, not trusted: GLM-5.3 ignored instructions for every important rule in testing, so each rule has a code-level guard (forced first-step tool call, latest-message quote required for updates, save-claim and reminder-claim regeneration, repeat-word check). Add a code guard, not just a prompt line, for new rules.
- Questionnaire wording is copyrighted and the repo is public: wording lives only in git-ignored `data/instruments/*.local.json` (templates in `docs/instruments/`). ZBI here is items 1–12 of the 22-item form, not the validated ZBI-12.
- Never read or print `.env`. Never commit `data/` or real phone numbers.

## Working in the repo

- Use the Ubuntu (WSL) terminal in `~/lucidity`, not PowerShell.
- `npm test` (114 tests, mock model), `npm run typecheck`, `npm run llm:check` (real model, no iMessage), `npm run dev` (bot; ~30s to connect), `npm run demo:seed -- --caregiver +1…` (synthetic September history; `--full` also seeds October and blocks a live NPI-Q for 28 days).
- Stop the bot before deleting/editing `data/lucidity.json` (it rewrites the file from memory).
- Photon Free/Pro: proactive texts only reach numbers registered under Users; each person texts their own assigned line.
- `LLM_REASONING_EFFORT` must stay `low` for GLM (default thinking caused random 60s+ timeouts).
- When testing AI behavior changes, run the real model several times on the exact failing input; its behavior varies run to run.
- Work on a branch per change, push, and let the user merge (that's been the workflow).
- When writing scenarios or explanations for the user: use role names ("the caregiver", "the clinician"), no pronouns, and concrete step-by-step examples with real messages.
