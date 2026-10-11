import { test } from "node:test";
import assert from "node:assert/strict";
import { WELCOME_MESSAGES, acceptWelcome, isGreetingOnly } from "./welcome.ts";

test("greetings get only the welcome; real reports continue to the AI", () => {
  for (const t of ["hi", "Hello!", "hey there 👋", "start", "good morning", "test"]) assert.ok(isGreetingOnly(t), t);
  for (const t of ["hi, dad was up all night", "my mom keeps forgetting my name", "help"]) assert.ok(!isGreetingOnly(t), t);
});

test("welcome is two short, warm messages that mention STOP and ask how to help", () => {
  assert.equal(WELCOME_MESSAGES.length, 2);
  assert.match(WELCOME_MESSAGES[0]!, /^Hi, I'm Lucidity/);
  assert.match(WELCOME_MESSAGES[1]!, /STOP/);
  assert.match(WELCOME_MESSAGES[1]!, /What can I do for you today\?$/);
});

test("AI welcome drafts must include the essentials and avoid promises", () => {
  const good =
    "Hi, I'm Lucidity 💛 I'm here to help you keep track of how your loved one is doing between doctor visits.\n---\nText me anytime in your own words, a hard night or a sweet moment. I'll save it for the care team, help with reminders, and tell you right away what to do if something sounds urgent. Text STOP anytime to pause. What can I do for you today?";
  assert.equal(acceptWelcome(good)?.length, 2);
  // the fixed fallback passes its own checks
  assert.ok(acceptWelcome(WELCOME_MESSAGES.join("\n---\n")));
  assert.equal(acceptWelcome(good.replace("Text STOP anytime to pause. ", "")), null); // no STOP
  assert.equal(acceptWelcome(good.replace("What can I do for you today?", "Talk soon!")), null); // no closing question
  assert.ok(acceptWelcome(good.replace("What can I do for you today?", "How can I help today?")));
  assert.equal(acceptWelcome(good.replace("between doctor visits", "and I'm monitoring 24/7")), null); // promise
  assert.equal(acceptWelcome(good.replace("\n---\n", " ")), null); // not two messages
});
