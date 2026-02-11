import { renderToReadableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";
import { startWatchdog } from "~/lib/watchdog/worker";

// Start watchdog on server boot (only once)
let watchdogStarted = false;
if (!watchdogStarted) {
  watchdogStarted = true;
  startWatchdog();
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        console.error(error);
        responseStatusCode = 500;
      },
    }
  );

  await stream.allReady;

  responseHeaders.set("Content-Type", "text/html");

  return new Response(stream, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
