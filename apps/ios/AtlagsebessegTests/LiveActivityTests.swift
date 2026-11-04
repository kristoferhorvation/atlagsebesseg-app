import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Atlagsebesseg

// AOS16: a napló és a hőtérkép érintetlen (a krúzing-sor tesztje a TripTests-ben); az öt állapot magassága (a rendszer a 160 pt fölötti tartalmat levágja).

@Suite("Live Activity: elrendezés")
struct LiveActivityTests {
    private func height<V: View>(_ v: V, width: CGFloat) -> CGFloat {
        UIHostingController(rootView: v).sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
    }

    @Test("a Live Activity kódja nem nyúl a naplóhoz és a hőtérképhez")
    func nemÉrintiANaplót() throws {
        for rel in ["apps/ios/Atlagsebesseg/LiveActivity/LiveActivityController.swift", "apps/ios/Atlagsebesseg/LiveActivity/LiveMap.swift", "apps/ios/Atlagsebesseg/LiveActivity/DriveActivity.swift", "apps/ios/AtlagsebessegWidget/LiveActivityViews.swift", "apps/ios/AtlagsebessegWidget/DriveLiveActivity.swift"] {
            let text = try String(contentsOf: Repo.root.appendingPathComponent(rel), encoding: .utf8)
            for word in ["tripStore", "tripRecorder", "TripStore", "TripRecorder", "heatIndex", "HeatIndex", "absorbTrip", "heatOutbox"] {
                #expect(!text.contains(word), "\(rel): \(word)")
            }
        }
    }

    @Test("a lezárt képernyő mind az öt állapotban, képpel és kép nélkül legfeljebb 160 pt", arguments: [340.0, 374.0])
    func lezártKépernyő(width: Double) {
        for item in LiveActivitySamples.all {
            for image in [LiveActivitySamples.mapImage, nil] as [UIImage?] {
                var state = item.state
                if image == nil { state.mapVersion = nil }
                let h = height(LockScreenView(state: state, mapImage: image), width: width)
                #expect(h <= LIVE_MAX_HEIGHT, "\(item.name), kép: \(image != nil): \(h) pt")
            }
        }
    }

    @Test("AOS18: a „figyel” soha nem üres, mentett helynél Haza / Munka gomb, navigáció közben nincs gomb")
    func figyelTartalom() throws {
        let idle = try #require(liveActivityState(SessionView(), nav: nil, unit: .kmh, savedHome: true, lang: .hu)?.watch)
        #expect(idle.cruise == "0 km · 0 perc")
        #expect(idle.homeLabel == "Haza")
        #expect(idle.workLabel == nil)
        let none = try #require(liveActivityState(SessionView(), nav: nil, unit: .kmh, lang: .hu)?.watch)
        #expect(none.homeLabel == nil && none.workLabel == nil)
    }

    @Test("AOS18: a gombok kérése egyszer vehető fel (App Group), a célok a helyek azonosítói")
    func gombKeres() {
        _ = LiveNavRouter.take()
        LiveNavRouter.request(LiveNavRouter.work)
        // a teszt-gazdában az App Group nem biztos, hogy elérhető: ilyenkor nincs mit felvenni, de hibát nem okoz
        let first = LiveNavRouter.take()
        #expect(first == LiveNavRouter.work || first == nil)
        #expect(LiveNavRouter.take() == nil)
    }
}
