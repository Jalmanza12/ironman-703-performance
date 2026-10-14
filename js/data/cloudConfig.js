// Public Supabase configuration for optional cloud backup. These are *publishable* keys, designed
// to ship in browser code: they only identify the project. Data is protected by row level security
// (supabase/migrations) — each athlete can read and write only their own row.
// The live site uses production; localhost (and anything else) uses staging.

export const CLOUD_PROJECTS = {
  production: { url: 'https://nqferhukatkzcyaokzrp.supabase.co', key: 'sb_publishable_tybjodYZnEDDADVDD7xfow_MZ2FzD9e' },
  staging: { url: 'https://zpalawbmldmejyuqpozs.supabase.co', key: 'sb_publishable_91rHt6NEuSteFVWUoOLGZg_DBBwsovW' },
};

export function cloudProject(hostname = typeof location === 'undefined' ? '' : location.hostname) {
  return hostname === 'jalmanza12.github.io' ? CLOUD_PROJECTS.production : CLOUD_PROJECTS.staging;
}
