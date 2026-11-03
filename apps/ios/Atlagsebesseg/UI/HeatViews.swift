import SwiftUI

/// AW20: a hőtérkép módváltója (Gyakoriság | Átlagsebesség) üveg-szegmensben, alatta halvány jelmagyarázat – a webes
/// `HeatSwitch` párja. Csak az üres nézeten és krúzingban látszik.
struct HeatSwitch: View {
    @Bindable var model: AppModel

    var body: some View {
        let view = model.settings.hoterkepNezet
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: 0) {
                segment(.gyakorisag, .heatViewFrequency, selected: view == .gyakorisag)
                segment(.atlagsebesseg, .heatViewSpeed, selected: view == .atlagsebesseg)
            }
            .padding(3)
            .glass(radius: 22)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.heatViewAria))
            HStack(spacing: Tokens.Space.s2) {
                Capsule()
                    .fill(LinearGradient(colors: ramp(view), startPoint: .leading, endPoint: .trailing))
                    .frame(width: 56, height: 5)
                Text(t(view == .gyakorisag ? .heatLegendFrequency : .heatLegendSpeed))
                    .font(.inter(Tokens.Typography.caption.size, 500))
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            .padding(.leading, Tokens.Space.s3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func ramp(_ v: HeatView) -> [Color] {
        v == .gyakorisag ? [Tokens.Colors.heatFreqLow, Tokens.Colors.heatFreqMid, Tokens.Colors.heatFreqHigh] : [Tokens.Colors.heatSpeedLow, Tokens.Colors.heatSpeedMid, Tokens.Colors.heatSpeedHigh]
    }

    private func segment(_ v: HeatView, _ key: L10nKey, selected: Bool) -> some View {
        Button { model.settings.hoterkepNezet = v } label: {
            Text(t(key))
                .font(.inter(Tokens.Typography.caption.size, 620))
                .foregroundStyle(selected ? Tokens.Colors.text : Tokens.Colors.textMuted)
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 36)
                .background(selected ? Tokens.Colors.surfaceRaised : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// AW20-javítás: egy mentett hely adatvédelmi zónájának sugara (200 m / 500 m / 1 km) – a Beállításokban a hely sora alatt és
/// a Részletek lapon. Váltáskor a kamera a zónára áll (félmagas lap alatt), hogy a kör látsszon. A webes zóna-szegmens párja.
struct ZoneRadiusRow: View {
    @Bindable var model: AppModel
    let id: String

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(t(.heatZoneLabel)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
            // AOS17: mindhárom szegmens a háttéren belül, 320 pt-en is (a sor teljes szélességében)
            Segmented(options: [(200, t(.heatZone200)), (500, t(.heatZone500)), (1000, t(.heatZone1000))], selection: Binding(get: { model.zoneRadius(id) }, set: { model.setZoneRadius(id, $0) }), compact: true)
                .accessibilityLabel(t(.heatZoneLabel))
        }
    }
}

/// AW20-javítás: az adatmegosztás „Részletek” lapja – mi megy fel, mi nem, a védett zónák és a zónák beállítása helyenként
/// (a webes `HeatDetails` párja).
struct HeatDetailsView: View {
    @Bindable var model: AppModel

    var body: some View {
        Form {
            SwiftUI.Section(t(.heatDetailsUpTitle)) { Text(t(.heatDetailsUpBody)) }
            SwiftUI.Section(t(.heatDetailsNoTitle)) { Text(t(.heatDetailsNoBody)) }
            SwiftUI.Section(t(.heatDetailsZonesTitle)) {
                Text(t(.heatDetailsZonesBody))
                let places = placeList
                if places.isEmpty {
                    Text(t(.heatDetailsNoPlaces)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                }
                ForEach(places, id: \.id) { p in
                    VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                        Text(p.name).lineLimit(1)
                        ZoneRadiusRow(model: model, id: p.id)
                    }
                }
            }
        }
        .navigationTitle(t(.heatDetailsTitle))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A zónával rendelkező helyek (a zóna-azonosító: `home`, `work`, a további helyeknél a hely azonosítója).
    private var placeList: [(id: String, name: String)] {
        var out: [(String, String)] = []
        if model.saved.home != nil { out.append(("home", t(.navPlaceHome))) }
        if model.saved.work != nil { out.append(("work", t(.navPlaceWork))) }
        out.append(contentsOf: model.saved.others.map { ($0.id, $0.name) })
        return out
    }
}
