import SwiftUI

/// Felső, lüktető sáv, amíg a pozíció egy tervezett rendőrségi mérés vonalán (zónájában) van – a webes
/// `PlannedBand`: „Tervezett rendőrségi mérés”, alatta „okt 27–nov 2 · max 90” (+ időszak); zónánál egy mondat:
/// „Rendőrségi mérés {település} területén · {dátum} · forrás: {forrás}”. Mérés közben kisebb, egysoros.
struct PlannedBand: View {
    let check: PlannedCheck
    let compact: Bool
    let unit: SpeedUnit

    var body: some View {
        HStack(spacing: compact ? 10 : 14) {
            PulseDot()
            if check.isZone {
                Text(plannedZoneText(check))
                    .font(.inter(Tokens.Typography.body.size, 620))
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(compact ? 1 : 3)
            } else if compact {
                (Text(t(.plannedLine)).foregroundColor(Tokens.Colors.planned) + Text(" · ") + meta)
                    .font(.inter(Tokens.Typography.body.size, 620))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t(.plannedLine))
                        .font(.inter(22, 650))
                        .tracking(Tokens.Typography.title.trackingPt)
                        .foregroundStyle(Tokens.Colors.planned)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    meta
                        .font(.inter(Tokens.Typography.body.size, 560))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
        }
        .foregroundStyle(Tokens.Colors.textMuted)
        .padding(.leading, compact ? 12 : 16)
        .padding(.trailing, compact ? 14 : 20)
        .padding(.vertical, compact ? 8 : 12)
        .glass(radius: 24)
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Tokens.Colors.planned.opacity(0.45), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(plannedBandText(check, unit: unit))
    }

    /// „okt 27–nov 2 · max 90 · (időszak)” – a határ fehéren, vastagabban.
    private var meta: Text {
        var out = Text(plannedDateRange(check)).foregroundColor(Tokens.Colors.textMuted)
            + Text(" · ").foregroundColor(Tokens.Colors.textMuted)
            + Text(plannedLimitText(check, unit: unit)).foregroundColor(Tokens.Colors.text).fontWeight(.bold)
        if let w = check.timeWindow { out = out + Text(" · \(w)").foregroundColor(Tokens.Colors.textMuted) }
        return out
    }
}

/// A lüktető pont: táguló, halványuló gyűrű (a webes `planned-pulse`).
private struct PulseDot: View {
    @State private var on = false

    var body: some View {
        Circle()
            .fill(Tokens.Colors.planned)
            .frame(width: 14, height: 14)
            .background(
                Circle()
                    .fill(Tokens.Colors.planned)
                    .scaleEffect(on ? 2.6 : 1)
                    .opacity(on ? 0 : 0.6)
            )
            .onAppear {
                withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { on = true }
            }
            .accessibilityHidden(true)
    }
}

/// A jelzés pillanata: rövid ideig látszó sáv a bemondott mondattal (kamera, szakaszkapu, tervezett mérés).
struct AlertBanner: View {
    let event: AlertEvent

    var body: some View {
        HStack(spacing: Tokens.Space.s3) {
            switch event.kind {
            case .camera: Icon(name: .cam_speed, size: 26)
            case .section: Icon(name: .kapu_kezdo, size: 26)
            case .planned: Circle().fill(Tokens.Colors.planned).frame(width: 14, height: 14)
            }
            Text(event.text)
                .font(.inter(Tokens.Typography.body.size, 650))
                .foregroundStyle(Tokens.Colors.text)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(event.kind == .planned ? Tokens.Colors.planned : Tokens.Colors.text)
        .padding(.leading, Tokens.Space.s4)
        .padding(.trailing, Tokens.Space.s5)
        .frame(minHeight: 56)
        .glass(radius: 28, fill: Tokens.Colors.surfaceStrong)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}
