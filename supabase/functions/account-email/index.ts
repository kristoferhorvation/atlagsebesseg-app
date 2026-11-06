// AW25: fiók-levelek – a logika a handler.ts-ben. Hívás: POST, Authorization: Bearer <CRON_SECRET> (adatbázis-trigger, pg_net).
// A kapu-JWT-t a platform nem ellenőrzi (verify_jwt = false a config.toml-ban).
import { handleEmail } from './handler.ts';
// @ts-ignore: generált bundle (npm run build:edge)
import { accountEmail } from './emails.bundle.js';

Deno.serve((req: Request) =>
  handleEmail(
    req,
    {
      supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      cronSecret: Deno.env.get('CRON_SECRET') ?? '',
      resendKey: Deno.env.get('RESEND_API_KEY') ?? '',
      from: Deno.env.get('MAIL_FROM') ?? 'Tempomate <hello@tempomate.app>',
    },
    accountEmail
  )
);
