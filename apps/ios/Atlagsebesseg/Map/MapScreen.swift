import AtlagsebessegCore
import MapboxMaps
import SwiftUI

/// A térkép (Mapbox Standard): szakaszok vonalként (az aktív a tónus színében, a megtett rész telítetten),
/// tervezett mérések halvány sárga vonalként / zónaként (a webes A7 kinézet), kamerák ikonként a láthatósági
/// szabály szerint, saját pozíció; a kamera követi a pozíciót.
struct MapScreen: View {
    let model: AppModel
    @Binding var follow: Bool

    @State private var viewport: Viewport = .camera(center: CLLocationCoordinate2D(latitude: 47.4979, longitude: 19.0402), zoom: 6.5)
    @State private var sectionsFC = FeatureCollection(features: [])
    @State private var cameraPoints: [FixedCamera] = []
    @State private var zonesFC = FeatureCollection(features: [])
    /// A térkép aktuális elforgatása (fok) – a saját pozíció nyila ehhez képest mutat a haladási irányba.
    @State private var mapBearing: Double = 0
    @Environment(\.colorScheme) private var scheme

    private var view: SessionView { model.view }
    private var tone: Tone { toneOf(view) }
    private var activeId: String? {
        switch view.phase {
        case .meres, .kozeledik, .befejezve: view.section?.id
        default: nil
        }
    }

    var body: some View {
        Map(viewport: $viewport) {
            GeoJSONSource(id: "sections").data(.featureCollection(sectionsFC))
            LineLayer(id: "sections-line", source: "sections")
                .slot(.middle)
                .filter(Exp(.neq) { Exp(.get) { "id" }; activeId ?? "" })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.accent))
                .lineWidth(Exp(.interpolate) { Exp(.linear); Exp(.zoom); 8; 2; 16; 6 })
                .lineOpacity(0.55)
                .lineEmissiveStrength(1)

            GeoJSONSource(id: "active").data(.featureCollection(activeFC))
            LineLayer(id: "active-glow", source: "active")
                .slot(.middle)
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(tone.color))
                .lineWidth(26)
                .lineOpacity(0.22)
                .lineBlur(10)
                .lineEmissiveStrength(1)
            LineLayer(id: "active-line", source: "active")
                .slot(.middle)
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(tone.color))
                .lineWidth(Exp(.interpolate) { Exp(.linear); Exp(.zoom); 10; 4; 17; 11 })
                .lineOpacity(Exp(.match) { Exp(.get) { "part" }; "rest"; view.progress == nil ? 0.9 : 0.38; 1.0 })
                .lineEmissiveStrength(1)

            // tervezett mérések: zóna (település) halvány kitöltéssel, vonal halvány sárgán; az aktív erősebb
            GeoJSONSource(id: "planned-zones").data(.featureCollection(plannedFC.zones))
            FillLayer(id: "planned-zone-fill", source: "planned-zones")
                .slot(.middle)
                .fillColor(UIColor(Tokens.Colors.planned))
                .fillOpacity(Exp(.switchCase) { Exp(.get) { "active" }; 0.22; 0.12 })
                .fillEmissiveStrength(1)
            LineLayer(id: "planned-zone-line", source: "planned-zones")
                .slot(.middle)
                .lineColor(UIColor(Tokens.Colors.planned))
                .lineWidth(1.5)
                .lineOpacity(Exp(.switchCase) { Exp(.get) { "active" }; 0.7; 0.4 })
                .lineEmissiveStrength(1)
            GeoJSONSource(id: "planned").data(.featureCollection(plannedFC.lines))
            LineLayer(id: "planned-line", source: "planned")
                .slot(.middle)
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.planned))
                .lineWidth(Exp(.interpolate) { Exp(.linear); Exp(.zoom); 8; 3; 16; 12 })
                .lineOpacity(Exp(.switchCase) { Exp(.get) { "active" }; 0.75; 0.42 })
                .lineEmissiveStrength(1)

            // kamera-zóna (`zone` láthatóság): kör, pont nélkül
            GeoJSONSource(id: "camera-zones").data(.featureCollection(zonesFC))
            FillLayer(id: "camera-zones-fill", source: "camera-zones")
                .slot(.middle)
                .fillColor(UIColor(Tokens.Colors.idle))
                .fillOpacity(0.12)
                .fillEmissiveStrength(1)
            LineLayer(id: "camera-zones-line", source: "camera-zones")
                .slot(.middle)
                .lineColor(UIColor(Tokens.Colors.idle))
                .lineWidth(1.5)
                .lineOpacity(0.5)
                .lineDashArray([2, 2])
                .lineEmissiveStrength(1)

            ForEvery(cameraPoints) { cam in
                MapViewAnnotation(coordinate: CLLocationCoordinate2D(latitude: cam.lat, longitude: cam.lon)) {
                    CameraPin(camera: cam)
                }
                .allowOverlap(true)
            }

            if let fix = view.lastFix {
                MapViewAnnotation(coordinate: CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lon)) {
                    // a nyíl a képernyőhöz képest forog: haladási irány − térkép-elforgatás (kézzel forgatva is)
                    Puck(heading: fix.heading.map { $0 - mapBearing }, tone: tone)
                }
                .allowOverlap(true)
            }
        }
        .mapStyle(.standard(
            theme: model.settings.terkep == .visszafogott ? .monochrome : .default,
            lightPreset: StandardLightPreset(rawValue: lightPresetAt(model.nowMs(), view.lastFix, dark: systemDark).rawValue),
            showPointOfInterestLabels: false
        ))
        // attribúció a felső sarkokban (a kártya ne takarja), mint a weben
        .ornamentOptions(OrnamentOptions(
            scaleBar: ScaleBarViewOptions(visibility: .hidden),
            compass: CompassViewOptions(visibility: .hidden),
            logo: LogoViewOptions(position: .topLeading, margins: CGPoint(x: 12, y: 4)),
            attributionButton: AttributionButtonOptions(position: .topTrailing, margins: CGPoint(x: 12, y: 4))
        ))
        .gestureHandlers(MapGestureHandlers(onBegin: { _ in follow = false }))
        .onCameraChanged { e in
            let b = e.cameraState.bearing
            if abs(angleDiffDeg(b, mapBearing)) >= 0.5 { mapBearing = b }
        }
        .ignoresSafeArea()
        .onAppear {
            rebuild()
            // a nézet a már futó mérés közben is megjelenhet (szimulátor-ugrás, visszatérés): azonnal a pozícióra áll
            if follow, let fix = view.lastFix { recenter(fix, animated: false) }
        }
        .onChange(of: model.dataVersion) { rebuild() }
        .onChange(of: view.lastFix) { _, fix in
            guard let fix else { return }
            if follow { recenter(fix, animated: true) }
            if Int(fix.timestamp / 1000) % 10 == 0 { rebuildCameras(around: fix) }
        }
        .onChange(of: follow) { _, on in
            if on, let fix = view.lastFix { recenter(fix, animated: true) }
        }
    }

    /// A rendszer világos/sötét módja (a kártyák mindig sötétek; a térkép előbeállítása ebből és a napszakból).
    private var systemDark: Bool { UITraitCollection.current.userInterfaceStyle == .dark || scheme == .dark }

    private func recenter(_ fix: GpsFix, animated: Bool) {
        let target = Viewport.camera(
            center: CLLocationCoordinate2D(latitude: fix.lat, longitude: fix.lon),
            zoom: 15.2,
            bearing: fix.heading ?? 0,
            pitch: 45
        )
        // a saját pozíció a kártya fölötti, látható térképrészre kerül (ne takarja a mérőkártya)
        .padding(.bottom, UIScreen.main.bounds.height * 0.45)
        if animated {
            withViewportAnimation(.easeOut(duration: Tokens.Motion.data)) { viewport = target }
        } else {
            viewport = target
        }
    }

    // MARK: rétegadat

    private var activeFC: FeatureCollection {
        guard let s = view.section, let id = activeId else { return FeatureCollection(features: []) }
        let pts = (s.geometry?.isEmpty ?? true) ? [s.start, s.end] : s.geometry!
        guard let route = try? Route(pts, nominalLengthM: s.lengthM) else { return FeatureCollection(features: []) }
        let doneM = (view.progress ?? 0) * route.lengthM
        func feature(_ part: String, _ coords: [LatLon]) -> Feature {
            var f = Feature(geometry: LineString(coords.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }))
            f.properties = ["id": .string(id), "part": .string(part)]
            return f
        }
        guard doneM > 0 else { return FeatureCollection(features: [feature("rest", pts)]) }
        // a megtett rész és a hátralévő rész az útvonal mentén kettévágva
        let split = route.pointAt(doneM)
        var done: [LatLon] = [pts[0]]
        var rest: [LatLon] = [split]
        for p in pts.dropFirst() {
            if route.project(p).alongM < doneM { done.append(p) } else { rest.append(p) }
        }
        done.append(split)
        return FeatureCollection(features: [feature("done", done), feature("rest", rest)])
    }

    /// A látható tervezett mérések (a jogi láthatóság szerint csak `show` országban kerülnek a térképre).
    private var plannedFC: (lines: FeatureCollection, zones: FeatureCollection) {
        let rules = VisibilityRules.bundled
        let shown = model.plannedShown.filter { rules.visibility($0.country) == .show }
        let activeId = model.activePlanned?.id
        let coord = { (p: LatLon) in CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon) }
        var lines: [Feature] = []
        var zones: [Feature] = []
        for c in shown {
            let props: JSONObject = ["id": .string(c.id), "active": .boolean(c.id == activeId)]
            if c.isZone {
                var f = Feature(geometry: MultiPolygon(c.zones.map { $0.map { $0.map(coord) } }))
                f.properties = props
                zones.append(f)
            } else {
                var f = Feature(geometry: MultiLineString(c.lines.filter { $0.count >= 2 }.map { $0.map(coord) }))
                f.properties = props
                lines.append(f)
            }
        }
        return (FeatureCollection(features: lines), FeatureCollection(features: zones))
    }

    private func rebuild() {
        sectionsFC = FeatureCollection(features: model.sections.map { s in
            let pts = (s.geometry?.isEmpty ?? true) ? [s.start, s.end] : s.geometry!
            var f = Feature(geometry: LineString(pts.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }))
            f.properties = ["id": .string(s.id)]
            return f
        })
        let vis = visibleCameras(model.cameras)
        zonesFC = FeatureCollection(features: vis.zones.map { z in
            Feature(geometry: Polygon(center: CLLocationCoordinate2D(latitude: z.center.lat, longitude: z.center.lon), radius: z.radiusM, vertices: 48))
        })
        rebuildCameras(around: view.lastFix)
    }

    /// A pontként látható kamerák közül a közeliek (≤ 25 km) – a nézet-annotációk száma kicsi marad.
    private func rebuildCameras(around fix: GpsFix?) {
        let points = visibleCameras(model.cameras).points
        guard let fix else {
            cameraPoints = []
            return
        }
        cameraPoints = points.filter { haversineM(fix, LatLon(lat: $0.lat, lon: $0.lon)) <= 25_000 }
    }
}

/// Kamera-jelölő: kerek üveg-korong a típus ikonjával (a webes `.camera-pin`).
private struct CameraPin: View {
    let camera: FixedCamera

    var body: some View {
        Icon(name: camera.type.icon, size: 18)
            .foregroundStyle(camera.verified ? Tokens.Colors.text : Tokens.Colors.textMuted)
            .frame(width: 34, height: 34)
            .background(Tokens.Colors.surfaceStrong, in: Circle())
            .overlay(Circle().strokeBorder(camera.verified ? Tokens.Colors.signRing : Tokens.Colors.strokeStrong, lineWidth: 2))
            .accessibilityLabel(t(.cameraAria, ["label": camera.type.label]))
    }
}

/// Saját pozíció: tónusszínű nyíl a haladási irányban (irány nélkül pont). A `heading` a képernyőhöz képest
/// értendő (a térkép elforgatása már le van vonva), így követéskor felfelé, kézzel forgatott térképen is az
/// útirányba mutat.
private struct Puck: View {
    let heading: Double?
    let tone: Tone

    var body: some View {
        ZStack {
            Circle().fill(tone.color.opacity(0.25)).frame(width: 44, height: 44)
            Circle().fill(Tokens.Colors.text).frame(width: 24, height: 24)
            if heading != nil {
                Icon(name: .arrowUp, size: 18)
                    .foregroundStyle(Tokens.Colors.bg)
                    .rotationEffect(.degrees(heading ?? 0))
            } else {
                Circle().fill(tone.color).frame(width: 14, height: 14)
            }
        }
        .accessibilityHidden(true)
    }
}
