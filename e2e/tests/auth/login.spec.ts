import { test, expect } from "../../fixtures/test";
import { USERS } from "../../fixtures/users";
import { Zedu } from "../../pages/zedu";

test("login shows the sidebar @P0 @auth", async ({ userA }) => {
  await userA.goto("/");
  await expect(new Zedu(userA).sidebar()).toBeVisible();
});

test("logout returns to the login page @P1 @auth", async ({ browser }) => {
  // Fresh context: logging out must not invalidate the saved session other tests use.
  const context = await browser.newContext();
  const zedu = new Zedu(await context.newPage());
  await zedu.login(USERS.userA.email, USERS.userA.password);
  await zedu.logout();
  await expect(zedu.page).toHaveURL(/login/);
  await context.close();
});
