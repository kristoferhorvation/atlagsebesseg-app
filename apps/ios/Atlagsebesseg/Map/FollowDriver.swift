import AtlagsebessegCore
import MapboxMaps
import QuartzCore
import SwiftUI
import UIKit

/// AW23: a jelölő és a követő kamera képkockánként (CADisplayLink) ugyanabból a pózból mozog (a webes `MapController.frame` párja). A
/// jelölő nem Mapbox-annotáció: a SwiftUI-frissítés és az annotáció-elhelyezés késne, és a fixenkénti ugrás éppen ebből jött.
@MainActor final class FollowDriver: NSObject {
    private let smoother: PositionSmoother
    /// A térkép (a `MapProxy`-ból, az első képkockáktól elérhető).
    var map: (() -> MapboxMap?)?
    weak var puck: UIView?
    /// Követ-e a kamera (a felhasználó mozdulata vagy az útvonalválasztó kikapcsolja).
    private(set) var following = false
    /// A legfelső alsó kártya teteje (pt).
    var cardTop = 0.0
    private var link: CADisplayLink?
    private var zoom: Double?
    private var focus = Tokens.Camera.focusMaxY
    private var lastFrame = 0.0
    private var recenter: (from: CameraState, start: Double)?
    private var lastSent: CameraOptions?
    private var shownAny = false
    #if DEBUG
    /// `-frameLog YES`: képkockánként a jelölő helye, a `Documents/frames.json`-ba (a mérés-próbához).
    private var frames: [[Double]] = []
    private let frameLog = UserDefaults.standard.bool(forKey: "frameLog")
    #endif

    init(simClock: Bool) {
        smoother = PositionSmoother(simClock: simClock)
    }

    func start() {
        guard link == nil else { return }
        let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        l.add(to: .main, forMode: .common)
        link = l
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    func onFix(_ fix: GpsFix) {
        smoother.onFix(fix, now: CACurrentMediaTime() * 1000)
    }

    /// Követés ki / be; bekapcsoláskor a kamera animálva áll vissza (kivéve a legelső helyzetet).
    func setFollowing(_ on: Bool) {
        guard on != following else { return }
        following = on
        lastSent = nil
        if on, shownAny, let m = map?() {
            recenter = (m.cameraState, CACurrentMediaTime() * 1000)
        } else {
            recenter = nil
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = CACurrentMediaTime() * 1000
        let dt = lastFrame > 0 ? min(1000, now - lastFrame) : 16
        lastFrame = now
        guard let pose = smoother.at(now), let m = map?() else { return }
        let center = CLLocationCoordinate2D(latitude: pose.lat, longitude: pose.lon)
        let h = Double(UIScreen.main.bounds.height)
        let wanted = followFocusY(cardTop > 0 ? cardTop : h, h)
        focus += (wanted - focus) * (1 - exp(-dt / Tokens.Camera.focusTau))
        let target = followZoom(pose.speedMps * 3.6)
        let z = zoom.map { $0 + (target - $0) * (1 - exp(-dt / Tokens.Camera.zoomTau)) } ?? target
        zoom = z
        if following { moveCamera(m, center, z, pose.bearing, h, now) }
        shownAny = true
        placePuck(m, center, pose.bearing)
        #if DEBUG
        if frameLog {
            frames.append([now, pose.lat, pose.lon, pose.speedMps])
            if frames.count % 600 == 0, let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first, let data = try? JSONSerialization.data(withJSONObject: frames) {
                try? data.write(to: dir.appendingPathComponent("frames.json"))
            }
        }
        #endif
    }

    private func moveCamera(_ m: MapboxMap, _ center: CLLocationCoordinate2D, _ z: Double, _ bearing: Double, _ h: Double, _ now: Double) {
        var lat = center.latitude, lon = center.longitude, zo = z, b = bearing, pitch = Tokens.Camera.pitch
        var top = max(0, 2 * focus * h - h), bottom = max(0, h - 2 * focus * h)
        if let r = recenter {
            let k = min(1, (now - r.start) / Tokens.Camera.recenter)
            let e = k < 0.5 ? 4 * k * k * k : 1 - pow(-2 * k + 2, 3) / 2
            func mix(_ a: Double, _ c: Double) -> Double { a + (c - a) * e }
            let f = r.from
            lat = mix(f.center.latitude, lat)
            lon = mix(f.center.longitude, lon)
            zo = mix(f.zoom, zo)
            pitch = mix(f.pitch, pitch)
            top = mix(Double(f.padding.top), top)
            bottom = mix(Double(f.padding.bottom), bottom)
            let d = ((b - f.bearing).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180
            b = (f.bearing + d * e + 360).truncatingRemainder(dividingBy: 360)
            if k >= 1 { recenter = nil }
        }
        let options = CameraOptions(
            center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            padding: UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0),
            zoom: zo, bearing: b, pitch: pitch
        )
        // azonos kamerára nem hívunk (a webes `lastCam`)
        if options == lastSent { return }
        lastSent = options
        m.setCamera(to: options)
    }

    private func placePuck(_ m: MapboxMap, _ center: CLLocationCoordinate2D, _ bearing: Double) {
        guard let puck else { return }
        let state = m.cameraState
        puck.isHidden = false
        puck.center = m.point(for: center)
        let rotate = CATransform3DMakeRotation((bearing - state.bearing) * .pi / 180, 0, 0, 1)
        let tilt = CATransform3DMakeRotation(state.pitch * .pi / 180, 1, 0, 0)
        puck.layer.transform = CATransform3DConcat(rotate, tilt)
    }
}

/// A saját pozíció rétege a térkép fölött: a `Puck` nézetet a `FollowDriver` mozgatja képkockánként, SwiftUI-frissítés nélkül.
struct PuckOverlay: UIViewRepresentable {
    let driver: FollowDriver

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.isUserInteractionEnabled = false
        container.backgroundColor = .clear
        let host = UIHostingController(rootView: Puck(rotation: 0, pitch: 0))
        host.view.backgroundColor = .clear
        host.view.frame = CGRect(x: 0, y: 0, width: 60, height: 60)
        host.view.isHidden = true
        host.view.accessibilityIdentifier = "puck"
        container.addSubview(host.view)
        context.coordinator.host = host
        driver.puck = host.view
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var host: UIHostingController<Puck>?
    }
}
