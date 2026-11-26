/** Where the reports are kept: a Supabase project.
 *
 *  The key below is the project's publishable key. It is meant to be public: it lets a page
 *  read the reports and hand in a frame, and nothing else, because the database itself
 *  refuses the rest (row-level security; see supabase/migrations). A secret key, the
 *  database password or a buoy's own key must never be written here or anywhere in this
 *  repository. */
export interface Backend {
  url: string
  key: string
  /** The buoy whose reports the page shows. */
  buoy: number
}

export const BACKEND: Backend = {
  url: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://qumxkgtniseyjjvpcmxm.supabase.co',
  key: (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? 'sb_publishable_5qcTm0SonBSxleBoZZHYTQ_cT1wob_4',
  buoy: 1,
}
