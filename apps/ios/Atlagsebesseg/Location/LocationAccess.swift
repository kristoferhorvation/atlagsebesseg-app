import CoreLocation

// A packages/app-logic/src/location.ts iOS-megfelelője (AOS12): a GPS-pill koppintása az engedély állapotából. A webes
// böngésző-felismerés és a gesztusra történő újrakérés iOS-en nem kell – az app a rendszer engedély-állapotát ismeri.

/// A helymeghatározás engedélye (a `CLAuthorizationStatus` egyszerűsítve).
nonisolated enum LocationPermission: Sendable {
    case notDetermined, denied, granted

    init(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .denied, .restricted: self = .denied
        default: self = .granted
        }
    }
}

/// A GPS-pill koppintására: engedélykérés / a tiltott-lap megnyitása / semmi (a webes `GpsPillAction`).
nonisolated enum GpsPillAction: Sendable {
    case request, deniedHelp, none
}

/// A GPS-pill koppintása (AW14): a helyzet-állapot nyer az engedély felett – van pozíció (aktív) vagy szimulátor → semmi
/// (a pill a pontosságot mutatja). Pozíció nélkül az engedély dönt: nem eldöntött → kérés, tiltva (vagy korlátozva) → lap
/// a Beállítások-megnyitással, engedélyezve → semmi, kivéve ha a rendszerszintű Helymeghatározás ki van kapcsolva (a forrás
/// elutasítást jelez) → lap. Leállított GPS-nél nincs mit kérni.
func gpsPillAction(_ permission: LocationPermission, _ status: GeoStatus) -> GpsPillAction {
    if status == .off || status == .sim || status == .unavailable || status == .active { return .none }
    switch permission {
    case .granted: return status == .denied ? .deniedHelp : .none
    case .notDetermined: return .request
    case .denied: return .deniedHelp
    }
}
