import AtlagsebessegCore
import AtlagsebessegTestSupport
import Foundation
import Testing

// packages/core/test/real-geometry.test.ts – valódi OSM-geometrián futó tesztek. A fixtúrákat a data
// csomag állítja elő (packages/core/test/fixtures/osm); fixtúra nélkül a tesztek kihagyva jelennek meg.
private struct OsmFixture: Decodable {
    let section: Section
}

private let osmSections: [Section] = {
    let dir = Fixtures.directory.deletingLastPathComponent().appendingPathComponent("test/fixtures/osm")
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }.sorted { $0.path < $1.path }.compactMap { url in
        (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(OsmFixture.self, from: $0).section }
    }
}()

@Suite("valódi OSM-geometria")
struct RealGeometryTests {
    @Test("van legalább egy olasz OSM-fixtúra", .enabled(if: !osmSections.isEmpty, "nincs OSM-fixtúra (az import nem futott)"))
    func vanFixtura() {
        #expect(osmSections.contains { $0.country == "IT" })
    }
}
