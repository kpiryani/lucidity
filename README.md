# Lucidity

**Connected dementia care, delivered over iMessage.**

Lucidity keeps the patient, the family caregiver, and the care team connected between clinic visits. Caregivers text what they notice, as it happens. Lucidity turns those messages into a structured, clinically grounded record — NPI-Q symptom trends, caregiver strain, and a log of paradoxical lucidity episodes — and sends clinician-approved guidance back to the family.

> Built at HackNC 2026.

---

## What's built

The whole loop runs over iMessage today, with two phones: the caregiver's and a clinician's (labeled **"Simulated clinician"** in the demo).

```
Caregiver texts ──▶ CONNECT ──▶ INTELLIGENCE ──▶ CARE ──▶ CONNECT ──▶ Caregiver
                    safety first,  profile compiled  clinician reads,   delivers the
                    follow-ups,    by code: changes,  asks, approves     approved text,
                    check-ins,     quotes, suggested  the exact wording  saves the reply
                    reminders      questions, drafts
```

| | What works | Docs |
|---|---|---|
| **Safety** | Every text checked by fixed rules before any AI; fixed 911 / doctor / 988 guidance; AI can flag what rules miss (still fixed wording); clinician alerted | `src/triage.ts` |
| **Conversation** | Caregivers text naturally; the AI (GLM-5.3) saves observations with their exact words, asks one follow-up at a time, captures lucid moments; code guardrails stop it from claiming saves it didn't make or changing records unasked | [Phase 2](docs/phase-2-test-scenarios.md) |
| **Clinical check-ins** | When patterns appear, Lucidity offers the **NPI-Q** (behavior) or **Zarit Burden Interview** items 1–12 (caregiver strain), hands off to word-for-word questions, understands casual answers, scores **in code** | [Phase 3](docs/phase-3-questionnaire.md) |
| **Reminders** | "Remind me to give Dad his meds at 8pm" → texted at 8pm; daily/weekly; recurring check-in reminders after a first check-in | [Phase 4](docs/phase-4-reminders.md) |
| **Care loop** | Clinician texts "how is he doing?" → one-page profile (Sept vs Oct changes, caregiver's words, suggested questions); "tell them: …" → Lucidity drafts caregiver-friendly wording → clinician approves → delivered; reply forwarded back | [Phase 5](docs/phase-5-close-the-loop.md) |

**Simulated in the demo:** the clinician is a teammate; Jonathan's September/October history is synthetic (`npm run demo:seed`); data lives in a local JSON file. Nothing reaches a caregiver without clinician approval, and all demo data is synthetic.

---

## The problem

- Dementia care happens at home, but decisions happen in short clinic visits. By the time the appointment comes, caregivers have forgotten details: *when* the agitation started, *how often* Dad was up at night, *what* triggered it.
- Clinicians rely on caregiver recall, which is incomplete and biased by stress and time.
- Communication mostly flows one way. Guidance from the visit rarely turns into structured follow-up at home.
- **Paradoxical lucidity** — sudden, unexpected moments of clarity in people with advanced dementia — is one of the least understood phenomena in dementia care. Almost everything known about it comes from caregivers recalling episodes weeks, months, or years later.
- Caregivers are overloaded. They won't download and learn another app, but they already text all day.

**Why text messaging?** Prior research supports it as a channel for dementia caregivers. CuidaTEXT, a bilingual two-way SMS intervention, was tested in a one-arm feasibility trial with 24 Latino family caregivers and showed high feasibility, acceptability, and preliminary efficacy ([Perales-Puchalt et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC10119327)). That study does not validate Lucidity itself; it supports the channel.

---

## The three pillars

Lucidity is organized into three pillars. The system runs in **both directions**: caregiver observations inform clinical care, and clinician-approved plans shape future check-ins and support.

```
        ┌──────────────────────┐
        │   Lucidity Connect   │  Caregiver & patient experience (iMessage)
        └──────────┬───────────┘
          observations ▲  │ approved guidance,
                       │  ▼ reminders, check-ins
        ┌──────────────────────┐
        │ Lucidity Intelligence│  Structuring, trends, gaps, reports
        └──────────┬───────────┘
            reports ▲  │ recommendations
                       │  ▼
        ┌──────────────────────┐
        │    Lucidity Care     │  Clinician & care-team experience
        └──────────────────────┘
```

| Pillar | Role | Hackathon status |
|---|---|---|
| **1. Connect** | Make participation effortless for caregivers | ✅ Built: safety, conversation, check-ins, reminders, delivery |
| **2. Intelligence** | Turn messages into structured, linked understanding | ✅ Built (minimal): code-scored check-ins, profile with changes over time, suggested questions, drafted wording |
| **3. Care** | Give clinicians a clear view and a way to respond | ✅ Built over iMessage (clinician phone); web dashboard is future work |

---

### 1. Lucidity Connect — make participation effortless

The caregiver and patient experience. Text messaging via Photon is the default; no app to install.

**Built for the hackathon:**
- **Free-text behavioral observations** — caregivers text naturally (*"Dad was up pacing all night again"*), anytime.
- **NPI-Q follow-ups** — when an observation maps to an NPI-Q domain, the agent asks for missing severity (1–3) and caregiver distress (0–5).
- **Paradoxical lucidity capture** — when a message suggests a possible lucid episode, the agent offers a short, optional follow-up (3–4 questions max): how long it lasted, what was happening right before (time of day, visitors, music, environment), what they said or did, and how they were afterward. It also offers gentle guidance and support.
- **Safety triage** — urgent signals (falls, sudden confusion, stroke signs, risk of harm) bypass normal logging. The caregiver is told to call 911 or their doctor immediately and the care team is alerted. Uses rule-based checks plus the LLM, never the LLM alone.
- **Care-plan reminders** — clinician-approved instructions delivered back as plain-English texts on a schedule.

**Stretch / future:**

| Experience | Frequency | Who |
|---|---|---|
| Caregiver wellness check-in (ZBI-inspired, 1–2 questions at a time) | Weekly, at a chosen time | Caregiver |
| Functional check-ins (FAQ-inspired) | Periodically | Caregiver |
| Patient cognitive assessment | Only when requested by a clinician | Patient |
| Cognitive games and activities | Optional | Patient |

> Patient-facing assessments and activities need a visual interface and careful clinical design. They are out of scope for the 24-hour build.

---

### 2. Lucidity Intelligence — connect the dots

The understanding layer between caregivers and clinicians.

**Minimal version (core):** deterministic and verifiable.
- Classify each message into an NPI-Q domain, lucidity episode, urgent, or general, using structured tool calls.
- Aggregate scores over time into per-domain trends.
- Flag **missing information** with simple rules (e.g. *agitation reported 3× this week, no severity recorded*; *no check-in in 10 days*).
- Generate a weekly summary that **describes** what changed and **cites the underlying messages**.

**Full version (stretch):**
- Evidence-linked timeline across NPI-Q, ZBI-inspired, and FAQ-inspired signals.
- Highlight discrepancies between reports.
- Track recommended interventions and whether they were completed.

**Accuracy guardrails:**
- The engine **describes co-occurrence, never causation.** It says *"caregiver strain rose during the same weeks nighttime behaviors increased,"* not *"the patient's decline is causing caregiver burnout."*
- Every statement in a report links back to the source messages.
- Different instruments use different scales and are never combined into a single score.
- All output is a **draft for clinician review.**

*Illustrative example (synthetic data):* if caregiver strain, NPI-Q severity, and functional difficulty all rise over the same weeks, the report surfaces the overlap and prompts the clinician to review timing, possible medical contributors, and the caregiver's available support. It does not draw the conclusion itself.

---

### 3. Lucidity Care — human clinical oversight

The physician and care-team experience. This is what makes Lucidity a bridge rather than a logbook.

**Built for the hackathon:**
- **Dashboard** — NPI-Q domain trends, paradoxical lucidity timeline with possible triggers, urgent alert feed.
- **Report export** — "pre-filled NPI-Q — clinician to verify."
- **Send guidance back** — clinician writes or approves care instructions, which Lucidity delivers to the caregiver as plain-English texts and reminders.

**Design principle:** not every check-in needs a physician. Lucidity prepares organized information for periodic review and escalates only urgent concerns. This matches the structure of Medicare's [GUIDE dementia care model](https://www.cms.gov/priorities/innovation/innovation-models/guide), which pairs people with dementia and their caregivers with care navigators, coordinated care, and caregiver support.

---

## What Lucidity is *not*

- ❌ **Not a diagnostic tool.** It never diagnoses Alzheimer's or estimates disease risk.
- ❌ **Not a predictor of lucid episodes.** There is no evidence base for predicting or inducing paradoxical lucidity, and we don't claim one.
- ❌ **Not a causal reasoning engine.** Intelligence reports patterns; clinicians interpret them.
- ❌ **Not a replacement for clinical judgment.** All structured output is a draft for a clinician to review.
- ❌ **Not handling real patient data during the hackathon.** All demo data is synthetic.

---

## Architecture

```
Caregiver's iPhone            Clinician's iPhone ("Simulated clinician")
        │  iMessage                    │  iMessage
        ▼                              ▼
Photon Spectrum (spectrum-ts, cloud iMessage lines)
        │
        ▼
Lucidity server (TypeScript / Node, one process)  — src/index.ts routes by sender
   ├─ Safety triage: fixed rules first, every message           [Connect]   src/triage.ts
   ├─ STOP / START, burst grouping (10s)                         [Connect]
   ├─ Check-in mode: verbatim NPI-Q / ZBI, code scoring          [Connect + Intelligence]  src/questionnaire.ts, src/instruments/
   ├─ AI conversation: GLM-5.3 + validated tool calls            [Connect]   src/agent.ts, src/prompt.ts
   │    log_npi_observation · update_observation · log_lucidity_episode · log_general
   │    escalate_urgent · offer_questionnaire · set/change/cancel_reminder · no_record_needed
   ├─ Reminder timer (time zones, repeats)                       [Connect]   src/reminders.ts
   ├─ Profile + suggested questions (code) · message drafting (AI) [Intelligence]  src/profile.ts, src/drafting.ts
   └─ Clinician commands, approval gate, reply forwarding        [Care]      src/care.ts
        │
        ▼
data/lucidity.json (git-ignored): history, observations, lucidity episodes, notes,
alerts, assessments, reminders, care messages
```

### Tech stack
| Layer | Tool |
|---|---|
| Messaging | [Photon Spectrum](https://docs.photon.codes) (`spectrum-ts`, cloud iMessage) |
| Runtime | Node.js 22+, TypeScript, `tsx` |
| AI | GLM-5.3 via OpenCode (any OpenAI-compatible model), [Vercel AI SDK](https://ai-sdk.dev), zod-validated tool calls |
| Scoring, scheduling, profile | Plain TypeScript (deterministic; no model) |
| Storage | Local JSON file (`data/lucidity.json`); a database is future work |
| Clinician UI | iMessage (clinician phone); a web dashboard is future work |
| Tests | `node:test`, 111 tests with a mock model (no API calls) |

---

## Getting started

> **Windows users:** run everything inside **WSL**, not PowerShell. The Spectrum scaffolder fails on native Windows (`spawn npx ENOENT`). Keep the project in your Linux home directory (`~/lucidity`), not under `/mnt/c/...` — the Windows drive is dramatically slower from WSL.

### Prerequisites
- Node.js **22+** (`node -v`; inside WSL, `which node` should be `/usr/bin/node`)
- A Photon project (ID + secret) from [app.photon.codes](https://app.photon.codes)

### Setup
```bash
git clone https://github.com/kpiryani/lucidity.git
cd lucidity
npm install
```

Create your `.env` from the template, in the project root (the same folder as `package.json`):
```bash
cp .env.example .env
```
Then open `.env` and fill in:

| Variable | Value | Required |
|---|---|---|
| `PROJECT_ID`, `PROJECT_SECRET` | Photon project credentials (Photon dashboard) | Yes |
| `LLM_BASE_URL` | `https://opencode.ai/zen/go/v1` (no trailing `/chat/completions`) | For AI |
| `LLM_API_KEY` | Your OpenCode API key, pasted as-is with no quotes or spaces | For AI |
| `LLM_MODEL` | `glm-5.3` (exactly; not `opencode-go/glm-5.3`) | For AI |
| `LLM_REASONING_EFFORT` | Optional. Defaults to `low` (fast replies). `default` uses the model's own setting, which is much slower for GLM-5.3 | No |
| `LUCIDITY_TIMEZONE` | Optional. Time zone for reminders, e.g. `America/Chicago`. Defaults to `America/New_York` | No |
| `CLINICIAN_PHONE` | Optional. The clinician's phone for Lucidity Care (commands + safety alerts). Must be registered under Users in Photon | No |
| `CARE_TEAM_PHONE` | E.164 number that receives alert texts, e.g. `+15551234567` | No |

Example (fake key):
```bash
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_API_KEY=sk-oc-xxxxxxxxxxxxxxxxxxxx
LLM_MODEL=glm-5.3
```
If any `LLM_*` value is missing, the bot still runs with Phase 1 behavior (safety rules + "Thanks, I've noted that."). To switch to another OpenAI-compatible model later, change only these three values. **Never commit `.env`.**

### Check the model connection (no iMessage involved)
```bash
npm run llm:check
```
Sends one test message to the model and confirms it makes a proper tool call. Expect `✓ Tool call OK`.

### Run
```bash
npm run dev     # auto-restarts on save
# or
npm run start
```

You should see:
```
[lucidity] AI enabled: model "glm-5.3" at https://opencode.ai/zen/go/v1 (reasoning effort: low)
[spectrum.lifecycle] INFO Spectrum started { ... providers: 'imessage' ... }
```
Connecting can take up to ~30 seconds. Once both lines appear, text the project's iMessage number from your phone in plain language. The bot must be running for replies to arrive.

Records are saved to `data/lucidity.json` (gitignored). Delete that file to reset all memory.

### Demo (two phones)
Set `CLINICIAN_PHONE` in `.env`, stop the bot, then:
```bash
npm run demo:seed -- --full
```
Start the bot and follow the script in [docs/phase-5-close-the-loop.md](docs/phase-5-close-the-loop.md).

### Tests
```bash
npm test          # safety rules + agent (uses a mock model; no API calls)
npm run typecheck
```

### Troubleshooting
| Error | Fix |
|---|---|
| `Cloud iMessage requires projectId and projectSecret` | `.env` isn't being loaded. Make sure scripts use `tsx --env-file=.env ...` and `.env` exists in the project root. |
| `tsx: not found` | You're in a folder where `npm install` hasn't run (check your path). |
| `spawn npx ENOENT` | You're on native Windows. Use WSL. |
| `Password authentication is not supported` on push | Use `gh auth login` or a GitHub personal access token. |
| `AI disabled (set LLM_BASE_URL, ...)` at startup | One of the `LLM_*` lines is missing or empty in `.env`. |
| `llm:check` says `API error 401` / `403` | `LLM_API_KEY` is wrong or has extra quotes/spaces. |
| `llm:check` says `API error 404` | `LLM_BASE_URL` must end in `/v1`, and `LLM_MODEL` must be exactly `glm-5.3`. |
| `[lucidity.agent] failed` in the log | The model call failed or timed out (90s limit); the caregiver got "Sorry, I'm having trouble replying right now…". `[lucidity.step]` lines show how long each step took. If replies are slow, check `LLM_REASONING_EFFORT` isn't set to `default`. |

---

## Evaluation plan

We validate the Intelligence layer with a hand-labeled test set of ~40 realistic, synthetic caregiver messages (including lucidity and urgent cases), and report:
- NPI-Q domain classification accuracy
- Urgent-message recall (missing an urgent message is the worst failure)
- Whether every summary statement traces back to a source message
- Where the model fails, and why

---

## Clinical & research references

- **NPI-Q:** Kaufer DI, et al. *Validation of the NPI-Q, a brief clinical form of the Neuropsychiatric Inventory.* J Neuropsychiatry Clin Neurosci, 2000.
- **Zarit Burden Interview:** Zarit SH, Reever KE, Bach-Peterson J. *Relatives of the impaired elderly: correlates of feelings of burden.* The Gerontologist, 1980.
- **Functional Activities Questionnaire (FAQ):** Pfeffer RI, et al. *Measurement of functional activities in older adults in the community.* J Gerontol, 1982.
- **Paradoxical lucidity:** Mashour GA, et al. *Paradoxical lucidity: A potential paradigm shift for the neurobiology and treatment of severe dementias.* Alzheimer's & Dementia, 2019.
- **Text messaging for dementia caregivers:** Perales-Puchalt J, et al. *A Text Message Intervention to Support Latino Dementia Family Caregivers (CuidaTEXT): Feasibility Study.* [PMC10119327](https://pmc.ncbi.nlm.nih.gov/articles/PMC10119327)
- **CMS GUIDE Model:** [cms.gov/priorities/innovation/innovation-models/guide](https://www.cms.gov/priorities/innovation/innovation-models/guide)
- **Urgent symptom guidance:** Alzheimer's Association, National Institute on Aging

> **Licensing note:** The NPI-Q, ZBI, and FAQ are established instruments, some of them copyrighted. This hackathon prototype references them for research and demonstration purposes; any production use would require authorized versions and permission from the rights holders.

---

## Privacy & safety

- Demo uses synthetic data only.
- `.env` and secrets are git-ignored — never commit credentials.
- A production version would require explicit caregiver consent, data minimization, a privacy policy, and compliance review (HIPAA where applicable; FTC Health Breach Notification Rule for consumer health apps).

---

## Team

| Name | Role | Pillar |
|---|---|---|
| | | Connect |
| | | Intelligence |
| | | Care |
