// slca-website worker: serves the static site, and carries the visitor
// counter between edu-secu.com and the project's register on muse.ai.
// The counter endpoints are same-origin (/api/visitors, /api/visit), so the
// page never has to call across origins; this worker makes the upstream
// call itself, stamped with the muse.ai origin the register expects.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
          return new Response(JSON.stringify({ visitors: 0, visits: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }
      }

      const upstream =
        "https://muse.ai/spaces/v2/student-life-cycle-assurance-project/actions";
      const payload = isMark
        ? { action: "markvisit", args: { visitorKey: visitorKey } }
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
          return new Response(
            JSON.stringify({
              visitors: Number(d.visitors) || 0,
              visits: Number(d.visits) || 0,
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
