import CoreLocation

/// A valódi helyzet: When In Use engedély + `location` háttér-mód, hogy a mérés zárolt képernyőn is fusson.
final class CoreLocationSource: NSObject, LocationSource, CLLocationManagerDelegate {
    var onLocation: ((CLLocation) -> Void)?
    var onGap: (() -> Void)?
    var onStatus: ((GeoStatus) -> Void)?

    private let manager = CLLocationManager()
    /// iOS 17+: a When In Use engedéllyel ez tartja életben a háttérbeli frissítéseket (kék jelzés a státuszsorban).
    private var backgroundSession: CLBackgroundActivitySession?
    private var running = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start() {
        running = true
        onStatus?(.searching)
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            onStatus?(.denied)
        default:
            begin()
        }
    }

    func stop() {
        running = false
        manager.stopUpdatingLocation()
        backgroundSession?.invalidate()
        backgroundSession = nil
        onStatus?(.off)
    }

    private func begin() {
        guard running else { return }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        if backgroundSession == nil { backgroundSession = CLBackgroundActivitySession() }
        manager.startUpdatingLocation()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            switch status {
            case .authorizedWhenInUse, .authorizedAlways: begin()
            case .denied, .restricted: onStatus?(.denied)
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated {
            onStatus?(.active)
            for l in locations { onLocation?(l) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        MainActor.assumeIsolated {
            if code == .denied { onStatus?(.denied) } else if code != .locationUnknown { onStatus?(.error) }
        }
    }
}
