import AtlagsebessegCore
import Foundation

/// Az appba csomagolt adat (ugyanazok a packages/data/output fájlok, mint a weben): tartalék, ha nincs szerver.
nonisolated enum BundledData {
    private struct SectionFile: Decodable {
        let sections: [Lenient<Section>]
    }

    private struct CameraFile: Decodable {
        let cameras: [Lenient<CameraRow>]
    }

    /// Egy hibás elem ne buktassa el az egész fájlt.
    private struct Lenient<T: Decodable>: Decodable {
        let value: T?

        init(from decoder: Decoder) throws {
            value = try? T(from: decoder)
        }
    }

    private static func url(_ name: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "output")
    }

    static let sections: [Section] = ["PL", "IT", "FR", "ES", "NL", "AT", "HU"].flatMap { c -> [Section] in
        guard let u = url("sections.\(c)"), let data = try? Data(contentsOf: u),
              let file = try? JSONDecoder().decode(SectionFile.self, from: data) else { return [] }
        return file.sections.compactMap(\.value)
    }

    static let cameras: [FixedCamera] = {
        guard let u = url("cameras.HU"), let data = try? Data(contentsOf: u),
              let file = try? JSONDecoder().decode(CameraFile.self, from: data) else { return [] }
        return file.cameras.compactMap(\.value?.camera)
    }()
}
