import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase, supabaseConfigurationError } from "@/shared/api/supabase-client";
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [error, setError] = useState(supabaseConfigurationError);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
        if (error) setError("Oturum yüklenemedi. Yeniden giriş yapabilirsin.");
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError("Oturum yüklenemedi.");
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return { session, user: session?.user ?? null, loading, error, recovering, setRecovering };
}
