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

    /// Kell-e lekérni (új téglalap / 60 s), a lista frissítése (lejártak), és a közeledő bejelentés kártyája.
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
        let p = reportPrompt.update(lastFix, list, voted: { feed.myVote($0) != nil }, now: nowMs())
        // a távolság 10 m-es lépésben frissül (nem minden óra-lépésnél új állapot)
        let same = p?.id == reportPromptState?.id && p?.phase == reportPromptState?.phase
            && Int(((p?.distanceM ?? 0) / 10).rounded()) == Int(((reportPromptState?.distanceM ?? 0) / 10).rounded())
        if !same { reportPromptState = p }
        if let sel = selectedReportId, !list.contains(where: { $0.id == sel }) { selectedReportId = nil }
        runLiveTestHooks()
    }

    /// A koppintott jelölő kártyája (lent, a gombsor fölött).
    var shownReport: ActiveReport? {
        selectedReportId.flatMap { id in reports.first { $0.id == id } }
    }

    /// AOS14: a közeledő bejelentés kártyája (a kamera-figyelmeztetés helyén: a manőverkártyán, vagy önállóan ugyanott).
    var reportAlert: (prompt: ReportPrompt, report: ActiveReport)? {
        guard let p = reportPromptState, let r = reports.first(where: { $0.id == p.id }) else { return nil }
        return (p, r)
    }

    /// A térképen kiemelt jelölő: a koppintott, különben a közeledő.
    var highlightedReportId: String? { shownReport?.id ?? reportPromptState?.id }

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
        selectedReportId = nil
    }

    /// Bejelentés a jelenlegi helyről (2. koppintás a típusra – nincs megerősítő lépés). A szimulátorban is a szerverre
    /// megy, mint a weben (AOS14 javítás); sikeres küldés után a kapu-tétel vált (`gateStartedAfter`).
    func sendReport(_ choice: ReportChoice) {
        guard let fix = lastFix, let row = reportFromFix(choice, fix) else { return }
        let label = choice.label
        reportSending = choice
        let done = { [weak self] (id: String?) in
            guard let self else { return }
            if let id { self.reportFeed?.addOwn(ownReport(row, id: id, now: self.nowMs())) }
            self.gateStarted = gateStartedAfter(self.gateStarted, .sent(choice))
            if self.sim != nil { NSLog("LIVE-TEST report sent: %@ %@", choice.rawValue, id ?? "-") }
            self.syncReports()
            self.showToast(AppToast(text: t(.reportSent, ["label": label]), color: Tokens.StatusColors.jo, icon: .check))
            self.reportSending = nil
            self.reportSheetOpen = false
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

    /// Megerősítés / nincs ott (`report_votes`). A szimulátor minta-bejelentéseire csak helyben (mint a weben: azok nincsenek a
    /// szerveren); a valódi (szerverről jött) bejelentésre a szimulátorban is a szerverre megy.
    func vote(_ id: String, confirm: Bool) {
        let done = { [weak self] in
            guard let self else { return }
            self.reportFeed?.vote(id, confirm)
            self.showToast(AppToast(text: t(confirm ? .voteConfirmed : .voteGone), color: Tokens.StatusColors.jo, icon: .check))
            self.selectedReportId = nil
            if self.reportPrompt.current == id { self.reportPrompt.close() }
            self.syncReports()
        }
        if sim != nil, simReports.contains(where: { $0.id == id }) { return done() }
        voting = true
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.backend.voteReport(id, confirm: confirm)
                NSLog("LIVE-TEST vote sent: %@ %@", id, confirm ? "true" : "false")
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
        reportPromptState = nil
    }
}

extension AppModel {
    /// AOS14 javítás: a mérés vagy a navigáció vége a kapu-tételt visszaállítja („Átlagmérés eleje”).
    func updateGateActivity() {
        let now = (measuring: view.phase == .meres || view.phase == .kezi, nav: nav != nil)
        if (gateActivity.measuring && !now.measuring) || (gateActivity.nav && !now.nav) {
            gateStarted = gateStartedAfter(gateStarted, .activityEnded)
        }
        gateActivity = now
    }

    /// Élő próba (csak DEBUG): `-autoReport <típus>` az első pozíciónál egyszer bejelent, `-autoVoteId <uuid> -autoVote YES|NO`
    /// egyszer szavaz egy szerveren lévő (más felhasználó által küldött) bejelentésre – a fej nélküli szimulátorban így
    /// próbálható a `reports` / `report_votes` írás (érintés nélkül).
    func runLiveTestHooks() {
        #if DEBUG
        let args = UserDefaults.standard
        if !liveTestReported, lastFix != nil, let raw = args.string(forKey: "autoReport"), let choice = ReportChoice(rawValue: raw) {
            liveTestReported = true
            sendReport(choice)
        }
        if !liveTestVoted, lastFix != nil, let id = args.string(forKey: "autoVoteId") {
            liveTestVoted = true
            vote(id, confirm: args.object(forKey: "autoVote") == nil || args.bool(forKey: "autoVote"))
        }
        #endif
    }
}
