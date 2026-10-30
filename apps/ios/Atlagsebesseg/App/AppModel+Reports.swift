import AtlagsebessegCore
import Foundation
import SwiftUI

// AOS14: a bejelentések kötése (a webes App.tsx bejelentés-része és a useReports.ts megfelelője): a térkép bejelentései
// (lekérés a látható téglalapra vagy a pozíció körül, 60 s-enként), Bejelentés menü, koppintásos kártya, „Még ott van?”
// közeledéskor, szavazás, visszajelző toast. A logika a Logic/Reports.swift-ben.

/// Rövid visszajelzés a képernyő tetején (a webes `toast`).
struct AppToast: Equatable, Identifiable {
    var id = UUID()
    var text: String
    var color: Color
    var icon: IconName
    var seconds = 2.6
}

/// Mérés közben a koppintott bejelentés kártyája ennyi idő után magától bezárul (a webes `REPORT_CARD_AUTOCLOSE_MS`).
let REPORT_CARD_AUTOCLOSE_S = 3.0

extension AppModel {
    func setUpReports() {
        reportFeed = ReportFeed(
            fetch: { [weak self] b in
                guard let self else { return [] }
                if self.sim != nil { return self.simReports }
                return try await self.backend.activeReports(in: b)
            },
            now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 }
        )
    }

    /// A térkép látható téglalapja (a `MapScreen` küldi kamera-mozdulatkor) – új csempe-téglalapnál új lekérés.
    func setReportView(_ b: BBox) {
        let before = reportQuery(reportView, center: nil)?.key
        reportView = b
        // kamera-mozdulatonként sokszor jön: csak új csempe-téglalapnál nézünk rá
        if reportQuery(b, center: nil)?.key != before { checkReports() }
    }

    /// Kell-e lekérni (új téglalap / 60 s), a lista frissítése (lejártak), és a „Még ott van?” kérdés.
    func checkReports() {
        guard let feed = reportFeed else { return }
        if let q = reportQuery(reportView, center: lastFix.map { LatLon(lat: $0.lat, lon: $0.lon) }), feed.shouldFetch(q) {
            Task { [weak self] in
                if await feed.refresh(q) { self?.syncReports() }
            }
        }
        syncReports()
    }

    private func syncReports() {
        guard let feed = reportFeed else { return }
        let list = feed.list()
        if list != reports { reports = list }
        let id = reportPrompt.update(lastFix, list, voted: { feed.myVote($0) != nil }, now: nowMs())
        if id != reportPromptId { reportPromptId = id }
        if let sel = selectedReportId, !list.contains(where: { $0.id == sel }) { selectedReportId = nil }
    }

    /// A kártyán látható bejelentés: a koppintott, különben a kérdezett (a koppintott elsőbbséget kap).
    var shownReport: (report: ActiveReport, prompt: Bool)? {
        if let id = selectedReportId, let r = reports.first(where: { $0.id == id }) { return (r, false) }
        if let id = reportPromptId, let r = reports.first(where: { $0.id == id }) { return (r, true) }
        return nil
    }

    func myVote(_ id: String) -> Bool? { reportFeed?.myVote(id) }

    /// Koppintás egy jelölőre: a kártya nyílik (mérés közben 3 s után magától zárul, mint a weben).
    func selectReport(_ id: String) {
        selectedReportId = id
        let measuring = view.phase == .meres || view.phase == .kezi
        guard measuring else { return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(REPORT_CARD_AUTOCLOSE_S))
            if self?.selectedReportId == id { self?.selectedReportId = nil }
        }
    }

    func closeReportCard() {
        if let s = shownReport, s.prompt {
            reportPrompt.close()
            reportPromptId = nil
        } else {
            selectedReportId = nil
        }
    }

    /// Bejelentés a jelenlegi helyről (2. koppintás a típusra – nincs megerősítő lépés). A szimulátorban csak helyben.
    func sendReport(_ choice: ReportChoice) {
        guard let fix = lastFix, let row = reportFromFix(choice, fix) else { return }
        let label = choice.label
        reportSending = choice
        let done = { [weak self] (id: String?) in
            guard let self else { return }
            if let id { self.reportFeed?.addOwn(ownReport(row, id: id, now: self.nowMs())) }
            self.syncReports()
            self.showToast(AppToast(text: t(.reportSent, ["label": label]), color: Tokens.StatusColors.jo, icon: .check))
            self.reportSending = nil
            self.reportSheetOpen = false
        }
        if sim != nil {
            done("sim-own-\(Int(nowMs()))")
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                done(try await self.backend.createReports([row]).first)
            } catch {
                self.showToast(AppToast(text: t(.reportSendFail), color: Tokens.StatusColors.tul, icon: .report))
                self.reportSending = nil
                self.reportSheetOpen = false
            }
        }
    }

    /// Megerősítés / nincs ott (`report_votes`); a szimulátorban csak helyben.
    func vote(_ id: String, confirm: Bool) {
        let done = { [weak self] in
            guard let self else { return }
            self.reportFeed?.vote(id, confirm)
            self.showToast(AppToast(text: t(confirm ? .voteConfirmed : .voteGone), color: Tokens.StatusColors.jo, icon: .check))
            self.selectedReportId = nil
            if self.reportPrompt.current == id { self.reportPrompt.close() }
            self.syncReports()
        }
        if sim != nil { return done() }
        voting = true
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.backend.voteReport(id, confirm: confirm)
                done()
            } catch {
                self.showToast(AppToast(text: t(.reportSendFail), color: Tokens.StatusColors.tul, icon: .report))
            }
            self.voting = false
        }
    }

    func showToast(_ toast: AppToast) {
        self.toast = toast
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(toast.seconds))
            if self?.toast?.id == toast.id { self?.toast = nil }
        }
    }

    /// A szimulátor minta-bejelentései (a webes `simReports`), a lejátszás kezdetéhez tolva.
    func loadSimReports(_ fixture: SimFixture, t0: Double) {
        simReports = fixture.reports.map { $0.report(at: t0) }
        // új adatforrás: üres feed, az első fixnél lekér (a szerver helyett a mintákat)
        setUpReports()
        reports = []
        reportPrompt.reset()
        selectedReportId = nil
        reportPromptId = nil
    }
}
