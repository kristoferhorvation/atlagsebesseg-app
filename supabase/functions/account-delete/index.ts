// AW22: fiók törlése – a logika a handler.ts-ben (lásd ott). Hívás: POST, a felhasználó saját JWT-jével.
import { handleDelete } from './handler.ts';

Deno.serve((req: Request) =>
  handleDelete(req, {
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  })
);
