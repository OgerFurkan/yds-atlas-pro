import {
  type AccountPlan,
  accountPlanSchema,
  type PrivatePlan,
  privatePlanSchema,
  type WordEntry,
  type WordInput,
} from "@yds-atlas/shared";
import { enrichWordInput } from "@yds-atlas/shared/starter-vocabulary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountRequest } from "@/shared/api/api-client";
import { readStoredText, writeRawStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { DailyWordGroupsRepository } from "../api/daily-word-groups-repository";
import { updatePlanCommand } from "../api/plan-command-storage";
import { buildDailyPlan, dailyPlanWordIds } from "../model/daily-groups";

type PlanCommand = {
  owner: string;
  revision: number;
  command: string;
  plan: PrivatePlan;
  day?: number;
  createOnly?: boolean;
  words?: WordInput[];
};
function preview(plan: PrivatePlan) {
  const values = new Map<string, unknown>([
    [storageKeys.dailyWordGroups, structuredClone(plan.groups)],
    [storageKeys.dailyWordExclusions, [...plan.exclusions]],
    [storageKeys.dailyPlanGroupSize, plan.size],
  ]);
  return new DailyWordGroupsRepository(
    (key) => values.get(key),
    (key, value) => {
      values.set(key, value);
    },
  );
}
function documentOf(repo: DailyWordGroupsRepository) {
  const { groups, size, exclusions } = repo.readPlan();
  return privatePlanSchema.parse({ size, groups, exclusions });
}
function devicePlan() {
  const repo = new DailyWordGroupsRepository();
  const { size, groups, exclusions } = repo.readPlan();
  const doc = { size, groups, exclusions };
  return doc.groups.length || doc.exclusions.length || repo.getStoredGroupSize() !== undefined
    ? doc
    : null;
}
async function fingerprint(doc: PrivatePlan) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(doc)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
const acceptanceKey = "atlas-plan-device-choice-v1";
export function useAccountPlan(
  owner: string | null,
  words: WordEntry[],
  verify: (w: WordEntry[]) => boolean,
  enabled: boolean,
) {
  const api = useMemo(() => (owner ? accountRequest(owner) : null), [owner]);
  const [state, setState] = useState<AccountPlan | null>(null);
  const [legacy, setLegacy] = useState<PrivatePlan | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [fault, setFault] = useState("");
  const inFlightRead = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const observe = useCallback((next: AccountPlan) => {
    setState((previous) =>
      previous && previous.owner === next.owner && previous.revision > next.revision
        ? previous
        : next,
    );
  }, []);
  const load = useCallback(() => {
    inFlightRead.current?.abort();
    if (!api || !enabled || !verify(words)) return;
    const abort = new AbortController();
    inFlightRead.current = abort;
    void (async () => {
      const remote = accountPlanSchema.parse(
        await api("/api/account/plan", { signal: abort.signal }),
      );
      if (abort.signal.aborted || remote.owner !== owner || !verify(words)) return;
      const doc = devicePlan();
      const acceptedHash = doc ? await fingerprint(doc) : null;
      if (abort.signal.aborted || getStorageScope() !== remote.owner || !verify(words)) return;
      setAccepted(!!acceptedHash && readStoredText(acceptanceKey, remote.owner) === acceptedHash);
      const receipt = await updatePlanCommand(remote.owner);
      if (abort.signal.aborted || getStorageScope() !== remote.owner || !verify(words)) return;
      setPending(receipt);
      setLegacy(doc);
      observe(remote);
      setFault("");
    })().catch((e) => {
      if (!abort.signal.aborted) setFault(e instanceof Error ? e.message : "Plan okunamadı.");
    });
  }, [api, owner, enabled, words, verify, observe]);
  useEffect(() => {
    load();
    return () => inFlightRead.current?.abort();
  }, [load]);
  const refresh = useCallback(() => {
    setState(null);
    setFault("");
    load();
  }, [load]);
  const localChoice =
    !!legacy && !accepted && JSON.stringify(state?.plan) !== JSON.stringify(legacy);
  const { orphanIds, deviceProjection } = useMemo(() => {
    if (!legacy) return { orphanIds: [], deviceProjection: null };
    const owned = new Set(words.map((word) => word.id));
    const missing = [
      ...new Set(
        [...legacy.groups.flatMap((g) => g.words), ...legacy.exclusions].filter(
          (id) => !owned.has(id),
        ),
      ),
    ];
    const projection = missing.length
      ? {
          size: legacy.size,
          groups: legacy.groups
            .map((g) => ({ ...g, words: g.words.filter((id) => owned.has(id)) }))
            .filter((g) => g.words.length),
          exclusions: legacy.exclusions.filter((id) => owned.has(id)),
        }
      : legacy;
    return { orphanIds: missing, deviceProjection: projection };
  }, [legacy, words]);
  const base = useMemo(() => {
    const plan = state?.plan ?? deviceProjection ?? { size: 20, groups: [], exclusions: [] };
    const repo = preview(plan);
    if (owner && enabled && verify(words))
      repo.syncWords(dailyPlanWordIds(words), undefined, true, true);
    return documentOf(repo);
  }, [state, deviceProjection, words, verify, enabled, owner]);
  const plan = useMemo(() => buildDailyPlan(words, base.size, base.groups), [words, base]);
  function guard() {
    if (!api || !owner || !state || !enabled || getStorageScope() !== owner || !verify(words))
      throw new Error("Kütüphane veya hesap değişti. Yeniden yükle.");
    return { api, state };
  }
  async function acknowledge(doc: PrivatePlan | null) {
    if (doc && owner) {
      const hash = await fingerprint(doc);
      if (getStorageScope() !== owner || JSON.stringify(devicePlan()) !== JSON.stringify(doc))
        throw new Error("Cihazdaki plan değişti. Güncel kaydı yeniden yükle.");
      writeRawStorage(acceptanceKey, hash, owner);
    }
    setAccepted(true);
  }
  async function send(cmd: PlanCommand, replay = false) {
    const { api, state } = guard();
    if (cmd.owner !== state.owner) throw new Error("Planın sahibi değişti.");
    const raw = JSON.stringify(cmd);
    if (sending.current) throw new Error("Plan isteği sürüyor.");
    sending.current = true;
    setBusy(true);
    try {
      await updatePlanCommand(cmd.owner, { expected: replay ? raw : null, next: raw });
      guard();
      setPending(raw);
      const importing = cmd.day !== undefined;
      const data = await api<{ added: number; duplicates: number }>(
        importing ? "/api/account/plan/import" : "/api/account/plan",
        { method: importing ? "POST" : "PUT", body: raw },
      );
      const next = accountPlanSchema.parse(data);
      if (
        next.owner !== cmd.owner ||
        next.revision !== cmd.revision + 1 ||
        !next.plan ||
        (!importing &&
          JSON.stringify(next.plan) !== JSON.stringify(privatePlanSchema.parse(cmd.plan))) ||
        (importing &&
          (!Number.isInteger(data.added) ||
            !Number.isInteger(data.duplicates) ||
            data.added + data.duplicates !== cmd.words?.length))
      )
        throw new Error("Sunucu planı doğrulanamadı.");
      await updatePlanCommand(cmd.owner, { expected: raw, next: null });
      setPending(null);
      observe(next);
      if (!importing && legacy && JSON.stringify(cmd.plan) === JSON.stringify(deviceProjection))
        await acknowledge(legacy);
      setFault("");
      return { added: data.added, duplicates: data.duplicates };
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function submit(doc: PrivatePlan) {
    const { state } = guard();
    await send({
      owner: state.owner,
      revision: state.revision,
      command: crypto.randomUUID(),
      plan: doc,
    });
  }
  async function change<T>(fn: (repo: DailyWordGroupsRepository) => T, size?: number) {
    guard();
    if (localChoice || !state?.plan) throw new Error("Önce kullanılacak planı seç.");
    const repo = preview(base);
    const result = fn(repo);
    const doc = documentOf(repo);
    if (size !== undefined) doc.size = size;
    try {
      await submit(doc);
    } catch (e) {
      setFault(e instanceof Error ? e.message : "Plan kaydı doğrulanamadı.");
      throw e;
    }
    return result;
  }
  async function importDay(inputs: WordInput[], day: number, createOnly = false) {
    const { state } = guard();
    if (localChoice || !state.plan) throw new Error("Önce kullanılacak planı seç.");
    try {
      return await send({
        owner: state.owner,
        revision: state.revision,
        command: crypto.randomUUID(),
        plan: state.plan,
        day,
        words: inputs.map(enrichWordInput),
        createOnly,
      });
    } catch (e) {
      setFault(e instanceof Error ? e.message : "Gün ataması doğrulanamadı.");
      throw e;
    }
  }
  return {
    plan,
    groupSize: base.size,
    error: fault,
    loading: !!owner && !state && !fault,
    refresh,
    pending,
    busy,
    replay: async () => {
      try {
        if (!pending) return false;
        await send(JSON.parse(pending), true);
        return true;
      } catch (e) {
        setFault(e instanceof Error ? e.message : "İşlem doğrulanamadı.");
        return false;
      }
    },
    abandon: async () => {
      if (sending.current || !owner || !pending) return;
      try {
        await updatePlanCommand(owner, { expected: pending, next: null });
        setPending(null);
        refresh();
      } catch (e) {
        setFault(e instanceof Error ? e.message : "İşlem korunuyor.");
      }
    },
    orphanIds,
    choice: state && (!state.plan || localChoice),
    legacy,
    server: state?.plan,
    chooseServer: async () => {
      try {
        guard();
        await acknowledge(legacy);
      } catch (e) {
        setFault(e instanceof Error ? e.message : "Cihaz seçimi kaydedilemedi.");
      }
    },
    chooseLocal: async () => {
      try {
        guard();
        if (JSON.stringify(devicePlan()) !== JSON.stringify(legacy))
          throw new Error("Cihazdaki plan değişti. Yeniden yükle.");
        await submit(deviceProjection ?? base);
      } catch (e) {
        setFault(e instanceof Error ? e.message : "Plan aktarılamadı.");
      }
    },
    importDay,
    setGroupSize: async (size: number) => {
      try {
        await change(() => true, size);
      } catch (e) {
        setFault(e instanceof Error ? e.message : "Boyut kaydedilemedi.");
      }
    },
    assign: (id: string, day: number) =>
      change((repo) => {
        repo.assignManyToDay([id], day);
        return true;
      }),
    assignMany: (ids: string[], day: number) => change((repo) => repo.assignManyToDay(ids, day)),
    removeFromDay: (id: string, day: number) => change((repo) => repo.excludeWordFromDay(id, day)),
    clearDay: (day: number, expected: string) =>
      change((repo) => {
        if (expected !== String(state?.revision)) throw new Error("Plan değişti.");
        return repo.clearDay(day);
      }),
    getDayRemoval: (day: number) => ({
      ...preview(base).getDayRemoval(day),
      planRevision: String(state?.revision),
    }),
  };
}
