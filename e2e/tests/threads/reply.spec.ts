import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("thread reply is visible to the other user @P0 @threads", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("thr");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  const root = `root ${unique("m")}`;
  const reply = `reply ${unique("r")}`;
  await a.sendMessage(root);
  await b.expectMessage(root);
  await b.replyInThread(root, reply);

  await a.openThread(root);
  await expect(a.threadPanel().getByText(reply, { exact: true })).toBeVisible({ timeout: 20_000 });
});
