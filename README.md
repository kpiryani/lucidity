# Lucidity

**Connected dementia care, delivered over iMessage.**

Lucidity keeps the patient, the family caregiver, and the care team connected between clinic visits. Caregivers text what they notice, as it happens. Lucidity turns those messages into a structured, clinically grounded record — NPI-Q symptom trends, caregiver strain, and a log of paradoxical lucidity episodes — and sends clinician-approved guidance back to the family.

> Built at HackNC 2026.

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
| **1. Connect** | Make participation effortless for caregivers | ✅ Core |
| **2. Intelligence** | Turn messages into structured, linked understanding | 🟡 Minimal version core; full version stretch |
| **3. Care** | Give clinicians a clear view and a way to respond | ✅ Core |

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
Caregiver (iMessage)
        │
        ▼
Photon Spectrum (spectrum-ts)  ── iMessage delivery layer        [Connect]
        │
        ▼
Lucidity agent server (TypeScript / Node)
   ├─ Safety triage (rules + LLM)                                 [Connect]
   ├─ LLM with structured tool calls                              [Intelligence]
   │    ├─ log_npi_observation(domain, severity, distress, quote, timestamp)
   │    ├─ log_lucidity_episode(duration, triggers, what_was_said, after_state, timestamp)
   │    ├─ escalate_urgent(reason)
   │    └─ log_general(text)
   ├─ Per-user conversation state (for follow-ups)
   └─ Trend aggregation + missing-info rules + weekly summary     [Intelligence]
        │
        ▼
Database (observations, lucidity episodes, alerts, care instructions)
        │
        ▼
Clinician dashboard + "send guidance" back to caregiver           [Care]
```

### Tech stack
| Layer | Tool |
|---|---|
| Messaging | [Photon Spectrum](https://docs.photon.codes) (`spectrum-ts`, cloud iMessage) |
| Runtime | Node.js 22+, TypeScript, `tsx` |
| Agent | LLM with structured tool calling |
| Storage | TBD (e.g. Supabase / Postgres) |
| Dashboard | TBD (e.g. Next.js) |

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

Create a `.env` file in the project root with your Photon project credentials (ask a teammate for the variable names / values — **never commit this file**).

### Run
```bash
npm run dev     # auto-restarts on save
# or
npm run start
```

You should see:
```
[spectrum.lifecycle] INFO Spectrum started { ... providers: 'imessage' ... }
```
Then text the project's iMessage number from your phone to test the loop.

### Troubleshooting
| Error | Fix |
|---|---|
| `Cloud iMessage requires projectId and projectSecret` | `.env` isn't being loaded. Make sure scripts use `tsx --env-file=.env ...` and `.env` exists in the project root. |
| `tsx: not found` | You're in a folder where `npm install` hasn't run (check your path). |
| `spawn npx ENOENT` | You're on native Windows. Use WSL. |
| `Password authentication is not supported` on push | Use `gh auth login` or a GitHub personal access token. |

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
