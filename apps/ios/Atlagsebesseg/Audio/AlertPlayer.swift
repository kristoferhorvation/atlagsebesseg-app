import AudioToolbox
import AVFoundation

/// A jelzések hang-rétege: rövid kéthangú csipogás, utána bemondás az app nyelvén, és rezgés.
/// Az audio-munkamenet csak a jelzés idejére aktív: `.playback` (a némítás-kapcsolótól függetlenül szól – a
/// felhasználó a beállításokban választhat csak rezgést vagy ki-t), a zene közben halkul (`duckOthers`), és a
/// `audio` háttér-mód miatt zárolt képernyőn is szól. A bemondás után a többi app hangereje visszaáll.
final class AlertPlayer: NSObject, AlertSink, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private lazy var chime: AVAudioPCMBuffer? = Self.makeChime()
    private var engineReady = false

    override init() {
        super.init()
        synth.delegate = self
    }

    func deliver(_ event: AlertEvent, _ delivery: AlertDelivery) {
        switch delivery {
        case .silent:
            // a kézbesítő ilyenkor nem is hív (csak a sáv látszik)
            return
        case .vibrate:
            vibrate()
        case .sound:
            activateSession()
            playChime()
            speak(event.text)
            vibrate()
        }
    }

    private func vibrate() {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    }

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
    }

    private func deactivateSession() {
        guard !synth.isSpeaking else { return }
        player.stop()
        engine.pause()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func playChime() {
        guard let chime else { return }
        if !engineReady {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: chime.format)
            engineReady = true
        }
        if !engine.isRunning { try? engine.start() }
        guard engine.isRunning else { return }
        player.scheduleBuffer(chime, at: nil, options: .interrupts)
        player.play()
    }

    private func speak(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        // BCP 47 („hu-HU”), mint a webes LOCALES
        u.voice = AVSpeechSynthesisVoice(language: L10n.lang.locale.identifier.replacingOccurrences(of: "_", with: "-"))
        // a csipogás után szóljon
        u.preUtteranceDelay = 0.35
        synth.speak(u)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deactivateSession() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deactivateSession() }
    }

    /// Két rövid szinuszhang (H5 → E6, 110 + 160 ms), lágy fel- és lefutással, hogy ne kattogjon.
    private static func makeChime() -> AVAudioPCMBuffer? {
        let rate = 44_100.0
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else { return nil }
        let notes: [(hz: Double, s: Double)] = [(987.77, 0.11), (1318.51, 0.16)]
        let total = AVAudioFrameCount(notes.reduce(0) { $0 + $1.s } * rate)
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: total), let out = buf.floatChannelData?[0] else { return nil }
        var i = 0
        for note in notes {
            let n = Int(note.s * rate)
            let fade = Int(0.012 * rate)
            for k in 0..<n {
                let env = min(1, Double(k) / Double(fade), Double(n - k) / Double(fade))
                out[i] = Float(0.32 * env * sin(2 * .pi * note.hz * Double(k) / rate))
                i += 1
            }
        }
        buf.frameLength = AVAudioFrameCount(i)
        return buf
    }
}
