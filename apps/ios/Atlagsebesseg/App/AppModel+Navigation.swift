import AtlagsebessegCore
import Foundation

// A navigáció kötése (A11) – a webes apps/web/src/nav/useNavigation.ts és routeData.ts megfelelője. A logika a
// Navigation/ mappában; ez csak az állapotot, a hangot és az útvonal-adat betöltését köti az apphoz.

nonisolated enum PlanStatus: Sendable {
    case nogps, loading, ready, error, ratelimited
}

/// A kereső célja: úti cél, vagy mentendő hely a Beállításokból (a webes `SearchKind`).
nonisolated enum PlaceSlot: Sendable {
    case dest, home, work, other
}

nonisolated struct PlanState: Sendable {
    var dest: Place
    var status: PlanStatus
    var routes: [NavRoute] = []
    var selected = 0
    /// AW18: a felhasználó kézzel választott – addig a kiválasztás a leggyorsabbat követi (az útvonal-adat megérkezésekor is).
    var userPicked = false
}

extension AppModel {
    /// A Mapbox nyilvános kulcsa (`pk.`) az Info.plist-ből; nélküle nincs keresés és tervezés (csak a szimulátorban).
    private var mapboxToken: String? {
        let token = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String
        return token?.hasPrefix("pk.") == true ? token : nil
    }

    func setUpNavigation() {
        recents = parseRecents(placesStore.getItem(RECENTS_KEY))
        saved = parseSaved(placesStore.getItem(SAVED_KEY))
        requestCounter = RequestCounter(store: placesStore)
        requestsToday = requestCounter.count
        requestCounter.onChange = { [weak self] in self?.requestsToday = self?.requestCounter.count ?? 0 }
        if let token = mapboxToken {
            directions = DirectionsClient(token: token, lang: { L10n.lang }, counter: requestCounter)
        }
    }

    /// Az útvonal-kérés: a szimulátorban a fixtúra, élesben a Mapbox Directions.
    private var fetchRoutes: RouteFetcher? { simFetcher ?? directions?.fetcher }

    var navActive: Bool { nav != nil }
    /// Úti cél keresése a térkép tetején (a mentett hely keresője a Beállítások fölött nyílik – AW15).
    var destSearchOpen: Bool { searchOpen && pickFor == .dest }
    var placeSearchOpen: Bool { searchOpen && pickFor != .dest }

    // MARK: keresés

    func openSearch(for slot: PlaceSlot = .dest) {
        pickFor = slot
        searchQuery = ""
        searchState = .idle
        searchController?.dispose()
        searchController = SearchController(
            search: { [weak self] q in self?.searchPlaces(q) ?? Task { [] } },
            onState: { [weak self] s in self?.searchState = s }
        )
        searchOpen = true
    }

    func searchInput(_ q: String) {
        searchQuery = q
        searchController?.input(q)
    }

    func closeSearch() {
        searchController?.dispose()
        searchController = nil
        searchOpen = false
    }

    private func searchPlaces(_ q: String) -> Task<[Place], Error> {
        if sim != nil, let places = sim?.fixture.nav?.places {
            return Task { NavSim.search(q, in: places) }
        }
        guard let token = mapboxToken else { return Task { throw DirectionsError(code: "notoken") } }
        let near = view.lastFix.map { LatLon(lat: $0.lat, lon: $0.lon) }
        return geocodeSearch(q, lang: L10n.lang, token: token, near: near)
    }

    /// Koppintás egy találatra / utolsó célra / chipre: a hely a célpont – vagy (a Beállításokból) a mentett hely.
    func choose(_ place: Place) {
        let slot = pickFor
        closeSearch()
        pickFor = .dest
        switch slot {
        case .dest: requestPlan(place)
        case .home: updateSaved { $0.home = place }
        case .work: updateSaved { $0.work = place }
        case .other: updateSaved { $0 = addSavedOther($0, place) }
        }
    }

    // MARK: mentett helyek

    func clearSaved(_ slot: PlaceSlot) {
        updateSaved {
            if slot == .home { $0.home = nil }
            if slot == .work { $0.work = nil }
        }
    }

    func removeSavedOther(_ id: String) {
        updateSaved { $0 = Atlagsebesseg.removeSavedOther($0, id) }
    }

    private func updateSaved(_ edit: (inout SavedPlaces) -> Void) {
        edit(&saved)
        placesStore.setItem(SAVED_KEY, serializeSaved(saved))
    }

    // MARK: tervezés (útvonalválasztó)

    func requestPlan(_ dest: Place) {
        planSeq += 1
        let seq = planSeq
        guard let fix = view.lastFix, let fetchRoutes else {
            plan = PlanState(dest: dest, status: .nogps)
            return
        }
        plan = PlanState(dest: dest, status: .loading)
        summaries = []
        routeData = .none
        follow = false
        // a cím útra illesztett pontjára tervezünk (AW12: sarki háznál különben a mellékutcára illesztene)
        let req = fetchRoutes(LatLon(lat: fix.lat, lon: fix.lon), dest.routeTarget, RouteRequestContext(heading: fix.heading, reason: .plan))
        Task { [weak self] in
            let result = await req.result
            guard let self, seq == self.planSeq else { return }
            switch result {
            case .success(let routes):
                self.plan = PlanState(dest: dest, status: .ready, routes: routes)
                // `-navPick N` (AW17, szimulátor): az N. útvonal kiválasztva – a címke képernyőképéhez (fej nélkül nincs koppintás)
                self.recomputeSummaries()
                if self.sim != nil, UserDefaults.standard.object(forKey: "navPick") != nil {
                    self.selectRoute(UserDefaults.standard.integer(forKey: "navPick"))
                }
                self.fitVersion += 1
                // egyszeri előtöltés az ajánlott és az alternatív útvonalakra együtt (navigáció közben nem töltünk újra)
                let data = await self.loadRouteData(routes)
                guard seq == self.planSeq || self.navSession != nil else { return }
                self.routeData = data
                self.navSession?.setData(data)
                self.recomputeSummaries()
                if self.navStage == "nav", self.navSession == nil {
                    self.navStage = nil
                    self.startNav()
                    self.runSimManual()
                }
            case .failure(let e):
                self.plan = PlanState(dest: dest, status: (e as? DirectionsError)?.code == "RateLimited" ? .ratelimited : .error)
            }
        }
    }

    func retryPlan() {
        if let p = plan { requestPlan(p.dest) }
    }

    /// Kiválasztás (koppintás a kártyán / a térképen); AW18: ettől a kiválasztás nem követi többé a leggyorsabbat.
    func selectRoute(_ i: Int) {
        guard var p = plan, p.routes.indices.contains(i) else { return }
        p.selected = i
        p.userPicked = true
        plan = p
    }

    /// AW18: a „Leggyorsabb” az útvonalválasztóban (a kártyán mutatott menetidő szerint).
    var fastestRoute: Int { fastestRouteIndex(summaries.map(\.durationS)) }

    func cancelPlan() {
        planSeq += 1
        guard plan != nil else { return }
        plan = nil
        summaries = []
        if navSession == nil { routeData = .none }
        follow = true
    }

    private func recomputeSummaries() {
        let now = nowMs()
        summaries = (plan?.routes ?? []).map { routeSummary($0, routeData, now: now) }
        // AW18: az előválasztás a leggyorsabb (nem a Mapbox 0. indexe); az útvonal-adat megérkezésekor újra, amíg a
        // felhasználó nem választott
        if var p = plan, p.status == .ready, !p.userPicked, summaries.count == p.routes.count {
            p.selected = fastestRoute
            plan = p
        }
    }

    // MARK: navigáció

    func startNav() {
        guard let p = plan, p.status == .ready, p.routes.indices.contains(p.selected), let fetchRoutes else { return }
        let route = p.routes[p.selected]
        pushRecent(p.dest)
        navSession?.dispose()
        let s = NavigationSession(
            route: route,
            destination: NavDestination(name: p.dest.name, lat: p.dest.lat, lon: p.dest.lon, routable: p.dest.routable),
            fetchRoutes: fetchRoutes,
            now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 },
            unit: settings.egyseg,
            voice: settings.hangosUtasitasok
        )
        s.setData(routeData)
        s.onChange = { [weak self] in self?.navChanged() }
        navSession = s
        planSeq += 1
        plan = nil
        summaries = []
        follow = true
        if let fix = view.lastFix { s.onFix(fix) }
        syncNavMeasure()
        // AOS14: köszönés az indításkor (a kézi mérés indításakor nincs); az indulási utasítás utána szól
        if settings.hangosUtasitasok {
            let greet = greetingVoice(settings.megszolitas)
            if sim != nil { NSLog("NAV-VOICE greet: %@", greet) }
            if sim?.seeking != true { player.announce(greet, interrupt: false) }
        }
        navChanged()
        updateLiveActivity()
        // a navigációs szimulátor most indul (mint a webes NavSimDriver `active`-ja)
        if let sim, sim.fixture.nav != nil, !sim.playing { sim.start() }
    }

    func endNav() {
        guard let s = navSession else { return }
        s.dispose()
        navSession = nil
        nav = nil
        lastJamFetchAt = nil
        updateManualPill()
        routeData = .none
        player.stopSpeaking()
        updateGateActivity()
        updateLiveActivity()
    }

    func acceptOffer() { navSession?.acceptOffer() }

    /// AW18: koppintás az újratervezés-hiba kártyájára – azonnali újrapróba.
    func retryReroute() { navSession?.retryReroute() }

    /// AW18: „Dugóba kerültél?” – Igen: „Dugó” bejelentés a pozícióra a meglévő folyamattal (a közösségi mintát a session
    /// adja); Nem: erre a szakaszra nem kérdez újra.
    func answerJam(_ yes: Bool) {
        if yes { sendReport(.dugo, jamSample: false) }
        navSession?.answerJam(yes)
    }

    /// AW18: a közösségi dugó-adat navigáció közben ~60 s-enként (`active_jams` az előttünk lévő útvonal-téglalapra);
    /// szimulátorban nincs (a minták csak a naplóba mennek).
    func checkCommunityJams() {
        guard let s = navSession, let v = nav, sim == nil, backend.configured else { return }
        let now = nowMs()
        if let last = lastJamFetchAt, now - last < 60_000 { return }
        lastJamFetchAt = now
        guard let b = jamQueryBBox(v.route, v.alongM) else { return }
        Task { [weak self, weak s] in
            guard let self, let jams = try? await self.backend.activeJams(in: b) else { return }
            if self.navSession === s { s?.setCommunityJams(jams) }
        }
    }

    /// AW18: a session dugó-mintáinak feltöltése (szimulátorban csak napló, NAV-JAM).
    private func uploadJamSamples(_ s: NavigationSession) {
        let rows = s.drainJamSamples()
        if rows.isEmpty { return }
        if sim != nil {
            for r in rows { NSLog("NAV-JAM %@ %d km/h %d m", r.kind.rawValue, r.avg_kmh, r.length_m) }
            return
        }
        Task { [weak self] in
            do { try await self?.backend.createJamSamples(rows) } catch { NSLog("NAV-JAM upload failed: %@", String(describing: error)) }
        }
    }
    func declineOffer() { navSession?.declineOffer() }

    /// A munkamenet változott: új nézet, és a sorban várakozó mondatok felolvasása.
    private func navChanged() {
        guard let s = navSession else { return }
        let camBefore = nav?.cameraNear?.item.id
        nav = s.view()
        uploadJamSamples(s)
        updateManualPill()
        // AW12: a közeli kamera borostyán sávja mellé egyetlen rezgés (a „ki” jelzés-módban nincs)
        if let cam = nav?.cameraNear?.item.id, cam != camBefore, settings.jelzesMod != .ki, sim?.seeking != true { player.pulse() }
        let quiet = sim?.seeking == true
        for v in s.drainVoice() {
            // a szimulátor ugrása (seek) alatt nem szól; a bemondás a naplóba is kerül (a végigjátszás ellenőrzéséhez)
            if sim != nil { NSLog("NAV-VOICE %@: %@", v.kind.rawValue, v.text) }
            if quiet { continue }
            player.announce(v.text, interrupt: v.kind != .instruction)
        }
    }

    /// A mérés állapota a navigációnak: a „Túl gyors” bemondáshoz, és az ajánlat mérés közbeni visszatartásához.
    func syncNavMeasure() {
        updateManualPill()
        updateGateActivity()
        guard let s = navSession else { return }
        s.setMeasureStatus(view.phase == .meres ? view.status : nil)
        s.setMeasuring(view.phase == .meres || view.phase == .kezi)
    }

    private func pushRecent(_ p: Place) {
        recents = addRecent(recents, p)
        placesStore.setItem(RECENTS_KEY, serializeRecents(recents))
    }

    // MARK: útvonal-adat (routeData.ts)

    /// Az útvonal menti szakaszok, kamerák, tervezett mérések: a beépített lista + az útvonalat érő csempék a
    /// szerverről (a meglévő cache-eken át). Szerver nélkül csak a beépített adat; a szimulátorban a fixtúra adata is.
    /// Útvonalválasztáskor egyszer fut, az ajánlott és az alternatív útvonalakra együtt; a csempék a 2 km-es sávnál
    /// bővebb környéket fedik, így navigáció közben nem töltünk újra.
    func loadRouteData(_ routes: [NavRoute]) async -> EnforcementData {
        if sim != nil {
            return EnforcementData(sections: mergeById(BundledData.sections, simSections), cameras: BundledData.cameras + simCameras, planned: simPlanned)
        }
        guard backend.configured else { return EnforcementData(sections: BundledData.sections, cameras: BundledData.cameras) }
        // a csempe 0,5° (a 3 × 3 szomszédsággal együtt bőven lefedi) – 35 km-enként elég mintát venni
        var sections: [[Section]] = []
        var cameras: [String: FixedCamera] = [:]
        var planned: [String: PlannedCheck] = [:]
        for c in BundledData.cameras { cameras[c.id] = c }
        for p in routes.flatMap({ sampleRoute($0, stepM: 35_000) }) {
            sections.append(await sectionTiles.loadItems(p.lat, p.lon).items)
            for c in await cameraTiles.loadItems(p.lat, p.lon).items { cameras[c.id] = c }
            for c in await plannedTiles.loadItems(p.lat, p.lon).items { planned[c.id] = c }
        }
        return EnforcementData(
            sections: sections.reduce(BundledData.sections) { mergeById($0, $1) },
            cameras: cameras.values.sorted { $0.id < $1.id },
            planned: planned.values.sorted { $0.id < $1.id }
        )
    }

    // MARK: szimulátor

    /// `-manual S` (a `-navStage nav` mellett, AW15): a navigációval kézi átlagmérés indul, és S (valós) másodperc múlva
    /// leáll (0: fut tovább) – a pill és a kompakt kézi eredmény képernyőképéhez.
    private func runSimManual() {
        let args = UserDefaults.standard
        guard args.object(forKey: "manual") != nil else { return }
        startManual()
        let stopAfter = args.double(forKey: "manual")
        guard stopAfter > 0 else { return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(stopAfter))
            self?.stopManual()
        }
    }

    /// `-navStage search|picker|nav`: a navigációs szimulátor egy állapotba ugrik (a képernyőképekhez).
    func runNavStage() {
        guard let stage = navStage, let places = sim?.fixture.nav?.places, let dest = places.first else { return }
        switch stage {
        case "search":
            navStage = nil
            openSearch()
            searchInput(UserDefaults.standard.string(forKey: "navQuery") ?? "Gy")
        case "picker":
            navStage = nil
            requestPlan(dest)
        case "nav":
            requestPlan(dest)
        default:
            navStage = nil
        }
    }
}

/// Az útvonal pontjai `stepM` méterenként (és a vége) – a csempék betöltéséhez.
nonisolated func sampleRoute(_ route: NavRoute, stepM: Double) -> [LatLon] {
    guard let first = route.points.first, let last = route.points.last else { return [] }
    var out = [first]
    var acc = 0.0
    for i in route.points.indices.dropFirst() {
        acc += haversineM(route.points[i - 1], route.points[i])
        if acc >= stepM {
            out.append(route.points[i])
            acc = 0
        }
    }
    out.append(last)
    return out
}
