import { test, expect } from "../../fixtures/test";
import { USERS } from "../../fixtures/users";
import { Zedu } from "../../pages/zedu";

// Read-only on purpose: editing the shared test account would break tests running in parallel.
test("profile settings show the signed-in user @P1 @settings", async ({ userA }) => {
  await userA.goto("/");
  await new Zedu(userA).openProfileSettings();
  await expect(userA.getByText(USERS.userA.email)).toBeVisible();
});
