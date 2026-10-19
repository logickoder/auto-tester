import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("search finds a sent message @P0 @search", async ({ userA, unique, cleanup }) => {
  const a = new Zedu(userA);
  const channel = unique("srch");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  // One unique token, so the only possible hit is this message.
  const token = unique("needle").replace(/-/g, "");
  const text = `search me ${token}`;
  await a.sendMessage(text);

  // The search index can lag behind delivery: retry the query, not a fixed sleep.
  await expect(async () => {
    await a.search(token);
    await expect(a.searchResults().getByText(text)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});
