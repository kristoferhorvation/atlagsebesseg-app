public struct ManualOptions: Sendable {
    public var fixFilter: FixFilterOptions
    /// Ennél hosszabb kiesés "becsült" (egyenes vonalú) szakasznak számít (ms).
    public var gapMs: Double
    /// Ennél kisebb elmozdulást nem adunk hozzá (álló helyzetben a zaj ne növelje az utat).
    /// A tényleges küszöb max(minStepM, 2 × pontosság), mert két független fix ennyire térhet el.
    public var minStepM: Double

    public init(fixFilter: FixFilterOptions = .default, gapMs: Double = 5000, minStepM: Double = 5) {
        self.fixFilter = fixFilter
        self.gapMs = gapMs
        self.minStepM = minStepM
    }

    /// TS: `DEFAULT_MANUAL_OPTIONS`.
    public static let `default` = ManualOptions()
}

public struct ManualSnapshot: Equatable, Sendable {
    public var running: Bool
    /// GPS-útból számolt hossz (m).
    public var distanceM: Double
    /// Az első és az utolsó elfogadott fix között eltelt idő (ms).
    public var elapsedMs: Double
    public var averageKmh: Double?
    /// A kiesések alatt egyenessel becsült úthossz (m).
    public var estimatedGapM: Double
    public var acceptedFixes: Int
}

/// Egy kapu helye és iránya – kézi mérés végén ebből lehet ideiglenes kaput bejelenteni.
public struct ManualGate: Equatable, Sendable {
    public var lat: Double
    public var lon: Double
    /// Haladási irány a kapunál (fok), ha meghatározható.
    public var headingDeg: Double?
    public var timestamp: Double
}

public struct ManualResult: Equatable, Sendable {
    public var running: Bool
    public var distanceM: Double
    public var elapsedMs: Double
    public var averageKmh: Double?
    public var estimatedGapM: Double
    public var acceptedFixes: Int
    public var startedAt: Double
    public var stoppedAt: Double
    /// A mért szakasz első és utolsó elfogadott pontja (kezdő- és zárókapu); `nil`, ha nincs elég adat.
    public var gates: (start: ManualGate, end: ManualGate)?

    public static func == (a: ManualResult, b: ManualResult) -> Bool {
        a.running == b.running && a.distanceM == b.distanceM && a.elapsedMs == b.elapsedMs && a.averageKmh == b.averageKmh
            && a.estimatedGapM == b.estimatedGapM && a.acceptedFixes == b.acceptedFixes && a.startedAt == b.startedAt
            && a.stoppedAt == b.stoppedAt && a.gates?.start == b.gates?.start && a.gates?.end == b.gates?.end
    }
}

/// Kézi mód: gombnyomásra indul és áll le, a hosszt a GPS-útból számolja.
///
/// Távolság és idő is az első és az utolsó elfogadott fix között mérődik, így a gombnyomás és az
/// első fix közötti késés nem torzítja az átlagot. Jelkiesésnél a két szélső fix közti egyenes a
/// becslés (kanyarban kissé alábecsül).
public final class ManualTracker {
    private let opts: ManualOptions
    private let filter: FixFilter
    private var running = false
    private var startedAt = 0.0
    private var first: GpsFix?
    private var anchor: GpsFix?
    private var lastTime = 0.0
    private var distanceM = 0.0
    private var estimatedGapM = 0.0
    private var accepted = 0
    private var startHeading: Double?
    private var last: GpsFix?
    private var lastMoveHeading: Double?

    public init(_ options: ManualOptions = .default) {
        opts = options
        filter = FixFilter(options.fixFilter)
    }

    public var isRunning: Bool { running }

    public func start(_ nowMs: Double) {
        running = true
        startedAt = nowMs
        first = nil
        anchor = nil
        lastTime = 0
        distanceM = 0
        estimatedGapM = 0
        accepted = 0
        startHeading = nil
        last = nil
        lastMoveHeading = nil
        filter.reset()
    }

    @discardableResult
    public func addFix(_ fix: GpsFix) -> ManualSnapshot {
        if running && fix.timestamp >= startedAt && filter.check(fix).ok {
            accepted += 1
            if let first, let anchor {
                let step = haversineM(anchor, fix)
                let gap = fix.timestamp - lastTime > opts.gapMs
                if step >= max(opts.minStepM, 2 * (fix.accuracy ?? 0)) || gap {
                    distanceM += step
                    if gap { estimatedGapM += step }
                    let moveHeading = bearingDeg(anchor, fix)
                    lastMoveHeading = moveHeading
                    if startHeading == nil { startHeading = first.heading ?? moveHeading }
                    self.anchor = fix
                }
            } else {
                first = fix
                anchor = fix
            }
            last = fix
            lastTime = fix.timestamp
        }
        return snapshot()
    }

    public func stop(_ nowMs: Double) -> ManualResult {
        let snap = snapshot()
        running = false
        var gates: (start: ManualGate, end: ManualGate)?
        if let first, let last, first != last, distanceM > 0 {
            gates = (start: gate(first, startHeading), end: gate(last, last.heading ?? lastMoveHeading))
        }
        return ManualResult(
            running: false, distanceM: snap.distanceM, elapsedMs: snap.elapsedMs, averageKmh: snap.averageKmh,
            estimatedGapM: snap.estimatedGapM, acceptedFixes: snap.acceptedFixes, startedAt: startedAt, stoppedAt: nowMs, gates: gates
        )
    }

    public func snapshot() -> ManualSnapshot {
        let elapsedMs = first.map { lastTime - $0.timestamp } ?? 0
        return ManualSnapshot(
            running: running, distanceM: distanceM, elapsedMs: elapsedMs, averageKmh: averageSpeedKmh(distanceM, elapsedMs),
            estimatedGapM: estimatedGapM, acceptedFixes: accepted
        )
    }
}

private func gate(_ fix: GpsFix, _ headingDeg: Double?) -> ManualGate {
    ManualGate(lat: fix.lat, lon: fix.lon, headingDeg: headingDeg, timestamp: fix.timestamp)
}
