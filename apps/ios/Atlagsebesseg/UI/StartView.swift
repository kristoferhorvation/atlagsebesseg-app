import MapboxMaps
import SwiftUI

/// Kezdőképernyő, a webes `StartScreen` 1:1 (AOS17): a térkép fölött sötétedő átmenet, ikon, cím, mondat, három pipás tipp,
/// „Indulás” és a szimulátor. A harmadik tipp platformfüggő: iOS-en a lezárt képernyős mérés (nem a webes „háttérben megszakad”).
struct StartView: View {
    let model: AppModel

    var body: some View {
        ZStack {
            // a webes térkép a saját kiinduló nézetén (MapboxWebAdapter), mozdítani nem lehet: a lap fedi
            if Parity.on {
                Tokens.Colors.parityBackdrop.ignoresSafeArea()
            } else {
            Map(initialViewport: .camera(center: CLLocationCoordinate2D(latitude: 46.5, longitude: 12.5), zoom: 5.2))
                .mapStyle(.standard(
                    theme: mapThemeIsMonochrome(model.settings.terkep) ? .monochrome : .default,
                    lightPreset: StandardLightPreset(rawValue: mapLightPreset(model.settings.terkep, lightPresetAt(model.lightNowMs(), nil)).rawValue),
                    showPointOfInterestLabels: false
                ))
                .ornamentOptions(OrnamentOptions(
                    scaleBar: ScaleBarViewOptions(visibility: .hidden),
                    compass: CompassViewOptions(visibility: .hidden),
                    logo: LogoViewOptions(position: .topLeading, margins: CGPoint(x: Tokens.Space.s2, y: Tokens.Space.s1)),
                    attributionButton: AttributionButtonOptions(position: .topTrailing, margins: CGPoint(x: Tokens.Space.s2, y: Tokens.Space.s1), tintColor: UIColor(Tokens.Colors.textMuted))
                ))
                .allowsHitTesting(false)
                .ignoresSafeArea()
            }
            // AOS18: a webes `.app` sötétítő rétegei a kezdőképernyő alatt is ott vannak
            ScrimTop()
            ScrimBottom(compact: false).ignoresSafeArea()
            // a webes `.start` háttere: 10% → 94% a magasság 52%-áig
            LinearGradient(stops: [
                .init(color: Tokens.Colors.bg.opacity(Tokens.Opacity.o10), location: 0),
                .init(color: Tokens.Colors.bg.opacity(Tokens.Opacity.o94), location: 0.52),
            ], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 22) {
                Spacer(minLength: 0)
                Image("StartMark")
                    .resizable()
                    .frame(width: 76, height: 76)
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.r20, style: .continuous))
                    .background(BoxShadow(shape: RoundedRectangle(cornerRadius: Tokens.Radius.r20, style: .continuous), layers: Tokens.Shadow.startMark))
                VStack(alignment: .leading, spacing: 10) {
                    // a cím SOHA nem törik: a betű annyira kisebb, hogy minden nyelven egy sorban elférjen (320 pt-en is)
                    Text(t(.appName))
                        .css(Tokens.FontSize.f44, Tokens.FontWeight.w700, line: 1.02, tracking: -0.035)
                        .lineLimit(1)
                        .minimumScaleFactor(0.4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(t(.startTagline))
                        .css(Tokens.FontSize.f19, Tokens.FontWeight.w400, line: 1.4)
                        .foregroundStyle(Tokens.Colors.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 12) {
                    tip(t(.startTipPhone))
                    tip(t(.startTipLocation))
                    tip(t(.iosStartTipBackground))
                }
                Button(t(.startGo)) { model.start() }
                    .buttonStyle(WideButtonStyle(kind: .primary))
                Button { model.startSim(.lassit) } label: {
                    Text(t(.startSim))
                        .css(Tokens.FontSize.f16, Tokens.FontWeight.w600)
                        .foregroundStyle(Tokens.Colors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(10)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
            .foregroundStyle(Tokens.Colors.text)
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 20)
        }
    }

    private func tip(_ text: String) -> some View {
        HStack(spacing: 12) {
            Icon(name: .check).foregroundStyle(Tokens.Colors.ok)
            Text(text)
                .css(Tokens.FontSize.f17, Tokens.FontWeight.w540)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
