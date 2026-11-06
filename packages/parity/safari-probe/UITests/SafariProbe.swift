import XCTest

/// AW24 F (INV-23): a web valódi Mobile Safariban – eszköztárral, eszköztár nélkül és kezdőképernyős webappként. Minden mód a webes elemek képernyő-
/// kereteit (pt) írja ki (`FRAMES <mód> {…}`) és képet ment a `PROBE_OUT` mappába; a futtató (safari-real.mjs) ellenőriz. A feliratok a szimulátor
/// nyelvén (magyar) vannak; a Safari a mérés előtt a futtató által megnyitott oldalon áll.
final class SafariProbe: XCTestCase {
    private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let webapp = XCUIApplication(bundleIdentifier: "com.apple.webapp")
    private var out: String { ProcessInfo.processInfo.environment["PROBE_OUT"] ?? NSTemporaryDirectory() }

    private func element(_ app: XCUIApplication, _ label: String, prefix: Bool = false) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: prefix ? "label BEGINSWITH %@" : "label == %@", label)).firstMatch
    }

    /// A mért elemek: az „i”, a kereső, a gombsor, az alsó kártya szövege és a térkép (a webtartalom látható része).
    private func measure(_ app: XCUIApplication, _ mode: String) throws {
        var parts: [String] = []
        let labels = ["Toggle attribution", "Úti cél keresése", "Beállítások", "Bejelentés", "Nincs mérőszakasz a közelben", "Map, régió"]
        for l in labels {
            let e = element(app, l)
            if e.exists { let f = e.frame; parts.append("\"\(l)\": [\(f.minX), \(f.minY), \(f.maxX), \(f.maxY)]") }
        }
        // a webtartalom legalsó szövege (bármelyik nézetben): ha a lap alja levágódik, ez a látható részen túl van
        let texts = app.webViews.firstMatch.descendants(matching: .staticText).allElementsBoundByIndex.map(\.frame).filter { $0.height > 0 && $0.minY >= 0 }
        if let low = texts.max(by: { $0.maxY < $1.maxY }) { parts.append("\"bottomText\": [\(low.minX), \(low.minY), \(low.maxX), \(low.maxY)]") }
        let s = XCUIScreen.main.screenshot()
        parts.append("\"screen\": [\(s.image.size.width), \(s.image.size.height)]")
        print("FRAMES \(mode) {\(parts.joined(separator: ", "))}")
        try s.pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/safari-\(mode).png"))
    }

    private func showToolbar() {
        guard !safari.buttons["MoreMenuButton"].isHittable else { return }
        let pill = safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "127.0.0.1", "127.0.0.1")).firstMatch
        if pill.exists { pill.tap(); sleep(3) }
    }

    func test1Safari() throws {
        safari.activate(); sleep(2)
        // friss bootnál a szimulátor Safarija néha „A WebKit belső hibát észlelt”-tel áll meg: újratöltés
        for _ in 0..<3 where element(safari, "A Safari nem képes", prefix: true).exists {
            showToolbar()
            safari.buttons["ReloadButton"].tap(); sleep(45)
        }
        showToolbar(); sleep(6)
        try measure(safari, "eszkoztarral")
        if !safari.buttons["HideToolbar"].exists { safari.buttons["MoreMenuButton"].tap(); sleep(2) }
        safari.buttons["HideToolbar"].tap(); sleep(5)
        try measure(safari, "eszkoztar-nelkul")
        showToolbar()
    }

    func test2AddToHomeScreen() throws {
        safari.activate(); sleep(2)
        showToolbar()
        if !safari.buttons["ShareButton"].exists { safari.buttons["MoreMenuButton"].tap(); sleep(2) }
        safari.buttons["ShareButton"].tap(); sleep(3)
        let more = element(safari, "Továbbiak megtekintése", prefix: true)
        XCTAssertTrue(more.waitForExistence(timeout: 10), "nincs „Továbbiak megtekintése”")
        more.tap(); sleep(2)
        // a megosztás-lap egy része a SpringBoard folyamatában fut: mindkettőben keresünk
        let q = NSPredicate(format: "label CONTAINS %@", "Főképernyő")
        var add: XCUIElement?
        for i in 0..<10 where add == nil {
            add = [safari, springboard].map { $0.descendants(matching: .any).matching(q).firstMatch }.first { $0.exists && $0.isHittable }
            // kis kijelzőn (SE) a menüpont lejjebb van a listában
            if add == nil { if i % 3 == 2 { safari.swipeUp() }; sleep(1) }
        }
        guard let add else {
            // hibakereséshez: a látható feliratok mindkét folyamatból és egy kép
            for app in [safari, springboard] {
                for e in app.descendants(matching: .any).allElementsBoundByIndex.prefix(400) where !e.label.isEmpty { print("ELEM \(e.elementType.rawValue) \(e.label) \(e.frame)") }
            }
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/safari-megosztas-hiba.png"))
            XCTFail("nincs „Hozzáadás a Főképernyőhöz”"); return
        }
        add.tap(); sleep(3)
        let ok = safari.buttons["Hozzáadás"]
        XCTAssertTrue(ok.waitForExistence(timeout: 10))
        for _ in 0..<10 where !ok.isEnabled { sleep(1) }
        ok.tap(); sleep(3)
    }

    func test3Standalone() throws {
        XCUIDevice.shared.press(.home); sleep(2)
        // több futás után több ikon is lehet: a legutóbb hozzáadott (a sor végén) a mostani szerveré
        let icons = springboard.icons.matching(NSPredicate(format: "label BEGINSWITH %@", "Átlag"))
        for _ in 0..<4 where !(icons.allElementsBoundByIndex.last?.isHittable ?? false) { springboard.swipeLeft(); sleep(1) }
        guard let icon = icons.allElementsBoundByIndex.last else { XCTFail("nincs „Átlag” ikon a kezdőképernyőn"); return }
        icon.tap(); sleep(40)
        // friss tárhellyel a kezdőképernyő jön: a szimulátor-gombbal a fő nézet
        let sim = element(webapp, "Kipróbálom GPS nélkül", prefix: true)
        if sim.exists { sim.tap(); sleep(45) }
        try measure(webapp, "kezdokepernyo")
    }
}
