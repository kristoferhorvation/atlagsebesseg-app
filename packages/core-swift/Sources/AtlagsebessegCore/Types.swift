/// Bármi, aminek szélessége és hosszúsága van (a TS-ben a `LatLon`-t a `GpsFix` is kielégíti).
public protocol Coordinate {
    var lat: Double { get }
    var lon: Double { get }
}

/// WGS84 koordináta, fokban.
public struct LatLon: Coordinate, Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double

    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }
}

/// Az adat eredete: OSM-import, hivatalos lista vagy közösségi bejelentés.
public enum SectionSource: String, Codable, Sendable {
    case osm, hivatalos, kozosseg
}

/// A sebességhatár forrása.
public enum SectionLimitSource: String, Codable, Sendable {
    case hivatalos, osm
}

/// Hogyan állapítottuk meg a kapuk helyét a forrásból.
public enum SectionLocatedBy: String, Codable, Sendable {
    case koordinata
    case kmSzelveny = "km_szelveny"
    case telepules
}

/// Egy szakasz forrása: ki adta ki, hol, mikor, és hogyan lett belőle hely.
public struct SectionProvenance: Codable, Hashable, Sendable {
    /// A forrás (hivatalos szerv) neve, pl. "Polizia di Stato"; OSM-nél "OpenStreetMap".
    public var name: String
    public var url: String
    /// A forrás dátuma: "2026-08" vagy "2026-08-14".
    public var date: String
    public var locatedBy: SectionLocatedBy

    public init(name: String, url: String, date: String, locatedBy: SectionLocatedBy) {
        self.name = name
        self.url = url
        self.date = date
        self.locatedBy = locatedBy
    }
}

/// Egy irányú átlagsebesség-mérő szakasz. Egy útszakasz két irányát két külön `Section` írja le.
public struct Section: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    /// ISO 3166-1 alpha-2 országkód, pl. "IT", "AT", "HU".
    public var country: String
    /// Útszám, pl. "A1".
    public var road: String
    /// Emberi olvasásra szánt irány, pl. "Bologna → Firenze".
    public var direction: String
    /// Kezdőpont (a belépő kapu).
    public var start: LatLon
    /// Végpont (a kilépő kapu).
    public var end: LatLon
    /// A szakasz hossza méterben (lehetőleg a hivatalos érték).
    public var lengthM: Double
    /// Sebességhatár km/h-ban.
    public var speedLimitKmh: Double
    public var source: SectionSource
    /// Ember által ellenőrzött adat-e.
    public var verified: Bool
    /// Az út vonala a haladási irányban, `start`-tól `end`-ig. Ha hiányzik, a start→end egyenes.
    public var geometry: [LatLon]?
    /// A forrás (hivatalos importnál mindig kitöltve).
    public var provenance: SectionProvenance?
    /// Honnan jön a sebességhatár: a hivatalos forrásból vagy az OSM `maxspeed`-ből.
    public var limitSource: SectionLimitSource?

    public init(
        id: String, country: String, road: String, direction: String, start: LatLon, end: LatLon, lengthM: Double,
        speedLimitKmh: Double, source: SectionSource, verified: Bool, geometry: [LatLon]? = nil,
        provenance: SectionProvenance? = nil, limitSource: SectionLimitSource? = nil
    ) {
        self.id = id
        self.country = country
        self.road = road
        self.direction = direction
        self.start = start
        self.end = end
        self.lengthM = lengthM
        self.speedLimitKmh = speedLimitKmh
        self.source = source
        self.verified = verified
        self.geometry = geometry
        self.provenance = provenance
        self.limitSource = limitSource
    }
}

/// Egy GPS-mérés. Az ismeretlen értékek `nil`-ek.
public struct GpsFix: Coordinate, Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double
    /// Unix-idő ezredmásodpercben.
    public var timestamp: Double
    /// Sebesség m/s-ban.
    public var speed: Double?
    /// Vízszintes pontosság méterben (68%-os sugár).
    public var accuracy: Double?
    /// Haladási irány fokban (0 = észak, óramutató szerint).
    public var heading: Double?

    public init(lat: Double, lon: Double, timestamp: Double, speed: Double?, accuracy: Double?, heading: Double?) {
        self.lat = lat
        self.lon = lon
        self.timestamp = timestamp
        self.speed = speed
        self.accuracy = accuracy
        self.heading = heading
    }
}
