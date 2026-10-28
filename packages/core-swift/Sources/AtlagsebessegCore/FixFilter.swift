public struct FixFilterOptions: Sendable {
    /// Ennél pontatlanabb fixet eldobunk (méter).
    public var maxAccuracyM: Double
    /// Ennél nagyobb, két fix közötti látszólagos sebesség GPS-ugrásnak számít (m/s).
    public var maxPlausibleSpeedMps: Double
    /// Ennyi egymást követő, egymással konzisztens "ugrás" után az új helyzetet fogadjuk el.
    public var rebaseAfterJumps: Int

    public init(maxAccuracyM: Double, maxPlausibleSpeedMps: Double, rebaseAfterJumps: Int) {
        self.maxAccuracyM = maxAccuracyM
        self.maxPlausibleSpeedMps = maxPlausibleSpeedMps
        self.rebaseAfterJumps = rebaseAfterJumps
    }

    /// TS: `DEFAULT_FIX_FILTER`.
    public static let `default` = FixFilterOptions(maxAccuracyM: 35, maxPlausibleSpeedMps: 250 / 3.6, rebaseAfterJumps: 3)
}

public enum FixRejection: String, Sendable {
    case pontatlan, idorend, ugras, ervenytelen
}

public enum FixVerdict: Equatable, Sendable {
    case ok
    case rejected(FixRejection)

    public var ok: Bool { self == .ok }
}

/// Kiszűri a pontatlan, időrendben hibás és fizikailag lehetetlen (ugró) fixeket.
/// Ha az utolsó elfogadott fix volt hibás, néhány konzisztens új fix után átáll az új helyzetre.
public final class FixFilter {
    private var last: GpsFix?
    private var jumpStreak: [GpsFix] = []
    private let opts: FixFilterOptions

    public init(_ opts: FixFilterOptions = .default) {
        self.opts = opts
    }

    public var lastAccepted: GpsFix? { last }

    public func reset() {
        last = nil
        jumpStreak = []
    }

    public func check(_ fix: GpsFix) -> FixVerdict {
        if !fix.lat.isFinite || !fix.lon.isFinite || !fix.timestamp.isFinite { return .rejected(.ervenytelen) }
        if let acc = fix.accuracy, acc < 0 || acc > opts.maxAccuracyM { return .rejected(.pontatlan) }
        if let last, fix.timestamp <= last.timestamp { return .rejected(.idorend) }
        if let last, impliedSpeed(last, fix) > opts.maxPlausibleSpeedMps {
            if let prevJump = jumpStreak.last, impliedSpeed(prevJump, fix) > opts.maxPlausibleSpeedMps { jumpStreak = [] }
            jumpStreak.append(fix)
            if jumpStreak.count >= opts.rebaseAfterJumps {
                accept(fix)
                return .ok
            }
            return .rejected(.ugras)
        }
        accept(fix)
        return .ok
    }

    private func accept(_ fix: GpsFix) {
        last = fix
        jumpStreak = []
    }
}

/// Két fix közötti látszólagos sebesség (m/s), a pontossági sugarakkal csökkentett távolságból.
public func impliedSpeed(_ a: GpsFix, _ b: GpsFix) -> Double {
    let dt = (b.timestamp - a.timestamp) / 1000
    if dt <= 0 { return .infinity }
    let slack = (a.accuracy ?? 0) + (b.accuracy ?? 0)
    return max(0, haversineM(a, b) - slack) / dt
}
