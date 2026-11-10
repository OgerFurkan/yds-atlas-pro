import type { GameSession } from "@yds-atlas/shared";
import type { createAccountApi } from "../api/account-api";
export class SessionSync {
  private revisions = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private api: ReturnType<typeof createAccountApi>;
  constructor(
    api: ReturnType<typeof createAccountApi>,
    initial?: { snapshot: GameSession; revision: number } | null,
  ) {
    this.api = api;
    if (initial) this.revisions.set(initial.snapshot.id, initial.revision);
  }
  save(snapshot: GameSession) {
    const work = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      const { revision } = await this.api.saveSession(
        snapshot,
        this.revisions.get(snapshot.id) ?? 0,
      );
      this.revisions.set(snapshot.id, revision);
    });
    this.tail = work.catch((error) => {
      this.failure = error;
    });
    return work;
  }
  async flush() {
    await this.tail;
    if (this.failure) throw this.failure;
  }
  retry() {
    this.failure = null;
  }
}
