public enum TrackerState: String, Sendable {
    case nincsSzakasz = "nincs_szakasz"
    case kozeledik
    case szakaszon
    case kesz
    case megszakadt
}

/// Miért szakadt meg a mérés.
public enum AbortReason: String, Sendable {
    case letert, ellenirany, jelvesztes
}

public struct TrackerOptions: Sendable {
    /// Ennyi méterrel a kezdőpont előtt jelezzük a közeledést.
    public var approachRadiusM: Double = 2000
    /// Közeledéskor megengedett távolság az útvonal (első szakaszának meghosszabbítása) vonalától.
    public var approachCrossM: Double = 100
    /// Kapuzóna: a kezdőpont utáni ennyi méteren belül még beléptetünk.
    public var gateZoneM: Double = 150
    /// Belépéskor megengedett merőleges távolság az útvonaltól (párhuzamos út szűrése).
    public var entryCrossM: Double = 40
    /// Belépéskor megengedett eltérés a haladási irány és az útvonal iránya között (ellenirány szűrése).
    public var maxHeadingDiffDeg: Double = 45
    /// Szakaszon ennél messzebb az útvonaltól: letérés-gyanú.
    public var offRouteCrossM: Double = 60
    /// Letérés: legalább ennyi egymást követő fix …
    public var offRouteMinFixes: Int = 5
    /// … és legalább ennyi idő (ms).
    public var offRouteMinMs: Double = 5000
    /// Ennél nagyobb irányeltérés szakaszon: ellenirány-gyanú.
    public var wrongWayDiffDeg: Double = 135
    public var wrongWayMinFixes: Int = 5
    /// Ennél hosszabb jelkiesés után a mérés megszakad (ms).
    public var maxGapMs: Double = 15 * 60_000
    /// Ennyi idő fix nélkül után a megtett utat becsüljük (ms).
    public var estimateAfterMs: Double = 3000
    /// A GPS-irányszöget csak ennél nagyobb sebességnél vesszük figyelembe (m/s).
    public var minHeadingSpeedMps: Double = 3
    /// Lásd `requiredSpeed`: a határ ekkora hányada alatt „nem lehetséges”.
    public var minPracticalFraction: Double = DEFAULT_MIN_PRACTICAL_FRACTION
    /// Kész/megszakadt állapot ennyi ideig marad látható (ms), utána `nincsSzakasz`.
    public var resultHoldMs: Double = 60_000
    public var fixFilter: FixFilterOptions = .default

    public init() {}

    /// TS: `DEFAULT_TRACKER_OPTIONS`.
    public static let `default` = TrackerOptions()
}

public struct LiveMetrics: Equatable, Sendable {
    /// Megtett út a szakaszon (m).
    public var distanceM: Double
    public var remainingM: Double
    public var elapsedMs: Double
    public var averageKmh: Double?
    public var currentKmh: Double?
    /// Várható végső átlag, ha a hátralévő utat a jelenlegi sebességgel teszed meg.
    public var projectedKmh: Double?
    public var required: RequiredSpeed
    /// Mennyivel kell lassítani a jelenlegi sebességhez képest (km/h).
    public var slowDownKmh: Double?
    /// Igaz, ha a megtett út becsült (jelkiesés, pl. alagút).
    public var estimated: Bool
}

public struct SectionResult: Equatable, Sendable {
    public var sectionId: String
    public var entryTime: Double
    public var exitTime: Double
    public var lengthM: Double
    public var averageKmh: Double
    public var speedLimitKmh: Double
    public var overLimit: Bool
}

public struct Transition: Equatable, Sendable {
    public var from: TrackerState
    public var to: TrackerState
    public var sectionId: String?
    public var at: Double
}

public struct TrackerSnapshot: Sendable {
    public var state: TrackerState
    /// Közeledéskor, szakaszon és kész/megszakadt állapotban az érintett szakasz.
    public var section: Section?
    public var live: LiveMetrics?
    public var lastResult: SectionResult?
    public var abortReason: AbortReason?
    /// Az utolsó `update`/`tick` hívás alatti állapotváltások.
    public var transitions: [Transition]
}

private struct Prepared {
    let section: Section
    let route: Route
}

private final class Active {
    let entryTime: Double
    var lastAlongM: Double
    var lastAcceptedTime: Double
    var lastSpeedMps: Double?
    var history: [(t: Double, along: Double)]
    var offRouteCount = 0
    var offRouteSince: Double?
    var wrongWayCount = 0

    init(entryTime: Double, lastAlongM: Double, lastAcceptedTime: Double, lastSpeedMps: Double?, history: [(t: Double, along: Double)]) {
        self.entryTime = entryTime
        self.lastAlongM = lastAlongM
        self.lastAcceptedTime = lastAcceptedTime
        self.lastSpeedMps = lastSpeedMps
        self.history = history
    }
}

/// Automatikus szakasz-felismerés és átlagsebesség-mérés.
///
/// Állapotgép: nincsSzakasz → kozeledik → szakaszon → kesz | megszakadt.
/// (Kész/megszakadt után közvetlenül jöhet a következő szakasz is, mert az olasz
/// Tutor-szakaszok gyakran egymás után következnek.)
public final class SectionTracker {
    private let opts: TrackerOptions
    private var prepared: [Prepared]
    private let filter: FixFilter
    private var state: TrackerState = .nincsSzakasz
    private var current: Prepared?
    private var active: Active?
    private var prevFix: GpsFix?
    private var approachLost = 0
    private var finishedAt = 0.0
    private var lastResult: SectionResult?
    private var abortReason: AbortReason?
    private var transitions: [Transition] = []

    public init(_ sections: [Section], options: TrackerOptions = .default) {
        opts = options
        filter = FixFilter(options.fixFilter)
        prepared = sections.compactMap(prepare)
    }

    /// A szakaszlista cseréje (pl. a szerverről frissült adat) a folyamatban lévő mérés megtartásával:
    /// az aktív / közeledő szakasz a régi geometriával fut tovább, a változás a következő felismeréstől érvényes.
    public func setSections(_ sections: [Section]) {
        var old: [String: Prepared] = [:]
        for p in prepared { old[p.section.id] = p }
        prepared = sections.compactMap { s in
            if let prev = old[s.id], prev.section == s { return prev }
            return prepare(s)
        }
        if let cur = current, state != .szakaszon {
            // közeledés / kész állapotban a frissített példányra mutatunk (ha még létezik)
            current = prepared.first { $0.section.id == cur.section.id } ?? cur
        }
    }

    public var currentState: TrackerState { state }

    @discardableResult
    public func update(_ fix: GpsFix) -> TrackerSnapshot {
        transitions = []
        if !filter.check(fix).ok {
            checkGap(fix.timestamp)
            return snapshot(fix.timestamp)
        }
        let prev = prevFix
        prevFix = fix
        if state == .szakaszon {
            updateActive(prev, fix)
            if currentState == .kesz { detect(prev, fix) }
        } else {
            detect(prev, fix)
        }
        return snapshot(fix.timestamp)
    }

    /// Fix nélküli frissítés (pl. másodpercenként a kijelzőhöz): becslés és jelkiesés-figyelés.
    @discardableResult
    public func tick(_ nowMs: Double) -> TrackerSnapshot {
        transitions = []
        checkGap(nowMs)
        return snapshot(nowMs)
    }

    public func reset() {
        transitions = []
        state = .nincsSzakasz
        current = nil
        active = nil
        prevFix = nil
        filter.reset()
        lastResult = nil
        abortReason = nil
    }

    public func snapshot(_ nowMs: Double) -> TrackerSnapshot {
        TrackerSnapshot(
            state: state,
            section: current?.section,
            live: state == .szakaszon ? liveMetrics(nowMs) : nil,
            lastResult: lastResult,
            abortReason: abortReason,
            transitions: transitions
        )
    }

    // MARK: felismerés (szakaszon kívül)

    private func detect(_ prev: GpsFix?, _ fix: GpsFix) {
        let candidates = prepared.filter { haversineM(fix, $0.route.start) <= opts.approachRadiusM + 1000 }

        for p in candidates {
            if let entryTime = checkEntry(p, prev, fix) {
                enter(p, entryTime, fix)
                return
            }
        }

        var approaching: Prepared?
        var bestDist = Double.infinity
        for p in candidates {
            let d = haversineM(fix, p.route.start)
            if d < bestDist && isApproaching(p, prev, fix) {
                approaching = p
                bestDist = d
            }
        }

        if let approaching {
            approachLost = 0
            if state != .kozeledik || current?.route !== approaching.route {
                current = approaching
                setState(.kozeledik, fix.timestamp)
            }
            return
        }

        if state == .kozeledik {
            approachLost += 1
            if approachLost >= 3 {
                current = nil
                setState(.nincsSzakasz, fix.timestamp)
            }
        } else if (state == .kesz || state == .megszakadt) && fix.timestamp - finishedAt >= opts.resultHoldMs {
            current = nil
            setState(.nincsSzakasz, fix.timestamp)
        }
    }

    /// Belépés a kapuzónába a helyes irányban; a belépés (interpolált) idejét adja, vagy `nil`-t.
    private func checkEntry(_ p: Prepared, _ prev: GpsFix?, _ fix: GpsFix) -> Double? {
        let o = opts
        let hint = ProjectionHint(fromM: -.infinity, toM: o.gateZoneM + 2000)
        let proj = p.route.project(fix, hint: hint)
        if proj.crossM > o.entryCrossM || proj.alongM < 0 { return nil }

        let prevProj = prev.map { p.route.project($0, hint: hint) }
        let crossed = prevProj.map { $0.alongM < 0 && $0.crossM <= o.approachCrossM } ?? false
        let inZone = proj.alongM <= o.gateZoneM
        let dtS = prev.map { (fix.timestamp - $0.timestamp) / 1000 } ?? 0
        if !inZone && !(crossed && proj.alongM <= o.gateZoneM + o.fixFilter.maxPlausibleSpeedMps * dtS) { return nil }
        if !directionOk(p, proj, prevProj, prev, fix) { return nil }

        if crossed, let prev, let prevProj {
            let f = -prevProj.alongM / (proj.alongM - prevProj.alongM)
            return prev.timestamp + f * (fix.timestamp - prev.timestamp)
        }
        if let v = speedOf(prev, fix), v > 0 { return fix.timestamp - (proj.alongM / v) * 1000 }
        return fix.timestamp
    }

    private func isApproaching(_ p: Prepared, _ prev: GpsFix?, _ fix: GpsFix) -> Bool {
        let o = opts
        if haversineM(fix, p.route.start) > o.approachRadiusM { return false }
        let hint = ProjectionHint(fromM: -.infinity, toM: 0)
        let proj = p.route.project(fix, hint: hint)
        if proj.alongM >= 0 || proj.crossM > o.approachCrossM { return false }
        let prevProj = prev.map { p.route.project($0, hint: hint) }
        return directionOk(p, proj, prevProj, prev, fix)
    }

    private func directionOk(_ p: Prepared, _ proj: RouteProjection, _ prevProj: RouteProjection?, _ prev: GpsFix?, _ fix: GpsFix) -> Bool {
        if let heading = motionHeading(prev, fix) {
            return angleDiffDeg(heading, p.route.bearingAt(max(0, proj.alongM))) <= opts.maxHeadingDiffDeg
        }
        // Irányszög nélkül: az útvonal menti haladás iránya dönt.
        guard let prevProj else { return false }
        return proj.alongM - prevProj.alongM >= 3
    }

    private func enter(_ p: Prepared, _ entryTime: Double, _ fix: GpsFix) {
        let along = max(0, p.route.project(fix, hint: ProjectionHint(fromM: -.infinity, toM: opts.gateZoneM + 2000)).alongM)
        current = p
        abortReason = nil
        active = Active(
            entryTime: entryTime,
            lastAlongM: along,
            lastAcceptedTime: fix.timestamp,
            lastSpeedMps: validSpeed(fix),
            history: [(t: entryTime, along: 0), (t: fix.timestamp, along: along)]
        )
        setState(.szakaszon, fix.timestamp)
    }

    // MARK: mérés a szakaszon

    private func updateActive(_ prev: GpsFix?, _ fix: GpsFix) {
        let a = active!
        let p = current!
        let o = opts
        if fix.timestamp - a.lastAcceptedTime > o.maxGapMs {
            abort(.jelvesztes, fix.timestamp)
            return
        }
        let dtS = (fix.timestamp - a.lastAcceptedTime) / 1000
        let proj = p.route.project(fix, hint: ProjectionHint(
            fromM: a.lastAlongM - 200,
            toM: a.lastAlongM + o.fixFilter.maxPlausibleSpeedMps * dtS + 300
        ))

        if proj.crossM > o.offRouteCrossM {
            a.offRouteCount += 1
            if a.offRouteSince == nil { a.offRouteSince = fix.timestamp }
            if a.offRouteCount >= o.offRouteMinFixes && fix.timestamp - a.offRouteSince! >= o.offRouteMinMs {
                abort(.letert, fix.timestamp)
            }
            return
        }
        if let heading = motionHeading(prev, fix), angleDiffDeg(heading, proj.bearingDeg) >= o.wrongWayDiffDeg {
            a.wrongWayCount += 1
            if a.wrongWayCount >= o.wrongWayMinFixes { abort(.ellenirany, fix.timestamp) }
            return
        }
        a.offRouteCount = 0
        a.offRouteSince = nil
        a.wrongWayCount = 0

        let L = p.route.lengthM
        if proj.alongM >= L {
            // Kilépés: a végpont átlépésének idejét az utolsó két pont között interpoláljuk.
            // Jelkiesés után is pontos, mert a megtett utat az útvonalon mérjük.
            let exitTime = proj.alongM > a.lastAlongM
                ? a.lastAcceptedTime + ((L - a.lastAlongM) / (proj.alongM - a.lastAlongM)) * (fix.timestamp - a.lastAcceptedTime)
                : fix.timestamp
            finish(exitTime, fix.timestamp)
            return
        }

        // Kis visszalépést (GPS-zaj) nem veszünk figyelembe: a megtett út nem csökken.
        if proj.alongM > a.lastAlongM { a.lastAlongM = proj.alongM }
        let derived: Double? = dtS > 0 ? (a.lastAlongM - (a.history.last?.along ?? 0)) / dtS : nil
        a.lastSpeedMps = validSpeed(fix) ?? derived
        a.lastAcceptedTime = fix.timestamp
        a.history.append((t: fix.timestamp, along: a.lastAlongM))
        while a.history.count > 2 && fix.timestamp - a.history[0].t > 30_000 { a.history.removeFirst() }
    }

    private func liveMetrics(_ nowMs: Double) -> LiveMetrics {
        let a = active!
        let p = current!
        let L = p.route.lengthM
        let sinceFix = nowMs - a.lastAcceptedTime
        let estimated = sinceFix > opts.estimateAfterMs
        let v = a.lastSpeedMps ?? historySpeed(a)
        var distanceM = a.lastAlongM
        if estimated, let v {
            // Holtszámítás (dead reckoning) a legutóbbi sebességgel – az alagút végén a valódi fix felülírja.
            distanceM = min(L, a.lastAlongM + (v * sinceFix) / 1000)
        }
        let elapsedMs = max(0, nowMs - a.entryTime)
        let required = requiredSpeed(
            lengthM: L, speedLimitKmh: p.section.speedLimitKmh, distanceDoneM: distanceM, elapsedMs: elapsedMs,
            minPracticalFraction: opts.minPracticalFraction
        )
        let currentKmh = v.map(mpsToKmh)
        return LiveMetrics(
            distanceM: distanceM,
            remainingM: max(0, L - distanceM),
            elapsedMs: elapsedMs,
            averageKmh: averageSpeedKmh(distanceM, elapsedMs),
            currentKmh: currentKmh,
            projectedKmh: projectedAverageKmh(lengthM: L, distanceDoneM: distanceM, elapsedMs: elapsedMs, currentKmh: currentKmh),
            required: required,
            slowDownKmh: slowDownByKmh(currentKmh, required),
            estimated: estimated
        )
    }

    private func historySpeed(_ a: Active) -> Double? {
        guard let first = a.history.first, let last = a.history.last, last.t - first.t >= 1000 else { return nil }
        return (last.along - first.along) / ((last.t - first.t) / 1000)
    }

    private func finish(_ exitTime: Double, _ now: Double) {
        let a = active!
        let p = current!
        let averageKmh = mpsToKmh(p.route.lengthM / ((exitTime - a.entryTime) / 1000))
        lastResult = SectionResult(
            sectionId: p.section.id,
            entryTime: a.entryTime,
            exitTime: exitTime,
            lengthM: p.route.lengthM,
            averageKmh: averageKmh,
            speedLimitKmh: p.section.speedLimitKmh,
            overLimit: averageKmh > p.section.speedLimitKmh
        )
        active = nil
        finishedAt = now
        setState(.kesz, now)
    }

    private func abort(_ reason: AbortReason, _ now: Double) {
        abortReason = reason
        active = nil
        finishedAt = now
        setState(.megszakadt, now)
    }

    private func checkGap(_ nowMs: Double) {
        if state == .szakaszon, nowMs - active!.lastAcceptedTime > opts.maxGapMs { abort(.jelvesztes, nowMs) }
    }

    private func setState(_ to: TrackerState, _ at: Double) {
        if to == state { return }
        transitions.append(Transition(from: state, to: to, sectionId: current?.section.id, at: at))
        state = to
    }

    private func motionHeading(_ prev: GpsFix?, _ fix: GpsFix) -> Double? {
        let speed = validSpeed(fix)
        if let heading = fix.heading, heading >= 0, speed == nil || speed! >= opts.minHeadingSpeedMps { return heading }
        if let prev, haversineM(prev, fix) >= 10 { return bearingDeg(prev, fix) }
        return nil
    }

    private func speedOf(_ prev: GpsFix?, _ fix: GpsFix) -> Double? {
        if let s = validSpeed(fix) { return s }
        guard let prev else { return nil }
        let dt = (fix.timestamp - prev.timestamp) / 1000
        return dt > 0 ? haversineM(prev, fix) / dt : nil
    }
}

/// A TS-ben a konstruktor dob, ha a geometria < 2 különböző pont; itt az ilyen szakasz kimarad.
private func prepare(_ section: Section) -> Prepared? {
    let pts = (section.geometry?.isEmpty ?? true) ? [section.start, section.end] : section.geometry!
    guard let route = try? Route(pts, nominalLengthM: section.lengthM) else { return nil }
    return Prepared(section: section, route: route)
}

private func validSpeed(_ fix: GpsFix) -> Double? {
    guard let s = fix.speed, s >= 0, s.isFinite else { return nil }
    return s
}
