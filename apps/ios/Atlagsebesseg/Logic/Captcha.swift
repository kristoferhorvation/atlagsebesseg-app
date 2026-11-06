import Foundation

/// AW25b (AOS19): captcha a munkamenet-létrehozáshoz (névtelen belépés, e-mail-link) – előkészítve, KIKAPCSOLVA; a webes
/// `packages/app-logic/src/captcha.ts` párja. Bekapcsolás: Cloudflare Turnstile site key (Kristof), a token-adó (Turnstile egy rejtett
/// `WKWebView`-ban) regisztrálása a `setCaptchaProvider`-rel, itt `enabled: true` + `siteKey`; a sorrend: `docs/ops/store-checklist.md`.
/// Amíg ki van kapcsolva, a kérések pontosan a régiek (`captchaToken: nil`), és a token-adót sem hívjuk.
nonisolated enum CAPTCHA {
    static let enabled = false
    static let provider = "turnstile"
    static let siteKey = ""
}

typealias CaptchaProvider = @Sendable () async throws -> String?

nonisolated private final class CaptchaSlot: @unchecked Sendable {
    static let shared = CaptchaSlot()
    private let lock = NSLock()
    private var value: CaptchaProvider?
    var provider: CaptchaProvider? {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

/// A platform token-adója. Kikapcsolt captchánál hatástalan.
nonisolated func setCaptchaProvider(_ p: CaptchaProvider?) { CaptchaSlot.shared.provider = p }

/// A Supabase Auth `captchaToken` paramétere: bekapcsolt captchánál és kapott tokennél a token, különben `nil` (a webes `captchaOptions`).
nonisolated func captchaToken(enabled: Bool = CAPTCHA.enabled) async -> String? {
    guard enabled, let p = CaptchaSlot.shared.provider else { return nil }
    return (try? await p()) ?? nil
}
