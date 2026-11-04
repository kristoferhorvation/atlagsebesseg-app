import AtlagsebessegCore
import MapboxMaps
import SwiftUI

// AW19: az utak naplója (a webes `TripLog.tsx` 1:1): Beállítások › „Utak naplója” → felül az összesítő kártya
// időszakváltóval (ez a hét / hónap / összes), alatta az utak dátum szerint csökkenő sorrendben; koppintásra a részlet
// (kis térkép a Visszafogott stílusban, a számok, a szakaszmérések). Törlés: balra húzásra vagy hosszú nyomásra; alul
// „Összes törlése” megerősítéssel. Minden adat csak ezen a készüléken (SQLite, `TripStore`).

/// „okt. 31. 14:32” a nyelv szerint, a készülék időzónájában (a webes `tripDateText`).
func tripDateText(_ ms: Double) -> String {
    let d = Date(timeIntervalSince1970: ms / 1000)
    let f = DateFormatter()
    f.locale = L10n.lang.locale
    f.setLocalizedDateFormatFromTemplate("MMMd")
    let c = DateFormatter()
    c.locale = L10n.lang.locale
    c.setLocalizedDateFormatFromTemplate("HHmm")
    return "\(f.string(from: d)) \(c.string(from: d))"
}

private func clockText(_ ms: Double) -> String {
    let c = DateFormatter()
    c.locale = L10n.lang.locale
    c.setLocalizedDateFormatFromTemplate("HHmm")
    return c.string(from: Date(timeIntervalSince1970: ms / 1000))
}

private func distText(_ m: Double, _ unit: SpeedUnit) -> String {
    let d = formatDistance(m, unit)
    return "\(d.value) \(d.unit)"
}

struct TripLogView: View {
    @Bindable var model: AppModel
    /// `-tripPeriod het|honap|osszes` (képernyőkép): a kezdő időszak; alapból ez a hét.
    @State private var period: TripPeriod = UserDefaults.standard.string(forKey: "tripPeriod").flatMap(TripPeriod.init(rawValue:)) ?? .het
    /// `-tripOpen deleteAll` (képernyőkép): a törlés-párbeszéd nyitva.
    @State private var confirmAll = UserDefaults.standard.string(forKey: "tripOpen") == "deleteAll"
    @State private var deleteHeat = false
    @State private var keepTrash = true
    @State private var openTrip: Trip?

    var body: some View {
        let unit = model.settings.egyseg
        let totals = tripTotals(model.trips, period, model.nowMs())
        List {
            SwiftUI.Section {
                VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                    Segmented(options: [(TripPeriod.het, t(.tripsPeriodWeek)), (.honap, t(.tripsPeriodMonth)), (.osszes, t(.tripsPeriodAll))], selection: $period)
                        .accessibilityLabel(t(.tripsPeriod))
                    LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], spacing: Tokens.Space.s3) {
                        stat(t(.tripsStatDistance), distText(totals.distanceM, unit), big: true)
                        stat(t(.tripsStatMoving), tripDurationText(totals.movingS), big: true)
                        stat(t(.tripsStatCount), String(totals.trips))
                        stat(t(.tripsStatAvg), tripSpeedText(totals.avgKmh, unit))
                        stat(t(.tripsStatTurns), turnsText(totals.turns))
                        stat(t(.tripsStatDirChanges), turnsText(totals.dirChanges))
                        stat(t(.tripsStatChecks), checksText(totals.checksOk, totals.checksTooFast))
                        stat(t(.tripsStatJam), tripDurationText(totals.jamS))
                    }
                }
                .padding(.vertical, Tokens.Space.s2)
            }
            if model.trips.isEmpty {
                SwiftUI.Section {
                    Text(t(.tripsEmpty)).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                }
            } else {
                SwiftUI.Section {
                    ForEach(model.trips) { trip in
                        Button { openTrip = trip } label: { TripRowView(trip: trip, unit: unit) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(t(.tripsDelete), role: .destructive) { model.deleteTrip(trip.id) }
                            }
                            .contextMenu {
                                Button(t(.tripsDelete), role: .destructive) { model.deleteTrip(trip.id) }
                            }
                    }
                }
                SwiftUI.Section {
                    // AOS17: külön kérdés a saját hőtérképről, „30 napig visszaállítható” alapból bepipálva (a webes `delete-all-panel`)
                    if confirmAll {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(t(.tripsDeleteAllConfirm)).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w580))
                            CheckRow(label: t(.tripsDeleteAllHeat), isOn: $deleteHeat)
                            CheckRow(label: t(.tripsDeleteAllKeep), hint: t(keepTrash ? .tripsDeleteAllKeepHint : .tripsDeleteAllFinalHint), isOn: $keepTrash)
                            HStack(spacing: Tokens.Space.s2) {
                                Spacer(minLength: 0)
                                Button(t(.tripsCancel)) { confirmAll = false }
                                    .buttonStyle(MiniButtonStyle())
                                Button(t(.tripsDelete)) {
                                    confirmAll = false
                                    model.deleteAllTrips(heat: deleteHeat, keep: keepTrash)
                                }
                                .buttonStyle(MiniButtonStyle(danger: true))
                            }
                        }
                        .padding(.vertical, Tokens.Space.s1)
                    } else {
                        Button(t(.tripsDeleteAll), role: .destructive) {
                            deleteHeat = false
                            keepTrash = true
                            confirmAll = true
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            SwiftUI.Section {
                Text(t(.tripsLocal)).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(t(.tripsTitle))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openTrip) { trip in TripDetailView(model: model, trip: trip) }
        .onAppear {
            model.reloadTrips()
            // `-tripOpen first` (képernyőkép): rögtön a legújabb út részlete
            if openTrip == nil, UserDefaults.standard.string(forKey: "tripOpen") == "first" { openTrip = model.trips.first }
        }
    }

    private func stat(_ label: String, _ value: String, big: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted)
            Text(value)
                .font(.num(big ? Tokens.FontSize.f26 : Tokens.FontSize.f17, big ? Tokens.FontWeight.w700 : Tokens.FontWeight.w620))
                .foregroundStyle(Tokens.Colors.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

/// A napló sora: dátum, cím (cél / „Krúzing”), táv · menetidő · átlag.
struct TripRowView: View {
    let trip: Trip
    let unit: SpeedUnit

    var body: some View {
        let p = tripRowParts(trip, unit)
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(tripDateText(trip.startedAt)).font(.inter(Tokens.FontSize.f14, Tokens.FontWeight.w520)).foregroundStyle(Tokens.Colors.textMuted)
                Text(p.title).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w600)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                Text("\(p.distance) · \(p.duration) · \(p.avg)").font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted)
                Text(p.turns).font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted)
            }
            Spacer(minLength: Tokens.Space.s2)
            Icon(name: .chevronRight, size: 20).foregroundStyle(Tokens.Colors.textFaint)
        }
        .contentShape(Rectangle())
    }
}

/// Egy út részlete: kis térkép, a számok, a szakaszmérések.
struct TripDetailView: View {
    let model: AppModel
    let trip: Trip
    /// AW20: az út színezett szakaszai a mintákból (a részlet megnyitásakor számolva); minták nélkül üres → egyszínű vonal.
    @State private var runs: [SpeedRun] = []
    /// AW20: van-e a mintákon tábla-limit (a jelmagyarázat szövegéhez).
    @State private var hasLimit = false

    var body: some View {
        let unit = model.settings.egyseg
        let rows: [(String, String)] = [
            (t(.tripsDStart), tripDateText(trip.startedAt)),
            (t(.tripsDEnd), clockText(trip.endedAt)),
            (t(.tripsDDistance), distText(trip.distanceM, unit)),
            (t(.tripsDMoving), tripDurationText(trip.movingS)),
            (t(.tripsDIdle), tripDurationText(trip.idleS)),
            (t(.tripsDAvg), tripSpeedText(tripAvgKmh(trip), unit)),
            (t(.tripsDMax), tripSpeedText(trip.maxKmh, unit)),
            (t(.tripsDTurns), turnsText(trip.turns)),
            (t(.tripsDDirChanges), turnsText(trip.dirChanges)),
            (t(.tripsDReroutes), String(trip.reroutes)),
            (t(.tripsDJam), tripDurationText(trip.jamS)),
        ]
        ScrollViewReader { proxy in
        List {
            SwiftUI.Section {
                TripMapView(trip: trip, preset: model.tripMapPreset, runs: runs)
                    .frame(height: 220)
                    .listRowInsets(EdgeInsets())
                if !runs.isEmpty { TripSpeedLegend(hasLimit: hasLimit) }
            }
            SwiftUI.Section {
                ForEach(rows, id: \.0) { r in LabeledContent(r.0, value: r.1).id(r.0) }
            }
            SwiftUI.Section(t(.tripsDChecks)) {
                if trip.measurements.isEmpty {
                    Text(t(.tripsDNoChecks)).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                }
                ForEach(trip.measurements, id: \.at) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.name).lineLimit(1)
                            Text("\(clockText(m.at)) · \(t(.tripsCheckLimit, ["v": tripSpeedText(m.limitKmh, unit)]))")
                                .css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                        }
                        Spacer(minLength: Tokens.Space.s2)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(tripSpeedText(m.avgKmh, unit)).font(.num(Tokens.FontSize.f17, Tokens.FontWeight.w650))
                                .foregroundStyle(m.tooFast ? Tokens.StatusColors.tul : Tokens.StatusColors.jo)
                            Text(t(m.tooFast ? .tripsCheckFast : .tripsCheckOk)).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        // `-tripScroll YES` (képernyőkép): a számok sora legalul látszik (a két számláló a lap alsó felén van)
        .onAppear {
            guard UserDefaults.standard.bool(forKey: "tripScroll") else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { proxy.scrollTo(t(.tripsDJam), anchor: .bottom) }
        }
        }
        .navigationTitle(tripTitle(trip))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let samples = model.tripStore.samples(trip.id)
            runs = speedRuns(samples)
            hasLimit = samples.contains { $0.limitKmh != nil }
        }
    }
}

/// AW20: az út színezésének jelmagyarázata – zöld → sárga → piros sáv és a szöveg (a limithez képest, vagy abszolút skálán).
struct TripSpeedLegend: View {
    let hasLimit: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Capsule()
                .fill(LinearGradient(colors: [Tokens.Colors.tripSlow, Tokens.Colors.tripMid, Tokens.Colors.tripFast], startPoint: .leading, endPoint: .trailing))
                .frame(height: 6)
            Text(t(hasLimit ? .tripsMapLegendLimit : .tripsMapLegendAbs)).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A kis térkép kamerája: a pontok befoglalójának közepe és a legnagyobb zoom, amelynél a befoglaló kifér (a margóval);
/// a Mapbox világa 0-s zoomon 512 pt széles (Web Mercator). Pontok nélkül `nil`.
nonisolated func tripMapCamera(_ points: [CLLocationCoordinate2D], widthPt: Double, heightPt: Double, paddingPt: Double) -> (center: CLLocationCoordinate2D, zoom: Double)? {
    guard let first = points.first else { return nil }
    let mercY = { (lat: Double) in log(tan(.pi / 4 + lat * .pi / 360)) / (2 * .pi) }
    var (s, n, w, e) = (first.latitude, first.latitude, first.longitude, first.longitude)
    for p in points {
        s = min(s, p.latitude)
        n = max(n, p.latitude)
        w = min(w, p.longitude)
        e = max(e, p.longitude)
    }
    let dx = max((e - w) / 360, 1e-6)
    let dy = max(mercY(n) - mercY(s), 1e-6)
    let zoom = min(log2((widthPt - 2 * paddingPt) / (dx * 512)), log2((heightPt - 2 * paddingPt) / (dy * 512)))
    return (CLLocationCoordinate2D(latitude: (s + n) / 2, longitude: (w + e) / 2), min(zoom, 16))
}

/// Kis, nem mozgatható térkép az út vonalával (Visszafogott = monokróm stílus, a mostani napszak fényével).
struct TripMapView: View {
    let trip: Trip
    let preset: LightPreset
    /// AW20: a mért sebesség szerint színezett szakaszok; üresen az egyszínű vonal.
    var runs: [SpeedRun] = []

    var body: some View {
        let segs = trip.path.map { $0.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) } }.filter { $0.count >= 2 }
        let all = segs.flatMap { $0 }
        // a kamera a befoglalóból számolva: az `.overview` a List-cella méretezése előtt indulna, és nem állna be
        let camera = tripMapCamera(all, widthPt: UIScreen.main.bounds.width - 2 * Tokens.Space.s4, heightPt: 220, paddingPt: 28)
        Map(initialViewport: camera.map { .camera(center: $0.center, zoom: $0.zoom) } ?? .idle) {
            GeoJSONSource(id: "trip").data(.feature(Feature(geometry: .multiLineString(MultiLineString(segs)))))
            LineLayer(id: "trip-casing", source: "trip")
                .slot(.top)
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.routeCasing))
                .lineWidth(7)
                .lineOpacity(0.9)
                .lineEmissiveStrength(1)
            if runs.isEmpty {
                LineLayer(id: "trip-line", source: "trip")
                    .slot(.top)
                    .lineCap(.round)
                    .lineJoin(.round)
                    .lineColor(UIColor(Tokens.Colors.route))
                    .lineWidth(4)
                    .lineEmissiveStrength(1)
            } else {
                GeoJSONSource(id: "trip-speed").data(.featureCollection(FeatureCollection(features: runs.map { run in
                    var f = Feature(geometry: LineString(run.points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }))
                    f.properties = ["tone": .number(run.tone)]
                    return f
                })))
                LineLayer(id: "trip-speed-line", source: "trip-speed")
                    .slot(.top)
                    .lineCap(.round)
                    .lineJoin(.round)
                    .lineColor(Exp(.interpolate) {
                        Exp(.linear)
                        Exp(.get) { "tone" }
                        0; UIColor(Tokens.Colors.tripSlow)
                        0.5; UIColor(Tokens.Colors.tripMid)
                        1; UIColor(Tokens.Colors.tripFast)
                    })
                    .lineWidth(4)
                    .lineEmissiveStrength(1)
            }
        }
        .mapStyle(.standard(theme: .monochrome, lightPreset: StandardLightPreset(rawValue: preset.rawValue), showPointOfInterestLabels: false, showTransitLabels: false, showPedestrianRoads: false))
        .ornamentOptions(OrnamentOptions(
            scaleBar: ScaleBarViewOptions(visibility: .hidden),
            compass: CompassViewOptions(visibility: .hidden),
            logo: LogoViewOptions(position: .bottomLeading),
            attributionButton: AttributionButtonOptions(position: .bottomTrailing)
        ))
        .allowsHitTesting(false)
    }
}
