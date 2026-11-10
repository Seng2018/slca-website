// ============================================================================
// DRAFT — NOT DEPLOYED — FOR LATER USE
// Cloudflare Pages Function: /spaces/* proxy to https://muse.ai
// ----------------------------------------------------------------------------
// Why this exists:
//   The SLCA public page (index.html) saves its forms by POSTing to the
//   origin-relative path /spaces/v2/student-life-cycle-assurance-project/
//   actions (the register, pilot-study, application, CV and vacancy forms,
//   file attachments, and the job-board reads all use that one endpoint).
//   While the page is served from Muse's own origin this works directly.
//   When the page is served from edu-secu.com (Cloudflare Pages, from the
//   GitHub repo Seng2018/slca-website), /spaces/* does not exist on that
//   origin — so this Function forwards those requests to https://muse.ai,
//   where the project's real actions endpoint lives, and returns the
//   upstream response unchanged.
//
// How to deploy it later (do NOT do this until the wiring step):
//   1. In the repo, create the folder  functions/spaces/
//   2. Save this file there as         functions/spaces/[[path]].js
//      (the [[path]] catch-all makes it answer every /spaces/* route)
//   3. Commit + push; Cloudflare Pages picks Functions up automatically
//      on the next deployment. No wrangler config is needed for this file.
//
// Notes:
//   - Method, query string, headers and request body are forwarded as-is;
//     the response (status, headers, body) is returned untouched, so the
//     page's existing callRegisterAction() helper needs no changes.
//   - The 'host' header is dropped so the upstream sees its own host.
//   - Requests outside /spaces/* are not handled here at all.
// ============================================================================

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Safety: this Function only ever proxies the /spaces/* tree.
  if (!url.pathname.startsWith("/spaces/")) {
    return new Response("Not found", { status: 404 });
  }

  // Same path + same query string, on the Muse origin.
  const upstreamUrl = "https://muse.ai" + url.pathname + url.search;

  // Copy the incoming headers, minus the host header.
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init = {
    method: request.method,
    headers: headers,
    redirect: "manual",
  };

  // Forward the body on methods that carry one (the forms POST JSON,
  // including base64-encoded file attachments).
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Required by the Fetch spec when streaming a request body.
    init.duplex = "half";
  }

  const upstreamResponse = await fetch(upstreamUrl, init);

  // Return the upstream response exactly as received.
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers,
  });
}
