import { test, expect } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("edited message updates for the other user @P0 @messaging", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("edit");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  const before = `draft ${unique("m")}`;
  const after = `final ${unique("m")}`;
  await a.sendMessage(before);
  await b.expectMessage(before);

  await a.editMessage(before, after);
  await b.expectMessage(after);
  await expect(b.messageList().getByText(before, { exact: true })).toHaveCount(0);
});

test("deleted message disappears for the other user @P1 @messaging", async ({ userA, userB, unique, cleanup }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);
  const channel = unique("del");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));
  await userB.goto("/");
  await b.joinChannel(channel);

  const text = `delete me ${unique("m")}`;
  await a.sendMessage(text);
  await b.expectMessage(text);

  await a.deleteMessage(text);
  await expect(b.messageList().getByText(text, { exact: true })).toHaveCount(0, { timeout: 20_000 });
});
