import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing

// packages/core/test/metrics.test.ts
@Suite("averageSpeedKmh")
struct AverageSpeedTests {
    @Test("10 km 5 perc alatt = 120 km/h")
    func tizKmOtPerc() {
        #expect(closeTo(averageSpeedKmh(10_000, 300_000), 120, 9))
    }

    @Test("nincs adat → null")
    func nincsAdat() {
        #expect(averageSpeedKmh(0, 10_000) == nil)
        #expect(averageSpeedKmh(100, 500) == nil)
    }
}

@Suite("requiredSpeed")
struct RequiredSpeedTests {
    func req(_ distanceDoneM: Double, _ elapsedMs: Double, _ minPracticalFraction: Double? = nil) -> RequiredSpeed {
        requiredSpeed(lengthM: 10_000, speedLimitKmh: 130, distanceDoneM: distanceDoneM, elapsedMs: elapsedMs, minPracticalFraction: minPracticalFraction)
    }

    @Test("az elején a határral egyezik")
    func elejen() {
        let r = req(0, 0)
        #expect(r.kind == "ok")
        #expect(closeTo(r.maxKmh, 130, 9))
    }

    @Test("8 km 125 km/h-val → a maradék 2 km legfeljebb ≈ 154,8 km/h")
    func nyolcKm() {
        let r = req(8000, (8.0 / 125) * 3_600_000)
        #expect(r.kind == "ok")
        #expect(closeTo(r.maxKmh, 154.78, 1))
    }

    @Test("ha túl gyors voltál, a hátralévő maximum a határ alá esik")
    func tulGyorsVoltal() {
        let r = req(5000, (5.0 / 150) * 3_600_000)
        #expect(r.kind == "ok")
        #expect(r.maxKmh! < 130)
    }

    @Test("nem lehetséges, ha csak irreálisan lassan lehetne a határ alá kerülni")
    func nemLehetseges() {
        let r = req(9000, (9.0 / 160) * 3_600_000)
        #expect(r.kind == "nem_lehetseges")
        #expect(r.maxKmh! < 130 * 0.6)
    }

    @Test("a minimum-küszöb állítható (a határ hányadaként)")
    func kuszobAllithato() {
        #expect(req(9000, (9.0 / 160) * 3_600_000, 0.3).kind == "ok")
    }

    @Test("a küszöb a határ 60%-a: 130-nál 78, 100-nál 60 km/h")
    func kuszobHatvanSzazalek() {
        // a hátralévő 2 km-en legfeljebb 70 km/h
        func at(_ limit: Double) -> RequiredSpeed {
            let L = 10_000.0
            let budgetS = 2000 / (70 / 3.6)
            let elapsedMs = (L / (limit / 3.6) - budgetS) * 1000
            return requiredSpeed(lengthM: L, speedLimitKmh: limit, distanceDoneM: 8000, elapsedMs: elapsedMs)
        }
        #expect(at(130).kind == "nem_lehetseges")
        #expect(at(100).kind == "ok")
        #expect(closeTo(at(130).maxKmh, 70, 6))
    }

    @Test("célba érve határ felett: nem lehetséges")
    func celbaErve() {
        #expect(req(10_000, 200_000).kind == "nem_lehetseges")
    }

    @Test("ha elég idő eltelt, nincs korlát")
    func nincsKorlat() {
        #expect(req(5000, 300_000).kind == "nincs_korlat")
    }
}

@Suite("slowDownByKmh")
struct SlowDownTests {
    @Test("a jelenlegi és a megengedett különbsége, alulról 0-ra vágva")
    func kulonbseg() {
        #expect(slowDownByKmh(160, .ok(maxKmh: 140)) == 20)
        #expect(slowDownByKmh(120, .ok(maxKmh: 140)) == 0)
        #expect(slowDownByKmh(200, .nincsKorlat) == 0)
        #expect(slowDownByKmh(nil, .ok(maxKmh: 140)) == nil)
    }
}

@Suite("tűrés")
struct ToleranceTests {
    @Test("5% vagy 5 km/h, a nagyobb")
    func otSzazalek() {
        #expect(closeTo(toleranceKmh(130), 6.5, 9))
        #expect(toleranceKmh(100) == 5)
        #expect(toleranceKmh(80) == 5)
        #expect(toleranceKmh(50) == 5)
        #expect(closeTo(limitWithToleranceKmh(130), 136.5, 9))
        #expect(closeTo(limitWithToleranceKmh(110), 115.5, 9))
        #expect(limitWithToleranceKmh(90) == 95)
    }

    @Test("a szabály paraméterezhető")
    func parameterezheto() {
        #expect(closeTo(toleranceKmh(130, ToleranceRule(percent: 3, minKmh: 3)), 3.9, 9))
        #expect(limitWithToleranceKmh(60, ToleranceRule(percent: 0, minKmh: 0)) == 60)
    }

    @Test("a szükséges sebesség a tűréstől független (mindig a szigorú határ)")
    func szigoruHatar() {
        #expect(requiredSpeed(lengthM: 10_000, speedLimitKmh: 130, distanceDoneM: 0, elapsedMs: 0) == .ok(maxKmh: 130))
    }
}

@Suite("projectedAverageKmh")
struct ProjectedAverageTests {
    let L = 10_000.0

    @Test("állandó sebességnél a végső átlag a jelenlegi átlag")
    func allandoSebesseg() {
        let v = projectedAverageKmh(lengthM: L, distanceDoneM: 4000, elapsedMs: (4.0 / 120) * 3_600_000, currentKmh: 120)
        #expect(closeTo(v, 120, 6))
    }

    @Test("gyors kezdés után lassítva a végső átlag a pillanatnyi alá esik")
    func gyorsKezdes() {
        // 5 km 150-nel, onnan 100-zal: 10 / (5/150 + 5/100) = 120
        let v = projectedAverageKmh(lengthM: L, distanceDoneM: 5000, elapsedMs: (5.0 / 150) * 3_600_000, currentKmh: 100)
        #expect(closeTo(v, 120, 6))
    }

    @Test("sebesség nélkül vagy állva null; célban a tényleges átlag")
    func sebessegNelkul() {
        #expect(projectedAverageKmh(lengthM: L, distanceDoneM: 1000, elapsedMs: 30_000, currentKmh: nil) == nil)
        #expect(projectedAverageKmh(lengthM: L, distanceDoneM: 1000, elapsedMs: 30_000, currentKmh: 0.5) == nil)
        #expect(closeTo(projectedAverageKmh(lengthM: L, distanceDoneM: L, elapsedMs: 300_000, currentKmh: 0), 120, 6))
    }
}

@Suite("meterState / meterBar")
struct MeterStateTests {
    func st(_ averageKmh: Double?, _ projectedKmh: Double?) -> MeterState? {
        meterState(averageKmh: averageKmh, projectedKmh: projectedKmh, speedLimitKmh: 130)
    }

    @Test("jó: az átlag ≤ határ, a várható végsőtől függetlenül")
    func jo() {
        #expect(st(120, 100) == .jo)
        #expect(st(130, 150) == .jo)
    }

    @Test("lassíts: az átlag a határ felett, de a várható végső ≤ határ")
    func lassits() {
        #expect(st(138, 120) == .lassits)
        #expect(st(130.4, 130) == .lassits)
    }

    @Test("túl gyors: a várható végső a határ felett")
    func tulGyors() {
        #expect(st(138, 130.1) == .tulGyors)
        #expect(st(150, 160) == .tulGyors)
    }

    @Test("várható végső nélkül a pillanatnyi átlag a tartalék; átlag nélkül nincs állapot")
    func tartalek() {
        #expect(st(135, nil) == .tulGyors)
        #expect(st(125, nil) == .jo)
        #expect(st(nil, 120) == nil)
    }

    @Test("sáv: jó állapotban nincs; különben max X, vagy „nem hozható be”")
    func sav() {
        #expect(meterBar(.jo, .ok(maxKmh: 120)) == nil)
        #expect(meterBar(nil, .ok(maxKmh: 120)) == nil)
        #expect(meterBar(.lassits, .ok(maxKmh: 118)) == .max(maxKmh: 118))
        #expect(meterBar(.tulGyors, .ok(maxKmh: 110)) == .max(maxKmh: 110))
        #expect(meterBar(.tulGyors, .nemLehetseges(maxKmh: 60)) == .nemHozhato)
        #expect(meterBar(.tulGyors, .nincsKorlat) == nil)
    }
}

@Suite("AW17: „Maradj X alatt” és „várható” együtt")
struct StayBelowExpectedTests {
    @Test("137 átlag, 130 határ, most 108, 2,0 km hátra a 7 km-ből → Maradj 115, várható 127")
    func pelda() throws {
        // 5 km 137-tel: 131,4 s; a 130-as átlaghoz a 7 km legalább 193,8 s → 62,5 s marad a 2 km-re
        let elapsedMs = (5.0 / 137) * 3_600_000
        let req = requiredSpeed(lengthM: 7000, speedLimitKmh: 130, distanceDoneM: 5000, elapsedMs: elapsedMs)
        #expect(req.kind == "ok")
        let maxKmh = try #require(req.maxKmh)
        #expect(closeTo(maxKmh, 115.28, 2))
        #expect(maxKmh.rounded() == 115)
        let projected = try #require(projectedAverageKmh(lengthM: 7000, distanceDoneM: 5000, elapsedMs: elapsedMs, currentKmh: 108))
        #expect(closeTo(projected, 127.24, 1))
        #expect(projected.rounded() == 127)
        let state = meterState(averageKmh: 137, projectedKmh: projected, speedLimitKmh: 130)
        #expect(state == .lassits)
        #expect(meterBar(state, req) == .max(maxKmh: maxKmh))
        // a „Maradj” értékével továbbmenve a kapunál pontosan a határ az átlag
        #expect(closeTo(projectedAverageKmh(lengthM: 7000, distanceDoneM: 5000, elapsedMs: elapsedMs, currentKmh: maxKmh), 130, 9))
    }

    @Test("a kettő nem mond ellent: a várható ≤ határ pontosan akkor, ha most ≤ a Maradj-érték")
    func nincsEllentmondas() {
        for avg in [125.0, 131, 137, 145] {
            for doneM in [1000.0, 3500, 5000, 6500] {
                for now in [80.0, 100, 108, 115, 120, 140] {
                    let elapsedMs = (doneM / 1000 / avg) * 3_600_000
                    let req = requiredSpeed(lengthM: 7000, speedLimitKmh: 130, distanceDoneM: doneM, elapsedMs: elapsedMs, minPracticalFraction: 0)
                    let projected = projectedAverageKmh(lengthM: 7000, distanceDoneM: doneM, elapsedMs: elapsedMs, currentKmh: now)!
                    if req.kind == "nincs_korlat" {
                        #expect(projected <= 130 + 1e-9, "\(avg)/\(doneM)/\(now)")
                    } else {
                        #expect((projected <= 130 + 1e-9) == (now <= req.maxKmh! + 1e-9), "\(avg)/\(doneM)/\(now)")
                    }
                }
            }
        }
    }
}

