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
    @State private var confirmAll = false
    @State private var openTrip: Trip?

    var body: some View {
        let unit = model.settings.egyseg
        let totals = tripTotals(model.trips, period, model.nowMs())
        List {
            SwiftUI.Section {
                VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                    Picker(t(.tripsPeriod), selection: $period) {
                        Text(t(.tripsPeriodWeek)).tag(TripPeriod.het)
                        Text(t(.tripsPeriodMonth)).tag(TripPeriod.honap)
                        Text(t(.tripsPeriodAll)).tag(TripPeriod.osszes)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
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
                    Text(t(.tripsEmpty)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
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
                    Button(t(.tripsDeleteAll), role: .destructive) { confirmAll = true }
                        .frame(maxWidth: .infinity)
                }
            }
            SwiftUI.Section {
                Text(t(.tripsLocal)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(t(.tripsTitle))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openTrip) { trip in TripDetailView(model: model, trip: trip) }
        .confirmationDialog(t(.tripsDeleteAllConfirm), isPresented: $confirmAll, titleVisibility: .visible) {
            Button(t(.tripsDelete), role: .destructive) { model.deleteAllTrips() }
            Button(t(.tripsCancel), role: .cancel) {}
        }
        .onAppear {
            model.reloadTrips()
            // `-tripOpen first` (képernyőkép): rögtön a legújabb út részlete
            if openTrip == nil, UserDefaults.standard.string(forKey: "tripOpen") == "first" { openTrip = model.trips.first }
        }
    }

    private func stat(_ label: String, _ value: String, big: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
            Text(value)
                .font(.num(big ? 26 : 17, big ? 700 : 620))
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
                Text(tripDateText(trip.startedAt)).font(.inter(14, 520)).foregroundStyle(Tokens.Colors.textMuted)
                Text(p.title).font(.inter(17, 600)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                Text("\(p.distance) · \(p.duration) · \(p.avg)").font(.num(15, 560)).foregroundStyle(Tokens.Colors.textMuted)
                Text(p.turns).font(.num(15, 560)).foregroundStyle(Tokens.Colors.textMuted)
            }
            Spacer(minLength: Tokens.Space.s2)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Tokens.Colors.textFaint)
        }
        .contentShape(Rectangle())
    }
}

/// Egy út részlete: kis térkép, a számok, a szakaszmérések.
struct TripDetailView: View {
    let model: AppModel
    let trip: Trip

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
                TripMapView(trip: trip, preset: model.tripMapPreset)
                    .frame(height: 220)
                    .listRowInsets(EdgeInsets())
            }
            SwiftUI.Section {
                ForEach(rows, id: \.0) { r in LabeledContent(r.0, value: r.1).id(r.0) }
            }
            SwiftUI.Section(t(.tripsDChecks)) {
                if trip.measurements.isEmpty {
                    Text(t(.tripsDNoChecks)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                }
                ForEach(trip.measurements, id: \.at) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.name).lineLimit(1)
                            Text("\(clockText(m.at)) · \(t(.tripsCheckLimit, ["v": tripSpeedText(m.limitKmh, unit)]))")
                                .font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                        }
                        Spacer(minLength: Tokens.Space.s2)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(tripSpeedText(m.avgKmh, unit)).font(.num(17, 650))
                                .foregroundStyle(m.tooFast ? Tokens.StatusColors.tul : Tokens.StatusColors.jo)
                            Text(t(m.tooFast ? .tripsCheckFast : .tripsCheckOk)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
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
            LineLayer(id: "trip-line", source: "trip")
                .slot(.top)
                .lineCap(.round)
                .lineJoin(.round)
                .lineColor(UIColor(Tokens.Colors.route))
                .lineWidth(4)
                .lineEmissiveStrength(1)
        }
        .mapStyle(.standard(theme: .monochrome, lightPreset: StandardLightPreset(rawValue: preset.rawValue), showPointOfInterestLabels: false))
        .ornamentOptions(OrnamentOptions(
            scaleBar: ScaleBarViewOptions(visibility: .hidden),
            compass: CompassViewOptions(visibility: .hidden),
            logo: LogoViewOptions(position: .bottomLeading),
            attributionButton: AttributionButtonOptions(position: .bottomTrailing)
        ))
        .allowsHitTesting(false)
    }
}
