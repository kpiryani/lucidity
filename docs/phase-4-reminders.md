# Phase 4 — Reminders

Branch `phase-4-reminders`. Caregivers can ask Lucidity to remind them about anything (meds, meals, appointments, routines), and Lucidity texts them at that time over iMessage.

> "remind me to give dad his meds at 8pm" → "Got it — I'll remind you to give Dad his meds today at 8:00 PM. Want that every day, or just today?" → at 8:00 PM: **"Reminder: give Dad his meds"**

## How it works

```
caregiver text ─▶ AI calls set_reminder(what, time "20:00", date?, repeat)
                    └▶ code converts to the caregiver's time zone, saves it,
                       returns the exact time ("every day at 8:00 PM") for the AI to confirm
timer (every 20s) ─▶ due reminders ─▶ Spectrum sends "Reminder: …" ─▶ next repeat scheduled
```

- **Spectrum** sends messages without the caregiver texting first (`im.space.create` → `space.send`). Verified on our Photon plan on 2026-10-11. Lucidity reuses the latest conversation, or opens the DM after a restart.
- **Scheduling is ours:** a 20-second timer in the bot (`startReminderLoop` in `src/reminders.ts`).
- **Time zones:** `LUCIDITY_TIMEZONE` in `.env` (default `America/New_York`). The AI gives a local clock time; code does the conversion (daylight-saving safe) and formats the confirmation, so the time the caregiver reads is computed, not generated.
- **Repeats:** `none`, `daily`, `weekly`. A repeat is only allowed if the caregiver's message says so ("every", "daily", "each night"…); otherwise it's one-time and the AI asks "just today, or every day?".
- **Listing / changing / cancelling:** the AI sees scheduled reminders (with ids) in its context. "What reminders do I have?", "cancel the breakfast one", "make it 9pm" (cancels and replaces, never duplicates).

## Safety and consent rules

- **STOP** silences reminders (held, not deleted); **START** turns them back on.
- **Emergencies** (keyword rules or AI escalation) hold routine reminders for 1 hour (`LUCIDITY_CONNECT_EMERGENCIES.md` EM6).
- A reminder the caregiver asked for at a specific time is consent, so it's sent at that time even in quiet hours.
- Vague times ("tonight", "after lunch") → the AI asks for an exact time.
- Code safety net: if the AI says "I'll remind you…" without a reminder actually being scheduled, it's corrected; it never promises a reminder that doesn't exist.
- Reminders are only what the caregiver asked for; the AI never suggests medication doses or timing.
- Sent reminders are added to the chat history so the AI knows about them.

## Limits

- **The bot must be running at the reminder time.** If it's off (laptop asleep), the reminder is sent when the bot next starts, marked "(this was due …)". A real deployment needs an always-on server.
- Failed sends retry up to 3 times, then the reminder is marked `failed`.
- One time zone per caregiver (`timeZone` on the caregiver, defaulting to `LUCIDITY_TIMEZONE`); there's no "set my time zone" command yet.

## Stored data (`data/lucidity.json` → `reminders`)

`id`, `caregiver`, `what`, `dueAt` (UTC, next send), `timeZone`, `repeat`, `status` (`scheduled` / `sent` / `cancelled` / `failed`), `quote` (the caregiver's words), `createdAt`, `lastSentAt`, `cancelledAt`, `attempts`.

## Files

| File | What |
|---|---|
| `src/reminders.ts` | Time-zone math, scheduling, repeats, delivery, the timer |
| `src/agent.ts` | `set_reminder` / `cancel_reminder` tools, repeat guard, "promised but not scheduled" safety net |
| `src/prompt.ts` | Reminder rules for the AI |
| `src/index.ts` | Starts the timer, sends via Spectrum, holds reminders on STOP/emergencies |
| `src/reminders.test.ts` | Time zones/DST, scheduling, repeats, STOP/emergency holds, late delivery, retries, AI tools |

## Manual test (iMessage)

Start the bot (`npm run dev`) and wait for `[lucidity] Reminders running (time zone: …)`. Times below should be a few minutes in the future.

1. `remind me to drink water at <a time 3 minutes from now>` → confirms the exact time, may ask "just today or every day?". At that time: **"Reminder: drink water"**.
2. `remind me to give dad his meds every day at 8pm` → "every day at 8:00 PM".
3. `remind me later tonight to call my sister` → asks for an exact time.
4. `what reminders do I have?` → lists them.
5. `actually make the meds one 9pm` → one reminder at 9:00 PM, no duplicate.
6. `cancel the meds reminder` → cancelled.
7. Set one for 2 minutes out, text `STOP` → it is not sent; text `START` → it is sent on the next check.
8. Check `data/lucidity.json` → `reminders`.
