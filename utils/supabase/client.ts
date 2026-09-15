import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "./info";

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  {
    auth: {
      storageKey: "gross-anatomy-admin-auth",
      detectSessionInUrl: window.location.pathname.startsWith("/admin"),
    },
  },
);

export const studentSupabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  {
    auth: {
      storageKey: "gross-anatomy-student-auth",
      detectSessionInUrl: window.location.pathname.startsWith("/student"),
    },
  },
);
