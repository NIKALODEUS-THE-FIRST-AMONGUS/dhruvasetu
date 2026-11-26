/** The connection to Supabase. Loaded only when the page follows the database, so a page
 *  that shows its built-in sample carries none of it. */
import type { Backend } from './backend'
import type { StreamAnswer, Transport } from './hosted'

interface ReportRow {
  id: number
  received_at: string
  source: string
  report: unknown
}

export async function supabaseTransport(backend: Backend): Promise<Transport> {
  const { createClient } = await import('@supabase/supabase-js')
  // Nobody signs in on this page: no session is kept, refreshed or looked for.
  const client = createClient(backend.url, backend.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    async stream(after) {
      const { data, error } = await client.rpc('stream', { p_buoy: backend.buoy, p_after: after })
      if (error) throw new Error(error.message)
      return data as StreamAnswer
    },
    listen(onItem, onJoined) {
      const channel = client
        .channel(`reports-of-buoy-${backend.buoy}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports', filter: `buoy=eq.${backend.buoy}` }, (change) => {
          const row = change.new as ReportRow
          onItem({ id: row.id, received_ms: Date.parse(row.received_at), source: row.source, report: row.report })
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onJoined()
        })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
