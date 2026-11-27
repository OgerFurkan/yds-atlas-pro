export function loopback(url: URL) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function origin(value: string, hosted: boolean) {
  const url = new URL(value);
  if (
    url.href !== url.origin + "/" ||
    loopback(url) === hosted ||
    (hosted ? url.protocol !== "https:" : !/^https?:$/.test(url.protocol))
  )
    throw new Error("Invalid environment origin.");
  return url.origin;
}

type HostedIdentity = {
  web: string;
  api: string;
  supabase: string;
  project: string;
  assessment: { host: string; port: number; user: string };
};

export function hostedIdentity(raw: string | undefined, mode: "pre" | "prod"): HostedIdentity {
  function read(value: HostedIdentity): HostedIdentity {
    const project = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(origin(value.supabase, true))?.[1];
    if (!project) throw new Error();
    const { host, port, user } = value.assessment;
    const direct =
      host === `db.${project}.supabase.co` && port === 5432 && user === "atlas_assessment_api";
    const pooled =
      /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
      [5432, 6543].includes(port) &&
      user === `atlas_assessment_api.${project}`;
    if (!direct && !pooled) throw new Error();
    return {
      web: origin(value.web, true),
      api: origin(value.api, true),
      supabase: origin(value.supabase, true),
      project,
      assessment: { host, port, user },
    };
  }
  try {
    const pair = JSON.parse(raw ?? "");
    const pre = read(pair.pre),
      prod = read(pair.prod);
    const preOrigins = [pre.web, pre.api, pre.supabase];
    if (
      pre.project === prod.project ||
      [prod.web, prod.api, prod.supabase].some((url) => preOrigins.includes(url))
    )
      throw new Error();
    return mode === "pre" ? pre : prod;
  } catch {
    throw new Error(
      "ATLAS_HOSTED_IDENTITIES must declare separate PRE and PROD origins, projects and assessment endpoints.",
    );
  }
}
