import AtlagsebessegCore
import MapboxMaps
import SwiftUI
import UIKit

/// A térkép (Mapbox Standard): szakaszok vonalként (az aktív a tónus színében, a megtett rész telítetten),
/// tervezett mérések halvány sárga vonalként / zónaként (a webes A7 kinézet), kamerák ikonként a láthatósági
/// szabály szerint, saját pozíció; a kamera követi a pozíciót. A11: tervezett / navigációs útvonal (a kiválasztott
/// kékkel, dugó-színezéssel; az alternatíva tömör szürkéskéken, casinggel, „+/− perc” címkével, koppintásra vált – A8d),
/// a cél jelölője; navigációban 3D-s döntésű követés. AOS12: az AW11-es útvonal-tokenek (nappal / éjjel), a címke a
/// leágazás után 300 m-rel (`altLabels`), érkezéskor a vonal eltűnik. AW23: a jelölő és a követő kamera a `FollowDriver`-ből, képkockánként.
struct MapScreen: View {
    let model: AppModel
    @Binding var follow: Bool

    // AOS17: az első helyzetig a webes kiinduló nézet; az első fixre ugrik (nem repül), utána a közeli követés
    @State private var viewport: Viewport = .camera(center: CLLocationCoordinate2D(latitude: 46.5, longitude: 12.5), zoom: 5.2)
    @State private var driver = FollowDriver(simClock: UserDefaults.standard.string(forKey: "sim") != nil || UserDefaults.standard.bool(forKey: "cruise"))
    @State private var mapEpoch = 0
    @State private var sectionsFC = FeatureCollection(features: [])
    @State private var cameraPoints: [FixedCamera] = []
    @State private var zonesFC = FeatureCollection(features: [])
    @State private var routesFC = FeatureCollection(features: [])
    /// AW20: a hőtérkép pontjai (súllyal); navigáció / mérés közben üres.
    @State private var heatFC = FeatureCollection(features: [])
    @State private var heatBuiltAt = 0.0
    /// AW20-javítás: a zónában lévő cellák (saját módban szürkén, nem színezve) és a zóna-körök (amíg a Beállítások nyitva).
    @State private var privacyZonesFC = FeatureCollection(features: [])
    @State private var altLabels: [AltLabel] = []
    /// AW17: a címkék képernyő-pontban számolt helye (a buborék közepe), útvonal-azonosító szerint.
    @State private var altLabelAt: [String: CLLocationCoordinate2D] = [:]
    @State private var lastGestureAt: Double = 0
    @State private var gesturing = false

    private var view: SessionView { model.view }
    private var tone: Tone { toneOf(view) }
    private var activeId: String? {
        switch view.phase {
        case .meres, .kozeledik: view.section?.id
        default: nil
        }
    }

    /// A térkép fény-előbeállítása; az alternatíva színe ehhez igazodik (hajnal = nappali, alkony = éjjeli, mint a weben).
    /// AW16: napközben a kinézet dönt (Világos = day, Színes = dusk); napnyugtakor és éjjel mindkettő a napszaké.
    private var preset: LightPreset { mapLightPreset(model.settings.terkep, lightPresetAt(model.lightNowMs(), view.lastFix)) }
    private var dayLike: Bool { preset == .day || preset == .dawn }
    private var altColor: Color { dayLike ? Tokens.Colors.routeAltDay : Tokens.Colors.routeAltNight }
    private var altCasing: Color { dayLike ? Tokens.Colors.routeAltCasingDay : Tokens.Colors.routeAltCasingNight }

    var body: some View {
        MapReader { proxy in
            map(proxy)
                .overlay { PuckOverlay(driver: driver).ignoresSafeArea() }
                .onAppear {
                    driver.map = { proxy.map }
                    driver.start()
                }
                .onDisappear { driver.stop() }
        }
            // AW22: nyelvváltáskor azonnal az új nyelvű feliratok: a csempék a régi nyelven vannak a gyorsítótárban, a térkép újraépül
            .id(mapEpoch)
            .onChange(of: L10n.lang) { refreshMapLanguage() }
            // a gyorsítótár egy korábbi futás nyelvén maradhatott (a nyelv az app leállása alatt, a rendszerben is változhat)
            .onAppear { if UserDefaults.standard.string(forKey: Self.mapLangKey) != L10n.lang.rawValue { refreshMapLanguage() } }
            #if DEBUG
            // élő próba: `-switchLangAfter de` – 15 s múlva nyelvváltás (a fej nélküli szimulátorban nincs koppintás)
            .task {
                guard let l = UserDefaults.standard.string(forKey: "switchLangAfter").flatMap(Lang.init(rawValue:)) else { return }
                try? await Task.sleep(for: .seconds(15))
                LangChoice.shared.preference = l
            }
            #endif
    }

    private static let mapLangKey = "map:lang:v1"

    private func refreshMapLanguage() {
        UserDefaults.standard.set(L10n.lang.rawValue, forKey: Self.mapLangKey)
        MapboxMap.clearData { _ in DispatchQueue.main.async { mapEpoch += 1 } }
    }

    private func map(_ proxy: MapProxy) -> some View {
        Map(viewport: $viewport) {
            // AW24: hőtérkép – utcákra illesztett csíkok (saját / közösségi), legalul; a vastagság a navigációs útvonal-vonalé (INV-18), kerek végek és illesztések, a szín a súlyból; a zónás / út-végi szakasz szürke
            GeoJSONSource(id: "heat").data(.featureCollection(heatFC))
            LineLayer(id: "heat-grey-layer", source: "heat")
                .slot(.middle)
                .filter(Exp(.get) { "grey" })
                .lineCap(.round)
                .lineJoin(.round)
                .lineWidth(Self.routeW)
                .lineColor(UIColor(Tokens.Colors.heatGrey))
                .lineEmissiveStrength(1)
            LineLayer(id: "heat-layer", source: "heat")
                .slot(.middle)
                .filter(Exp(.not) { Exp(.get) { "grey" } })
                .lineCap(.round)
                .lineJoin(.round)
                .lineSortKey(Exp(.get) { "weight" })
                .lineWidth(Self.routeW)
                .lineColor(Self.heatColorRamp(model.settings.hoterkepNezet))
                .lineEmissiveStrength(1)
            // a mentett helyek adatvédelmi zónái: halvány kör, amíg a Beállítások nyitva van
            GeoJSONSource(id: "privacy-zones").data(.featureCollection(privacyZonesFC))
            FillLayer(id: "privacy-zones-fill", source: "privacy-zones")
                .slot(.middle)
                .fillColor(UIColor(Tokens.Colors.brand))
                .fillOpacity(0.10)
                .fillEmissiveStrength(1)
            LineLayer(id: "privacy-zones-line", source: "privacy-zones")
                .slot(.middle)
                .lineColor(UIColor(Tokens.Colors.brand))
                .lineWidth(1.5)
                .lineOpacity(0.45)
                .lineEmissiveStrength(1)
            // útvonalak (A8/A11): legalul, hogy a szakaszok és a mérés fölöttük látszódjanak; az alternatíva alul
            GeoJSONSource(id: "routes").data(.featureCollection(routesFC))
            // AW11 (A8d): a kiválasztott 7 pt erős kék + 2 × 2 pt fehér kontúr, az alternatíva 5 pt + 2 × 1,5 pt kontúr –
            // nappal (hajnal is) 55/45 sötét kontúrral, éjjel (alkony is) 70/30 világos kontúrral
            LineLayer(id: "route-alt-casing", source: "routes")
                .slot(.middle)
                .filter(Exp(.eq) { Exp(.get) { "selected" }; false })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(altCasing))
                .lineWidth(Self.routeAltW + 2 * Self.routeAltCasingW)
                .lineEmissiveStrength(1)
            LineLayer(id: "route-alt", source: "routes")
                .slot(.middle)
                .filter(Exp(.eq) { Exp(.get) { "selected" }; false })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(altColor))
                .lineWidth(Self.routeAltW)
                .lineEmissiveStrength(1)
            LineLayer(id: "route-casing", source: "routes")
                .slot(.middle)
                .filter(Exp(.eq) { Exp(.get) { "selected" }; true })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.routeCasing))
                .lineWidth(Self.routeW + 2 * Self.routeCasingW)
                .lineEmissiveStrength(1)
            LineLayer(id: "route-main", source: "routes")
                .slot(.middle)
                .filter(Exp(.eq) { Exp(.get) { "selected" }; true })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(Exp(.match) {
                    Exp(.get) { "level" }
                    "heavy"; UIColor(Tokens.Colors.over)
                    "moderate"; UIColor(Tokens.Colors.near)
                    UIColor(Tokens.Colors.route)
                })
                .lineWidth(Self.routeW)
                .lineEmissiveStrength(1)

            GeoJSONSource(id: "sections").data(.featureCollection(sectionsFC))
            LineLayer(id: "sections-line", source: "sections")
                .slot(.middle)
                .filter(Exp(.neq) { Exp(.get) { "id" }; activeId ?? "" })
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.brand))
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

            // az alternatív útvonal címkéje: „+4 perc” / „−3 perc”; koppintásra erre vált
            ForEvery(altLabels) { label in
                MapViewAnnotation(coordinate: altLabelAt[label.id] ?? CLLocationCoordinate2D(latitude: label.at.lat, longitude: label.at.lon)) {
                    // a webes `.route-label`: fehér pill, fekete szöveg, 56 pt-es érintési cél; a középpontja a `placeAltLabel` szerinti hely
                    Button { model.selectRoute(label.index) } label: {
                        Text(label.text)
                            .css(Tokens.Typography.caption.size, Tokens.FontWeight.w650, line: 1.2, num: true)
                            .foregroundStyle(Tokens.Colors.signText)
                            .lineLimit(1)
                            .fixedSize()
                            .padding(.horizontal, Tokens.Space.s2)
                            .padding(.vertical, Tokens.Space.s1)
                            .background(Tokens.Colors.signFace, in: Capsule())
                            .overlay(Capsule().strokeBorder(Tokens.Colors.routeAltCasingDay, lineWidth: 1.5))
                            .background(BoxShadow(shape: Capsule(), layers: Tokens.Shadow.routeLabel))
                            .frame(minWidth: Tokens.Size.touch, minHeight: Tokens.Size.touch)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t(.navAltAria, ["d": label.text]))
                }
                .allowOverlap(true)
            }

            if let dest = destination {
                MapViewAnnotation(coordinate: CLLocationCoordinate2D(latitude: dest.lat, longitude: dest.lon)) {
                    Icon(name: .pin, size: 24)
                        .foregroundStyle(Tokens.Colors.bg)
                        .frame(width: 40, height: 40)
                        .background(Tokens.Colors.brand, in: Circle())
                        .overlay(Circle().strokeBorder(Tokens.Colors.text, lineWidth: 2))
                        .accessibilityLabel(t(.navDestAria))
                }
                .allowOverlap(true)
                .variableAnchors([ViewAnnotationAnchorConfig(anchor: .bottom)])
            }

            ForEvery(model.plan == nil ? cameraPoints : []) { cam in
                MapViewAnnotation(coordinate: CLLocationCoordinate2D(latitude: cam.lat, longitude: cam.lon)) {
                    // AOS15: koppintásra a kamera kártyája (a webes `CameraCard`), a kiválasztott nagyobb
                    Button { model.selectCamera(cam.id) } label: {
                        CameraPin(camera: cam, selected: cam.id == model.selectedCameraId)
                    }
                    .buttonStyle(.plain)
                }
                .allowOverlap(true)
            }

            // AOS14: bejelentések (a webes `.report-pin`); koppintásra a kártya, a kiválasztott / kérdezett nagyobb
            ForEvery(model.plan == nil ? model.reports : []) { r in
                MapViewAnnotation(coordinate: CLLocationCoordinate2D(latitude: r.lat, longitude: r.lon)) {
                    Button { model.selectReport(r.id) } label: {
                        ReportPin(report: r, selected: r.id == model.highlightedReportId)
                    }
                    .buttonStyle(.plain)
                }
                .allowOverlap(true)
            }

        }
        .mapStyle(.standard(
            theme: mapThemeIsMonochrome(model.settings.terkep) ? .monochrome : .default,
            lightPreset: StandardLightPreset(rawValue: preset.rawValue),
            showPointOfInterestLabels: false,
            // INV-01: Mapbox Standard 3D épületekkel (AW24: az AW23 jóváhagyás nélküli kikapcsolása visszavonva)
            show3dObjects: true
        ))
        // attribúció a felső sarkokban (a kártya ne takarja), mint a weben
        .ornamentOptions(.web)
        .gestureHandlers(MapGestureHandlers(
            onBegin: { _ in
                follow = false
                gesturing = true
                lastGestureAt = Date().timeIntervalSince1970 * 1000
            },
            onEnd: { _, _ in
                gesturing = false
                lastGestureAt = Date().timeIntervalSince1970 * 1000
            }
        ))
        // a térkép üres részére koppintva a nyitott kártya bezárul (a webes `onReportTap(null)`)
        .onMapTapGesture { _ in model.mapTapped() }
        // érintésre váltás az alternatív útvonalra (a vonalon is, nem csak a címkén)
        .onLayerTapGesture("route-alt") { queried, _ in
            if case .string(let id) = queried.feature.properties?["id"], let i = model.plan?.routes.firstIndex(where: { $0.id == id }) {
                model.selectRoute(i)
                return true
            }
            return false
        }
        .onCameraChanged { e in
            // AOS14: a látható téglalap a bejelentések lekéréséhez (csempe-rácsra kerekítve – kis mozdulat nem kér újra)
            if let m = proxy.map {
                // AW23: a teljes képernyő: a követő kamera kitöltése (a kép felső része) is látszik
                let screen = UIScreen.main.bounds.size
                let corners = [CGPoint.zero, CGPoint(x: screen.width, y: 0), CGPoint(x: 0, y: screen.height), CGPoint(x: screen.width, y: screen.height)].map { m.coordinate(for: $0) }
                let box = BBox(south: corners.map(\.latitude).min()!, west: corners.map(\.longitude).min()!, north: corners.map(\.latitude).max()!, east: corners.map(\.longitude).max()!)
                model.setReportView(box)
                // AW20: a hőtérkép a látható részre és a zoomra (res-10 / res-8) számol
                model.setHeatViewport(HeatViewport(zoom: e.cameraState.zoom, bbox: box))
                // mozgás közben ritkítva (a pontok számítása ne akadályozza a gesztust); a végén az `onMapIdle` pontosít
                let now = Date().timeIntervalSince1970
                if now - heatBuiltAt > 0.4 { rebuildHeat() }
                placeAltLabels(m)
            }
        }
        .onMapIdle { _ in rebuildHeat() }
        .onChange(of: altLabels) { if let m = proxy.map { placeAltLabels(m) } }
        .ignoresSafeArea()
        .onAppear {
            rebuild()
            rebuildRoutes()
            rebuildZones()
            applyDebugCamera()
            // a nézet a már futó mérés közben is megjelenhet (szimulátor-ugrás, visszatérés): azonnal a pozícióra áll
            if let fix = view.lastFix { driver.onFix(fix) }
            driver.cardTop = cardTop
            syncFollow()
        }
        .onChange(of: model.dataVersion) { rebuild() }
        .onChange(of: heatKey) { rebuildHeat() }
        .onChange(of: model.zonesVisible) { rebuildZones() }
        .onChange(of: model.zoneFocusSeq) { focusZone() }
        .onChange(of: routeKey) { rebuildRoutes() }
        .onChange(of: model.fitVersion) { fitRoutes(proxy.map) }
        // a tervezés vége (indítás vagy mégse): a kamera visszaáll a követésre (mint a weben)
        .onChange(of: model.plan == nil) { _, closed in
            guard closed, !UserDefaults.standard.bool(forKey: "parityNoFollow") else { return }
            follow = true
            syncFollow()
        }
        .onChange(of: view.lastFix) { _, fix in
            guard let fix else { return }
            driver.onFix(fix)
            if Int(fix.timestamp / 1000) % 10 == 0 { rebuildCameras(around: fix) }
        }
        // AOS16: mérés közben 5 s tétlenség után magától visszaáll (`followReducer`, a webes `useFollow`; valós órával)
        .task(id: !follow && (view.phase == .meres || view.phase == .kezi)) {
            guard !follow, view.phase == .meres || view.phase == .kezi else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                if gesturing { lastGestureAt = Date().timeIntervalSince1970 * 1000 }
                let s = FollowState(following: follow, lastGestureAt: lastGestureAt)
                if !UserDefaults.standard.bool(forKey: "parityNoFollow"), followReducer(s, .tick(at: Date().timeIntervalSince1970 * 1000, measuring: true)).following { follow = true }
            }
        }
        .onChange(of: follow) { syncFollow() }
        // AOS18: az útvonalválasztó alatt a bounds-fit marad, a követés nem írja felül (a webes `fitRoute` megállítja a követést)
        .onChange(of: model.plan == nil) { syncFollow() }
        // a kártya méretváltásakor a pozíció helye is követi (időalapú simítással)
        .onChange(of: cardTop) { driver.cardTop = cardTop }
    }

    /// Útvonal-vonalak (AW11, pt): a kiválasztott 7 + 2 × 2 kontúr, az alternatíva 5 + 2 × 1,5 kontúr (mint a weben).
    private static let routeW = Double(Tokens.Size.routeLine)
    private static let routeCasingW = Double(Tokens.Size.routeLineCasing)
    private static let routeAltW = 5.0
    private static let routeAltCasingW = 1.5
    /// A legfelső alsó kártya teteje: a mért kártya, ennek hiányában a HUD teteje.
    private var cardTop: Double { Double(model.navCardTop > 0 ? model.navCardTop : model.hudTop) }

    /// A követő kamera ki / be; bekapcsoláskor a viewport elenged minden folyó átmenetet (a kamerát a `FollowDriver` viszi).
    private func syncFollow() {
        let on = follow && model.plan == nil
        if on && !driver.following { viewport = .idle }
        driver.setFollowing(on)
    }

    // MARK: útvonalak (A11)

    /// A cél: tervezéskor és navigációban.
    private var destination: LatLon? {
        if let n = model.nav { return n.destination.latLon }
        if let p = model.plan, p.status == .ready { return p.dest.latLon }
        return nil
    }

    /// AW20: mikor kell a hőtérkép pontjait újraszámolni: más mód / nézet, látható-e, új út vagy közösségi adat.
    private var heatKey: String { "\(model.settings.hoterkep.rawValue):\(model.settings.hoterkepNezet.rawValue):\(model.heatVisible):\(model.heatVersion):\(model.settings.zonaM.sorted { $0.key < $1.key })" }

    private func rebuildHeat() {
        heatBuiltAt = Date().timeIntervalSince1970
        heatFC = FeatureCollection(features: model.heatLines().map { l in
            var f = Feature(geometry: LineString(l.coords.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) }))
            f.properties = ["weight": .number(l.weight), "grey": .boolean(l.grey)]
            return f
        })
        rebuildZones()
    }

    /// A zóna-körök (a mentett helyek körül, a beállított sugárral): csak a Beállítások / Részletek nyitva tartása alatt.
    private func rebuildZones() {
        guard model.zonesVisible else {
            if !privacyZonesFC.features.isEmpty { privacyZonesFC = FeatureCollection(features: []) }
            return
        }
        privacyZonesFC = FeatureCollection(features: model.heatZoneList.map { z in
            Feature(geometry: Polygon(center: CLLocationCoordinate2D(latitude: z.lat, longitude: z.lon), radius: z.radiusM, vertices: 64))
        })
    }

    /// Sugárváltáskor: a kamera a zónára áll (követés nélkül), a lap alatt hagyott hellyel, hogy a teljes kör látsszon.
    private func focusZone() {
        guard let z = model.zoneFocus else { return }
        let w = UIScreen.main.bounds.width
        let mpp = 2 * z.radiusM / (0.6 * w)
        let zoom = max(8, min(17, log2(78_271.5 * cos(z.lat * .pi / 180) / mpp)))
        let h = UIScreen.main.bounds.height
        withViewportAnimation(.easeOut(duration: Tokens.Motion.slow)) {
            viewport = Viewport.camera(center: CLLocationCoordinate2D(latitude: z.lat, longitude: z.lon), zoom: zoom, bearing: 0, pitch: 0).padding(.bottom, h * 0.5)
        }
        rebuildZones()
    }

    /// Csak a képernyőképekhez (`-mapZoom <z>`, opcionálisan `-mapLat` / `-mapLon`): a kamera erre a zoomra áll, követés nélkül;
    /// alapból a hőtérkép-seed körei fölé (Budapest belváros).
    private func applyDebugCamera() {
        let d = UserDefaults.standard
        guard d.object(forKey: "mapZoom") != nil else { return }
        let lat = d.object(forKey: "mapLat") != nil ? d.double(forKey: "mapLat") : 47.497
        let lon = d.object(forKey: "mapLon") != nil ? d.double(forKey: "mapLon") : 19.05
        model.follow = false
        viewport = .camera(center: CLLocationCoordinate2D(latitude: lat, longitude: lon), zoom: d.double(forKey: "mapZoom"), bearing: 0, pitch: 0)
    }

    /// A hőtérkép színskálája a módban (tokenekből): a súly (0…1) szerint alacsony → közép → magas, teljes fedéssel (a webes `heatColor`).
    private static func heatColorRamp(_ view: HeatView) -> Exp {
        let (lo, mid, hi) = view == .gyakorisag
            ? (Tokens.Colors.heatFreqLow, Tokens.Colors.heatFreqMid, Tokens.Colors.heatFreqHigh)
            : (Tokens.Colors.heatSpeedLow, Tokens.Colors.heatSpeedMid, Tokens.Colors.heatSpeedHigh)
        func rgb(_ c: Color) -> String {
            var (r, g, b, o) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
            UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &o)
            return "rgb(\(Int((r * 255).rounded())), \(Int((g * 255).rounded())), \(Int((b * 255).rounded())))"
        }
        return Exp(.interpolate) {
            Exp(.linear)
            Exp(.get) { "weight" }
            0; rgb(lo)
            0.5; rgb(mid)
            1; rgb(hi)
        }
    }

    /// Mikor kell újrarajzolni: más útvonalak, más kiválasztás, új navigációs útvonal, megjött az összefoglaló.
    private var routeKey: String {
        if let n = model.nav {
            var alts = ""
            if case .ok(let choices) = model.panelAlts { alts = choices.map(\.route.id).joined(separator: ",") }
            return "nav:\(n.routeVersion):\(n.trafficRoute.id):\(n.phase.rawValue):\(alts)"
        }
        if let p = model.plan, p.status == .ready { return "plan:\(p.routes.map(\.id).joined(separator: ",")):\(p.selected):\(model.summaries.map { Int($0.durationS) })" }
        return ""
    }

    private func rebuildRoutes() {
        let coord = { (p: LatLon) in CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon) }
        func features(_ r: NavRoute, selected: Bool) -> [Feature] {
            congestionRuns(r).map { run in
                var f = Feature(geometry: LineString(run.points.map(coord)))
                f.properties = ["id": .string(r.id), "selected": .boolean(selected), "level": .string(run.level.rawValue)]
                return f
            }
        }
        if let n = model.nav {
            // érkezéskor az útvonal maradéka eltűnik (a jelölő a házon marad)
            // AW23: a panelen nyitott alternatívák is a térképen (a kiválasztott alatt)
            var alts: [NavRoute] = []
            if case .ok(let choices) = model.panelAlts { alts = choices.filter { !$0.current }.map(\.route) }
            routesFC = FeatureCollection(features: n.phase == .arrived ? [] : alts.flatMap { features($0, selected: false) } + features(n.trafficRoute, selected: true))
            altLabels = []
            return
        }
        guard let p = model.plan, p.status == .ready, p.routes.indices.contains(p.selected) else {
            routesFC = FeatureCollection(features: [])
            altLabels = []
            return
        }
        // a kiválasztott a végére: a GeoJSON-sorrendben is fölül
        let order = p.routes.indices.filter { $0 != p.selected } + [p.selected]
        routesFC = FeatureCollection(features: order.flatMap { features(p.routes[$0], selected: $0 == p.selected) })
        // a címke a saját szakasz legtávolabbi részén, a kártya menetidejével (a webes `altLabels`, AW11 / AW17)
        altLabels = model.summaries.count == p.routes.count ? Atlagsebesseg.altLabels(p.routes, model.summaries.map(\.durationS), p.selected) : []
    }

    /// AW17: a címke a saját szakasz képernyőn legtávolabbi része mellé kerül (fölé / alá / balra / jobbra), nem takarja a
    /// leágazást és a célt, és a lehető legkevesebbet takar az útvonalakból (`placeAltLabel`, képernyő-pontban, az aktuális
    /// zoomon; a webes adapter `placeRouteLabels` párja). A látható rész a tervező kártya fölötti fél képernyő.
    private func placeAltLabels(_ m: MapboxMap) {
        guard !altLabels.isEmpty else {
            if !altLabelAt.isEmpty { altLabelAt = [:] }
            return
        }
        let screen = UIScreen.main.bounds.size
        let viewport = (w: Double(screen.width), h: Double(screen.height) - Self.fitPadBottom)
        func proj(_ pts: [LatLon]) -> [Px] {
            m.points(for: pts.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }).map { Px(x: Double($0.x), y: Double($0.y)) }
        }
        var next: [String: CLLocationCoordinate2D] = [:]
        for l in altLabels {
            // a buborék mérete: 15 pt-es, táblázatos szöveg + 2 × 8 pt margó + 2 × 1,5 pt él; 1,2-es sor + 2 × 4 pt + 2 × 1,5 pt
            let label = (w: Double(l.text.count) * 8.6 + 19, h: 29.0)
            guard let place = placeAltLabel(
                own: proj(l.own), base: proj(l.basePath), alt: proj(l.altPath), divergence: proj([l.divergence])[0], label: label, viewport: viewport
            ) else { continue }
            next[l.id] = m.coordinate(for: CGPoint(x: place.box.x + place.box.w / 2, y: place.box.y + place.box.h / 2))
        }
        if next.count != altLabelAt.count || next.contains(where: { k, v in altLabelAt[k].map { abs($0.latitude - v.latitude) + abs($0.longitude - v.longitude) > 1e-7 } ?? true }) {
            altLabelAt = next
        }
    }

    /// Tervezéskor a térkép az összes útvonalra igazodik (a webes `fitRoute`: padTop 120, padBottom 400, oldalt 36, maxZoom 15, felülnézet, 900 ms).
    private func fitRoutes(_ map: MapboxMap?) {
        guard let p = model.plan, p.status == .ready else { return }
        let coords = p.routes.flatMap { $0.points }.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        guard coords.count >= 2 else { return }
        let insets = UIEdgeInsets(top: Self.fitPadTop, left: Self.fitPadSide, bottom: Self.fitPadBottom, right: Self.fitPadSide)
        let flat = CameraOptions(bearing: 0, pitch: 0)
        withViewportAnimation(.easeInOut(duration: Self.fitSeconds)) {
            if let cam = try? map?.camera(for: coords, camera: flat, coordinatesPadding: insets, maxZoom: Self.fitMaxZoom, offset: nil), let center = cam.center {
                viewport = .camera(center: center, zoom: cam.zoom, bearing: 0, pitch: 0)
            } else {
                viewport = .overview(geometry: LineString(coords), bearing: 0, pitch: 0, geometryPadding: SwiftUI.EdgeInsets(top: Self.fitPadTop, leading: Self.fitPadSide, bottom: Self.fitPadBottom, trailing: Self.fitPadSide))
            }
        }
    }

    private static let fitPadTop = 120.0
    private static let fitPadBottom = 400.0
    private static let fitPadSide = 36.0
    private static let fitMaxZoom = 15.0
    private static let fitSeconds = 0.9

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

/// Kamera-jelölő (a webes `.camera-pin`, DESIGN.md A7): kicsi, visszafogott – 32 pt-es lekerekített négyzet, sötét üveg,
/// halvány él, fehér vonalikon, 56 pt-es érintési cél; kiválasztva 1,2-szeres, erősebb éllel.
private struct CameraPin: View {
    let camera: FixedCamera
    let selected: Bool

    var body: some View {
        Icon(name: camera.type.icon, size: 18)
            .foregroundStyle(Tokens.Colors.text)
            .frame(width: 32, height: 32)
            .background(Tokens.Colors.surfaceStrong, in: RoundedRectangle(cornerRadius: Tokens.Radius.r10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.r10, style: .continuous).strokeBorder(selected ? Tokens.Colors.textMuted : Tokens.Colors.textFaint, lineWidth: 1.5))
            .background(BoxShadow(shape: RoundedRectangle(cornerRadius: Tokens.Radius.r10, style: .continuous), layers: Tokens.Shadow.cameraPin))
            .scaleEffect(selected ? 1.2 : 1)
            .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
            .contentShape(Rectangle())
            .accessibilityLabel(t(.cameraAria, ["label": camera.type.label]))
            .animation(.easeOut(duration: Tokens.Motion.fast), value: selected)
    }
}

/// Saját pozíció (a webes `.puck`, DESIGN.md): `brand` pont 3 pt-es fehér éllel, 7 pt-es halóval és puha árnyékkal, előtte az irányt mutató, halványuló kúp.
/// A jelölő a térképpel együtt forog és dől (a webes `rotationAlignment` / `pitchAlignment: 'map'`); nem a Mapbox alap-nyila.
struct Puck: View {
    let rotation: Double
    let pitch: Double

    private let side: CGFloat = 60
    private let dot: CGFloat = 22
    private let halo: CGFloat = 7

    var body: some View {
        ZStack {
            PuckCone()
                .fill(LinearGradient(colors: [Tokens.Colors.brand.opacity(Tokens.Opacity.o60), Tokens.Colors.brand.opacity(0)], startPoint: .bottom, endPoint: .top))
                .frame(width: 52, height: 48)
                .offset(y: -24)
            Circle().fill(Tokens.Colors.brand.opacity(Tokens.Opacity.o24)).frame(width: dot + 2 * halo, height: dot + 2 * halo)
            Circle()
                .fill(Tokens.Colors.brand)
                .overlay(Circle().strokeBorder(Tokens.Colors.signFace, lineWidth: 3))
                .frame(width: dot, height: dot)
                .background(BoxShadow(shape: Circle(), layers: Tokens.Shadow.puck))
        }
        .frame(width: side, height: side)
        .rotationEffect(.degrees(rotation))
        .rotation3DEffect(.degrees(pitch), axis: (x: 1, y: 0, z: 0), perspective: 0)
        .accessibilityHidden(true)
    }
}

/// A webes `clip-path: polygon(50% 100%, 0 0, 100% 0)`.
private nonisolated struct PuckCone: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.closeSubpath()
        return p
    }
}

extension OrnamentOptions {
    /// INV-22: a webes helyek – a logó bal felül (8, biztonsági zóna + 4), az „i” jele jobb felül, a közepe (W − 20, + 16), mint a weben a 24 pt-es gomb.
    /// A Mapbox-gomb 44 pt-es, a jel a közepén: a margó ezért negatív. A felső sötétítés a helyüket kihagyja (`ScrimTop`), így nem halványulnak; az „i” látható
    /// rajza a webes (`WebInfoBadge`), a Mapbox saját jele átlátszó – a gomb, a koppintás és az akadálymentes neve a Mapboxé marad.
    static var web: OrnamentOptions {
        OrnamentOptions(
            scaleBar: ScaleBarViewOptions(visibility: .hidden),
            compass: CompassViewOptions(visibility: .hidden),
            logo: LogoViewOptions(position: .topLeading, margins: CGPoint(x: TopOrnaments.logo.minX, y: TopOrnaments.logo.minY)),
            attributionButton: AttributionButtonOptions(position: .topTrailing, margins: CGPoint(x: TopOrnaments.infoCenterFromTrailing - 22, y: TopOrnaments.infoCenterY - 22), tintColor: .clear)
        )
    }
}
