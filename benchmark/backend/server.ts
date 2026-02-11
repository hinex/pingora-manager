const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams);

    // Static files (fallback for proxies that can't serve files directly)
    if (url.pathname.startsWith("/static/")) {
      const filePath = `./public/${url.pathname.slice(8)}`;
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Cache-Control": "no-store, no-cache" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    if (url.pathname === "/api/data") {
      let body = null;
      if (req.method === "POST" || req.method === "PUT") {
        try {
          body = await req.json();
        } catch {
          body = await req.text();
        }
      }

      return Response.json(
        {
          method: req.method,
          random: Math.random(),
          timestamp: Date.now(),
          query,
          ...(body !== null ? { body } : {}),
        },
        {
          headers: { "Cache-Control": "no-store, no-cache" },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Backend listening on port ${server.port}`);
