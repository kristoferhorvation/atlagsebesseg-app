import * as api from '@atlagsebesseg/app-logic';
import type { BBox, ReportInsert, ReportRow } from '@atlagsebesseg/app-logic';
import { supabase } from './supabase';

export type { ReportRow };

/** Le nem járt bejelentések a téglalapban (olvasás bejelentkezés nélkül is megy). */
export const listActiveReports = (b: BBox): Promise<ReportRow[]> => api.listActiveReports(supabase, b);

/** Bejelentés(ek), pl. ideiglenes kapuk – anonim bejelentkezéssel. */
export const createReports = (rows: ReportInsert[]): Promise<string[]> => api.createReports(supabase, rows);

/** Megerősítés (true) vagy cáfolat (false); újraszavazásnál felülírja a sajátot. */
export const voteReport = (reportId: string, confirm: boolean): Promise<void> => api.voteReport(supabase, reportId, confirm);
