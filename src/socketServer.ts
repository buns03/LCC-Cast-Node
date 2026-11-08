import type { IncomingMessage, Server } from "http";
import { onBroadcast } from "./realtime";
import { isAllowed } from "./cors";

/**
 * Replaces Spring's WebSocketConfig:
 *   registry.addEndpoint("/ws-analytics").setAllowedOriginPatterns("*").withSockJS();
 *   registry.enableSimpleBroker("/topic");
 *
 * Speaks STOMP over SockJS, so your existing browser JS (SockJS + stompjs, subscribe("/topic/...")) works unchanged.
 * Everything that calls realtime.xxxChanged(...) is pushed to the browsers subscribed to that topic.
 *
 * Differences from Spring: a connection is not tied to the login session (SockJS hides cookies from the server).
 * The messages only say "something changed" ({campusId, ts, program}); pages then re-fetch their data through the
 * normal, login-protected API.
 *
 * Not pushed yet: /topic/live-results and /topic/analytics (LiveResultsService / AnalyticsService not migrated),
 * and /topic/history/actions (AuditLogDTO not shared).
 */

interface Client {
  conn: {
    write: (data: string) => unknown;
    close: (code?: number, reason?: string) => unknown;
  };
  subs: Map<string, string>; // subscription id -> destination
}

const clients = new Set<Client>();

/** true when at least one browser is connected (used to skip pointless live-results queries) */
export const hasClients = () => clients.size > 0;
let nextMessageId = 1;

const frame = (
  command: string,
  headers: Record<string, string | number>,
  body = "",
) =>
  `${command}\n${Object.entries(headers)
    .map(([k, v]) => `${k}:${v}`)
    .join("\n")}\n\n${body}\0`;

function parseFrames(
  raw: string,
): { command: string; headers: Record<string, string>; body: string }[] {
  const out: {
    command: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  for (const chunk of raw.split("\0")) {
    const text = chunk.replace(/^\n+/, ""); // leading newlines are heart-beats
    if (!text.trim()) continue;
    const sep = text.indexOf("\n\n");
    const head = (sep >= 0 ? text.slice(0, sep) : text).split("\n");
    const headers: Record<string, string> = {};
    for (const line of head.slice(1)) {
      const i = line.indexOf(":");
      if (i > 0 && !(line.slice(0, i) in headers))
        headers[line.slice(0, i)] = line.slice(i + 1).replace(/\r$/, "");
    }
    out.push({
      command: head[0].trim(),
      headers,
      body: sep >= 0 ? text.slice(sep + 2) : "",
    });
  }
  return out;
}

/** exact destination, or an Ant-style pattern like /topic/** like Spring's simple broker */
function matches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (!pattern.includes("*")) return false;
  const re = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`).test(topic);
}

/** SockJS answers /ws-analytics itself, so Express never sees those requests.
 *  Wrap the server's listeners and reject foreign origins before SockJS does. */
function guardSocketOrigin(httpServer: Server): void {
  for (const event of ["request", "upgrade"] as const) {
    const listeners = httpServer.listeners(event) as ((
      ...args: any[]
    ) => void)[];
    httpServer.removeAllListeners(event);

    httpServer.on(event, (req: IncomingMessage, target: any, head?: Buffer) => {
      const isSocketPath = (req.url ?? "").startsWith("/ws-analytics");

      if (isSocketPath && !isAllowed(req.headers.origin, req.headers.host)) {
        if (event === "request") {
          target.writeHead(403);
          target.end();
        } else {
          target.destroy(); // websocket handshake
        }
        return;
      }

      for (const listener of listeners)
        listener.call(httpServer, req, target, head);
    });
  }
}

export function startSocketServer(httpServer: Server): void {
  let sockjs: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sockjs = require("sockjs");
  } catch {
    console.warn(
      'Live updates are OFF: the "sockjs" package is not installed. Run: npm install',
    );
    return;
  }

  const server = sockjs.createServer({
    prefix: "/ws-analytics",
    log: () => {},
  });

  server.on(
    "connection",
    (
      conn: Client["conn"] & {
        on: (ev: string, cb: (...a: any[]) => void) => void;
      },
    ) => {
      if (!conn) return;
      const client: Client = { conn, subs: new Map() };
      clients.add(client);

      conn.on("data", (message: string) => {
        try {
          for (const f of parseFrames(String(message))) {
            switch (f.command) {
              case "CONNECT":
              case "STOMP":
                {
                  // answer with the highest STOMP version both sides support (old stomp.js 2.x only knows 1.0/1.1)
                  const offered = (f.headers["accept-version"] || "1.0")
                    .split(",")
                    .map((v) => v.trim());
                  const version =
                    ["1.2", "1.1", "1.0"].find((v) => offered.includes(v)) ??
                    "1.0";
                  conn.write(
                    frame("CONNECTED", { version, "heart-beat": "0,0" }),
                  );
                }
                break;
              case "SUBSCRIBE":
                if (f.headers.id && f.headers.destination)
                  client.subs.set(f.headers.id, f.headers.destination);
                if (f.headers.receipt)
                  conn.write(
                    frame("RECEIPT", { "receipt-id": f.headers.receipt }),
                  );
                break;
              case "UNSUBSCRIBE":
                client.subs.delete(f.headers.id);
                if (f.headers.receipt)
                  conn.write(
                    frame("RECEIPT", { "receipt-id": f.headers.receipt }),
                  );
                break;
              case "DISCONNECT":
                if (f.headers.receipt)
                  conn.write(
                    frame("RECEIPT", { "receipt-id": f.headers.receipt }),
                  );
                break;
              default:
                break; // SEND / ACK / NACK: the app has no /app handlers
            }
          }
        } catch (e) {
          console.error("[socket] bad frame:", (e as Error).message);
        }
      });

      conn.on("close", () => {
        clients.delete(client);
      });
    },
  );

  server.installHandlers(httpServer);
  guardSocketOrigin(httpServer); // must come AFTER installHandlers

  // every realtime.xxxChanged(...) goes to the browsers subscribed to that topic
  onBroadcast((topic, payload) => {
    const body = JSON.stringify(payload);
    for (const client of clients) {
      for (const [subId, destination] of client.subs) {
        if (!matches(destination, topic)) continue;
        try {
          client.conn.write(
            frame(
              "MESSAGE",
              {
                destination: topic,
                "content-type": "application/json",
                subscription: subId,
                "message-id": nextMessageId++,
                "content-length": Buffer.byteLength(body),
              },
              body,
            ),
          );
        } catch {
          /* connection already gone */
        }
      }
    }
  });
}
