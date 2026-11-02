import AtlagsebessegCore
import Foundation

// AW19: krúzing mód és az utak naplója (a webes `useTrips` párja): a `TripRecorder` ugyanazokat a fixeket kapja, mint a
// mérés és a navigáció; a navigáció (cél, újratervezés, dugó) és a mérés (befejezett szakasz) eseményei a futó útba
// kerülnek; a minták és a lezárt utak a `TripStore`-ba (SQLite). Szerverre semmi nem megy.
extension AppModel {
    /// Egy új fix a felvevőnek.
    func recordTrip(_ fix: GpsFix) {
        tripRecorder.onFix(fix)
        pumpTrips()
    }

    /// Óra-lépés (fix nélkül is).
    func tickTrips() {
        tripRecorder.tick(nowMs())
        pumpTrips()
    }

    /// A futó út pillanatképe a naplóba (az út nyitva marad) – ha az app a háttérben leáll, az út nem vész el.
    func checkpointTrip() {
        guard let snap = tripRecorder.snapshot() else { return }
        tripStore.saveTrip(snap)
        reloadTrips()
    }

    /// A felhasználó megállította a GPS-t (az app leállította, a szimuláció véget ért): a futó út lezárul. Háttérbe kerüléstől NEM.
    func stopTrips() {
        tripRecorder.stop()
        pumpTrips()
    }

    /// A navigáció állapota a felvevőnek: a cél, az újratervezések (felfutó él), a helyi dugó-állapot.
    func syncTripNav() {
        tripRecorder.setDestination(nav?.destination.name)
        let rerouting = nav?.rerouting ?? false
        if rerouting, !tripNavPrev.rerouting { tripRecorder.noteReroute() }
        let jam = nav?.jam ?? false
        if jam != tripNavPrev.jam { tripRecorder.noteJam(jam, nowMs()) }
        tripNavPrev = (rerouting, jam)
        // a teljesített manőverek adják a kanyarokat (krúzingban nincs navigáció → 0)
        tripRecorder.noteNextManeuver(nav.map { (icon: $0.next.icon.rawValue, instruction: $0.next.instruction, distanceM: $0.next.distanceM) })
    }

    /// A befejezett szakaszmérés (egyszer eredményenként).
    func syncTripMeasure() {
        guard view.phase == .befejezve, let r = view.result, let s = view.section else { return }
        let key = "\(r.sectionId):\(r.exitTime)"
        guard key != tripLastResult else { return }
        tripLastResult = key
        tripRecorder.noteMeasurement(TripMeasurement(
            sectionId: r.sectionId, name: measurementName(road: s.road, direction: s.direction), avgKmh: jsRound(r.averageKmh * 10) / 10,
            limitKmh: r.speedLimitKmh, tooFast: r.overLimit, at: r.exitTime
        ))
    }

    /// A napló újraolvasása a tárolóból.
    func reloadTrips() { trips = tripStore.trips() }

    func deleteTrip(_ id: String) {
        tripStore.deleteTrip(id)
        reloadTrips()
    }

    func deleteAllTrips() {
        tripStore.deleteAll()
        reloadTrips()
    }

    /// Az üres nézet állapotsora („Krúzing · 12,4 km · 23 perc”), amíg az út tart.
    var cruiseText: String? {
        cruise.map { cruiseStatusText(distanceM: $0.distanceM, elapsedS: $0.elapsedS, unit: settings.egyseg) }
    }

    /// A részlet kis térképének fénye: a mostani napszaké (mint a fő térképen a Visszafogott stílusnál).
    var tripMapPreset: LightPreset { mapLightPreset(.visszafogott, lightPresetAt(lightNowMs(), view.lastFix)) }

    private func pumpTrips() {
        let samples = tripRecorder.drainSamples()
        if !samples.isEmpty { tripStore.addSamples(samples) }
        var changed = false
        for e in tripRecorder.drainEnded() {
            switch e {
            case let .saved(trip):
                tripStore.saveTrip(trip)
                changed = true
                if sim != nil { NSLog("TRIP saved %@ %.0f m %.0f s turns %d/%d/%d checks %d", trip.id, trip.distanceM, trip.movingS, trip.turns.left, trip.turns.right, trip.turns.uTurn, trip.measurements.count) }
            case let .discarded(id):
                tripStore.deleteSamples(id)
            }
        }
        if changed { reloadTrips() }
        // az állapotsor 10 m-enként és percenként változik – nem minden fixnél új érték
        let v = tripRecorder.view(nowMs())
        let same = cruise.map { c in
            v.map { c.tripId == $0.tripId && jsRound(c.distanceM / 10) == jsRound($0.distanceM / 10) && floor(c.elapsedS / 60) == floor($0.elapsedS / 60) } ?? false
        } ?? (v == nil)
        if !same { cruise = v }
    }
}
