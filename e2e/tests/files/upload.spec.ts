import { test } from "../../fixtures/test";
import { Zedu } from "../../pages/zedu";

test("file upload shows the file in the channel @P0 @files", async ({ userA, unique, cleanup }) => {
  const a = new Zedu(userA);
  const channel = unique("file");

  await userA.goto("/");
  await a.createChannel(channel);
  cleanup(() => a.deleteChannel(channel));

  const fileName = `${unique("note")}.txt`;
  await a.uploadFile(fileName, `Auto Tester upload ${fileName}`);
});
