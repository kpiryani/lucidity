import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { triage, triageReply, type TriageResult } from "./triage.ts";
// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    // imessage
    imessage.config(),
  ],
});

// Optional on-call care-team number (E.164, e.g. +15551234567). On Free/Pro
// shared lines it must be registered as a project user in the Photon
// dashboard, or proactive sends fail with "Target not allowed".
const CARE_TEAM_PHONE = process.env.CARE_TEAM_PHONE?.trim() || undefined;

// Until the dashboard exists, alerts go to the server log and, if configured,
// a text to the care team. Returns whether a human was actually notified.
async function alertCareTeam(
  from: string,
  text: string,
  result: TriageResult,
): Promise<boolean> {
  console.warn(
    "[lucidity.alert]",
    JSON.stringify({
      level: result.level,
      categories: result.matches.map((m) => m.category),
      from,
      text,
      at: new Date().toISOString(),
    }),
  );

  if (!CARE_TEAM_PHONE) return false;
  try {
    const im = imessage(app);
    const space = await im.space.create(await im.user(CARE_TEAM_PHONE));
    const categories = result.matches.map((m) => m.category).join(", ");
    await space.send(
      `Lucidity ${result.level.toUpperCase()} alert (${categories}) from caregiver ${from}:\n\n"${text}"`,
    );
    return true;
  } catch (err) {
    console.error("[lucidity.alert] failed to text care team", err);
    return false;
  }
}

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  // Skip our own sends echoed back through the stream.
  if (message.direction === "outbound") continue;
  if (message.content.type !== "text") continue;

  const from = message.sender?.id ?? "unknown";
  const text = message.content.text;

  try {
    // Safety triage runs first, on every message, before any LLM.
    const result = triage(text);
    if (result) {
      // Tell the caregiver what to do before anything else can fail.
      await space.send(triageReply(result));
      if (await alertCareTeam(from, text, result)) {
        await space.send("I've also alerted your care team.");
      }
      continue;
    }

    // Placeholder for the Intelligence layer (LLM + structured logging).
    await space.responding(async () => {
      await message.react("👍");
      await space.send("Thanks, I've noted that.");
    });
  } catch (err) {
    console.error("[lucidity] failed to handle message", { from, err });
  }
}
