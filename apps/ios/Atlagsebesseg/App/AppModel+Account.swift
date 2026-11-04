import AuthenticationServices
import Foundation
import Supabase
import SwiftUI

// AW22: a fiók kötése (a webes `useAccount.ts` párja). Névtelenül is figyeli a helyi változásokat (időbélyeg mezőnként), de szerverre csak valódi fiókkal megy
// adat. A logika a Logic/Account.swift-ben, a Supabase-hívások a Backend/AccountBackend.swift-ben.
extension AppModel {
    var signedInAccount: Bool { accountUserState.map { !$0.isAnonymous } ?? false }
    private var defaults: UserDefaults { .standard }
    /// Szimulátorban nincs fiók-hálózat. A `setUpAccount` a szimulátor indítása előtt fut, ezért az indítási argumentumot is nézi.
    private var accountSimMode: Bool {
        let args = UserDefaults.standard
        return sim != nil || args.string(forKey: "sim") != nil || args.bool(forKey: "cruise") || args.string(forKey: "accountSim") != nil || Parity.on
    }

    /// A mostani app-adat a szinkron alakjában.
    private var accountData: AccountData {
        AccountData(settings: settings, lang: LangChoice.shared.preference?.rawValue ?? "auto", saved: saved, recents: recents)
    }

    func setUpAccount() {
        let args = UserDefaults.standard
        // szimulátorban nincs hálózat: az állapotok a képernyőképekhez (`-accountSim in|out|sent|off`, `-nameStep X`, `-nudge YES`)
        if accountSimMode {
            let state = args.string(forKey: "accountSim")
            accountProviders = (state != "off", state != "off")
            if state == "in" {
                accountUserState = AccountUser(id: "sim", email: "kristof@example.com", isAnonymous: false, provider: .email)
                lastSyncMs = Parity.wallMs() - 120_000
            }
            if state == "sent" { emailSentTo = "kristof@example.com" }
            if args.object(forKey: "nameStep") != nil { nameStep = args.string(forKey: "nameStep") ?? "" }
            if args.bool(forKey: "nudge") { signInNudge = true }
            return
        }
        #if DEBUG
        // élő próba a fej nélküli szimulátorban: az `openurl` rendszer-párbeszédet nyit, itt nincs koppintás; a Documents/debug-url.txt tartalma a link
        if args.bool(forKey: "debugUrls") {
            Task { [weak self] in
                let file = URL.documentsDirectory.appendingPathComponent("debug-url.txt")
                while let self {
                    try? await Task.sleep(for: .seconds(1))
                    guard let text = try? String(contentsOf: file, encoding: .utf8), let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { continue }
                    try? FileManager.default.removeItem(at: file)
                    self.openLink(url)
                }
            }
        }
        #endif
        guard let client = backend.client else { return }
        Task { [weak self] in
            if let p = await self?.backend.authProviders() { self?.accountProviders = p }
        }
        accountAuthTask = Task { [weak self] in
            for await (_, session) in client.auth.authStateChanges {
                self?.sessionChanged(session?.user)
            }
        }
        accountDataChanged()
    }

    private func sessionChanged(_ user: User?) {
        guard let user else {
            accountUserState = nil
            return
        }
        let meta = user.userMetadata
        let claims = meta["custom_claims"]?.objectValue
        let u = accountUser(
            id: user.id.uuidString, email: user.email, isAnonymous: user.isAnonymous, identities: (user.identities ?? []).map(\.provider),
            givenName: meta["given_name"]?.stringValue, claimsGivenName: claims?["given_name"]?.stringValue, fullName: meta["full_name"]?.stringValue, name: meta["name"]?.stringValue
        )
        accountUserState = u
        if !u.isAnonymous && accountHandled != u.id {
            accountHandled = u.id
            Task { await afterSignIn(u) }
        }
    }

    /// Bejelentkezés után: az összefésülés, a szolgáltató neve (az Apple később nem adja meg újra), szinkron, „Így szólítsunk?”.
    private func afterSignIn(_ u: AccountUser, apple: AppleSignIn.Result? = nil) async {
        guard let remote = backend.accountRemote else { return }
        if let token = defaults.string(forKey: MERGE_KEY) {
            do { try await backend.claimMerge(token) } catch { NSLog("ACCOUNT merge failed: %@", String(describing: error)) }
            defaults.removeObject(forKey: MERGE_KEY)
        }
        if u.givenName != nil || u.fullName != nil {
            try? await remote.pushProfile(megszolitas: nil, megszolitasMs: nil, givenName: u.givenName, fullName: u.fullName, namePrompted: nil)
        }
        let first = defaults.string(forKey: SEEN_KEY) != u.id
        await syncNow()
        guard first else { return }
        defaults.set(u.id, forKey: SEEN_KEY)
        showToast(AppToast(text: t(.accountSignedIn), color: Tokens.StatusColors.jo, icon: .check))
        let profile = try? await remote.pullProfile()
        if nameStepNeeded(settings.megszolitas, profile) { nameStep = nameStepPrefill(u, profile) }
    }

    // MARK: szinkron

    /// Helyi változás: időbélyeg mezőnként (névtelenül is), fiókkal 2,5 s múlva szinkron.
    func accountDataChanged() {
        guard !accountSimMode else { return }
        let data = accountData
        accountFields = noteLocalFields(accountFields, accountFieldsOf(data), order: otherPlaceKeys(data.saved), now: accountNowMs())
        defaults.set(accountFields.serialized, forKey: FIELDS_KEY)
        guard signedInAccount else { return }
        accountDebounce?.cancel()
        accountDebounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    /// Előtérbe kerüléskor friss adat.
    func accountBecameActive() {
        guard signedInAccount, !accountSimMode else { return }
        Task { await syncNow() }
    }

    /// Mező-szinkron, majd (bekapcsolva) a felhős mentés; futás közbeni kérés a kör után újra fut.
    func syncNow() async {
        guard let remote = backend.accountRemote, signedInAccount, !accountSimMode else { return }
        if accountSyncing {
            accountAgain = true
            return
        }
        accountSyncing = true
        syncStatus = .syncing
        defer {
            accountSyncing = false
            if accountAgain {
                accountAgain = false
                Task { await syncNow() }
            }
        }
        do {
            let r = try await syncFieldsOnce(remote, accountFields)
            accountFields = r.state
            defaults.set(r.state.serialized, forKey: FIELDS_KEY)
            if !r.changed.isEmpty { applySynced(r.state) }
            if settings.felhoMentes {
                let b = try await syncBackupOnce(remote, tripStore, CloudState.parse(defaults.string(forKey: CLOUD_STATE_KEY)), deviceId: accountDeviceId, openTripId: cruise?.tripId, now: accountNowMs())
                defaults.set(b.state.serialized, forKey: CLOUD_STATE_KEY)
                if b.down > 0 || b.deleted > 0 { reloadTrips() }
                if b.heatChanged {
                    heatIndex.setAll(heatSeedList ?? tripStore.displayHeatCells())
                    heatVersion += 1
                }
            }
            lastSyncMs = Date().timeIntervalSince1970 * 1000
            syncStatus = .ok
        } catch {
            NSLog("ACCOUNT sync failed: %@", String(describing: error))
            syncStatus = .error
        }
    }

    /// A másik készülék változása az appba: a beállítás, a helyek, a nyelv.
    private func applySynced(_ state: FieldState) {
        let next = applyFields(state, base: accountData)
        if next.settings != settings { settings = next.settings }
        if next.saved != saved || next.recents != recents {
            saved = next.saved
            recents = next.recents
            placesStore.setItem(SAVED_KEY, serializeSaved(saved))
            placesStore.setItem(RECENTS_KEY, serializeRecents(recents))
            heatVersion += 1
        }
        let lang = next.lang == "auto" ? nil : Lang(rawValue: next.lang)
        if lang != LangChoice.shared.preference { LangChoice.shared.preference = lang }
    }

    /// Telepítésenként egy azonosító a felhős hőtérkép-sorhoz (nem személyes adat).
    private var accountDeviceId: String {
        if let id = defaults.string(forKey: DEVICE_KEY) { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: DEVICE_KEY)
        return id
    }

    private func updateCloudState(_ edit: (inout CloudState) -> Void) {
        guard settings.felhoMentes, signedInAccount else { return }
        var s = CloudState.parse(defaults.string(forKey: CLOUD_STATE_KEY))
        edit(&s)
        defaults.set(s.serialized, forKey: CLOUD_STATE_KEY)
    }

    /// Törölt utak: a szerver tartalma törlődik, a többi készülékről is eltűnnek. Kikapcsolt mentésnél a szerverre nem megy semmi.
    func noteCloudDeleted(_ ids: [String], heat: Bool) {
        updateCloudState { s in
            s.pendingDeletes = Array(Set(s.pendingDeletes).union(ids))
            s.pendingRestores.removeAll { ids.contains($0) }
            if heat { s.pendingHeatClear = true }
        }
        Task { await syncNow() }
    }

    /// Visszaállított utak: a szerver törlési jelölőjét felülírják.
    func noteCloudRestored(_ ids: [String]) {
        updateCloudState { s in
            s.pendingRestores = Array(Set(s.pendingRestores).union(ids))
            s.pendingDeletes.removeAll { ids.contains($0) }
            s.heatHash = ""
        }
        Task { await syncNow() }
    }

    /// Befejezett út: fiókkal szinkron, névtelenül a bejelentkezés-ajánlat (legfeljebb 30 naponta egyszer).
    func accountTripSaved() {
        guard !accountSimMode else { return }
        if signedInAccount {
            Task { await syncNow() }
            return
        }
        guard backend.configured else { return }
        let now = accountNowMs()
        let last = defaults.object(forKey: NUDGE_KEY) as? Double
        if signinNudgeDue(last, now: now, isAnonymous: true) {
            defaults.set(now, forKey: NUDGE_KEY)
            signInNudge = true
        }
    }

    // MARK: bejelentkezés

    private func fail(_ error: Error) {
        // a felhasználó maga zárta be a lapot: nem hiba
        if (error as? ASAuthorizationError)?.code == .canceled || (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
        NSLog("ACCOUNT failed: %@", String(describing: error))
        let auth = error as? AuthError
        accountError = t(accountErrorKey(code: auth?.errorCode.rawValue, message: auth?.message, status: nil))
    }

    private func taken(_ error: Error) -> Bool {
        let auth = error as? AuthError
        return isIdentityTaken(code: auth?.errorCode.rawValue, message: auth?.message)
    }

    private func run(_ work: @escaping () async throws -> Void) {
        accountError = nil
        accountBusy = true
        Task {
            defer { accountBusy = false }
            do { try await work() } catch { fail(error) }
        }
    }

    /// Sign in with Apple (natív): a névtelen felhasználó alakul át; ha az Apple-fiókhoz már tartozik felhasználó, abba olvad bele. A nevet az Apple csak az első
    /// engedélyezéskor adja át, ezért azonnal a profilba kerül.
    func signInApple() {
        guard let client = backend.client else { return }
        run { [self] in
            let a = try await appleSignIn.start()
            let cred = OpenIDConnectCredentials(provider: .apple, idToken: a.idToken, nonce: a.nonce)
            if let s = try? await client.auth.session, s.user.isAnonymous {
                do {
                    _ = try await client.auth.linkIdentityWithIdToken(credentials: cred)
                } catch where taken(error) {
                    defaults.set(try await backend.prepareMerge(), forKey: MERGE_KEY)
                    _ = try await client.auth.signInWithIdToken(credentials: cred)
                }
            } else {
                _ = try await client.auth.signInWithIdToken(credentials: cred)
            }
            if a.givenName != nil || a.fullName != nil {
                try await backend.accountRemote?.pushProfile(megszolitas: nil, megszolitasMs: nil, givenName: a.givenName, fullName: a.fullName, namePrompted: nil)
                // az „Így szólítsunk?” lépés a most kapott névvel (a munkamenet-változás a profil írása előtt is lefuthatott)
                if nameStep != nil, nameStep?.isEmpty == true { nameStep = normalizeName(a.givenName ?? "") }
            }
        }
    }

    /// Google: a rendszer bejelentkező lapján; ugyanígy alakul át vagy olvad bele a névtelen felhasználó.
    func signInGoogle() {
        guard let client = backend.client, let redirect = URL(string: AUTH_REDIRECT_IOS) else { return }
        run { [self] in
            if let s = try? await client.auth.session, s.user.isAnonymous {
                let link = try await client.auth.getLinkIdentityURL(provider: .google, redirectTo: redirect)
                let back = try await webAuth.start(link.url)
                if !Self.identityTakenIn(back) {
                    try await finishCallback(back)
                    return
                }
                defaults.set(try await backend.prepareMerge(), forKey: MERGE_KEY)
            }
            let url = try client.auth.getOAuthSignInURL(provider: .google, redirectTo: redirect)
            try await finishCallback(try await webAuth.start(url))
        }
    }

    private static func callbackParams(_ url: URL) -> [String: String] {
        var out: [String: String] = [:]
        for part in [url.query, url.fragment].compactMap({ $0 }) {
            for item in URLComponents(string: "?\(part)")?.queryItems ?? [] { out[item.name] = item.value }
        }
        return out
    }

    private static func identityTakenIn(_ url: URL) -> Bool { callbackParams(url)["error_code"] == "identity_already_exists" }

    private func finishCallback(_ url: URL) async throws {
        guard let client = backend.client else { return }
        #if DEBUG
        // csak a szimulátoros élő próbához: az admin API linkje implicit munkamenetet ad (kiadott appban a kód-csere az egyetlen út)
        let p = Self.callbackParams(url)
        if let access = p["access_token"], let refresh = p["refresh_token"] {
            _ = try await client.auth.setSession(accessToken: access, refreshToken: refresh)
            return
        }
        #endif
        _ = try await client.auth.session(from: url)
    }

    #if DEBUG
    /// Élő próba a fej nélküli szimulátorban (csak DEBUG): `simctl openurl atlagsebesseg://debug/<parancs>`.
    func debugAccountCommand(_ url: URL) {
        switch url.lastPathComponent {
        case "unit-mph": settings.egyseg = .mph
        case "backup-on": settings.felhoMentes = true
        case "signout": signOut()
        case "delete": removeAccount()
        case "name": saveName("Proba")
        default: break
        }
    }
    #endif

    /// A levélben kapott link / OAuth visszatérése.
    func handleAuthCallback(_ url: URL) {
        run { [self] in try await finishCallback(url) }
    }

    /// E-mailes belépés (bejelentkező link, jelszó nélkül). Névtelen munkamenetnél a meglévő felhasználó kapja meg a címet, így minden adata marad; ha a címhez
    /// már tartozik fiók, előbb igazolás készül, és a linkkel az a fiók lép be, amelybe a névtelen beleolvad.
    func sendEmailLink(_ raw: String) {
        guard let client = backend.client, let redirect = URL(string: AUTH_REDIRECT_IOS) else { return }
        let email = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        run { [self] in
            if let s = try? await client.auth.session, s.user.isAnonymous {
                do {
                    _ = try await client.auth.update(user: UserAttributes(email: email), redirectTo: redirect)
                    emailSentTo = email
                    return
                } catch where taken(error) {
                    defaults.set(try await backend.prepareMerge(), forKey: MERGE_KEY)
                }
            }
            try await client.auth.signInWithOTP(email: email, redirectTo: redirect)
            emailSentTo = email
        }
    }

    /// Kijelentkezés és fiók törlése után: új névtelen felhasználó, a helyi adatok maradnak; a mentés kapcsolója nem kerül át a következő fiókra.
    private func leave(_ message: String) async throws {
        accountHandled = nil
        try await backend.continueAnonymously()
        defaults.removeObject(forKey: SEEN_KEY)
        // nem felhasználói döntés (0 idő): visszalépve a fiók értéke érvényes, a többi készülék mentése nem kapcsol ki
        accountFields.values["settings.felho_mentes"] = .bool(false)
        accountFields.times["settings.felho_mentes"] = 0
        settings.felhoMentes = false
        syncStatus = .idle
        lastSyncMs = nil
        emailSentTo = nil
        showToast(AppToast(text: message, color: Tokens.StatusColors.jo, icon: .check))
    }

    func signOut() {
        run { [self] in try await leave(t(.accountSignedOut)) }
    }

    func removeAccount() {
        run { [self] in
            try await backend.deleteAccount()
            try await leave(t(.accountDeleted))
        }
    }

    // MARK: „Így szólítsunk?”

    func saveName(_ name: String) {
        let n = normalizeName(name)
        if !n.isEmpty { settings.megszolitas = n }
        nameStep = nil
        guard !accountSimMode else { return }
        Task { try? await backend.accountRemote?.pushProfile(megszolitas: nil, megszolitasMs: nil, givenName: nil, fullName: nil, namePrompted: true) }
    }

    func skipName() { saveName("") }
}
