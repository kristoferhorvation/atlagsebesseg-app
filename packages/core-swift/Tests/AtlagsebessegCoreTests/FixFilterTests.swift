import AtlagsebessegCore
import Testing

// packages/core/test/fixFilter.test.ts
private func fix(_ t: Double, _ latOffsetM: Double, _ accuracy: Double? = 5) -> GpsFix {
    GpsFix(lat: 45 + latOffsetM / 111_195, lon: 10, timestamp: t * 1000, speed: 30, accuracy: accuracy, heading: 0)
}

@Suite("FixFilter")
struct FixFilterTests {
    @Test("elfogadja a folyamatos mozgást")
    func folyamatos() {
        let f = FixFilter()
        for i in 0..<10 { #expect(f.check(fix(Double(i), Double(i) * 30)).ok) }
    }

    @Test("eldobja a pontatlan fixet")
    func pontatlan() {
        let f = FixFilter()
        #expect(f.check(fix(0, 0, 80)) == .rejected(.pontatlan))
        #expect(f.check(fix(0, 0, nil)).ok)
    }

    @Test("eldobja az időrendben hibásat")
    func idorend() {
        let f = FixFilter()
        _ = f.check(fix(5, 0))
        #expect(f.check(fix(5, 30)) == .rejected(.idorend))
        #expect(f.check(fix(4, 30)) == .rejected(.idorend))
    }

    @Test("eldobja az ugrást, de utána a valódi pályát folytatja")
    func ugras() {
        let f = FixFilter()
        _ = f.check(fix(0, 0))
        _ = f.check(fix(1, 30))
        #expect(f.check(fix(2, 800)) == .rejected(.ugras))
        #expect(f.check(fix(3, 90)).ok)
    }

    @Test("hosszú kiesés után a nagy elmozdulás nem ugrás")
    func hosszuKieses() {
        let f = FixFilter()
        _ = f.check(fix(0, 0))
        #expect(f.check(fix(60, 2000)).ok)
    }

    @Test("ha a kiinduló fix volt hibás, három konzisztens fix után átáll")
    func atall() {
        let f = FixFilter()
        _ = f.check(fix(0, 5000)) // hibás kezdés
        #expect(!f.check(fix(1, 0)).ok)
        #expect(!f.check(fix(2, 30)).ok)
        #expect(f.check(fix(3, 60)).ok)
        #expect(f.check(fix(4, 90)).ok)
    }

    @Test("érvénytelen koordináta")
    func ervenytelen() {
        var x = fix(0, 0)
        x.lat = .nan
        #expect(FixFilter().check(x) == .rejected(.ervenytelen))
    }
}
