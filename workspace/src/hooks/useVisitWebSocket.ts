"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { getRealtimeWebSocketUrl } from "../lib/realtime";
import { authApi } from "../lib/api";

export type WsMessage = {
  type: string;
  data?: Record<string, unknown>;
  error?: string;
};

export function useVisitWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const intentionalClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(3000);
  const retryCount = useRef(0);
  const MAX_RETRIES = 8;

  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    void (async () => {
      try {
        const ticketResponse = await authApi.getWebSocketTicket();
        const url = getRealtimeWebSocketUrl();
        if (!url) return;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: "AUTH",
              data: { ticket: ticketResponse.ticket },
            }),
          );
        };

        ws.onclose = () => {
          setConnected(false);
          if (!intentionalClose.current && retryCount.current < MAX_RETRIES) {
            retryCount.current += 1;
            reconnectTimer.current = setTimeout(() => {
              reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
              connectRef.current?.();
            }, reconnectDelay.current);
          }
        };

        ws.onerror = () => ws.close();

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as WsMessage;
            if (msg.type === "AUTHENTICATED") {
              setConnected(true);
              reconnectDelay.current = 3000;
              retryCount.current = 0;
              if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
              }
              return;
            }

            setLastMessage(msg);
          } catch {
            /* ignore malformed messages */
          }
        };
      } catch {
        setConnected(false);
        if (!intentionalClose.current && retryCount.current < MAX_RETRIES) {
          retryCount.current += 1;
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
            connectRef.current?.();
          }, reconnectDelay.current);
        }
      }
    })();
  }, [token]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!token) return;
    intentionalClose.current = false;
    connect();
    return () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [token, connect]);

  const send = useCallback(
    (msg: object): boolean => {
      if (connected && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
        return true;
      }
      return false;
    },
    [connected]
  );

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    setConnected(false);
  }, []);

  return { send, lastMessage, connected, disconnect };
}
