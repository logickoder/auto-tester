import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("create a channel and a second user joins it @P0 @channels", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("chan");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  await userB.goto("/");
  await b.joinChannel(channel);
  await expect(b.sidebar().getByRole("link", { name: channel, exact: true })).toBeVisible();
});
