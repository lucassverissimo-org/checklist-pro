import { createHandler } from "./handler.ts";

// There is no user JWT: the handler checks the checklist capability token via SQL.
Deno.serve(
  createHandler({
    url: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    cleanupSecret: Deno.env.get("CHECKLIST_CLEANUP_SECRET") ?? "",
  }),
);
