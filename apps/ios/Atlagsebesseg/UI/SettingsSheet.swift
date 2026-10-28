import AtlagsebessegCore
import SwiftUI

/// Beállítások: kijelző (tűrés, egység, térkép), állapot, fejlesztés (szimulátor), attribúció.
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
                }
                SwiftUI.Section(t(.settingsGroupStatus)) {
                    LabeledContent(t(.settingsGps), value: model.geo.label)
                    LabeledContent(t(.settingsWake), value: model.started ? t(.geoActive) : t(.geoOff))
                    LabeledContent(t(.settingsSections), value: String(model.sections.count))
                    LabeledContent(t(.settingsServer), value: model.serverStatus)
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
}
