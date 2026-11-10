import type { Page } from "@playwright/test";

export async function installSpeechMock(page: Page, automatic = true) {
  await page.addInitScript(
    ({ automatic }) => {
      type MockUtterance = {
        onend?: (() => void) | null;
        onerror?: ((event: { error: string }) => void) | null;
      };
      let current: MockUtterance | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controls = {
        finish() {
          const playing = current;
          current = null;
          clearTimeout(timer);
          playing?.onend?.();
        },
        fail() {
          const playing = current;
          current = null;
          clearTimeout(timer);
          playing?.onerror?.({ error: "voice-unavailable" });
        },
      };
      Object.assign(window, { __speechMock: controls });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: class {
          constructor(public text: string) {}
        },
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          getVoices: () => [],
          cancel() {
            const playing = current;
            current = null;
            clearTimeout(timer);
            playing?.onerror?.({ error: "canceled" });
          },
          speak(utterance: MockUtterance) {
            current = utterance;
            if (automatic) timer = setTimeout(controls.finish, 350);
          },
        },
      });
    },
    { automatic },
  );
}
