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
//
// The public interest register lives here too (Founder's decision,
// 2026-11-20), for the same reason: the muse.ai actions endpoint
// refuses every outside call (browser, proxy and server-side alike all
// receive 404), while the register itself stays healthy inside Muse.
// The page's register form now posts same-origin to /api/register,
// which speaks the same {action, args} envelope the page already uses
// and answers the two register actions from the registrations table in
// this website's own D1 database:
//   subscribe            -> saves the registration, returns its code
//   getregistrationcount -> returns the public count and the 2,000 goal
// Any other action is answered with an error, plainly.
//
// Numbering: the project's first registration (SLCA-000001, the
// labelled test of 2026-11-09) stands in the original register inside
// Muse, so REGISTER_BASE = 1: the count and the referral codes here
// continue from it, and no code is ever issued twice.
const REGISTER_BASE = 1;
const REGISTER_GOAL = 2000;

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

    if (url.pathname === "/api/register") {
      const json = (obj, status) =>
        new Response(JSON.stringify(obj), {
          status: status || 200,
          headers: { "content-type": "application/json" },
        });
      const db = env.VISITORS_DB;
      if (!db) return json({ error: "register unavailable" }, 503);
      if (request.method !== "POST") {
        return json({ error: "method not allowed" }, 405);
      }

      let action = "";
      let args = {};
      try {
        const body = await request.json();
        action = String((body && body.action) || "");
        args = (body && body.args) || {};
      } catch (e) {
        return json({ error: "bad request" }, 400);
      }

      try {
        await db
          .prepare(
            "CREATE TABLE IF NOT EXISTS registrations (" +
              "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
              "referral_code TEXT, " +
              "full_name TEXT NOT NULL, " +
              "contact TEXT NOT NULL, " +
              "province TEXT, " +
              "district_village TEXT, " +
              "num_children INTEGER, " +
              "membership_type TEXT, " +
              "age_band TEXT, " +
              "participation_preference TEXT, " +
              "language TEXT, " +
              "consent INTEGER NOT NULL DEFAULT 0, " +
              "rules_accepted INTEGER NOT NULL DEFAULT 0, " +
              "referred_by TEXT, " +
              "created_at TEXT)"
          )
          .run();

        const countRows = async () => {
          const row = await db
            .prepare("SELECT COUNT(*) AS n FROM registrations")
            .first();
          return REGISTER_BASE + (Number(row && row.n) || 0);
        };

        if (action === "getregistrationcount") {
          return json({
            data: { count: await countRows(), goal: REGISTER_GOAL },
          });
        }

        if (action === "subscribe") {
          const clean = (v, max) =>
            String(v == null ? "" : v)
              .trim()
              .slice(0, max);
          const fullName = clean(args.fullName, 200);
          const contact = clean(args.contact, 200);
          const province = clean(args.province, 120);
          if (!fullName || !contact || !province) {
            return json(
              { error: "name, contact and province are required" },
              400
            );
          }
          if (args.consent !== true || args.rulesAccepted !== true) {
            return json({ error: "consent is required" }, 400);
          }
          let numChildren = parseInt(args.numChildren, 10);
          if (!isFinite(numChildren) || numChildren < 0 || numChildren > 30) {
            numChildren = 0;
          }
          const ins = await db
            .prepare(
              "INSERT INTO registrations (" +
                "full_name, contact, province, district_village, " +
                "num_children, membership_type, age_band, " +
                "participation_preference, language, consent, " +
                "rules_accepted, referred_by, created_at) " +
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 1, ?10, " +
                "datetime('now'))"
            )
            .bind(
              fullName,
              contact,
              province,
              clean(args.districtVillage, 300),
              numChildren,
              clean(args.membershipType, 40),
              clean(args.ageBand, 40),
              clean(args.participationPreference, 40),
              clean(args.language, 10),
              clean(args.referralCode, 40)
            )
            .run();
          let newId = Number(ins && ins.meta && ins.meta.last_row_id);
          if (!newId || !isFinite(newId)) {
            const rowAfter = await db
              .prepare("SELECT COUNT(*) AS n FROM registrations")
              .first();
            newId = Number(rowAfter && rowAfter.n) || 0;
          }
          const referralCode =
            "SLCA-" + String(REGISTER_BASE + newId).padStart(6, "0");
          await db
            .prepare("UPDATE registrations SET referral_code = ?1 WHERE id = ?2")
            .bind(referralCode, newId)
            .run();
          return json({
            data: { referralCode: referralCode, count: await countRows() },
          });
        }

        return json({ error: "action not available here" }, 404);
      } catch (e) {
        return json({ error: "register unavailable" }, 503);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
