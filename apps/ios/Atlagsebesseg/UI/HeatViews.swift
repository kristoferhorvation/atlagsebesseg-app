import SwiftUI

/// AW20: a hőtérkép módváltója (Gyakoriság | Átlagsebesség) üveg-szegmensben, alatta halvány jelmagyarázat – a webes
/// `HeatSwitch` párja. Csak az üres nézeten és krúzingban látszik.
struct HeatSwitch: View {
    @Bindable var model: AppModel

    var body: some View {
        let view = model.settings.hoterkepNezet
        // a webes `.heat-switch`: `.segmented.glass` (a `.segmented` háttere nyer: fehér 8%), 2 pt belső margó, a kiválasztott fehér, sötét felirattal
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                segment(.gyakorisag, .heatViewFrequency, selected: view == .gyakorisag)
                segment(.atlagsebesseg, .heatViewSpeed, selected: view == .atlagsebesseg)
            }
            .padding(2)
            .glass(radius: Tokens.Radius.r12, fill: Tokens.Colors.fill08)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.heatViewAria))
            HStack(spacing: Tokens.Space.s2) {
                RoundedRectangle(cornerRadius: Tokens.Radius.r3, style: .continuous)
                    .fill(LinearGradient(colors: ramp(view), startPoint: .leading, endPoint: .trailing))
                    .frame(width: 56, height: 6)
                Text(t(view == .gyakorisag ? .heatLegendFrequency : .heatLegendSpeed))
                    .css(Tokens.FontSize.f12, Tokens.FontWeight.w560)
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            .padding(.leading, Tokens.Space.s1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func ramp(_ v: HeatView) -> [Color] {
        v == .gyakorisag ? [Tokens.Colors.heatFreqLow, Tokens.Colors.heatFreqMid, Tokens.Colors.heatFreqHigh] : [Tokens.Colors.heatSpeedLow, Tokens.Colors.heatSpeedMid, Tokens.Colors.heatSpeedHigh]
    }

    private func segment(_ v: HeatView, _ key: L10nKey, selected: Bool) -> some View {
        Button { model.settings.hoterkepNezet = v } label: {
            Text(t(key))
                .css(Tokens.FontSize.f14, Tokens.FontWeight.w620)
                .foregroundStyle(selected ? Tokens.Colors.signText : Tokens.Colors.textMuted)
                .padding(.horizontal, Tokens.Space.s3)
                .frame(height: 30)
                .background(selected ? Tokens.Colors.text : .clear, in: RoundedRectangle(cornerRadius: Tokens.Radius.r9, style: .continuous))
                .contentShape(Rectangle())
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
        // AOS18: a webes `.zone-picker` – a név + gombok sora alatt, kisebb, balra zárt, a tartalma széles (web és iOS azonos)
        VStack(alignment: .leading, spacing: 6) {
            Text(t(.heatZoneLabel)).css(Tokens.FontSize.f14, Tokens.FontWeight.w400, line: 1.35).foregroundStyle(Tokens.Colors.textMuted).padding(.top, 3)
            Segmented(options: [(200, t(.heatZone200)), (500, t(.heatZone500)), (1000, t(.heatZone1000))], selection: Binding(get: { model.zoneRadius(id) }, set: { model.setZoneRadius(id, $0) }), stretch: false, compact: true)
                .accessibilityLabel(t(.heatZoneLabel))
        }
        .id("zone-\(id)")
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// AW20-javítás: az adatmegosztás „Részletek” lapja – mi megy fel, mi nem, a védett zónák és a zónák beállítása helyenként
/// (a webes `HeatDetails` párja).
struct HeatDetailsView: View {
    @Bindable var model: AppModel
    var onClose: () -> Void = {}

    var body: some View {
        // a webes `HeatDetailsSheet`: lap-fej, csoportcímek, kártyás sorok
        VStack(alignment: .leading, spacing: 0) {
            SheetHead(title: t(.heatDetailsTitle), onClose: onClose)
            GroupLabel(text: t(.heatDetailsUpTitle))
            ListCard { RowText(label: t(.heatDetailsUpBody)).listRow() }
            GroupLabel(text: t(.heatDetailsNoTitle))
            ListCard { RowText(label: t(.heatDetailsNoBody)).listRow() }
            GroupLabel(text: t(.heatDetailsZonesTitle))
            ListCard {
                RowText(label: t(.heatDetailsZonesBody)).listRow()
                let places = placeList
                if places.isEmpty {
                    RowDivider()
                    RowText(label: t(.heatDetailsNoPlaces)).listRow()
                }
                ForEach(places, id: \.id) { p in
                    RowDivider()
                    VStack(alignment: .leading, spacing: 14) {
                        Text(p.name).css(Tokens.FontSize.f17, Tokens.FontWeight.w580).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                        ZoneRadiusRow(model: model, id: p.id)
                    }
                    .listRow()
                }
            }
        }
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
