import { test } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

// FR-4: two isolated browser contexts — A sends, B sees it arrive without reloading.
test("message sent by user A reaches user B @P0 @messaging", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("msg");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  await userB.goto("/");
  await b.joinChannel(channel);

  const text = `hello from A ${unique("t")}`;
  await a.sendMessage(text);
  await b.expectMessage(text); // B never reloads: this proves real-time delivery
});
