import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://iaffzllmpdlotfuvfezr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Oy0RL09xFKxlqz7HX_z7ag_DSQx5-n-";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
