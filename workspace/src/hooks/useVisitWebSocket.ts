"use client";

import { useEffect, useRef, useCallback, useState } from 'react';

export type WsMessage = {
  type: string;
  data?: Record<string, unknown>;
  error?: string;
};

function getWsUrl(token: string): string {
  const apiUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/api\/?$/, '') ||
    'http://localhost:4000';
  const wsUrl = apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
  return `${wsUrl}?token=${token}`;
}

export function useVisitWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const intentionalClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(3000);

  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 3000;
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!intentionalClose.current) {
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
          setLastMessage(msg);
        } catch {
          /* ignore malformed messages */
        }
      };
    } catch {
      /* ignore connection errors — retry will happen via onclose */
    }
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
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
        return true;
      }
      return false;
    },
    []
  );

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    setConnected(false);
  }, []);

  return { send, lastMessage, connected, disconnect };
}
