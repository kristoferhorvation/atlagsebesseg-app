import ActivityKit
import SwiftUI
import WidgetKit

// AOS14: a Live Activity kirajzolása (lezárt képernyő + Dynamic Island). Minden szöveg kész, lefordított formában jön az
// apptól (`DriveActivityAttributes.ContentState`); a nézetek a LiveActivityViews.swift-ben (az app szimulátoros
// előnézete is azokat rajzolja).

@main
struct AtlagsebessegWidgetBundle: WidgetBundle {
    var body: some Widget {
        DriveLiveActivity()
    }
}

struct DriveLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DriveActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Tokens.Colors.bg.opacity(0.92))
                .activitySystemActionForegroundColor(Tokens.Colors.text)
                // AOS15: koppintásra az app a megfelelő nézetre nyílik (mérés / navigáció / térkép)
                .widgetURL(context.state.link)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                // AOS15: két oszlop (bal: a fő szám, jobb: tábla / érkezés), alatta a részletek; térképkép nélkül
                DynamicIslandExpandedRegion(.leading) { IslandLeading(state: s) }
                DynamicIslandExpandedRegion(.trailing) { IslandTrailing(state: s) }
                DynamicIslandExpandedRegion(.bottom) { IslandBottom(state: s) }
            } compactLeading: {
                IslandCompactLeading(state: s)
            } compactTrailing: {
                IslandCompactTrailing(state: s)
            } minimal: {
                IslandMinimal(state: s)
            }
            .keylineTint(s.measure?.tone.color ?? Tokens.Colors.accent)
            .widgetURL(s.link)
        }
    }
}
