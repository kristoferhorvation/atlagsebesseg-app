import PhotosUI
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
            // a webes `font-size: min(20px, 4.5vw)`: egy sorban marad
            .css(min(Tokens.Typography.body.size, 0.045 * UIScreen.main.bounds.width), Tokens.FontWeight.w600)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(Tokens.Colors.appleButtonText)
            .background(Tokens.Colors.appleButton, in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

/// AW22 + AW24: a Beállítások teteje (a webes `apps/web/src/ui/AccountCard.tsx`, spec: `account-card`, INV-20). Kijelentkezve: az Apple-gomb az elsődleges, nagy gomb, alatta kisebben a Google és az
/// e-mail (magic link, jelszó nincs). Bejelentkezve: kör alakú profilkép, név, e-mail. Mindkét esetben alatta a Megszólítás. A felhős mentés és a fiók törlése az Adatvédelem blokkban, a kijelentkezés a lap legalján.
struct AccountCard: View {
    @Bindable var model: AppModel
    @State private var emailOpen = false
    @State private var email = ""

    var body: some View {
        if let user = model.accountUserState, !user.isAnonymous {
            signedIn(user)
        } else {
            GroupLabel(text: t(.accountTitle))
            signedOut
        }
        NameRow(model: model).padding(.top, Tokens.Space.s3)
    }

    private func signedIn(_ user: AccountUser) -> some View {
        let name = accountTitle(user, name: model.settings.megszolitas)
        return VStack(spacing: Tokens.Space.s2) {
            AvatarButton(model: model, name: name)
            Text(name).css(Tokens.FontSize.f20, Tokens.FontWeight.w640).foregroundStyle(Tokens.Colors.text).lineLimit(1).truncationMode(.tail)
            if let e = user.email, e != name {
                Text(e).css(Tokens.FontSize.f15, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Tokens.Space.s1)
        .padding(.bottom, Tokens.Space.s1)
        .accessibilityIdentifier("account-card")
    }

    private var signedOut: some View {
        ListCard {
            VStack(alignment: .leading, spacing: 10) {
                hint(t(.accountHint))
                Button { model.signInApple() } label: {
                    HStack(spacing: Tokens.Space.s2) {
                        Icon(name: .apple, size: 22)
                        Text(t(.accountApple)).lineLimit(1)
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

    /// A webes `.list-row .hint`: 14 pt, 18,9 pt-es sor, mohó tördeléssel, 3 pt-tel a fölötte lévő sor alatt.
    private func hint(_ s: String) -> some View {
        GreedyText(text: s, font: .inter(Tokens.FontSize.f14, Tokens.FontWeight.w400), lineHeight: 1.35 * Tokens.FontSize.f14, color: Tokens.Colors.textMuted)
            .padding(.top, 3)
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
            GreedyText(text: t(.accountNudgeText), font: .inter(Tokens.Typography.body.size, Tokens.FontWeight.w600), lineHeight: 26, color: Tokens.Colors.text)
            HStack(spacing: 10) {
                // a webes `font-size: min(20px, 5vw)`
                Button(t(.accountNudgeLater), action: onLater).buttonStyle(WideButtonStyle(size: min(Tokens.Typography.body.size, 0.05 * UIScreen.main.bounds.width)))
                Button(t(.accountNudgeAction), action: onSignIn).buttonStyle(WideButtonStyle(kind: .primary, size: min(Tokens.Typography.body.size, 0.05 * UIScreen.main.bounds.width)))
            }
        }
        // a CSS-keret (1 pt) a belső margóhoz adódik
        .padding(17)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: Tokens.Radius.card)
    }
}

/// AW24: a kör alakú profilkép (a webes `Avatar`): a választott kép, különben a szolgáltató képe, különben monogram. Érintésre a fotótár.
private struct AvatarButton: View {
    @Bindable var model: AppModel
    let name: String
    @State private var pick: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $pick, matching: .images) {
            content
                .frame(width: Tokens.Size.avatar, height: Tokens.Size.avatar)
                .background(Tokens.Colors.surfaceRaised, in: Circle())
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Tokens.Colors.strokeStrong, lineWidth: 1))
        }
        .accessibilityLabel(t(.accountAvatarChange))
        .onChange(of: pick) {
            guard let item = pick else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { model.setAvatar(img) }
                pick = nil
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let s = model.avatarDataUrl, let i = s.firstIndex(of: ","), let data = Data(base64Encoded: String(s[s.index(after: i)...])), let img = UIImage(data: data) {
            Image(uiImage: img).resizable().scaledToFill()
        } else if let u = model.accountUserState?.avatarUrl, let url = URL(string: u) {
            AsyncImage(url: url) { phase in
                if case let .success(image) = phase { image.resizable().scaledToFill() } else { initials }
            }
        } else {
            initials
        }
    }

    private var initials: some View {
        Text(avatarInitials(name, model.accountUserState?.email)).css(Tokens.FontSize.f28, Tokens.FontWeight.w640).foregroundStyle(Tokens.Colors.text)
    }
}

/// AW24: a Megszólítás mező; a magyarázat a megadott névvel, élőben (a webes `NameRow`).
private struct NameRow: View {
    @Bindable var model: AppModel

    private var name: Binding<String> {
        Binding(get: { model.settings.megszolitas }, set: { model.settings.megszolitas = String($0.prefix(MEGSZOLITAS_MAX)) })
    }

    var body: some View {
        ListCard {
            VStack(alignment: .leading, spacing: 10) {
                RowText(label: t(.settingsName), hint: greetingPreview(model.settings.megszolitas))
                TextField(t(.settingsNamePlaceholder), text: name)
                    .font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620))
                    .textContentType(.givenName)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { model.settings.megszolitas = normalizeName(model.settings.megszolitas) }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 48)
                    .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
            }
            .listRow()
        }
    }
}

/// AW24: a felhős mentés kapcsolója az Adatvédelem blokkban (csak bejelentkezve; a webes `BackupRow`).
struct BackupRow: View {
    @Bindable var model: AppModel
    var body: some View {
        if model.signedInAccount {
            RowDivider()
            ToggleRow(label: t(.accountBackup), hint: t(.accountBackupHint), isOn: $model.settings.felhoMentes)
        }
    }
}

/// AW24: a „Fiók törlése” az Adatvédelem blokk alján, pirosan, megerősítéssel (a webes `DeleteAccountRow`).
struct DeleteAccountRow: View {
    @Bindable var model: AppModel
    @State private var confirm = false

    var body: some View {
        if model.signedInAccount {
            RowDivider()
            Group {
                if confirm {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(t(.accountDelete)).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w580)).foregroundStyle(Tokens.Colors.text)
                        Text(t(.accountDeleteBody)).css(Tokens.Typography.caption.size, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                        HStack(spacing: Tokens.Space.s2) {
                            Spacer(minLength: 0)
                            Button(t(.accountCancel)) { confirm = false }.buttonStyle(MiniButtonStyle())
                            Button(t(.accountDeleteConfirm)) { model.removeAccount() }
                                .buttonStyle(MiniButtonStyle(danger: true))
                                .disabled(model.accountBusy)
                        }
                    }
                    .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                    .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
                } else {
                    Button(t(.accountDelete)) { confirm = true }
                        .buttonStyle(MiniButtonStyle(danger: true, wide: true))
                }
            }
            .listRow()
        }
    }
}

/// AW24: a „Kijelentkezés” a Beállítások legalján, utolsó elemként (a webes `SignOutRow`).
struct SignOutRow: View {
    @Bindable var model: AppModel

    var body: some View {
        if model.signedInAccount {
            ListCard {
                VStack(alignment: .leading, spacing: 10) {
                    Button(t(.accountSignOut)) { model.signOut() }
                        .buttonStyle(MiniButtonStyle(wide: true))
                        .disabled(model.accountBusy)
                    Text(t(.accountSignOutHint)).css(Tokens.Typography.caption.size, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.textMuted)
                    if let error = model.accountError {
                        Text(error).css(Tokens.Typography.caption.size, Tokens.FontWeight.w400).foregroundStyle(Tokens.Colors.over)
                    }
                }
                .listRow()
            }
            .padding(.top, Tokens.Space.s3)
            .accessibilityIdentifier("account-signout")
        }
    }
}
