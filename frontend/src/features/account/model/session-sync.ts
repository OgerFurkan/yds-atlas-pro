import type { GameSession } from "@yds-atlas/shared";
import { sameSession } from "@/features/learning-game/task-storage";
import type { createAccountApi } from "../api/account-api";
export class SessionSync {
  private acknowledged?: GameSession;
  hasSaved(snapshot: GameSession) {
    return (
      !!this.acknowledged &&
      (this.acknowledged === snapshot || sameSession(this.acknowledged, snapshot))
    );
  }
  private revisions = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private api: ReturnType<typeof createAccountApi>;
  constructor(
    api: ReturnType<typeof createAccountApi>,
    initial?: { snapshot: GameSession; revision: number } | null,
    draftRevision?: [string, number],
  ) {
    this.api = api;
    if (draftRevision) this.revisions.set(...draftRevision);
    if (initial) {
      this.revisions.set(initial.snapshot.id, initial.revision);
      this.acknowledged = initial.snapshot;
    }
  }
  save(snapshot: GameSession) {
    const work = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      if (
        !snapshot.discarded &&
        !this.revision(snapshot.id) &&
        snapshot.assessmentActions?.length
      ) {
        const { revision } = await this.api.saveSession(
          { ...snapshot, assessmentActions: [], discarded: undefined },
          0,
        );
        this.revisions.set(snapshot.id, revision);
      }
      const { revision } = await this.api.saveSession(snapshot, this.revision(snapshot.id));
      this.revisions.set(snapshot.id, revision);
      this.acknowledged = snapshot;
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
  revision(id: string) {
    return this.revisions.get(id) ?? 0;
  }
}
