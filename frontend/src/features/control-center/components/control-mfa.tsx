import { useState } from "react";
import { supabase } from "@/shared/api/supabase-client";
import { Button } from "@/shared/ui/button";
export function ControlMfa({
  busy,
  run,
  onVerified,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(async () => {
          if (!supabase) throw Error("Oturum servisi kapalı.");
          const list = await supabase.auth.mfa.listFactors();
          const factor = list.data?.totp.find((f) => f.status === "verified");
          if (!factor) throw Error("Doğrulanmış TOTP faktörü gerekli.");
          const result = await supabase.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code,
          });
          if (result.error) throw Error("Kod doğrulanamadı.");
          setCode("");
          onVerified();
        });
      }}
    >
      <label>
        Doğrulama kodu{" "}
        <input
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <Button disabled={busy}>Doğrula</Button>
    </form>
  );
}
