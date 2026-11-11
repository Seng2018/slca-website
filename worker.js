// slca-website worker: serves the static site, and keeps the visitor
// counter in a small D1 database attached to this website itself
// (binding VISITORS_DB). The counter endpoints are same-origin
// (/api/visitors, /api/visit), so the page never calls across origins.
// Each visitor is one row keyed by a random browser-generated key (no
// personal data); the visitor's country is the one the Cloudflare edge
// itself reports for the request (request.cf.country) — the same source
// Tanda Flash's admin uses for its country flags.
//
// History: this worker first tried to carry the count to the project's
// register on muse.ai, but that endpoint refuses every server-side and
// proxied call (three attempts, same 404), so the counter lives here.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The worker's own machinery files are not public documents.
    if (url.pathname === "/worker.js" || url.pathname === "/wrangler.toml") {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/api/visitors" || url.pathname === "/api/visit") {
      const json = (obj) =>
        new Response(JSON.stringify(obj), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const db = env.VISITORS_DB;
      if (!db) return json({ visitors: 0, visits: 0, countries: [] });

      try {
        await db
          .prepare(
            "CREATE TABLE IF NOT EXISTS visitor_marks (" +
              "visitor_key TEXT PRIMARY KEY, " +
              "country TEXT, " +
              "visits INTEGER NOT NULL DEFAULT 0, " +
              "last_seen TEXT)"
          )
          .run();

        if (url.pathname === "/api/visit") {
          let visitorKey = "";
          try {
            const body = await request.json();
            visitorKey = String((body && body.visitorKey) || "");
          } catch (e) {
            visitorKey = "";
          }
          if (visitorKey) {
            let country = null;
            const cfCountry =
              request.cf && request.cf.country
                ? String(request.cf.country)
                : "";
            if (
              /^[A-Za-z]{2}$/.test(cfCountry) &&
              cfCountry.toUpperCase() !== "XX"
            ) {
              country = cfCountry.toUpperCase();
            }
            await db
              .prepare(
                "INSERT INTO visitor_marks (visitor_key, country, visits, last_seen) " +
                  "VALUES (?1, ?2, 1, datetime('now')) " +
                  "ON CONFLICT(visitor_key) DO UPDATE SET " +
                  "visits = visits + 1, " +
                  "last_seen = datetime('now'), " +
                  "country = COALESCE(excluded.country, visitor_marks.country)"
              )
              .bind(visitorKey, country)
              .run();
          }
        }

        const totals = await db
          .prepare(
            "SELECT COUNT(*) AS visitors, COALESCE(SUM(visits), 0) AS visits FROM visitor_marks"
          )
          .first();
        const byCountry = await db
          .prepare(
            "SELECT country AS code, COUNT(*) AS visitors FROM visitor_marks " +
              "WHERE country IS NOT NULL GROUP BY country ORDER BY visitors DESC"
          )
          .all();
        return json({
          visitors: Number(totals && totals.visitors) || 0,
          visits: Number(totals && totals.visits) || 0,
          countries: ((byCountry && byCountry.results) || []).map((r) => ({
            code: String(r.code || ""),
            visitors: Number(r.visitors) || 0,
          })),
        });
      } catch (e) {
        return json({ visitors: 0, visits: 0, countries: [] });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
