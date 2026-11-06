import Testing
@testable import Atlagsebesseg

/// AW25b (AOS19): a webes `captcha.test.ts` párja (azonos nevekkel).
@Suite("AW25: captcha (előkészítve, kikapcsolva)", .serialized)
struct CaptchaTests {
    @Test("alapból ki van kapcsolva: a kérés nem kap captchaToken-t, a token-adót sem hívja")
    func alapbolKi() async {
        defer { setCaptchaProvider(nil) }
        #expect(CAPTCHA.enabled == false)
        let calls = Counter()
        setCaptchaProvider { calls.bump(); return "tok" }
        #expect(await captchaToken() == nil)
        #expect(calls.value == 0)
    }

    @Test("bekapcsolva a token a kérésbe kerül; token-adó nélkül vagy hibánál üres")
    func bekapcsolva() async {
        defer { setCaptchaProvider(nil) }
        setCaptchaProvider(nil)
        #expect(await captchaToken(enabled: true) == nil)
        setCaptchaProvider { "tok" }
        #expect(await captchaToken(enabled: true) == "tok")
        struct Hiba: Error {}
        setCaptchaProvider { throw Hiba() }
        #expect(await captchaToken(enabled: true) == nil)
    }
}

nonisolated private final class Counter: @unchecked Sendable {
    private(set) var value = 0
    func bump() { value += 1 }
}
