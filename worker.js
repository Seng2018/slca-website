// slca-website worker: serves the static site, and carries the visitor
// counter between edu-secu.com and the project's register on muse.ai.
// The counter endpoints are same-origin (/api/visitors, /api/visit), so the
// page never has to call across origins; this worker makes the upstream
// call itself, stamped with the muse.ai origin the register expects.
// On /api/visit it also forwards the visitor's country, which the
// Cloudflare edge itself reports for the request (request.cf.country) —
// the same source Tanda Flash's admin uses for its country flags.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The worker's own machinery files are not public documents.
    if (url.pathname === "/worker.js" || url.pathname === "/wrangler.toml") {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/api/visitors" || url.pathname === "/api/visit") {
      const isMark = url.pathname === "/api/visit";
      let visitorKey = "";
      if (isMark) {
        try {
          const body = await request.json();
          visitorKey = String((body && body.visitorKey) || "");
        } catch (e) {
          visitorKey = "";
        }
        if (!visitorKey) {
          return new Response(
            JSON.stringify({ visitors: 0, visits: 0, countries: [] }),
            { headers: { "content-type": "application/json" } }
          );
        }
      }

      const upstream =
        "https://muse.ai/spaces/v2/student-life-cycle-assurance-project/actions";
      const args = { visitorKey: visitorKey };
      if (isMark) {
        const cfCountry =
          request.cf && request.cf.country ? String(request.cf.country) : "";
        if (/^[A-Za-z]{2}$/.test(cfCountry) && cfCountry.toUpperCase() !== "XX") {
          args.country = cfCountry.toUpperCase();
        }
      }
      const payload = isMark
        ? { action: "markvisit", args: args }
        : { action: "getvisitorcount", args: {} };

      try {
        const r = await fetch(upstream, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://muse.ai",
            referer: upstream,
          },
          body: JSON.stringify(payload),
        });
        const text = await r.text();
        try {
          const j = JSON.parse(text);
          const d = j && j.data ? j.data : j;
          const countries = Array.isArray(d.countries)
            ? d.countries.map((c) => ({
                code: String((c && c.code) || ""),
                visitors: Number(c && c.visitors) || 0,
              }))
            : [];
          return new Response(
            JSON.stringify({
              visitors: Number(d.visitors) || 0,
              visits: Number(d.visits) || 0,
              countries: countries,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        } catch (e) {
          return new Response(text, {
            status: r.status,
            headers: { "content-type": "application/json" },
          });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: "counter unreachable" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
