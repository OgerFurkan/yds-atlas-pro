import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Clock3, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";
import {
  getEditorial, listEditorial, reviewEditorial,
  type EditorialDetail, type EditorialFilterStatus, type EditorialFilters, type EditorialList,
  type EditorialReason,
} from "../api/admin-editorial-api";
import type { AdminAccess } from "../hooks/use-admin-access";
import {
  STATUS_LABELS, REASON_LABELS, permittedEditorialActions, normalizeEditorialSearch, countExampleTiers,
  isCurrentEditorialDecision, resultForEditorialEntry, type EditorialDecision, type EditorialResult,
} from "../model/admin-editorial-model";

type Props = { userId: string | null; access: AdminAccess };
const EMPTY_FILTERS: EditorialFilters = { status: "machine_validated", word: "", offset: 0, limit: 20 };

function safeMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "Kayıt başka bir işlemde güncellendi. En güncel revizyon tekrar yükleniyor.";
    if (error.status === 401 || error.status === 403) return "Yönetici yetkin doğrulanamadı. Oturumunu kontrol et.";
    if (error.status === 503) return "Yönetim servisi henüz kullanılabilir değil.";
    return error.message;
  }
  return "İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyebilirsin.";
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("tr-TR") : "—";
}

export function AdminControlCenterPage({ userId, access }: Props) {
  const [filters, setFilters] = useState<EditorialFilters>(EMPTY_FILTERS);
  const [draftWord, setDraftWord] = useState("");
  const [draftStatus, setDraftStatus] = useState<EditorialFilterStatus>("machine_validated");
  const [filterError, setFilterError] = useState("");
  const [reload, setReload] = useState(0);
  const [detailReload, setDetailReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listState, setListState] = useState<{ key: string; value?: EditorialList; error?: string } | null>(null);
  const [detailState, setDetailState] = useState<{ key: string; value?: EditorialDetail; error?: string } | null>(null);
  const [decision, setDecision] = useState<EditorialDecision | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewInFlight = useRef(false);
  const confirmButtonRef = useRef<HTMLSpanElement>(null);
  const approveButtonRef = useRef<HTMLSpanElement>(null);
  const quarantineButtonRef = useRef<HTMLSpanElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const [reviewResult, setReviewResult] = useState<EditorialResult | null>(null);
  const [quarantineReason, setQuarantineReason] = useState<EditorialReason>("quality");

  const listKey = JSON.stringify([filters, reload, userId]);
  const detailKey = JSON.stringify([selectedId, detailReload, userId]);
  // Inline confirmation, not a modal. Focus the confirm action when opening it.
  useEffect(() => {
    if (decision) confirmButtonRef.current?.querySelector("button")?.focus();
  }, [decision]);

  useEffect(() => {
    if (access !== "allowed" || !userId) return;
    const controller = new AbortController();
    void listEditorial(filters, userId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setListState({ key: listKey, value }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListState({ key: listKey, error: safeMessage(error) });
      });
    return () => controller.abort();
  }, [access, userId, filters, listKey]);

  useEffect(() => {
    if (access !== "allowed" || !userId || !selectedId) return;
    const controller = new AbortController();
    void getEditorial(selectedId, userId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setDetailState({ key: detailKey, value }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailState({ key: detailKey, error: safeMessage(error) });
      });
    return () => controller.abort();
  }, [access, userId, selectedId, detailKey]);

  if (access !== "allowed" || !userId) {
    const text = access === "checking" ? "Yönetici erişimi doğrulanıyor…" :
      access === "disabled" ? "Feedback Control Center bu ortamda kapalı." :
      access === "unavailable" ? "Yönetici yetki servisine ulaşılamadı. Daha sonra tekrar deneyin." :
      "Bu yönetim ekranını görüntülemek için yetkili hesapla giriş yapmalısın.";
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-8 shadow-sm" aria-label="Yönetici erişimi">
        <ShieldAlert className="mb-4 text-atlas-orange" size={32} aria-hidden="true" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Control Center</h1>
        <p className="mt-3 text-sm text-muted-foreground" role="status">{text}</p>
      </section>
    );
  }

  const listLoading = listState?.key !== listKey;
  const list = listLoading ? null : listState?.value;
  const detailLoading = selectedId !== null && detailState?.key !== detailKey;
  const detail = detailLoading ? null : detailState?.value;
  const entry = detail?.entry;
  const options = entry ? permittedEditorialActions(entry) : { approve: false, quarantine: false };
  const examples = entry?.content.examples ?? [];
  const tiers = countExampleTiers(examples);
  const currentDecision = isCurrentEditorialDecision(decision, entry) && decision?.id === selectedId ? decision : null;
  const visibleResult = entry ? resultForEditorialEntry(reviewResult, entry.id) : null;

  function startDecision(next: { nextStatus: "human_reviewed"; reasonCode: "editorial_approved" } |
    { nextStatus: "quarantined"; reasonCode: EditorialReason }) {
    if (!entry || entry.id !== selectedId || reviewInFlight.current) return;
    setReviewResult(null);
    setDecision({ ...next, id: entry.id, revision: entry.revision, word: entry.word });
  }
  function cancelDecision() {
    if (reviewInFlight.current) return;
    const target = decision?.nextStatus === "human_reviewed" ? approveButtonRef : quarantineButtonRef;
    setDecision(null);
    target?.current?.querySelector("button")?.focus();
  }
  function handleDecisionKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !reviewInFlight.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelDecision();
    }
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewInFlight.current) return;
    const word = normalizeEditorialSearch(draftWord);
    if (word === null) {
      setFilterError("Tek bir İngilizce kelime veya kısa ifade gir.");
      return;
    }
    setFilterError("");
    setSelectedId(null);
    setDecision(null);
    setReviewResult(null);
    setFilters({ status: draftStatus, word, offset: 0, limit: 20 });
  }
  function changePage(offset: number) {
    if (reviewInFlight.current || offset < 0 || offset > 5000) return;
    setFilters((old) => ({ ...old, offset }));
    setSelectedId(null);
    setDecision(null);
  }
  function chooseEntry(id: string) {
    if (reviewInFlight.current) return;
    setSelectedId(id);
    setDecision(null);
    setReviewResult(null);
  }
  async function submitDecision() {
    const intent = currentDecision;
    if (!intent || !userId || reviewInFlight.current || !entry) return;
    // Capture both identity and revision BEFORE the await; no mutable selected entry references.
    const reviewer = userId;
    reviewInFlight.current = true;
    setReviewBusy(true);
    setReviewResult(null);
    try {
      await reviewEditorial(intent.id, intent.revision,
        intent.nextStatus === "human_reviewed"
          ? { nextStatus: "human_reviewed", reasonCode: "editorial_approved" }
          : { nextStatus: "quarantined", reasonCode: intent.reasonCode },
        reviewer);
      setReviewResult({
        id: intent.id, kind: "success",
        message: intent.nextStatus === "human_reviewed" ? "Kelime editoryal olarak onaylandı." : "Kelime karantinaya alındı.",
      });
      setDecision(null);
      setDetailReload((n) => n + 1);
      setReload((n) => n + 1);
      detailHeadingRef.current?.focus();
    } catch (error) {
      setReviewResult({ id: intent.id, kind: "error", message: safeMessage(error) });
      if (error instanceof ApiError && error.status === 409) {
        setDecision(null);
        setDetailReload((n) => n + 1);
        setReload((n) => n + 1);
        detailHeadingRef.current?.focus();
      }
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  }

  return (
    <div className="space-y-6" aria-label="Atlas Admin Control Center">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-atlas-blue">
            <ShieldCheck size={16} aria-hidden="true" /> Atlas / Editorial Operations
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">Control Center</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Ortak kelime havuzunun kalitesini denetle. Kararların sunucu tarafında kimlik ve revizyon kontrolünden geçer.
          </p>
        </div>
        <Button variant="outline" disabled={reviewBusy} onClick={() => { setReload((n) => n + 1); setDetailReload((n) => n + 1); }}>
          <RefreshCw size={16} aria-hidden="true" /> Yenile
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]">
        <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-card shadow-sm" aria-labelledby="queue-title">
          <div className="border-b border-border p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="queue-title" className="font-display text-xl font-semibold text-foreground">İnceleme kuyruğu</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">20 / sayfa</span>
            </div>
            <form className="grid gap-3" onSubmit={submitFilters} aria-busy={reviewBusy}>
              <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                Kelime ara (tam eşleşme)
                <span className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" aria-hidden="true" />
                  <input disabled={reviewBusy} value={draftWord} onChange={(e) => setDraftWord(e.target.value)} maxLength={120}
                    className="min-h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-atlas-blue"
                    placeholder="ör. acquire" />
                </span>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                İnceleme durumu
                <select disabled={reviewBusy} value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as EditorialFilterStatus)}
                  className="min-h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-atlas-blue">
                  <option value="machine_validated">Makine kontrolü</option>
                  <option value="human_reviewed">Editör onaylı</option>
                  <option value="quarantined">Karantina</option>
                  <option value="all">Tüm kayıtlar</option>
                </select>
              </label>
              {filterError && <p role="alert" className="text-xs text-destructive">{filterError}</p>}
              <Button type="submit" size="sm" disabled={reviewBusy}>Filtreleri uygula</Button>
            </form>
          </div>
          <div aria-live="polite" className="min-h-48">
            {listLoading ? <p role="status" className="p-5 text-sm text-muted-foreground">Kayıtlar yükleniyor…</p> :
             listState?.error ? <p role="alert" className="p-5 text-sm text-destructive">{listState.error}</p> :
             list?.entries.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Bu filtreye uygun kelime bulunamadı.</p> :
             <ul className="divide-y divide-border">
               {list?.entries.map((row) => (
                 <li key={row.id}>
                   <button type="button" disabled={reviewBusy} onClick={() => chooseEntry(row.id)} aria-pressed={selectedId === row.id}
                     className={`w-full space-y-2 p-4 text-left transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-atlas-blue ${selectedId === row.id ? "bg-blue-50/70 dark:bg-blue-950/30" : ""}`}>
                     <span className="flex items-center justify-between gap-2">
                       <strong className="font-display text-lg text-foreground">{row.word}</strong>
                       <span className="text-xs text-muted-foreground">rev. {row.revision}</span>
                     </span>
                     <span className="block text-xs text-muted-foreground">{row.partOfSpeech} · {row.cefr || "CEFR belirtilmedi"}</span>
                     <span className="line-clamp-2 block text-sm text-foreground">{row.meanings.join(", ") || "Anlam belirtilmedi"}</span>
                     <span className="inline-flex rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">{STATUS_LABELS[row.status]}</span>
                   </button>
                 </li>
               ))}
             </ul>}
          </div>
          <footer className="flex items-center justify-between border-t border-border p-4 text-xs text-muted-foreground">
            <span>{filters.offset + 1}. kayıttan başlayan sayfa</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" aria-label="Önceki sayfa" disabled={reviewBusy || filters.offset === 0 || listLoading} onClick={() => changePage(Math.max(0, filters.offset - 20))}>
                <ArrowLeft size={15} /> Geri
              </Button>
              <Button size="sm" variant="outline" aria-label="Sonraki sayfa" disabled={reviewBusy || !list?.hasMore || listLoading || list.nextOffset === null || (list?.nextOffset ?? 5001) > 5000}
                onClick={() => { if (list?.nextOffset !== null && list?.nextOffset !== undefined) changePage(list.nextOffset); }}>
                İleri <ArrowRight size={15} />
              </Button>
            </div>
          </footer>
        </section>

        <section className="min-w-0 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="detail-title">
          <h2 id="detail-title" ref={detailHeadingRef} tabIndex={-1} className="mb-5 font-display text-xl font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-atlas-blue">Kelime incelemesi</h2>
          {!selectedId ? <div className="grid min-h-80 place-content-center gap-3 text-center text-muted-foreground">
              <ClipboardCheck size={36} className="mx-auto" aria-hidden="true" />
              <p className="text-sm">İncelemek için kuyruktan bir kelime seç.</p>
            </div> : detailLoading ? <p role="status" className="py-8 text-sm text-muted-foreground">Kelime ayrıntıları yükleniyor…</p> :
            detailState?.error ? <p role="alert" className="py-8 text-sm text-destructive">{detailState.error}</p> : entry ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-3xl font-semibold text-foreground">{entry.word}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.partOfSpeech} · {entry.cefr || "CEFR yok"} · rev. {entry.revision}</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{entry.meanings.join(" · ")}</p>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground">{STATUS_LABELS[entry.status]}</span>
                </div>
                {entry.content.usageNote && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{entry.content.usageNote}</p>}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold text-foreground">İngilizce / Türkçe örnekler</h4>
                    <span className="text-xs text-muted-foreground">{examples.length} örnek · {tiers.easy} kolay / {tiers.medium} orta / {tiers.yds} YDS</span>
                  </div>
                  {examples.length === 0 ? <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Örnek bulunamadı; bu kayıt onaylanmamalıdır.</p> :
                  <ol className="space-y-3">
                    {examples.map((example, i) => (
                      <li key={`${i}-${example.sentence}`} className="rounded-2xl border border-border bg-background p-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-atlas-blue">{i + 1}. örnek · {example.difficulty === "yds" ? "YDS" : example.difficulty === "easy" ? "Kolay" : example.difficulty === "medium" ? "Orta" : "Belirsiz"}</p>
                        <p className="text-sm font-medium leading-relaxed text-foreground">{example.sentence}</p>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{example.translation}</p>
                        {(example.translationFocus?.length ?? 0) > 0 &&
                          <p className="mt-2 text-xs text-muted-foreground">Odak: {example.translationFocus?.join(", ")}</p>}
                      </li>
                    ))}
                  </ol>}
                </div>
                <div className="grid gap-2 rounded-xl bg-muted p-4 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>Kaynak: {entry.provenance.provider ?? "—"}</span>
                  <span>Model: {entry.provenance.model ?? "—"}</span>
                  <span>Doğrulama: {entry.provenance.validation ?? "—"}</span>
                  <span>Güncelleme: {formatDate(entry.updatedAt)}</span>
                </div>
                {visibleResult?.kind === "success" && <p role="status" className="flex gap-2 rounded-xl border border-border p-3 text-sm text-foreground"><CheckCircle2 size={18} aria-hidden="true" />{visibleResult.message}</p>}
                {visibleResult?.kind === "error" && <p role="alert" className="flex gap-2 rounded-xl border border-destructive/30 p-3 text-sm text-destructive"><AlertCircle size={18} aria-hidden="true" />{visibleResult.message}</p>}
                <div className="space-y-3 border-t border-border pt-5">
                  <h4 className="font-semibold text-foreground">Editoryal karar</h4>
                  <p className="text-xs text-muted-foreground">Karar revizyon {entry.revision} üzerinden gönderilir. Bu sırada kayıt değişmişse sunucu işlemi reddeder.</p>
                  <div className="flex flex-wrap gap-2">
                    <span ref={approveButtonRef}><Button disabled={!options.approve || reviewBusy} onClick={() => startDecision({ nextStatus: "human_reviewed", reasonCode: "editorial_approved" })}>
                      <CheckCircle2 size={16} /> Onayla
                    </Button></span>
                    <span ref={quarantineButtonRef}><Button variant="destructive" disabled={!options.quarantine || reviewBusy} onClick={() => startDecision({ nextStatus: "quarantined", reasonCode: quarantineReason })}>
                      <ShieldAlert size={16} /> Karantinaya al
                    </Button></span>
                  </div>
                  <label className="grid max-w-sm gap-1 text-xs font-semibold text-muted-foreground">
                    Karantina gerekçesi
                    <select disabled={!options.quarantine || reviewBusy} value={quarantineReason} onChange={(e) => { setQuarantineReason(e.target.value as EditorialReason); setDecision(null); }}
                      className="min-h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
                      {Object.entries(REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {currentDecision && <div role="group" aria-labelledby="editorial-confirm-title" aria-describedby="editorial-confirm-description" onKeyDown={handleDecisionKeyDown} className="space-y-3 rounded-2xl border border-atlas-orange/40 bg-muted p-4">
                    <h5 id="editorial-confirm-title" className="font-semibold text-foreground">Kararı doğrula</h5>
                    <p id="editorial-confirm-description" className="text-sm text-muted-foreground">
                      <strong>{currentDecision.word}</strong> kelimesi için {currentDecision.nextStatus === "human_reviewed" ? "editoryal onay" : "karantina"} işlemini revizyon {currentDecision.revision} üzerinden uygulamak istiyor musun?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span ref={confirmButtonRef}><Button disabled={reviewBusy} onClick={() => void submitDecision()}>{reviewBusy ? "Kaydediliyor…" : "Kararı uygula"}</Button></span>
                      <Button variant="outline" disabled={reviewBusy} onClick={cancelDecision}>Vazgeç</Button>
                    </div>
                  </div>}
                </div>
                <div className="border-t border-border pt-5">
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><Clock3 size={17} aria-hidden="true" /> Revizyon geçmişi</h4>
                  {detail?.revisions.length ? <ol className="space-y-2">
                    {detail.revisions.map((r, i) => <li key={`${r.revision}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
                      <span>rev. {r.revision} · {r.action} · {r.reasonCode ?? "—"}</span>
                      <time>{formatDate(r.createdAt)}</time>
                    </li>)}
                  </ol> : <p className="text-sm text-muted-foreground">Henüz görünür kayıt yok.</p>}
                  {detail?.hasOlderRevisions && <p className="mt-2 text-xs text-muted-foreground">Daha eski revizyonlar sunucuda saklanıyor; burada yalnız son 20 kayıt görüntüleniyor.</p>}
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">Kayıt ayrıntısı bulunamadı.</p>}
        </section>
      </div>
    </div>
  );
}
