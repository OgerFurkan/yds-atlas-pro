import { Activity, ArrowLeft, BookOpenCheck, CircleDollarSign, Database, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { loadAdminOverview, type AdminOverview } from "../api/admin-api";

function CountCard({label,value,note,Icon}:{label:string;value:string;note:string;Icon:typeof Activity}){
  return <section className="atlas-premium-stat" aria-label={label}>
    <div className="atlas-premium-stat-head"><span>{label}</span><Icon size={19} aria-hidden="true"/></div>
    <strong className="atlas-premium-stat-number">{value}</strong>
    <span className="atlas-premium-stat-note">{note}</span>
  </section>;
}
function fmt(num:number){return new Intl.NumberFormat("tr-TR").format(num);}
export function AdminDashboard({onBack}:{onBack:()=>void}){
  const [data,setData]=useState<AdminOverview|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const reload=useCallback(async()=>{
    setBusy(true);setError("");
    try{setData(await loadAdminOverview());}
    catch{setData(null);setError("Yönetim verileri alınamadı. Yetkini veya bağlantıyı kontrol et.");}
    finally{setBusy(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const denominator=data?data.chatPoolHits+data.chatAiRequests:0;
  const chatHit=denominator?Math.round(100*(data?.chatPoolHits??0)/denominator):null;
  const reviewedPct=data?.totalPoolEntries?Math.round(100*data.humanReviewed/data.totalPoolEntries):null;
  return <div className="atlas-premium-page" aria-busy={busy}>
    <header className="atlas-premium-hero">
      <div className="atlas-premium-hero-inner">
        <div className="atlas-premium-kicker"><ShieldCheck size={16}/> ADMIN CONTROL CENTER <span className="atlas-premium-dot"/> YALNIZCA YETKİLİ HESAP</div>
        <h1>Atlas yönetim merkezi<span className="atlas-premium-title-mark">.</span></h1>
        <p>Kelime havuzunun, AI kullanımının ve operasyonel sağlığın tek görünümü.</p>
        <div className="atlas-premium-actions">
          <Button variant="outline" onClick={onBack}><ArrowLeft size={16}/> Uygulamaya dön</Button>
          <Button onClick={()=>void reload()} disabled={busy}><RefreshCw size={16} className={busy?"animate-spin":""}/> Yenile</Button>
        </div>
      </div>
    </header>
    {busy && !data && <div role="status" className="atlas-premium-message">Gerçek metrikler yükleniyor…</div>}
    {error && <div role="alert" className="atlas-premium-message atlas-premium-error">{error}</div>}
    {data && <>
      <div className="atlas-premium-section-heading"><h2>Ürün sağlığı</h2><span>Son {data.periodDays} gün · sunucu verisi</span></div>
      <div className="atlas-premium-grid">
        <CountCard label="Ortak havuz" value={fmt(data.totalPoolEntries)} note="Kelime + tür + anlam kaydı" Icon={Database}/>
        <CountCard label="Editoryal onaylı" value={reviewedPct===null?"—":`${reviewedPct}%`} note={`${fmt(data.humanReviewed)} doğrulanmış kayıt`} Icon={BookOpenCheck}/>
        <CountCard label="Chat havuz isabeti" value={chatHit===null?"—":`${chatHit}%`} note={denominator?`${fmt(denominator)} ölçülen chat isteği`:"Ölçülen istek yok"} Icon={Activity}/>
        <CountCard label="Ölçülen kullanıcı" value={fmt(data.measuredUsers)} note="Yalnız telemetri etkinlikleri" Icon={Users}/>
      </div>
      <div className="atlas-premium-detail-grid">
        <section className="atlas-premium-panel">
          <div className="atlas-premium-panel-top"><h2>Havuz verimliliği</h2><Database size={18}/></div>
          <p className="atlas-premium-muted">AI Chat havuz yanıtları ile doğrudan Gemini isteklerinin oranı.</p>
          {chatHit!==null?<><div className="atlas-premium-progress" role="progressbar" aria-label="Chat havuz isabet oranı" aria-valuemin={0} aria-valuemax={100} aria-valuenow={chatHit}><span style={{width:`${chatHit}%`}}/></div>
            <p className="atlas-premium-insight">Havuzdan {fmt(data.chatPoolHits)} · Gemini {fmt(data.chatAiRequests)}</p></>
            :<p className="atlas-premium-empty">Henüz karşılaştırılabilir kullanım verisi yok.</p>}
        </section>
        <section className="atlas-premium-panel">
          <div className="atlas-premium-panel-top"><h2>AI maliyet şeffaflığı</h2><CircleDollarSign size={18}/></div>
          <p className="atlas-premium-muted">Tahminler sağlayıcı faturasından ayrı tutulur; fiyat listesi doğrulanmadan maliyet hesaplanmaz.</p>
          <p className="atlas-premium-cost">{data.estimatedCostUsd===null?"Hesaplanmadı":`$${data.estimatedCostUsd.toFixed(4)}`}</p>
          <p className="atlas-premium-insight">Token ölçümü: {data.inputTokens===null||data.outputTokens===null?"Henüz eksik":`${fmt(data.inputTokens)} giriş / ${fmt(data.outputTokens)} çıkış`}</p>
        </section>
      </div>
      <section className="atlas-premium-panel atlas-premium-quality">
        <div className="atlas-premium-panel-top"><h2>İçerik kalite sinyalleri</h2><ShieldCheck size={18}/></div>
        <div className="atlas-premium-quality-list"><span>Otomatik doğrulanmış: <b>{fmt(data.machineValidated)}</b></span>
        <span>Karantina: <b>{fmt(data.quarantined)}</b></span>
        <span>Yeni üretim: <b>{fmt(data.generatedEntries)}</b></span>
        <span>Havuzdan öneri: <b>{fmt(data.recommendPoolHits)}</b></span></div>
      </section>
      {!data.metricsComplete&&<p role="note" className="atlas-premium-disclaimer">Ölçüm kapsamı henüz tamamlanmadı. Kullanıcı etkinliği, maliyet ve ürün kullanım verileri platformun tüm hareketlerini temsil etmeyebilir.</p>}
    </>}
  </div>;
}
