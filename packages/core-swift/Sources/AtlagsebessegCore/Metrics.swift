/// km/h ↔ m/s
@inline(__always) public func kmhToMps(_ kmh: Double) -> Double { kmh / 3.6 }
@inline(__always) public func mpsToKmh(_ mps: Double) -> Double { mps * 3.6 }

public let DEFAULT_MIN_PRACTICAL_FRACTION = 0.6

/// Átlagsebesség km/h-ban; `nil`, ha még nincs értelmezhető adat.
public func averageSpeedKmh(_ distanceM: Double, _ elapsedMs: Double) -> Double? {
    if elapsedMs < 1000 || distanceM <= 0 { return nil }
    return mpsToKmh(distanceM / (elapsedMs / 1000))
}

public enum RequiredSpeed: Equatable, Sendable {
    /// A hátralévő úton legfeljebb `maxKmh` sebességgel haladhatsz.
    case ok(maxKmh: Double)
    /// Már annyi idő eltelt, hogy bármilyen sebesség mellett a határ alatt maradsz.
    case nincsKorlat
    /// Csak `maxKmh`-nál lassabban lehetne a határ alá kerülni, ami nem reális (vagy már célba értél).
    case nemLehetseges(maxKmh: Double)

    /// A TS `kind` mezője: `ok` / `nincs_korlat` / `nem_lehetseges`.
    public var kind: String {
        switch self {
        case .ok: "ok"
        case .nincsKorlat: "nincs_korlat"
        case .nemLehetseges: "nem_lehetseges"
        }
    }

    public var maxKmh: Double? {
        switch self {
        case let .ok(v), let .nemLehetseges(v): v
        case .nincsKorlat: nil
        }
    }
}

/// Mekkora sebességgel kell (legfeljebb) megtenni a hátralévő utat, hogy a szakasz végén az átlag ≤ határ legyen.
///
/// Feltétel: teljes idő ≥ hossz / határ, azaz
///   hátralévő_idő ≥ hossz / határ − eltelt_idő,
///   v_max = hátralévő_út / (hossz / határ − eltelt_idő).
/// - Parameter minPracticalFraction: a határ ekkora hányadánál kisebb megengedett sebességet már nem
///   tekintünk reálisnak (hirtelen lassítás veszélyes). Alapértelmezés: 0,6 (130-as határnál 78 km/h).
public func requiredSpeed(
    lengthM: Double, speedLimitKmh: Double, distanceDoneM: Double, elapsedMs: Double, minPracticalFraction: Double? = nil
) -> RequiredSpeed {
    let minPractical = speedLimitKmh * (minPracticalFraction ?? DEFAULT_MIN_PRACTICAL_FRACTION)
    let remainingM = max(0, lengthM - distanceDoneM)
    let minTotalS = lengthM / kmhToMps(speedLimitKmh)
    let budgetS = minTotalS - elapsedMs / 1000
    if budgetS <= 0 { return .nincsKorlat }
    if remainingM <= 0 { return .nemLehetseges(maxKmh: 0) }
    let maxKmh = mpsToKmh(remainingM / budgetS)
    return maxKmh < minPractical ? .nemLehetseges(maxKmh: maxKmh) : .ok(maxKmh: maxKmh)
}

/// Várható végső átlag, ha a hátralévő utat a jelenlegi sebességgel teszed meg:
///   v_végső = hossz / (eltelt_idő + hátralévő_út / v_most).
/// A státusz-szín ebből számol, mert a pillanatnyi átlag a szakasz elején még alig mozdul.
/// Sebesség nélkül (vagy közel álló helyzetben) `nil` – a hívó a pillanatnyi átlagra esik vissza.
public func projectedAverageKmh(lengthM: Double, distanceDoneM: Double, elapsedMs: Double, currentKmh: Double?) -> Double? {
    if lengthM <= 0 { return nil }
    let remainingM = max(0, lengthM - distanceDoneM)
    if remainingM == 0 { return averageSpeedKmh(lengthM, elapsedMs) }
    guard let currentKmh, currentKmh >= 1 else { return nil }
    let totalS = elapsedMs / 1000 + remainingM / kmhToMps(currentKmh)
    return mpsToKmh(lengthM / totalS)
}

/// A mérőkártya egyetlen állapota (nagy szám, chip, sáv és háttér-árnyalat ebből színeződik):
/// - `jo`: az átlag ≤ határ
/// - `lassits`: az átlag a határ felett, de a várható végső ≤ határ (lassítással/tartással megvan)
/// - `tulGyors`: a várható végső a határ felett
public enum MeterState: String, Codable, Sendable, CaseIterable {
    case jo
    case lassits
    case tulGyors = "tul_gyors"
}

/// Átlag nélkül `nil`. Ha nincs várható végső (álló helyzet), a pillanatnyi átlag a tartalék.
public func meterState(averageKmh: Double?, projectedKmh: Double?, speedLimitKmh: Double) -> MeterState? {
    guard let averageKmh else { return nil }
    if averageKmh <= speedLimitKmh { return .jo }
    return (projectedKmh ?? averageKmh) <= speedLimitKmh ? .lassits : .tulGyors
}

/// A „Lassíts” sáv tartalma: `max` = ennyivel haladj legfeljebb; `nemHozhato` = már nem reális.
public enum MeterBar: Equatable, Sendable {
    case max(maxKmh: Double)
    case nemHozhato
}

/// Sáv: `jo`-ban soha, `lassits`-ban és `tulGyors`-ban mindig (ha a hátralévő útra van értelmes korlát).
/// A szöveget az állapot adja: `lassits` „Maradj X alatt”, `tulGyors` „Lassíts · max X”.
public func meterBar(_ state: MeterState?, _ required: RequiredSpeed) -> MeterBar? {
    guard let state, state != .jo else { return nil }
    switch required {
    case let .ok(maxKmh): return .max(maxKmh: maxKmh)
    case .nemLehetseges: return .nemHozhato
    case .nincsKorlat: return nil
    }
}

/// Mennyivel kell lassítani a jelenlegi sebességhez képest (km/h, ≥ 0).
public func slowDownByKmh(_ currentKmh: Double?, _ req: RequiredSpeed) -> Double? {
    guard let currentKmh else { return nil }
    guard let maxKmh = req.maxKmh else { return 0 }
    return max(0, currentKmh - maxKmh)
}

public struct ToleranceRule: Sendable {
    /// Százalékos tűrés (pl. 5 = 5%).
    public var percent: Double
    /// Legalább ennyi km/h tűrés.
    public var minKmh: Double

    public init(percent: Double, minKmh: Double) {
        self.percent = percent
        self.minKmh = minKmh
    }

    /// Olasz Tutor gyakorlat: 5%, de legalább 5 km/h (a nagyobb). TS: `DEFAULT_TOLERANCE`.
    public static let `default` = ToleranceRule(percent: 5, minKmh: 5)
}

/// A hatósági mérési tűrés km/h-ban: max(határ × %, minimum).
public func toleranceKmh(_ speedLimitKmh: Double, _ rule: ToleranceRule = .default) -> Double {
    max(speedLimitKmh * rule.percent / 100, rule.minKmh)
}

/// Határ + tűrés – CSAK megjelenítésre. A „szükséges sebesség” és a figyelmeztetés mindig a szigorú határhoz számol.
public func limitWithToleranceKmh(_ speedLimitKmh: Double, _ rule: ToleranceRule = .default) -> Double {
    speedLimitKmh + toleranceKmh(speedLimitKmh, rule)
}
