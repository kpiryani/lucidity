# Lucidity: Project Journal

Everything from building Lucidity at HackNC 2026 (October 10–11, 2026) that isn't obvious from the code: what was built in what order, the decisions and why, what broke and how it was fixed, setup lessons, the demo and pitch, and the plan for after the hackathon.

Companion docs: [CONTEXT.md](CONTEXT.md) (why + design rules + what's next) and [HOW_IT_WORKS.md](HOW_IT_WORKS.md) (how the code works, demo script, gotchas). This journal doesn't repeat those; it records the story and the reasoning.

---

## 1. Build timeline

Every phase was built on its own branch, tested on real phones, then merged by PR.

| PR | Branch | What it added |
|---|---|---|
| #1 | `phase-1-rule-checks` | Keyword safety rules on every text: emergency → "call 911", urgent → "call your doctor today", alerts to a care-team phone. 29 test cases |
| #2, #4 | `lucidity-req` | Teammate's requirement documents (Connect, emergencies, Care, profile, AI reporting) and a synthetic demo fixture. Later condensed (PR #9) |
| #3 | `phase-2-ai-integration` | The AI conversation: GLM-5.3 via OpenCode + Vercel AI SDK, structured tools, JSON storage, 10-second burst grouping, STOP/START, `npm run llm:check`, and many code guardrails added after live testing |
| #5 | `phase-3-questionnaire` | NPI-Q then ZBI (items 1–12): cue-based offers, word-for-word questions, casual-answer interpreter, code scoring, results consent. Generalized into an instrument registry |
| #6 | `phase-4-reminders` | Reminders over iMessage (time zones, repeats, holds on STOP/emergency), then recurring check-in reminders offered after a first check-in |
| #7 | `phase-5-close-the-loop` | Intelligence profile (code), Care commands from a clinician phone, approval gate, delivery to the caregiver, reply forwarding, `npm run demo:seed`. Then natural clinician phrases instead of all-caps commands |
| #8 | `phase-6-polish` | Fixed text after AI urgent flags, YES/NO number nudge, AI-drafted caregiver wording from clinician notes, README refresh, AI-written first-time welcome ("What can I do for you today?") |
| #9 | `docs-cleanup` | 13 docs condensed into CONTEXT.md + HOW_IT_WORKS.md; README formatting restored |

Final state: the full loop (Connect → Intelligence → Care → Connect) runs over iMessage with two phones; 114 automated tests.

## 2. Key decisions and why

| Decision | Why |
|---|---|
| **Free-form chat, not scripted forms** | The requirement docs described one-question-at-a-time scripted flows. The product vision was a caregiver talking naturally to an AI, so the specs were used as **benchmarks** (rules to test against), not as the conversation design |
| **Two modes: chat + questionnaire handoff** | Validated questionnaires need exact wording and code scoring, which free chat can't guarantee. Like a website chatbot handing you to a specialist: the AI chats, a check-in takes over word for word, then hands back |
| **GLM-5.3 via OpenCode** | The team had an OpenCode Go key. Photon provides no AI, so a model was needed. The Vercel AI SDK + OpenAI-compatible provider means switching models is three `.env` values |
| **Reasoning effort "low"** | GLM's default hidden thinking made replies take 7s to over 60s at random (timeouts). Low brought it to about 2–8s with no quality loss in testing |
| **Plain code for anything that must be exact** | Safety wording, scores, reminder times, what gets saved. The AI only handles conversation and wording, and its output is checked |
| **JSON file storage** | One phone, 24 hours, no external service. Kept behind the `Store` interface so a database can replace it |
| **Question wording git-ignored** | The repo is public and the instruments are copyrighted. The PDFs and wording files stay local in `data/`; templates are committed |
| **ZBI items 1–12, labeled as such** | The team's PDF was the 22-item ZBI. Items 1–12 aren't the validated ZBI-12 (a different selection), so the score is reported as a raw 0–48 with no burden categories |
| **One patient per caregiver** | Simplest, and avoids the Dad/Mom mix-ups seen in testing (records have no patient field yet) |
| **Clinician over iMessage, not a dashboard** | Built in hours with existing pieces, and two phones side by side tells the story on camera. A dashboard is the long-term plan |
| **Clinician phone instead of terminal console** | A teammate's phone was chosen (a terminal chat UI was the fallback). It needed registering in Photon first |
| **Natural phrases for the clinician** | All-caps commands felt awkward. Phrase matching by rules (not AI) keeps it predictable; sending still needs explicit approval |
| **AI drafts, clinician approves** | Clinicians write clinical notes; families need warm plain words. The AI rewrites, code checks it, the clinician sees both and approves |
| **AI-written welcome with checks** | Variety each time, but code verifies it mentions the care team, reminders, STOP, and ends with an offer to help; fixed fallback otherwise |
| **Seed September only for the demo** | Then the live check-in becomes "October" and the profile comparison is real. `--full` seeds October too, which blocks a live check-in for 28 days |

## 3. What broke in testing, and the fix

Most of these were found by texting the bot from a real phone and reading `data/lucidity.json`.

| What happened | Fix (code, not just instructions) |
|---|---|
| Replies timed out at random | `reasoning_effort: low`; 90s turn budget; honest failure message instead of "Thanks, I've noted that" |
| OpenCode rejected requests: "missing x-opencode-session" | Every request sends a hashed session header |
| AI said "I've updated that to a 3" but saved nothing | If a reply claims a save and nothing was saved, regenerate; second time, send a fixed clarifying question |
| AI changed a score the caregiver never confirmed (2 → 3 on an unrelated message) | Update tools require the caregiver's words from their **latest** message |
| "Skip" declined two unrelated records | At most one decline per message |
| AI said "I flagged this for her care team" when no one was notified | Escalation tool tells the AI whether anyone was really notified |
| Hobbies never saved | First step must call a tool (save something or `no_record_needed`) |
| Same hobby saved twice | Not fixed yet (needs `update_note`) |
| AI wrote its own medical advice after an urgent flag | After an AI escalation, only fixed text is sent |
| AI invited a check-in without calling the offer tool, so YES went nowhere | Code records the offer when the reply invites one; code-level cue detection tells the AI when to offer |
| "3" typed on a YES/NO question counted as unclear | A number on a YES/NO question gets "This one is YES or NO first" |
| "Remind me at 8pm" saved as daily | Repeats only allowed if the caregiver said "every", "daily", etc. |
| AI promised reminders it didn't schedule | Same regenerate-then-fixed-question safety net |
| Changing a check-in reminder's time lost its link | `change_reminder_time` tool keeps repeat and purpose |
| `RESUME` collided with START for STOP/START | RESUME reserved for check-ins |
| Typing bubble showed with no reply after a safety message | No typing bubble when the AI only records in the background |
| Reminder timer could start before questionnaire wording loaded | Timer starts after loading |
| Lucidity explained causes ("the wallet fear is about feeling unsafe"), didn't ask about distress after severity | Noted as prompt polish, not fixed |

**Lesson:** with GLM, an instruction alone was never enough for anything that mattered. Every important rule needed a code check.

## 4. Setup and environment lessons

- **Use the Ubuntu (WSL) terminal, never PowerShell.** PowerShell on a `\\wsl.localhost\...` path fails with `'tsx' is not recognized`.
- **Photon:** each person in the project gets their own assigned iMessage line (the  number next to them under **Users** in the dashboard), and texts that line. On Free/Pro plans, Lucidity can only text someone **first** (reminders, alerts, clinician messages) if they're registered under **Users**. A new user took a few minutes to start working ("Target not allowed for this project" until then). If it persists, Photon's debug bot (debug.photon.codes) reports the exact handle Apple uses.
- Photon's background `profile-sync … ETIMEDOUT` log lines are harmless.
- **Resetting data:** stop the bot first. It rewrites `data/lucidity.json` from memory, so deleting it while running does nothing.
- `npm run dev` restarts on code changes, but not on `.env` changes.
- The bot takes about 30 seconds to connect at startup.
- The model connection is checked without iMessage by `npm run llm:check`.

## 5. Testing approach

- **Automated:** 114 tests with a mock model (`npm test`), covering safety rules, tool guardrails, questionnaire scoring and flow, reminders and time zones, the care loop, and the welcome.
- **Live:** scripted scenarios texted from a real phone, checking both the replies and `data/lucidity.json`. Scenarios covered small talk, bursts, symptoms without scores, follow-ups and corrections, lucid moments with skip, AI vs. rules safety, hobbies, STOP/START, check-ins, reminders, and the two-phone care loop.
- **Before committing AI changes:** run the real model several times on the exact failing message (GLM's behavior varies run to run).
- **Not done:** the research team's 48 labeled evaluation cases haven't been run against the model.

## 6. Demo and video

**The two-phone scenario** is in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#demo): welcome → anxiety report → cue → NPI-Q → results and recurring reminder → meds reminder → clinician profile → "ask 1" → reply → "tell them: …" (AI-drafted) → approve → "yes" → "he fell and hit his head".

**Video plan (about 2:30):** two phones side by side, labeled CAREGIVER and SIMULATED CLINICIAN.

| Time | Beat | Voiceover idea |
|---|---|---|
| 0:00 | Hook: one text bubble, "dad is so anxious tonight…" | "It's 9pm. The caregiver is exhausted, and the next appointment is three weeks away." |
| 0:15 | Problem | "Decisions happen in a 15-minute visit, based on what a tired caregiver remembers." |
| 0:30 | Reveal | "So we built Lucidity. You just text." |
| 0:35 | Connect | Safety first, one question at a time, saved in the caregiver's words |
| 0:55 | Check-in montage | The NPI-Q, word for word; casual answers; scored by code |
| 1:15 | Profile on the clinician phone | Sept → Oct changes with the caregiver's words |
| 1:35 | Approval gate (the money shot) | Clinical note → warm wording → "looks good" → arrives on the caregiver phone |
| 1:55 | Safety | "he fell and hit his head" → instant 911 text + clinician alert |
| 2:10 | Reminder arrives | "It even remembers so the caregiver doesn't have to." |
| 2:20 | Trust + close | "Safety rules before AI · Scores by code · Clinician approves every message. Synthetic data, simulated clinician, real loop." |

**Recording tips:** set `BURST_WINDOW_MS=3000` for snappier replies; record each section separately with iPhone screen recording, then cut out every wait; big captions; set the reminder early so it arrives mid-recording; record the voiceover last.

**Intelligence in the demo** has no screen of its own. Show it through its outputs: the check-in offer, code-computed scores, the profile, suggested questions, and drafted wording. For a stronger beat, show `data/lucidity.json` next to the profile ("Connect saves everything; Intelligence turns it into one page").

## 7. Pitch materials

**One-line description (184 characters):**
> Lucidity is an iMessage companion for Alzheimer's and dementia caregivers. They text behavior changes or emergencies, and the agent records them, runs clinical check-ins, and responds.

**Devpost write-up** (written to sound human, not generated):

- **Inspiration:** Caring for someone with Alzheimer's or dementia is exhausting, and most of it happens at home. At the appointment, the caregiver is asked "how has he been this month?" and has to remember when the agitation started, how many nights he was up, what set it off. Caregivers don't have time for another app, but they're already texting all day.
- **What it does:** You text Lucidity what's going on, the way you'd tell a friend. It writes back like a person and saves what you said as something a doctor can use. Emergencies get pre-written "call 911" guidance immediately. When it notices a pattern, it offers a short clinical check-in (the NPI-Q or the Zarit Burden Interview), asked word for word, and you can answer however you want. It reminds you about meds and appointments. On the other side, a clinician texts "how is he doing?" and gets a one-page summary, asks follow-up questions, and approves advice that Lucidity turns into warm, plain words for the family. It also captures the good moments, like sudden clarity in advanced dementia.
- **How we built it:** Photon Spectrum runs Lucidity over iMessage, so there's nothing to download. TypeScript on Node, an AI model (GLM-5.3) that calls "tools" to save structured records, and plain code for anything that must be exactly right: safety, scores, reminders, and what gets sent.
- **Challenges:** The AI would confidently say it saved something it hadn't, or change a score nobody confirmed. Telling it to stop wasn't enough; we added checks in the code. Random timeouts came from the model "thinking" too long. And we had to make a friendly chatbot and a strict clinical questionnaire live in one conversation, which we solved with a handoff.
- **Accomplishments:** Safety comes first on every message, and the AI never writes emergency instructions. The data is honest: "I don't know" stays unknown, corrections keep history, incomplete check-ins get no made-up total. And the whole loop, from caregiver to clinician and back, actually works over text.
- **What we learned:** AI is great at conversation and bad at being trusted with facts on its own. Clinical tools come with real rules: copyright on wording, unknown ≠ no, a screening score is not a diagnosis.
- **What's next:** a clinician dashboard, running 24/7 on a server, more questionnaires (AD8, the full Zarit), a proper patient profile, Spanish, and clinical and privacy review before real use.

**Built with:** TypeScript, Node.js, Photon, iMessage, GLM, OpenCode, Vercel AI SDK, Zod.

**The simple explanation** (for anyone): Connect = Lucidity talks with the family by text. Intelligence = it turns those texts into one simple report. Care = a doctor reads it and decides what advice to send back. Emergencies = "call 911" right away, and the doctor is alerted. (Hospital analogy: Connect is the phone line to the family, Intelligence is the nurse preparing the chart, Care is the doctor.)

The README has the GitHub-ready versions: the "What Lucidity solves" quote, the centered three-layer table, and the mermaid flowchart.

## 8. After the hackathon: a plan

Lucidity didn't win, but the problem is real (about 11 million Americans care for someone with dementia, and Medicare's GUIDE program now pays for dementia caregiver support). The next step is learning, not building.

**Weeks 1–2: problem discovery** (about 15 hours around a 9-5)

- **Goal:** find out if the pain is real and which pain matters most. Targets: 8–12 caregiver conversations, 2–3 clinicians or care navigators, 2–3 caregivers willing to try a hands-on test.
- **Write assumptions first**, each with what would prove it wrong. For example: caregivers struggle to recall details at visits; they already track things somehow; texting is the easiest way to log; a one-page visit summary would get used; reminders are a daily burden; caregivers want help with their own stress.
- **Interview about past experience, never pitch the idea.** Key questions:
  - "Tell me about the last doctor's appointment. What was hard?"
  - "How did you remember what to tell the doctor?"
  - "Do you keep track of things now? Can you show me?"
  - "What have you tried? Why did you stop?"
  - "If you could fix one thing, what would it be?"
  - "Who else should I talk to?"
- **Notes after each call:** relationship and stage (no names), pains in their exact words, current workarounds, tools tried, which assumptions it supports or contradicts, willingness to try something.
- **Where to find people:** your own network first; Alzheimer's Association chapters and support groups (facilitators are great to talk to); r/dementia, r/AgingParents and Facebook caregiver groups (read the rules, post as a learner); adult day centers and memory care facilities; GUIDE program organizations (CMS lists participants).
- **Outreach message (network):** "I'm working on a side project to help people caring for family members with dementia. Do you know anyone who'd be open to a 20-minute chat? I just want to learn what it's like. Not selling anything."
- **Clinician questions:** what do you wish you knew between visits; how do families reach you now; would you read a one-page summary a caregiver brings; what would make you trust it.
- **Decide with criteria set in advance:** strong = appointment-recall pain raised unprompted by 6+ of 10, 4+ already tracking something, 3+ willing to try, clinicians would read a summary. Mixed → follow the strongest pain heard. Weak → stop, having spent 15 hours instead of months.

**The bigger path:**

| Phase | When | Question |
|---|---|---|
| A. Problem discovery | Weeks 1–2 | Is the pain real? Which one matters most? |
| B. Hands-on test, no new code | Weeks 3–5 | Caregivers text a number; you reply by hand, send reminders, and write a one-page visit summary. Did they bring it? Did the doctor look? Would they be disappointed if it stopped? |
| C. Caregiver-only app, built safely | Months 2–4 | Reuse the code (reminders, logging, safety) plus "prep my visit", with no clinician side. Needs hosting, a real database, encryption, consent, a privacy policy, and advice on the FTC Health Breach Notification Rule (and HIPAA once working with clinics) |
| D. Clinic pilot | Months 4–9 | One clinic or GUIDE program, the approval loop, and who pays |

**Ground rules:** don't put real caregiver data into the current prototype (laptop + JSON file); no medical advice (point emergencies to 911); be kind with exhausted people's time; time-box each phase and protect your energy.

## 9. Team

- **Krish Piryani:** built the app (code, architecture, iMessage integration, AI, testing).
- **Emery Meyer:** framed the problem and guided the logic, clinical design and requirements.
