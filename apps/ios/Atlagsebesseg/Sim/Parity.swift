import Foundation

/// AOS18: `-parity YES` – a paritás-kapu (`npm run parity`) iOS-képei: a térkép helyén egyszínű háttér, rögzített óra (`-parityNow`, ms), álló
/// lejátszás (a `-simAt` / `-simSeek` mintán marad). Éles futásban nincs beállítva.
nonisolated enum Parity {
    static let on = UserDefaults.standard.bool(forKey: "parity")

    /// A szimulátor falióra-értéke: paritás-módban a webes képekkel azonos rögzített idő.
    static func wallMs() -> Double {
        on ? UserDefaults.standard.double(forKey: "parityNow") : Date().timeIntervalSince1970 * 1000
    }
}
