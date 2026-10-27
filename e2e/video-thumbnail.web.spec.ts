import { writeFileSync } from "node:fs";
import { expect, test, waitForPageReady } from "./support/fixtures";

/*
 * Video gets one still frame, its duration and resolution, and Download. It is never played: no
 * video element is ever on the page.
 */

test("a video shows a still frame and its size, and is never played", async ({ page, workspace }) => {
  workspace.makeFolder("media");
  await page.goto(workspace.url("media"));
  await waitForPageReady(page);
  // A short WebM made by the browser itself: a canvas recorded with MediaRecorder.
  const videoBase64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve));
    recorder.start(100);
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = () => {
        const elapsed = performance.now() - startedAt;
        context.fillStyle = elapsed < 600 ? "#2266ff" : "#ff8800";
        context.fillRect(0, 0, 320, 240);
        if (elapsed < 1800) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    recorder.stop();
    await stopped;
    const buffer = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCodePoint(byte);
    return btoa(binary);
  });
  writeFileSync(workspace.disk("media", "clip.webm"), Buffer.from(videoBase64, "base64"));

  await page.goto(workspace.url("media", "clip.webm"));
  const thumbnail = page.getByTestId("video-thumbnail");
  await expect(thumbnail).toBeVisible({ timeout: 15_000 });
  await expect(thumbnail).toHaveAttribute("src", /^blob:/);
  await expect(page.getByTestId("video-resolution")).toHaveText("320 × 240");
  await expect(page.getByTestId("placeholder-download")).toBeVisible();
  await expect(page.locator("video, audio, iframe, embed")).toHaveCount(0);
});

test("a video the browser can't read keeps the plain placeholder", async ({ page, workspace }) => {
  workspace.writeText("media/broken.mp4", "this is not a video");
  await page.goto(workspace.url("media", "broken.mp4"));
  await expect(page.getByTestId("placeholder-message")).toHaveText(
    "Preview isn't available for video or audio files.",
    {
      timeout: 15_000,
    },
  );
  await expect(page.getByTestId("video-thumbnail")).toHaveCount(0);
});
