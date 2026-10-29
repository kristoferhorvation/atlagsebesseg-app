import AtlagsebessegCore
import Foundation

// Kamera-közeledés és tervezett mérés jelzése (A10). A logika hang nélkül fut: jelzés-eseményeket ad, amelyeket
// a hang-réteg (AlertPlayer) játszik le – így a döntések (irány, távolság, egyszeriség) tesztelhetők.

nonisolated enum AlertKind: String, Sendable {
    /// Fix kamera az útirányban.
    case camera
    /// Szakaszellenőrzés kezdő kapuja az útirányban.
    case section
    /// Tervezett rendőrségi mérés vonalára / zónájába érve.
    case planned
}

/// Egy jelzés: mit mondjon be a hang-réteg, és mit mutasson a sáv.
nonisolated struct AlertEvent: Equatable, Sendable {
    var kind: AlertKind
    /// A kamera / szakasz / tervezett mérés azonosítója.
    var targetId: String
    /// A bemondott és kiírt mondat (a szótárból, az app nyelvén).
    var text: String
}

nonisolated struct ApproachConfig: Sendable {
    /// Ennyi méteren belül jelez (légvonalban).
    var aheadM = 600.0
    /// A haladási iránytól legfeljebb ennyi fokra „előttünk” van a cél.
    var coneDeg = 45.0
    /// Egy már jelzett cél ennyi fok fölött számít „mögöttünk”-nek (elhaladtunk / visszafordultunk) – ekkor újra jelezhet.
    var behindDeg = 100.0
    /// …vagy ennyi méter fölött (eltávolodtunk).
    var resetM = 800.0
    /// A szakasz kezdő kapuja csak akkor, ha a szakasz iránya ennyi fokon belül egyezik a haladási iránnyal.
    var sectionDirDeg = 60.0
    /// A szakaszmérő-kapu kamerát nem jelezzük külön, ha egy szakasz kezdete ennyi méteren belül van (az a szakasz-jelzés).
    var gateDedupM = 150.0
    /// Ennél lassabban (m/s) az irány megbízhatatlan: nem jelez.
    var minSpeedMs = 1.5
    /// Irány nélküli fixnél az előző fixtől legalább ennyi elmozdulás kell a becsült irányhoz.
    var headingFromMoveM = 10.0
}

/// A bemondott távolság: 100 m-re lefelé kerekítve (600 m-en belül tipikusan „500 méterre”), legalább 100.
nonisolated func alertDistanceM(_ m: Double) -> Int {
    max(100, Int((m / 100).rounded(.down)) * 100)
}

/// A kamera-jelzés mondata: „Kamera 500 méterre, maximum 90” (határ nélkül: „Kamera 500 méterre”).
nonisolated func cameraAlertText(distanceM: Double, limitKmh: Double?, unit: SpeedUnit, lang: Lang? = nil) -> String {
    let d = String(alertDistanceM(distanceM))
    if let x = speedIn(limitKmh, unit) { return t(.iosAlertCamera, ["d": d, "x": String(x)], lang: lang) }
    return t(.iosAlertCameraNoLimit, ["d": d], lang: lang)
}

/// A szakasz-jelzés mondata (a webes navigáció szövege): „Szakaszellenőrzés kezdődik, maximum 110”.
nonisolated func sectionAlertText(limitKmh: Double, unit: SpeedUnit, lang: Lang? = nil) -> String {
    t(.navVoiceSectionAhead, ["x": String(speedIn(limitKmh, unit) ?? 0)], lang: lang)
}

/// A tervezett mérés mondata: vonalnál „Tervezett rendőrségi mérés, maximum 90”, zónánál „Rendőrségi mérés X területén”.
nonisolated func plannedAlertText(_ c: PlannedCheck, unit: SpeedUnit, lang: Lang? = nil) -> String {
    c.isZone
        ? t(.iosAlertPlannedZone, ["place": c.settlement ?? c.county], lang: lang)
        : t(.iosAlertPlannedLine, ["x": String(speedIn(c.speedLimitKmh, unit) ?? 0)], lang: lang)
}

/// A szakasz kezdő irányának foka (a geometria első két pontjából, különben kezdet → vég).
nonisolated private func sectionStartBearing(_ s: Section) -> Double {
    if let g = s.geometry, g.count >= 2 { return bearingDeg(g[0], g[1]) }
    return bearingDeg(s.start, s.end)
}

/// A kamera- és szakaszkapu-közeledés figyelője. Kameránként (kapunként) egyszer jelez, amikor az útirányban
/// (haladási irány ±45°) 600 m-en belülre kerül; ha elhaladtunk mellette vagy visszafordultunk (a cél mögénk
/// került, vagy 800 m-nél messzebb van), a jelzés „újratöltődik”, így visszafordulva újra szól.
final class ApproachWatch {
    let config: ApproachConfig
    private var announced: Set<String> = []
    private var previous: GpsFix?

    init(config: ApproachConfig = ApproachConfig()) {
        self.config = config
    }

    /// A haladási irány: a GPS-ből, ennek hiányában az előző fixtől való elmozdulásból.
    private func heading(_ fix: GpsFix) -> Double? {
        if let h = fix.heading { return h }
        guard let p = previous, haversineM(p, fix) >= config.headingFromMoveM else { return nil }
        return bearingDeg(p, fix)
    }

    /// Egy új fix: a most esedékes jelzések (a kamerák a jogi láthatóság szerint: csak `show` országban, mert a
    /// bemondás a pontos helyet árulná el).
    func update(_ fix: GpsFix, cameras: [FixedCamera], sections: [Section], unit: SpeedUnit, rules: VisibilityRules = .bundled) -> [AlertEvent] {
        defer { if previous == nil || haversineM(previous!, fix) >= config.headingFromMoveM { previous = fix } }
        guard let h = heading(fix) else { return [] }
        let moving = (fix.speed ?? config.minSpeedMs) >= config.minSpeedMs

        struct Target {
            var id: String
            var at: LatLon
            var make: (Double) -> AlertEvent
        }
        var targets: [Target] = []
        // gyors előszűrés: ~ a reset-sugáron belüli célok
        let dLat = config.resetM / 111_195
        let dLon = config.resetM / (111_195 * cos(fix.lat * .pi / 180))
        let near = { (p: LatLon) in abs(p.lat - fix.lat) <= dLat && abs(p.lon - fix.lon) <= dLon }

        let nearSections = sections.filter { near($0.start) }
        for s in nearSections where angleDiffDeg(sectionStartBearing(s), h) <= config.sectionDirDeg {
            targets.append(Target(id: "section:\(s.id)", at: s.start) { _ in
                AlertEvent(kind: .section, targetId: s.id, text: sectionAlertText(limitKmh: s.speedLimitKmh, unit: unit))
            })
        }
        for c in cameras {
            let p = LatLon(lat: c.lat, lon: c.lon)
            guard near(p), rules.visibility(c.country) == .show else { continue }
            // az ellenkező irányba néző kamera nem a miénk (ha van iránya), mint a webes útvonal-szűrésben
            if let ch = c.headingDeg, angleDiffDeg(ch, h) > config.behindDeg { continue }
            if c.type == .sectionGate, nearSections.contains(where: { haversineM($0.start, p) <= config.gateDedupM }) { continue }
            targets.append(Target(id: "camera:\(c.id)", at: p) { d in
                AlertEvent(kind: .camera, targetId: c.id, text: cameraAlertText(distanceM: d, limitKmh: c.speedLimitKmh, unit: unit))
            })
        }

        var events: [AlertEvent] = []
        var seen: Set<String> = []
        for target in targets {
            seen.insert(target.id)
            let d = haversineM(fix, target.at)
            let off = angleDiffDeg(bearingDeg(fix, target.at), h)
            if announced.contains(target.id) {
                if d > config.resetM || off > config.behindDeg { announced.remove(target.id) }
            } else if moving, d <= config.aheadM, off <= config.coneDeg {
                announced.insert(target.id)
                events.append(target.make(d))
            }
        }
        // a szűrésből kiesett (messzire került / irányt váltott) célok is újratöltődnek
        announced.formIntersection(seen)
        return events
    }

    func reset() {
        announced = []
        previous = nil
    }
}

/// Hogyan szóljon a jelzés (beállítás): hang (rövid hang + bemondás + rezgés), csak rezgés, vagy ki.
nonisolated enum AlertMode: String, Codable, CaseIterable, Sendable {
    case hang, rezges, ki
}

/// Mit kap a hang-réteg egy eseményhez.
nonisolated enum AlertDelivery: Equatable, Sendable {
    /// Rövid hang + bemondás + rezgés.
    case sound
    /// Csak rezgés.
    case vibrate
    /// Csak a képernyőn (a jelzés módja „ki”).
    case silent
}

/// A beállítások szerint: `nil`, ha az eseményt egyáltalán nem kell jelezni (a fajtája ki van kapcsolva),
/// különben a kézbesítés módja. A tervezett mérés jelzése csak akkor él, ha a tervezett mérések látszanak is.
nonisolated func alertDelivery(_ kind: AlertKind, _ s: Settings) -> AlertDelivery? {
    switch kind {
    case .camera, .section: guard s.kameraJelzes else { return nil }
    case .planned: guard s.tervezettMeresek && s.tervezettJelzes else { return nil }
    }
    switch s.jelzesMod {
    case .hang: return .sound
    case .rezges: return .vibrate
    case .ki: return .silent
    }
}

/// A hang-réteg felülete (a tesztekben felvevő; az appban az AVFoundation-os AlertPlayer).
protocol AlertSink: AnyObject {
    func deliver(_ event: AlertEvent, _ delivery: AlertDelivery)
}
