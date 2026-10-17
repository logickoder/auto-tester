import { test } from "../../fixtures/test";
import { USERS } from "../../fixtures/users";
import { Zedu } from "../../pages/zedu";

test("direct message reaches the recipient @P0 @messaging", async ({ userA, userB, unique }) => {
  const a = new Zedu(userA);
  const b = new Zedu(userB);

  await userA.goto("/");
  await a.openDirectMessage(USERS.userB.displayName);
  const text = `dm ${unique("t")}`;
  await a.sendMessage(text);

  await userB.goto("/");
  await b.openDirectMessage(USERS.userA.displayName);
  await b.expectMessage(text);
});
