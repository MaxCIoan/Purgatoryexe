const blockedUserAgents = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bhttpie\b/i,
  /\bpython-requests\b/i,
  /\baiohttp\b/i,
  /\burllib\b/i,
  /\blibwww-perl\b/i,
  /\bgo-http-client\b/i,
  /\bjava\b/i,
  /\bokhttp\b/i,
  /\bpostmanruntime\b/i,
  /\binsomnia\b/i,
  /\bpowershell\b/i,
];

export default async function blockCliClients(
  request: Request,
  context: { next: () => Promise<Response> },
) {
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  const fetchMode = request.headers.get("sec-fetch-mode") || "";
  const fetchSite = request.headers.get("sec-fetch-site") || "";
  const looksLikeCli = blockedUserAgents.some((pattern) => pattern.test(userAgent));
  const hasBrowserFetchMetadata = Boolean(fetchMode && fetchSite);
  const acceptsHtmlOrAssets = /text\/html|image\/|text\/css|javascript|\*\/\*/i.test(accept);

  if (looksLikeCli || (!hasBrowserFetchMetadata && !acceptsHtmlOrAssets)) {
    return new Response("Forbidden\n", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return context.next();
}
