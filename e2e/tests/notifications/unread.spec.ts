import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("new message marks the channel unread for the other user @P0 @notifications", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("unrd");
  const other = unique("away");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  // B moves to a different channel, so the new message counts as unread.
  await b.createChannel(other);
  cleanup(() => b.deleteChannel(other));

  await a.sendMessage(`ping ${unique("t")}`);
  await expect(b.unreadBadge(channel)).toBeVisible({ timeout: 20_000 });
});
