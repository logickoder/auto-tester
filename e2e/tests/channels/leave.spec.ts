import { test } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("a member can leave a channel @P1 @channels", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("leave");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  await b.leaveChannel(channel);
});
