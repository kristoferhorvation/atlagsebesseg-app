import SwiftUI

/// AW22: a Google hivatalos, négyszínű „G” jele (a webes `GoogleMark`, a színek a tokenekből).
private struct GoogleMark: View {
    var body: some View {
        ZStack {
            Icon(name: .googleB, size: 20).foregroundStyle(Tokens.Colors.googleBlue)
            Icon(name: .googleG, size: 20).foregroundStyle(Tokens.Colors.googleGreen)
            Icon(name: .googleY, size: 20).foregroundStyle(Tokens.Colors.googleYellow)
            Icon(name: .googleR, size: 20).foregroundStyle(Tokens.Colors.googleRed)
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}

/// AW22: az Apple-gomb a hivatalos fehér stílusban (a webes `.apple-btn`): saját felirat a szótárból, mert az app nyelve eltérhet a készülékétől.
struct AppleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .css(Tokens.Typography.body.size, Tokens.FontWeight.w600)
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(Tokens.Colors.appleButtonText)
            .background(Tokens.Colors.appleButton, in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

/// AW22: a Beállítások „Fiók” kártyája a lap tetején (a webes `apps/web/src/ui/AccountCard.tsx`, spec: `account-card`). Kijelentkezve: az Apple-gomb az
/// elsődleges, nagy gomb, alatta kisebben a Google és az e-mail (magic link, jelszó nincs). Bejelentkezve: név / e-mail, a szinkron állapota, felhős mentés,
/// kijelentkezés, fiók törlése megerősítéssel. A be nem állított szolgáltatót felirat jelzi, nem hiba.
struct AccountCard: View {
    @Bindable var model: AppModel
    @State private var emailOpen = false
    @State private var email = ""
    @State private var confirmDelete = false

    var body: some View {
        GroupLabel(text: t(.accountTitle))
        if let user = model.accountUserState, !user.isAnonymous {
            signedIn(user)
        } else {
            signedOut
        }
    }

    private func signedIn(_ user: AccountUser) -> some View {
        ListCard {
            VStack(alignment: .leading, spacing: 2) {
                Text(accountTitle(user, name: model.settings.megszolitas))
                    .font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w580))
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(1)
                if let e = user.email { hint(e) }
                hint(syncStatusText(model.syncStatus, lastSyncMs: model.lastSyncMs, formatTime: Self.time))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRow()
            RowDivider()
            ToggleRow(label: t(.accountBackup), hint: t(.accountBackupHint), isOn: $model.settings.felhoMentes)
            RowDivider()
            VStack(alignment: .leading, spacing: 10) {
                Button(t(.accountSignOut)) { model.signOut() }
                    .buttonStyle(MiniButtonStyle(wide: true))
                    .disabled(model.accountBusy)
                hint(t(.accountSignOutHint))
                if confirmDelete {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(t(.accountDelete)).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w580)).foregroundStyle(Tokens.Colors.text)
                        hint(t(.accountDeleteBody))
                        HStack(spacing: Tokens.Space.s2) {
                            Spacer(minLength: 0)
                            Button(t(.accountCancel)) { confirmDelete = false }.buttonStyle(MiniButtonStyle())
                            Button(t(.accountDeleteConfirm)) { model.removeAccount() }
                                .buttonStyle(MiniButtonStyle(danger: true))
                                .disabled(model.accountBusy)
                        }
                    }
                    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
                } else {
                    Button(t(.accountDelete)) { confirmDelete = true }
                        .buttonStyle(MiniButtonStyle(danger: true, wide: true))
                }
            }
            .listRow()
            if let error = model.accountError {
                RowDivider()
                errorText(error).listRow()
            }
        }
    }

    private var signedOut: some View {
        ListCard {
            VStack(alignment: .leading, spacing: 10) {
                hint(t(.accountHint))
                Button { model.signInApple() } label: {
                    HStack(spacing: 10) {
                        Icon(name: .apple, size: 22)
                        Text(t(.accountApple)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                }
                .buttonStyle(AppleButtonStyle())
                .disabled(model.accountBusy || !model.accountProviders.apple)
                .opacity(model.accountProviders.apple ? 1 : Tokens.Opacity.o45)
                HStack(spacing: Tokens.Space.s2) {
                    Button { model.signInGoogle() } label: {
                        HStack(spacing: Tokens.Space.s2) {
                            GoogleMark()
                            Text(t(.accountGoogle))
                        }
                    }
                    .buttonStyle(MiniButtonStyle(wide: true))
                    .disabled(model.accountBusy || !model.accountProviders.google)
                    .opacity(model.accountProviders.google ? 1 : Tokens.Opacity.o45)
                    Button { emailOpen.toggle() } label: {
                        HStack(spacing: Tokens.Space.s2) {
                            Icon(name: .mail, size: 20)
                            Text(t(.accountEmail))
                        }
                    }
                    .buttonStyle(MiniButtonStyle(wide: true))
                }
                if !model.accountProviders.apple || !model.accountProviders.google { hint(t(.accountNotConfigured)) }
                if emailOpen || UserDefaults.standard.bool(forKey: "accountEmailOpen"), model.emailSentTo == nil {
                    TextField(t(.accountEmailPlaceholder), text: $email)
                        .font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620))
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.send)
                        .onSubmit { if validEmail(email) { model.sendEmailLink(email) } }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 48)
                        .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
                    Button(t(.accountEmailSend)) { model.sendEmailLink(email) }
                        .buttonStyle(MiniButtonStyle(wide: true))
                        .disabled(model.accountBusy || !validEmail(email))
                        .opacity(validEmail(email) ? 1 : Tokens.Opacity.o45)
                    hint(t(.accountEmailHint))
                }
                if let sent = model.emailSentTo { hint(t(.accountEmailSent, ["email": sent])) }
                if let error = model.accountError { errorText(error) }
            }
            .listRow()
        }
    }

    private func hint(_ s: String) -> some View {
        Text(s)
            .font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w400))
            .foregroundStyle(Tokens.Colors.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func errorText(_ s: String) -> some View {
        Text(s)
            .font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w400))
            .foregroundStyle(Tokens.Colors.over)
            .fixedSize(horizontal: false, vertical: true)
    }

    private static func time(_ ms: Double) -> String {
        let f = DateFormatter()
        f.locale = L10n.lang.locale
        f.dateStyle = .none
        f.timeStyle = .short
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}

/// Az első bejelentkezés utáni könnyű, kihagyható lépés: „Így szólítsunk?” (a webes `NameStepSheet`).
struct NameStepSheet: View {
    @State var name: String
    let onSave: (String) -> Void
    let onSkip: () -> Void

    init(initial: String, onSave: @escaping (String) -> Void, onSkip: @escaping () -> Void) {
        _name = State(initialValue: initial)
        self.onSave = onSave
        self.onSkip = onSkip
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetHead(title: t(.accountNameTitle), onClose: onSkip)
            TextField(t(.settingsNamePlaceholder), text: Binding(get: { name }, set: { name = String($0.prefix(MEGSZOLITAS_MAX)) }))
                .font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620))
                .textContentType(.givenName)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
            HStack(spacing: 10) {
                Button(t(.accountNameSkip), action: onSkip).buttonStyle(WideButtonStyle())
                Button(t(.accountNameSave)) { onSave(name) }
                    .buttonStyle(WideButtonStyle(kind: .primary))
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? Tokens.Opacity.o45 : 1)
            }
        }
        .padding(EdgeInsets(top: 20, leading: 16, bottom: 16, trailing: 16))
    }
}

/// A befejezett út utáni, kihagyható ajánlat (legfeljebb egyszer, 30 napig nem jön újra; a webes `SignInNudge`).
struct SignInNudge: View {
    let onSignIn: () -> Void
    let onLater: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(t(.accountNudgeText))
                .css(Tokens.Typography.body.size, Tokens.FontWeight.w600)
                .foregroundStyle(Tokens.Colors.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button(t(.accountNudgeLater), action: onLater).buttonStyle(WideButtonStyle())
                Button(t(.accountNudgeAction), action: onSignIn).buttonStyle(WideButtonStyle(kind: .primary))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: Tokens.Radius.card)
    }
}
