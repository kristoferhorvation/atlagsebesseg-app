#if DEBUG
import CoreLocation
import Foundation

/// AW23 (`-gpsTrace 0`, csak DEBUG): a rögzített valódi 1 Hz-es GPS-nyomat visszajátszása valós időben, a valódi helyzet útján
/// (`AppModel.onLocation`), a `-frameLog YES` képkockánkénti méréséhez. Sebesség és irány a szomszédos mintákból.
final class TraceLocationSource: LocationSource {
    var onLocation: ((CLLocation) -> Void)?
    var onGap: (() -> Void)?
    var onStatus: ((GeoStatus) -> Void)?
    private var timer: Timer?
    private let fixes: [[Double]]
    private var i = 0

    init(trace: Int) {
        struct File: Decodable {
            struct T: Decodable { let fixes: [[Double]] }
            let traces: [T]
        }
        let url = Bundle.main.url(forResource: "gps-trace-1hz", withExtension: "json")
        let file = url.flatMap { try? JSONDecoder().decode(File.self, from: Data(contentsOf: $0)) }
        fixes = file.map { $0.traces[min(trace, $0.traces.count - 1)].fixes } ?? []
    }

    func start() {
        onStatus?(.active)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.step() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        onStatus?(.off)
    }

    private func step() {
        guard i < fixes.count else { return stop() }
        let f = fixes[i]
        var speed = 0.0
        var course = -1.0
        if i > 0 {
            let p = fixes[i - 1]
            let a = CLLocation(latitude: p[1], longitude: p[2])
            let b = CLLocation(latitude: f[1], longitude: f[2])
            speed = b.distance(from: a) / max(1, f[0] - p[0])
            let (dx, dy) = ((f[2] - p[2]) * cos(f[1] * .pi / 180), f[1] - p[1])
            if speed > 1 { course = (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360) }
        }
        i += 1
        onLocation?(CLLocation(coordinate: CLLocationCoordinate2D(latitude: f[1], longitude: f[2]), altitude: 0, horizontalAccuracy: 5, verticalAccuracy: 5, course: course, speed: speed, timestamp: Date()))
    }
}
#endif
