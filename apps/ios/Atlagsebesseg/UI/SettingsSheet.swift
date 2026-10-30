import AtlagsebessegCore
import SwiftUI

/// Beállítások: kijelző (tűrés, egység, térkép, nyelv), jelzések (kamera, tervezett mérés, mód), mentett helyek (Haza,
/// Munka, továbbiak – AW12), állapot, fejlesztés (szimulátor), attribúció. AW15: a mentett hely keresője a lap fölött
/// nyílik, választás után a lap ugyanott, nyitva marad.
struct SettingsSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                Form {
                    SwiftUI.Section(t(.settingsGroupDisplay)) {
                        Toggle(t(.settingsTolerance), isOn: $model.settings.hatosagiTuresMegjelenitese)
                        Text(t(.settingsToleranceHint, ["percent": String(Int(ToleranceRule.default.percent)), "min": String(Int(ToleranceRule.default.minKmh))]))
                            .font(.footnote)
                            .foregroundStyle(Tokens.Colors.textMuted)
                        Picker(t(.settingsUnit), selection: $model.settings.egyseg) {
                            Text(unitLabel(.kmh)).tag(SpeedUnit.kmh)
                            Text(unitLabel(.mph)).tag(SpeedUnit.mph)
                        }
                        .pickerStyle(.segmented)
                        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                            Text(t(.settingsMap))
                            Picker(t(.settingsMap), selection: $model.settings.terkep) {
                                Text(t(.settingsLookLight)).tag(MapLook.vilagos)
                                Text(t(.settingsLookColor)).tag(MapLook.szines)
                                Text(t(.settingsLookMuted)).tag(MapLook.visszafogott)
                            }
                            .pickerStyle(.segmented)
                            .labelsHidden()
                        }
                        Toggle(t(.settingsPlanned), isOn: $model.settings.tervezettMeresek)
                        Text(t(.settingsPlannedHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                    }
                    // AW15: zászló + a saját nyelvén írt név, ábécérendben; az „Automatikus” legfelül – beágyazott lista, egy koppintás
                    SwiftUI.Section {
                        // AW16: egy sor („Nyelv · 🇭🇺 Magyar”), koppintásra nyíló választó
                        Menu {
                            Picker(t(.settingsLanguage), selection: language) {
                                Text("\(t(.settingsLanguageAuto)) (\(L10n.systemLang.nativeName))").tag(Lang?.none)
                                ForEach(languageMenu(), id: \.lang) { item in
                                    Text(item.label).tag(Optional(item.lang))
                                }
                            }
                        } label: {
                            HStack {
                                Text("\(t(.settingsLanguage)) · \(languageSummary)")
                                    .foregroundStyle(Tokens.Colors.text)
                                Spacer(minLength: Tokens.Space.s2)
                                Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                            }
                            .contentShape(Rectangle())
                        }
                        .accessibilityLabel(t(.settingsLanguage))
                    }
                    .id(Self.languageAnchor)
                    // AOS14: megszólítás – a köszöntő felirat és a navigáció-indító köszönés neve (üresen név nélkül)
                    SwiftUI.Section {
                        LabeledContent(t(.settingsName)) {
                            TextField(t(.settingsNamePlaceholder), text: name)
                                .multilineTextAlignment(.trailing)
                                .textContentType(.givenName)
                                .autocorrectionDisabled()
                                .submitLabel(.done)
                                .onSubmit { model.settings.megszolitas = normalizeName(model.settings.megszolitas) }
                        }
                        Text(t(.settingsNameHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                    }
                    SwiftUI.Section(t(.iosSettingsGroupAlerts)) {
                        Toggle(t(.iosSettingsCameraAlert), isOn: $model.settings.kameraJelzes)
                        Text(t(.iosSettingsCameraAlertHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                        Toggle(t(.iosSettingsPlannedAlert), isOn: $model.settings.tervezettJelzes)
                            .disabled(!model.settings.tervezettMeresek)
                        Text(t(.iosSettingsPlannedAlertHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                        Picker(t(.iosSettingsAlertMode), selection: $model.settings.jelzesMod) {
                            Text(t(.iosSettingsAlertModeSound)).tag(AlertMode.hang)
                            Text(t(.iosSettingsAlertModeVibrate)).tag(AlertMode.rezges)
                            Text(t(.iosSettingsAlertModeOff)).tag(AlertMode.ki)
                        }
                        .pickerStyle(.segmented)
                        Text(t(.iosSettingsAlertModeHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                        // A11: a navigáció bemondásai (fordulók, szakaszellenőrzés, „túl gyors”, gyorsabb út)
                        Toggle(t(.settingsVoiceInstructions), isOn: $model.settings.hangosUtasitasok)
                        Text(t(.settingsVoiceInstructionsHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                    }
                    SwiftUI.Section(t(.settingsGroupPlaces)) {
                        slotRow(t(.navPlaceHome), model.saved.home, .home)
                        slotRow(t(.navPlaceWork), model.saved.work, .work)
                        ForEach(model.saved.others) { p in
                            HStack {
                                placeText(p.name, p.address)
                                Spacer(minLength: Tokens.Space.s2)
                                Button(t(.navPlaceRemove), role: .destructive) { model.removeSavedOther(p.id) }
                                    .buttonStyle(.borderless)
                            }
                        }
                        // „Új hely mentése”: a kereső kiválasztó módban nyílik, a választott hely a listába kerül
                        Button(t(.navPlaceAdd)) { pick(.other) }
                    }
                    SwiftUI.Section(t(.settingsGroupStatus)) {
                        LabeledContent(t(.settingsGps), value: model.geo.label)
                        LabeledContent(t(.settingsWake), value: model.started ? t(.geoActive) : t(.geoOff))
                        LabeledContent(t(.settingsSections), value: String(model.sections.count))
                        LabeledContent(t(.settingsServer), value: model.serverStatus)
                        LabeledContent(t(.settingsRequests), value: String(model.requestsToday))
                    }
                    SwiftUI.Section(t(.settingsGroupDev)) {
                        if model.sim == nil {
                            Button(t(.settingsSimEnter)) {
                                model.startSim(.lassit)
                                dismiss()
                            }
                        } else {
                            Button(t(.settingsSimExit), role: .destructive) {
                                model.exitSim()
                                dismiss()
                            }
                        }
                        Text(t(.settingsSimHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                    }
                    SwiftUI.Section {
                        Text(t(.settingsAttribution)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
                    }
                }
                .scrollContentBackground(.hidden)
                .onAppear {
                    // `-settingsOpen language`: a nyelvválasztóhoz görget (a képernyőképhez)
                    if UserDefaults.standard.string(forKey: "settingsOpen") == "language" { scroll.scrollTo(Self.languageAnchor, anchor: .top) }
                }
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
            .navigationTitle(t(.settingsTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t(.commonClose)) { dismiss() }
                }
            }
        }
    }

    /// Haza / Munka: a mentett hely neve (vagy „nincs beállítva”), Beállítás és Törlés.
    private func slotRow(_ label: String, _ place: Place?, _ slot: PlaceSlot) -> some View {
        HStack {
            placeText(label, place?.name ?? t(.navPlaceUnset))
            Spacer(minLength: Tokens.Space.s2)
            Button(t(.navPlaceSet)) { pick(slot) }
                .buttonStyle(.borderless)
            if place != nil {
                Button(t(.navPlaceRemove), role: .destructive) { model.clearSaved(slot) }
                    .buttonStyle(.borderless)
            }
        }
    }

    private func placeText(_ title: String, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).lineLimit(1)
            if !hint.isEmpty { Text(hint).font(.footnote).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1) }
        }
    }

    /// A kereső kiválasztó módban nyílik, a lap fölött (AW15: a lap nem zárul be).
    private func pick(_ slot: PlaceSlot) {
        model.openSearch(for: slot)
    }

    private static let languageAnchor = "language"

    /// A választott nyelv (`nil`: automatikus); azonnal érvényes, a feliratok újrarajzolódnak.
    /// A sor értéke: a választott nyelv zászlóval és saját nevével, vagy „Automatikus (készülék nyelve)”.
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
