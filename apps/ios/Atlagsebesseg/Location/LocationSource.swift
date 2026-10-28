import AtlagsebessegCore
import CoreLocation

/// Helyzetforrás: a valódi CoreLocation vagy a szimulátor (CoreLocation-mock). Mindkettő `CLLocation`-t ad,
/// és ugyanaz az átalakítás (`GpsFix(location:)`) viszi a mérésbe.
protocol LocationSource: AnyObject {
    var onLocation: ((CLLocation) -> Void)? { get set }
    /// Fix nélküli ütem (a szimulátorban a kiesett minták helyén: alagút).
    var onGap: (() -> Void)? { get set }
    var onStatus: ((GeoStatus) -> Void)? { get set }
    func start()
    func stop()
}

/// A GPS állapota a beállításokban (a webes `geo.*` feliratok).
enum GeoStatus: Sendable {
    case off, searching, active, denied, unavailable, error, sim

    var label: String {
        switch self {
        case .off: t(.geoOff)
        case .searching: t(.geoSearching)
        case .active: t(.geoActive)
        case .denied: t(.iosGeoDenied)
        case .unavailable: t(.geoUnavailable)
        case .error: t(.geoError)
        case .sim: t(.geoSim)
        }
    }
}

extension GpsFix {
    /// `CLLocation` → `GpsFix` (a webes `toGpsFix` megfelelője): negatív sebesség / irány / pontosság = ismeretlen.
    init(location l: CLLocation) {
        self.init(
            lat: l.coordinate.latitude,
            lon: l.coordinate.longitude,
            timestamp: (l.timestamp.timeIntervalSince1970 * 1000).rounded(),
            speed: l.speed >= 0 && l.speed.isFinite ? l.speed : nil,
            accuracy: l.horizontalAccuracy >= 0 && l.horizontalAccuracy.isFinite ? l.horizontalAccuracy : nil,
            heading: l.course >= 0 && l.course.isFinite ? l.course.truncatingRemainder(dividingBy: 360) : nil
        )
    }
}
