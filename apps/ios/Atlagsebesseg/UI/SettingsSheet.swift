import AtlagsebessegCore
import SwiftUI

/// Beállítások: kijelző (tűrés, egység, térkép), jelzések (kamera, tervezett mérés, mód), mentett helyek (Haza, Munka,
/// továbbiak – AW12), állapot, fejlesztés (szimulátor), attribúció.
struct SettingsSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
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
                    Picker(t(.settingsMap), selection: $model.settings.terkep) {
                        Text(t(.settingsLookColor)).tag(MapLook.szines)
                        Text(t(.settingsLookMuted)).tag(MapLook.visszafogott)
                    }
                    .pickerStyle(.segmented)
                    Toggle(t(.settingsPlanned), isOn: $model.settings.tervezettMeresek)
                    Text(t(.settingsPlannedHint)).font(.footnote).foregroundStyle(Tokens.Colors.textMuted)
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

    /// A kereső kiválasztó módban nyílik a térkép tetején (a lap bezárul).
    private func pick(_ slot: PlaceSlot) {
        dismiss()
        model.openSearch(for: slot)
    }
}
