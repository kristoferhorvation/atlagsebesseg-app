import AtlagsebessegCore

// A packages/app-logic/src/session.ts portja.

/// A kijelző állapotai (DESIGN.md): a core állapotgépe + kézi mód + megszakítás.
nonisolated enum SessionPhase: String, Sendable {
    case nincsSzakasz = "nincs_szakasz"
    case kozeledik
    case meres
    case befejezve
    case kezi
    case keziEredmeny = "kezi_eredmeny"
    case megszakadt
}

/// Miért szakadt meg a mérés: a core okai, vagy az app háttérbe került. (iOS-en a háttér-helymeghatározás
/// miatt a mérés a háttérben is fut; a `hatter` ok csak akkor jön, ha a hívó kifejezetten megszakít.)
nonisolated enum InterruptReason: String, Sendable {
    case hatter, letert, ellenirany, jelvesztes

    init(_ r: AbortReason) {
        switch r {
        case .letert: self = .letert
        case .ellenirany: self = .ellenirany
        case .jelvesztes: self = .jelvesztes
        }
    }
}

nonisolated struct SessionView: Sendable {
    var phase: SessionPhase = .nincsSzakasz
    /// Közeledéskor, mérés közben, befejezve / megszakadva az érintett szakasz.
    var section: Section?
    var live: LiveMetrics?
    /// Az egyetlen állapot (jo / lassits / tulGyors): mérés közben az átlagból és a VÁRHATÓ VÉGSŐ átlagból,
    /// befejezve a tényleges végső átlagból. A szám, a chip, a sáv és a háttér-árnyalat mind ebből színeződik.
    var status: SpeedStatus?
    /// Megtett hányad 0…1 (mérés közben).
    var progress: Double?
    /// Közeledéskor a belépő kapu légvonalbeli távolsága (m).
    var approachM: Double?
    var result: SectionResult?
    var interruption: (reason: InterruptReason, at: Double)?
    var manual: ManualSnapshot?
    var manualResult: ManualResult?
    var lastFix: GpsFix?
    /// Pillanatnyi sebesség km/h-ban (szakaszon a core-ból, egyébként a GPS-ből).
    var currentKmh: Double?
}

/// A mérés egy példánya a kijelző számára: a `SectionTracker` (automatikus) és a `ManualTracker` (kézi) együtt,
/// plusz a megszakítás tiszta kezelése – ilyenkor a mérés megszakad (nem becsül tovább, nincs hibás átlag),
/// és a következő belépő kapuig nem indul újra.
final class TrackingSession {
    private enum Dismissed: Equatable {
        case result(SectionResult)
        case abortAt(Double)
    }

    private let tracker: SectionTracker
    private let manualTracker = ManualTracker()
    private let now: () -> Double
    private let holdMs: Double
    private var snap: TrackerSnapshot
    private var manual: ManualSnapshot?
    private var manualResult: (result: ManualResult, at: Double)?
    private var interruption: (reason: InterruptReason, at: Double, section: Section?)?
    private var dismissed: Dismissed?
    /// A core utolsó megszakításának ideje (a snapshot átmenetei csak egy hívásig élnek).
    private var coreAbortAt: Double?
    private var lastFix: GpsFix?

    /// - Parameter now: óra (ms) – a szimulátor a lejátszás idejét adja.
    init(_ sections: [Section], now: @escaping () -> Double, tracker options: TrackerOptions = .default, holdMs: Double = 60_000) {
        self.now = now
        self.holdMs = holdMs
        tracker = SectionTracker(sections, options: options)
        snap = tracker.snapshot(now())
    }

    /// Új szakaszlista (pl. a szerverről) – a futó mérés megmarad.
    func setSections(_ sections: [Section]) {
        tracker.setSections(sections)
    }

    @discardableResult
    func onFix(_ fix: GpsFix) -> SessionView {
        lastFix = fix
        absorb(tracker.update(fix))
        if snap.state == .szakaszon || snap.state == .kozeledik { dismissed = nil }
        if manual != nil { manual = manualTracker.addFix(fix) }
        return view()
    }

    /// Fix nélküli frissítés (másodpercenként): becslés, jelkiesés, lejáratok.
    @discardableResult
    func tick() -> SessionView {
        absorb(tracker.tick(now()))
        return view()
    }

    private func absorb(_ s: TrackerSnapshot) {
        snap = s
        if let t = s.transitions.first(where: { $0.to == .megszakadt }) { coreAbortAt = t.at }
    }

    /// A futó mérés megszakítása (a szakaszon és kézi módban is).
    @discardableResult
    func interrupt(_ reason: InterruptReason = .hatter) -> SessionView {
        let at = now()
        let wasMeasuring = snap.state == .szakaszon
        let section = snap.section
        if snap.state == .szakaszon || snap.state == .kozeledik {
            tracker.reset()
            snap = tracker.snapshot(at)
        }
        if manual != nil {
            _ = manualTracker.stop(at)
            manual = nil
            interruption = (reason, at, nil)
        }
        if wasMeasuring { interruption = (reason, at, section) }
        lastFix = nil
        return view()
    }

    @discardableResult
    func startManual() -> SessionView {
        manualTracker.start(now())
        manual = manualTracker.snapshot()
        manualResult = nil
        interruption = nil
        return view()
    }

    @discardableResult
    func stopManual() -> SessionView {
        if manual != nil {
            let at = now()
            manualResult = (manualTracker.stop(at), at)
            manual = nil
        }
        return view()
    }

    /// Az összegzés / megszakítás-kártya bezárása.
    @discardableResult
    func dismiss() -> SessionView {
        manualResult = nil
        interruption = nil
        if snap.state == .kesz, let r = snap.lastResult { dismissed = .result(r) }
        if snap.state == .megszakadt { dismissed = coreAbortAt.map { .abortAt($0) } }
        return view()
    }

    func view() -> SessionView {
        let now = now()
        if let i = interruption, now - i.at > holdMs { interruption = nil }
        if let m = manualResult, now - m.at > holdMs { manualResult = nil }

        let s = snap
        let fixKmh = lastFix?.speed.map { $0 * 3.6 }
        var base = SessionView()
        base.manual = manual
        base.manualResult = manualResult?.result
        base.lastFix = lastFix
        base.currentKmh = s.live?.currentKmh ?? fixKmh

        if manual != nil {
            base.phase = .kezi
            return base
        }
        if s.state == .szakaszon, let section = s.section, let live = s.live {
            base.phase = .meres
            base.section = section
            base.live = live
            base.status = speedStatus(live.averageKmh, live.projectedKmh, section.speedLimitKmh)
            base.progress = progressOf(live.distanceM, section.lengthM)
            return base
        }
        if let i = interruption {
            base.phase = .megszakadt
            base.section = i.section
            base.interruption = (i.reason, i.at)
            return base
        }
        if s.state == .megszakadt, let reason = s.abortReason, dismissed != coreAbortAt.map({ .abortAt($0) }) {
            base.phase = .megszakadt
            base.section = s.section
            base.interruption = (InterruptReason(reason), coreAbortAt ?? now)
            return base
        }
        if s.state == .kesz, let r = s.lastResult, dismissed != .result(r) {
            base.phase = .befejezve
            base.section = s.section
            base.result = r
            base.status = speedStatus(r.averageKmh, r.averageKmh, r.speedLimitKmh)
            return base
        }
        if s.state == .kozeledik, let section = s.section {
            base.phase = .kozeledik
            base.section = section
            base.approachM = lastFix.map { haversineM($0, section.start) }
            return base
        }
        if manualResult != nil { base.phase = .keziEredmeny }
        return base
    }
}
