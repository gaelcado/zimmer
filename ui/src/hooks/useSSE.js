import { useEffect, useRef } from 'react'

/**
 * Subscribe to a Server-Sent Events endpoint.
 * Reconnects with exponential backoff (1s → 15s cap).
 *
 * @param {string} url
 * @param {function} onEvent — called with each parsed event object
 * @param {function} onConnect — called when EventSource opens
 * @param {function} onDisconnect — called when connection drops
 */
export function useSSE(url, onEvent, onConnect, onDisconnect) {
  const onEventRef = useRef(onEvent)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])
  useEffect(() => { onConnectRef.current = onConnect }, [onConnect])
  useEffect(() => { onDisconnectRef.current = onDisconnect }, [onDisconnect])

  useEffect(() => {
    let es = null
    let retryDelay = 1000
    let cancelled = false
    let retryTimer = null

    function connect() {
      if (cancelled) return
      es = new EventSource(url)

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          onEventRef.current(data)
        } catch (_) {}
      }

      es.onerror = () => {
        es.close()
        es = null
        onDisconnectRef.current?.()
        if (!cancelled) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 15000)
            connect()
          }, retryDelay)
        }
      }

      es.onopen = () => {
        retryDelay = 1000
        onConnectRef.current?.()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (es) es.close()
    }
  }, [url])
}
