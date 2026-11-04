import AVFoundation
import AtlagsebessegCore
import SwiftUI

/// Beállítások, a webes lap 1:1 (AOS17: kártyás csoportok, a `SettingsControls` elemei): kijelző (mint a weben), jelzések (csak iOS),
/// napló, mentett helyek (Haza, Munka, továbbiak – AW12), állapot, fejlesztés (szimulátor), attribúció. AW15: a mentett hely keresője a lap fölött
/// nyílik, választás után a lap ugyanott, nyitva marad.
struct SettingsSheet: View {
    @Bindable var model: AppModel
    var peek = false
    var onPeekEnd: () -> Void = {}
    let onClose: () -> Void
    /// AW19: az utak naplója nyitva (`-settingsOpen trips`: rögtön, a képernyőképhez).
    @State private var tripsOpen = UserDefaults.standard.string(forKey: "settingsOpen") == "trips"
    /// AW20-javítás: az adatmegosztás „Részletek” lapja (`-settingsOpen heatDetails`: rögtön, a képernyőképhez).
    @State private var heatDetailsOpen = UserDefaults.standard.string(forKey: "settingsOpen") == "heatDetails"

    var body: some View {
        AppSheet(peek: peek, onClose: onClose) {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if heatDetailsOpen {
                            HeatDetailsView(model: model, onClose: { heatDetailsOpen = false })
                        } else {
                            SheetHead(title: t(.settingsTitle), onClose: onClose)
                            GroupLabel(text: t(.settingsGroupDisplay))
                            displayCard
                            // a jelzések csak iOS-en vannak: a paritás-kép a webes lapot méri
                            if !Parity.on {
                                GroupLabel(text: t(.iosSettingsGroupAlerts))
                                alertsCard
                            }
                            tripsCard.padding(.top, 18).id(Self.tripsAnchor)
                            GroupLabel(text: t(.settingsGroupPlaces))
                            placesCard
                            GroupLabel(text: t(.settingsGroupStatus))
                            statusCard
                            GroupLabel(text: t(.settingsGroupDev))
                            devCard
                            Text(t(.settingsAttribution))
                                .css(Tokens.Typography.caption.size, Tokens.FontWeight.w400)
                                .foregroundStyle(Tokens.Colors.textMuted)
                                .padding(EdgeInsets(top: 12, leading: 6, bottom: 2, trailing: 6))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(EdgeInsets(top: 20, leading: 16, bottom: 16, trailing: 16))
                }
                .scrollBounceBehavior(.basedOnSize)
                // AOS18: sugár-választáskor a lap nem gördül fel: a pozíció marad, a választó látható marad (a webes `scrollIntoView({ block: 'nearest' })`)
                .onChange(of: model.zoneFocusSeq) {
                    guard let z = model.zoneFocus else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { scroll.scrollTo("zone-\(z.id)", anchor: .center) }
                }
                .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { _ in if peek { onPeekEnd() } })
                .onAppear {
                    model.refreshTrash()
                    // `-settingsOpen language|voice`: a nyelvválasztóhoz / a hangos utasításokhoz görget (a képernyőképhez)
                    switch UserDefaults.standard.string(forKey: "settingsOpen") {
                    case "language": scroll.scrollTo(Self.languageAnchor, anchor: .top)
                    case "voice": scroll.scrollTo(Self.voiceAnchor, anchor: .top)
                    case "heat": scroll.scrollTo(Self.heatAnchor, anchor: .top)
                    case "places": scroll.scrollTo(Self.placesAnchor, anchor: .top)
                    case "zone": scroll.scrollTo("zone-home", anchor: .center)
                    case "restore": scroll.scrollTo(Self.tripsAnchor, anchor: .center)
                    default: break
                    }
                }
            }
        }
        // AW19: az utak naplója saját lapon (a rendszer-lapon belüli navigációval); AOS16: alatta a zóna-körök nem látszanak
        .sheet(isPresented: $tripsOpen, onDismiss: { model.zonesVisible = true; model.refreshTrash() }) {
            NavigationStack { TripLogView(model: model) }
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
        .onChange(of: tripsOpen) { _, open in if open { model.zonesVisible = false } }
        .onAppear { if tripsOpen { model.zonesVisible = false } }
        // a mentett hely keresője a lap fölött; bezárva (választás vagy mégse) a lap ugyanott marad
        .fullScreenCover(isPresented: Binding(get: { model.placeSearchOpen }, set: { if !$0 { model.closeSearch() } })) {
            VStack(spacing: 0) {
                SearchPanel(model: model)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.top, Tokens.Space.s2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Tokens.Colors.bg.ignoresSafeArea())
        }
    }

    /// A webes „Kijelző” lista, azonos sorrendben.
    private var displayCard: some View {
        ListCard {
            ToggleRow(label: t(.settingsTolerance), hint: t(.settingsToleranceHint, ["percent": String(Int(ToleranceRule.default.percent)), "min": String(Int(ToleranceRule.default.minKmh))]), isOn: $model.settings.hatosagiTuresMegjelenitese)
            RowDivider()
            HStack(spacing: 14) {
                RowText(label: t(.settingsUnit))
                Segmented(options: [(SpeedUnit.kmh, unitLabel(.kmh)), (.mph, unitLabel(.mph))], selection: $model.settings.egyseg, stretch: false)
                    .accessibilityLabel(t(.settingsUnit))
            }
            .listRow()
            RowDivider()
            ToggleRow(label: t(.settingsPlanned), hint: t(.settingsPlannedHint), isOn: $model.settings.tervezettMeresek)
            RowDivider()
            VStack(alignment: .leading, spacing: 10) {
                RowText(label: t(.settingsMap))
                Segmented(options: [(MapLook.vilagos, t(.settingsLookLight)), (.szines, t(.settingsLookColor)), (.visszafogott, t(.settingsLookMuted))], selection: $model.settings.terkep)
                    .accessibilityLabel(t(.settingsMap))
            }
            .listRow()
            RowDivider()
            // AW20: hőtérkép (ki / saját / közösségi) és a névtelen adatmegosztás
            VStack(alignment: .leading, spacing: 10) {
                RowText(label: t(.settingsHeat), hint: t(.settingsHeatHint))
                Segmented(options: [(HeatMode.ki, t(.settingsHeatOff)), (.sajat, t(.settingsHeatOwn)), (.kozossegi, t(.settingsHeatCommunity))], selection: $model.settings.hoterkep)
                    .accessibilityLabel(t(.settingsHeat))
            }
            .listRow()
            .id(Self.heatAnchor)
            RowDivider()
            ToggleRow(label: t(.settingsShare), hint: t(.settingsShareHint), isOn: $model.settings.adatmegosztas)
            // AOS17: a Részletek a megosztás sorához tartozik – köztük nincs vonal
            chevronRow(t(.settingsShareDetails)) { heatDetailsOpen = true }
            RowDivider()
            // AW16: egy sor („Nyelv”), koppintásra nyíló választó; zászló + a saját nyelvén írt név, az „Automatikus” legfelül
            HStack(spacing: 14) {
                RowText(label: t(.settingsLanguage))
                Menu {
                    Picker(t(.settingsLanguage), selection: language) {
                        Text("\(t(.settingsLanguageAuto)) (\(L10n.systemLang.nativeName))").tag(Lang?.none)
                        ForEach(languageMenu(), id: \.lang) { item in
                            Text(item.label).tag(Optional(item.lang))
                        }
                    }
                } label: {
                    Text(languageSummary)
                        .font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w620))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(Tokens.Colors.text)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
                }
                .accessibilityLabel(t(.settingsLanguage))
            }
            .listRow()
            .id(Self.languageAnchor)
            RowDivider()
            // AOS14: megszólítás – a köszöntő felirat és a navigáció-indító köszönés neve (üresen név nélkül)
            VStack(alignment: .leading, spacing: 10) {
                RowText(label: t(.settingsName), hint: t(.settingsNameHint))
                TextField(t(.settingsNamePlaceholder), text: name)
                    .font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620))
                    .textContentType(.givenName)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { model.settings.megszolitas = normalizeName(model.settings.megszolitas) }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 48)
                    .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
            }
            .listRow()
            RowDivider()
            // AW17: a hang elérhetősége zárójelben a leírás végén (mint a weben; külön „Hang” sor nincs)
            ToggleRow(label: t(.settingsVoiceInstructions), hint: voiceInstructionsHint(voiceAvailability), isOn: $model.settings.hangosUtasitasok)
                .id(Self.voiceAnchor)
        }
    }

    /// Csak iOS: a jelzések (A10).
    private var alertsCard: some View {
        ListCard {
            ToggleRow(label: t(.iosSettingsCameraAlert), hint: t(.iosSettingsCameraAlertHint), isOn: $model.settings.kameraJelzes)
            RowDivider()
            ToggleRow(label: t(.iosSettingsPlannedAlert), hint: t(.iosSettingsPlannedAlertHint), isOn: $model.settings.tervezettJelzes)
                .disabled(!model.settings.tervezettMeresek)
                .opacity(model.settings.tervezettMeresek ? 1 : 0.5)
            RowDivider()
            VStack(alignment: .leading, spacing: 10) {
                RowText(label: t(.iosSettingsAlertMode), hint: t(.iosSettingsAlertModeHint))
                Segmented(options: [(AlertMode.hang, t(.iosSettingsAlertModeSound)), (.rezges, t(.iosSettingsAlertModeVibrate)), (.ki, t(.iosSettingsAlertModeOff))], selection: $model.settings.jelzesMod)
                    .accessibilityLabel(t(.iosSettingsAlertMode))
            }
            .listRow()
        }
    }

    /// AW19: az utak naplója; AOS17: alatta a „Törölt adatok visszaállítása” a lejáratig.
    private var tripsCard: some View {
        ListCard {
            chevronRow(t(.tripsTitle)) { tripsOpen = true }
            if let until = model.trashUntil {
                RowDivider()
                chevronRow(t(.settingsRestore), hint: t(.settingsRestoreHint, ["date": Self.expiryText(until)])) { model.restoreTrash() }
            }
        }
    }

    private static func expiryText(_ ms: Double) -> String {
        let f = DateFormatter()
        f.locale = L10n.lang.locale
        f.setLocalizedDateFormatFromTemplate("yMMMMd")
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    private var placesCard: some View {
        ListCard {
            slotRow(t(.navPlaceHome), model.saved.home, .home)
            RowDivider()
            slotRow(t(.navPlaceWork), model.saved.work, .work)
            RowDivider()
            ForEach(model.saved.others) { p in
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 14) {
                        placeText(p.name, p.address)
                        Button(t(.navPlaceRemove)) { model.removeSavedOther(p.id) }.buttonStyle(MiniButtonStyle())
                    }
                    ZoneRadiusRow(model: model, id: p.id)
                }
                .listRow()
                RowDivider()
            }
            // „Új hely mentése”: a kereső kiválasztó módban nyílik, a választott hely a listába kerül
            Button(t(.navPlaceAdd)) { pick(.other) }
                .buttonStyle(MiniButtonStyle())
                .listRow()
        }
        .id(Self.placesAnchor)
    }

    private var statusCard: some View {
        ListCard {
            statusRow(t(.settingsGps), model.geo.label)
            RowDivider()
            statusRow(t(.settingsWake), model.started ? t(.geoActive) : t(.geoOff))
            RowDivider()
            statusRow(t(.settingsSections), String(model.sections.count))
            RowDivider()
            statusRow(t(.settingsServer), model.serverStatus)
            RowDivider()
            statusRow(t(.settingsRequests), String(model.requestsToday))
        }
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack(spacing: 14) {
            Text(label).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w580)).foregroundStyle(Tokens.Colors.text)
            Spacer(minLength: 0)
            Text(value).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w400)).foregroundStyle(Tokens.Colors.textMuted).multilineTextAlignment(.trailing)
        }
        .listRow()
    }

    private var devCard: some View {
        ListCard {
            Button {
                if model.sim == nil { model.startSim(.lassit) } else { model.exitSim() }
                onClose()
            } label: {
                RowText(label: model.sim == nil ? t(.settingsSimEnter) : t(.settingsSimExit), hint: t(.settingsSimHint))
                    .listRow()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    /// Koppintható sor nyíllal (`.list-row.nav-row`).
    private func chevronRow(_ label: String, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                RowText(label: label, hint: hint)
                Icon(name: .chevronRight, size: 20).foregroundStyle(Tokens.Colors.textFaint)
            }
            .listRow()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Haza / Munka: a mentett hely neve (vagy „nincs beállítva”), Beállítás és Törlés.
    private func slotRow(_ label: String, _ place: Place?, _ slot: PlaceSlot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                placeText(label, place?.name ?? t(.navPlaceUnset))
                // a webes `.mini-btns`: 8 pt-es térköz
                HStack(spacing: Tokens.Space.s2) {
                    Button(t(.navPlaceSet)) { pick(slot) }.buttonStyle(MiniButtonStyle())
                    if place != nil {
                        Button(t(.navPlaceRemove)) { model.clearSaved(slot) }.buttonStyle(MiniButtonStyle())
                    }
                }
                .fixedSize()
            }
            // AW20-javítás: a beállított helyhez adatvédelmi zóna (AOS18: alapból 200 m); a beállítatlan sor nem kap szegmenst
            if place != nil { ZoneRadiusRow(model: model, id: slot == .home ? "home" : "work") }
        }
        .listRow()
    }

    private func placeText(_ title: String, _ hint: String) -> some View {
        RowText(label: title, hint: hint, hintLines: 1)
    }

    /// A kereső kiválasztó módban nyílik, a lap fölött (AW15: a lap nem zárul be).
    private func pick(_ slot: PlaceSlot) {
        model.openSearch(for: slot)
    }

    private static let heatAnchor = "heat"
    private static let languageAnchor = "language"
    private static let voiceAnchor = "voice"
    private static let placesAnchor = "places"
    private static let tripsAnchor = "trips"

    /// A választott nyelv (`nil`: automatikus); azonnal érvényes, a feliratok újrarajzolódnak.
    /// A sor értéke: a választott nyelv zászlóval és saját nevével, vagy „Automatikus (készülék nyelve)”.
    /// Van-e a készüléken felolvasó hang az app nyelvén (az `AlertPlayer` ugyanígy választ hangot).
    private var voiceAvailability: VoiceAvailability {
        AVSpeechSynthesisVoice(language: L10n.lang.locale.identifier.replacingOccurrences(of: "_", with: "-")) != nil ? .ok : .missing
    }

    private var languageSummary: String {
        if let l = LangChoice.shared.preference { return languageMenu().first { $0.lang == l }?.label ?? l.nativeName }
        return "\(t(.settingsLanguageAuto)) (\(L10n.systemLang.nativeName))"
    }

    /// A megszólítás mezője: legfeljebb `MEGSZOLITAS_MAX` karakter; a széleken lévő szóköz mentéskor (`onSubmit`) és a
    /// beolvasáskor vágódik, gépelés közben nem.
    private var name: Binding<String> {
        Binding(get: { model.settings.megszolitas }, set: { model.settings.megszolitas = String($0.prefix(MEGSZOLITAS_MAX)) })
    }

    private var language: Binding<Lang?> {
        Binding(get: { LangChoice.shared.preference }, set: { LangChoice.shared.preference = $0 })
    }
}
